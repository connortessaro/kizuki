"""Independent ground truth for the SQL evals.

Deliberately does not touch DuckDB. If expected answers were computed with the
same pipeline under test, the eval would pass whenever the pipeline was
self-consistently wrong, which is the failure mode that matters. These functions
shell out to git and count in Python instead.

They replicate three warehouse conventions exactly, and the replication is the
point -- getting any of them wrong shows up as a disagreement to investigate:
author date (not commit date), UTC (not local time), and bots excluded.
"""

from __future__ import annotations

import datetime
import subprocess
from functools import cache
from itertools import pairwise
from pathlib import Path

import yaml

CONFIG = Path(__file__).resolve().parents[1] / "config" / "repos.yaml"

BOT_MARKERS = ("[bot]", "dependabot", "copilot", "gitbutler")

DEFAULT_REFS = (
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
    "HEAD",
)


def repos() -> list[tuple[str, Path]]:
    cfg = yaml.safe_load(CONFIG.read_text())
    return [(r["slug"], Path(r["path"]).expanduser()) for r in cfg["repos"]]


def _git(path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(path), *args], capture_output=True, text=True, check=False
    )
    return result.stdout if result.returncode == 0 else ""


def default_ref(path: Path) -> str | None:
    for ref in DEFAULT_REFS:
        if _git(path, "rev-parse", "--verify", "--quiet", ref).strip():
            return ref
    return None


def is_bot(email: str, name: str) -> bool:
    blob = f"{email} {name}".lower()
    return any(marker in blob for marker in BOT_MARKERS)


@cache
def commits(slug: str) -> tuple[dict, ...]:
    """Every non-bot commit on the default branch, with UTC author dates."""
    path = dict(repos())[slug]
    ref = default_ref(path)
    if ref is None:
        return ()
    raw = _git(path, "log", ref, "--format=%H%x1f%aI%x1f%ae%x1f%an%x1f%s")
    out = []
    for line in raw.strip().split("\n"):
        if not line:
            continue
        sha, iso, email, name, subject = line.split("\x1f")
        if is_bot(email, name):
            continue
        dt = datetime.datetime.fromisoformat(iso).astimezone(datetime.UTC)
        out.append({"sha": sha, "at": dt, "email": email, "name": name, "subject": subject})
    return tuple(out)


def all_commits() -> list[dict]:
    return [{**c, "repo": slug} for slug, _ in repos() for c in commits(slug)]


# --- the reference answers ------------------------------------------------

def commits_in_month(slug: str, year_month: str) -> int:
    return sum(1 for c in commits(slug) if c["at"].strftime("%Y-%m") == year_month)


def busiest_repo_in_month(year_month: str) -> tuple[str, int]:
    counts: dict[str, int] = {}
    for slug, _ in repos():
        n = commits_in_month(slug, year_month)
        if n:
            counts[slug] = n
    top = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
    return top


def total_commits() -> int:
    return len(all_commits())


def repo_count_with_activity() -> int:
    return sum(1 for slug, _ in repos() if commits(slug))


def busiest_month_overall() -> tuple[str, int]:
    counts: dict[str, int] = {}
    for c in all_commits():
        key = c["at"].strftime("%Y-%m")
        counts[key] = counts.get(key, 0) + 1
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))


def distinct_author_emails() -> int:
    return len({c["email"].lower() for c in all_commits()})


def repo_with_most_commits() -> tuple[str, int]:
    counts = {slug: len(commits(slug)) for slug, _ in repos()}
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))


def largest_month_over_month_increase() -> tuple[str, str, int]:
    """Returns (repo, year_month, delta) for the biggest rise versus the prior month."""
    best = ("", "", -10**9)
    for slug, _ in repos():
        by_month: dict[str, int] = {}
        for c in commits(slug):
            key = c["at"].strftime("%Y-%m")
            by_month[key] = by_month.get(key, 0) + 1
        months = sorted(by_month)
        for prev, cur in pairwise(months):
            delta = by_month[cur] - by_month[prev]
            if delta > best[2]:
                best = (slug, cur, delta)
    return best


def conventional_commit_share() -> float:
    import re

    pattern = re.compile(r"^[a-zA-Z]+(\([^)]*\))?!?: ")
    rows = all_commits()
    return round(sum(1 for c in rows if pattern.match(c["subject"])) / len(rows), 4)


def merge_commit_count(slug: str) -> int:
    path = dict(repos())[slug]
    ref = default_ref(path)
    return len([ln for ln in _git(path, "rev-list", ref, "--merges").strip().split("\n") if ln])
