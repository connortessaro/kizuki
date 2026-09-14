"""Author identity resolution.

Git author metadata is not a person. One human shows up under several emails and
several display names, bots show up as authors, and some emails are ones we must
never publish. This module collapses raw (email, name) pairs into contributors
and records *why* each collapse happened, so the decision is auditable rather
than magic.

Manual overrides are keyed by a salted hash of the normalized email rather than
the email itself, so the checked-in override file contains no personal or
employer addresses.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

IDENTITY_SALT = "kizuki-identity-v1"

BOT_PATTERNS = (
    re.compile(r"\[bot\]", re.IGNORECASE),
    re.compile(r"^dependabot", re.IGNORECASE),
    re.compile(r"^copilot", re.IGNORECASE),
    re.compile(r"^gitbutler", re.IGNORECASE),
    re.compile(r"@gitbutler\.com$", re.IGNORECASE),
    re.compile(r"noreply@github\.com$", re.IGNORECASE),
)

GH_NOREPLY = re.compile(r"^(?:(?P<uid>\d+)\+)?(?P<login>[^@]+)@users\.noreply\.github\.com$", re.IGNORECASE)

_PLUS_TAG = re.compile(r"\+[^@]*(?=@)")
_DOT_LOCAL = re.compile(r"\.(?=[^@]*@)")

GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}


def normalize_email(email: str) -> str:
    """Lowercase, strip +tags, and strip dots in the local part for Gmail only.

    Dots are only insignificant at Gmail; stripping them everywhere would merge
    genuinely different people at other providers.
    """
    email = email.strip().lower()
    if "@" not in email:
        return email
    local, _, domain = email.partition("@")
    # On users.noreply.github.com the '+' separates the numeric user id from the
    # login; it is not a plus-tag, and stripping it would discard the login.
    if domain != "users.noreply.github.com":
        local = _PLUS_TAG.sub("", local + "@").rstrip("@")
    if domain in GMAIL_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}"


def identity_hash(email: str) -> str:
    """Stable, salted hash of a normalized email. Safe to commit."""
    normalized = normalize_email(email)
    return hashlib.sha256(f"{IDENTITY_SALT}|{normalized}".encode()).hexdigest()[:16]


def identity_id(email: str, name: str) -> str:
    return hashlib.sha256(f"{normalize_email(email)}|{name}".encode()).hexdigest()[:16]


def github_login(email: str) -> str | None:
    match = GH_NOREPLY.match(email.strip())
    return match.group("login").lower() if match else None


def is_bot(email: str, name: str) -> bool:
    return any(p.search(email) or p.search(name) for p in BOT_PATTERNS)


@dataclass(frozen=True)
class RawIdentity:
    email: str
    name: str
    commit_count: int
    repos: tuple[str, ...]

    @property
    def identity_id(self) -> str:
        return identity_id(self.email, self.name)


@dataclass(frozen=True)
class Resolution:
    identity_id: str
    contributor_id: str
    rule_kind: str
    evidence: str
    confidence: float


def _union(parent: dict[str, str], a: str, b: str) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[rb] = ra


def _find(parent: dict[str, str], a: str) -> str:
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


def resolve(
    identities: list[RawIdentity],
    overrides: dict[str, str] | None = None,
) -> tuple[list[Resolution], dict[str, dict]]:
    """Collapse raw identities into contributors.

    `overrides` maps identity_hash(email) -> a contributor group label. It exists
    because no automatic rule can know that a personal Gmail and an employer
    address are the same human; only the human knows that.

    Returns (resolutions, contributors). Every raw identity gets exactly one
    resolution row naming the rule that placed it, so the mapping is reviewable.
    """
    overrides = overrides or {}
    parent = {i.identity_id: i.identity_id for i in identities}
    reasons: dict[str, tuple[str, str, float]] = {}

    def note(ident: str, kind: str, evidence: str, confidence: float) -> None:
        prior = reasons.get(ident)
        if prior is None or confidence > prior[2]:
            reasons[ident] = (kind, evidence, confidence)

    bots = {i.identity_id for i in identities if is_bot(i.email, i.name)}
    for i in identities:
        if i.identity_id in bots:
            note(i.identity_id, "bot_pattern", f"{i.email} / {i.name} matches a bot pattern", 1.0)

    # Rule: same normalized email is the same account, so the same person.
    by_email: dict[str, list[RawIdentity]] = {}
    for i in identities:
        by_email.setdefault(normalize_email(i.email), []).append(i)
    for email, group in by_email.items():
        for other in group[1:]:
            _union(parent, group[0].identity_id, other.identity_id)
            note(other.identity_id, "normalized_email", f"shares normalized email {email}", 1.0)

    # Rule: a GitHub noreply address carries the login, which ties it to any
    # other identity resolved to that login.
    by_login: dict[str, list[RawIdentity]] = {}
    for i in identities:
        login = github_login(i.email)
        if login:
            by_login.setdefault(login, []).append(i)
    for login, group in by_login.items():
        for other in group[1:]:
            _union(parent, group[0].identity_id, other.identity_id)
            note(other.identity_id, "github_noreply_login", f"github login {login}", 0.9)

    # Rule: operator-supplied, hash-keyed. Highest confidence because a human
    # asserted it; the raw address never appears in the config.
    by_group: dict[str, list[RawIdentity]] = {}
    for i in identities:
        label = overrides.get(identity_hash(i.email))
        if label:
            by_group.setdefault(label, []).append(i)
    for label, group in by_group.items():
        for other in group[1:]:
            _union(parent, group[0].identity_id, other.identity_id)
        for member in group:
            note(member.identity_id, "manual_override", f"operator mapped to '{label}'", 1.0)

    # A bot must never end up in a group with a human. Bots merging with other
    # bots is fine and desirable -- vercel[bot] has two addresses. So split any
    # mixed group rather than isolating every bot.
    groups_seen: dict[str, set[bool]] = {}
    for i in identities:
        groups_seen.setdefault(_find(parent, i.identity_id), set()).add(i.identity_id in bots)
    contaminated = {root for root, kinds in groups_seen.items() if len(kinds) > 1}
    if contaminated:
        for i in identities:
            if _find(parent, i.identity_id) in contaminated and i.identity_id in bots:
                parent[i.identity_id] = i.identity_id
        # Re-merge the freed bots among themselves by normalized email and login.
        freed = [i for i in identities if i.identity_id in bots]
        for key_fn in (lambda x: normalize_email(x.email), lambda x: github_login(x.email)):
            buckets: dict[str, list[RawIdentity]] = {}
            for i in freed:
                key = key_fn(i)
                if key:
                    buckets.setdefault(key, []).append(i)
            for members in buckets.values():
                for other in members[1:]:
                    _union(parent, members[0].identity_id, other.identity_id)

    groups: dict[str, list[RawIdentity]] = {}
    for i in identities:
        groups.setdefault(_find(parent, i.identity_id), []).append(i)

    resolutions: list[Resolution] = []
    contributors: dict[str, dict] = {}
    for root, members in groups.items():
        members = sorted(members, key=lambda m: (-m.commit_count, m.email))
        canonical = members[0]
        contributor_id = "con_" + hashlib.sha256(root.encode()).hexdigest()[:12]
        bot = canonical.identity_id in bots
        contributors[contributor_id] = {
            "contributor_id": contributor_id,
            "canonical_name": canonical.name,
            "canonical_email_hash": identity_hash(canonical.email),
            "identity_count": len(members),
            "is_bot": bot,
            "total_commits": sum(m.commit_count for m in members),
        }
        for m in members:
            kind, evidence, confidence = reasons.get(
                m.identity_id, ("singleton", "only identity in its group", 1.0)
            )
            resolutions.append(
                Resolution(m.identity_id, contributor_id, kind, evidence, confidence)
            )
    return resolutions, contributors
