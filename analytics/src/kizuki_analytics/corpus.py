"""Generates the synthetic meeting and decision corpus.

The structured half of this project is real: real commits, real authors, real
timestamps, real file paths, real churn. The meetings and decisions are not.
They are fabricated so that hybrid questions have something to retrieve, and
they are generated *from* the real commit timeline so the two halves actually
line up -- a meeting that discusses a spike is dated inside that spike and names
the files that actually changed.

Generation is deterministic and seeded from the window identity, with no model
call anywhere. That keeps the corpus reproducible, keeps evals free of provider
drift, and lets CI regenerate it from scratch. It costs some prose realism; the
tradeoff is deliberate.

Contributor display names are pseudonymized by default. The commit data is the
operator's own, but it includes collaborators who did not volunteer to appear in
a portfolio demo.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

GENERATOR_VERSION = "kizuki-corpus@1.0.0"

SYNTHETIC_NOTICE = (
    
        "SYNTHETIC RECORD. This meeting did not happen. It was generated from real "
        "commit activity to give the retrieval layer something to retrieve. The "
        "commits, files, dates and churn figures below are real; the discussion, "
        "decisions and attributed statements are fabricated."
    
)

MEETING_KINDS = ("design review", "planning", "retro", "incident review", "working session")

PSEUDONYMS = (
    "Avery Brooks", "Rowan Patel", "Sasha Lindqvist", "Devin Okafor",
    "Mira Castellanos", "Jonah Reyes", "Priya Raghunathan", "Tomas Alvarez",
)


@dataclass(frozen=True)
class Window:
    repo_slug: str
    week_start: date
    commits: int
    contributors: tuple[str, ...]
    components: tuple[str, ...]
    paths: tuple[str, ...]
    subjects: tuple[str, ...]
    shas: tuple[str, ...]
    insertions: int
    deletions: int

    @property
    def window_id(self) -> str:
        raw = f"{self.repo_slug}|{self.week_start.isoformat()}"
        return "win_" + hashlib.sha256(raw.encode()).hexdigest()[:12]

    @property
    def seed(self) -> int:
        return int(hashlib.sha256(self.window_id.encode()).hexdigest()[:16], 16)


@dataclass(frozen=True)
class Decision:
    decision_id: str
    window_id: str
    repo_slug: str
    title: str
    statement: str
    rationale: str
    decided_on: date
    status: str
    components: tuple[str, ...]
    paths: tuple[str, ...]
    shas: tuple[str, ...] = field(default=())


@dataclass(frozen=True)
class Meeting:
    meeting_id: str
    window_id: str
    repo_slug: str
    title: str
    kind: str
    occurred_on: date
    participants: tuple[str, ...]
    body: str
    decisions: tuple[Decision, ...]
    grounding_shas: tuple[str, ...]
    grounding_paths: tuple[str, ...]

    @property
    def slug(self) -> str:
        return f"{self.occurred_on.isoformat()}-{self.repo_slug}-{self.kind.replace(' ', '-')}"


WINDOW_SQL = """
WITH weekly AS (
    SELECT
        repo_slug,
        date_trunc('week', authored_date)::DATE AS week_start,
        count(*)                               AS commits,
        sum(insertions)                        AS insertions,
        sum(deletions)                         AS deletions,
        list_distinct(list(contributor))       AS contributors,
        list_distinct(flatten(list(touched_components))) AS components,
        list(subject)                          AS subjects,
        list(commit_sha)                       AS shas
    FROM v_commit
    GROUP BY repo_slug, week_start
    HAVING count(*) >= ?
)
SELECT
    w.*,
    (SELECT list_distinct(list(f.path))
     FROM v_commit_file f
     WHERE f.repo_slug = w.repo_slug
       AND date_trunc('week', f.authored_date)::DATE = w.week_start) AS paths
FROM weekly w
ORDER BY w.commits DESC
"""


def pseudonym_map(names: list[str], enabled: bool = False) -> dict[str, str]:
    """Stable name -> pseudonym mapping, ordered so it does not shift run to run.

    Off by default: the warehouse already pseudonymizes contributor display
    names, and mapping twice would produce two different aliases for one person.
    Enable only when reading from a warehouse built with pseudonymize=False.
    """
    if not enabled:
        return {n: n for n in names}
    ordered = sorted(names)
    return {name: PSEUDONYMS[i % len(PSEUDONYMS)] for i, name in enumerate(ordered)}


def find_windows(con, min_commits: int = 4, limit: int | None = None) -> list[Window]:
    rows = con.execute(WINDOW_SQL, [min_commits]).fetchall()
    windows = [
        Window(
            repo_slug=r[0],
            week_start=r[1],
            commits=r[2],
            insertions=r[3] or 0,
            deletions=r[4] or 0,
            contributors=tuple(r[5] or ()),
            components=tuple(c for c in (r[6] or ()) if c),
            subjects=tuple(r[7] or ()),
            shas=tuple(r[8] or ()),
            paths=tuple(r[9] or ()),
        )
        for r in rows
    ]
    return windows[:limit] if limit else windows


def _top(items: tuple[str, ...], rng: random.Random, n: int) -> tuple[str, ...]:
    unique = list(dict.fromkeys(items))
    if len(unique) <= n:
        return tuple(unique)
    return tuple(rng.sample(unique, n))


def build_meeting(window: Window, names: dict[str, str]) -> Meeting:
    rng = random.Random(window.seed)
    kind = MEETING_KINDS[rng.randrange(len(MEETING_KINDS))]
    occurred_on = window.week_start + timedelta(days=rng.randrange(0, 5))
    participants = tuple(names.get(c, c) for c in sorted(window.contributors))
    paths = _top(window.paths, rng, 6)
    components = window.components or ("other",)
    subjects = _top(window.subjects, rng, 5)
    shas = tuple(window.shas[: min(8, len(window.shas))])

    decisions = _build_decisions(window, rng, components, paths, shas, occurred_on)
    body = _render_body(window, kind, occurred_on, participants, components, paths, subjects, decisions)

    return Meeting(
        meeting_id="mtg_" + hashlib.sha256(f"{window.window_id}|{kind}".encode()).hexdigest()[:12],
        window_id=window.window_id,
        repo_slug=window.repo_slug,
        title=f"{window.repo_slug} {kind} — week of {window.week_start.isoformat()}",
        kind=kind,
        occurred_on=occurred_on,
        participants=participants,
        body=body,
        decisions=decisions,
        grounding_shas=shas,
        grounding_paths=paths,
    )


DECISION_SHAPES = (
    (
        "Concentrate work in {component}",
        (
            "We will keep the current push focused on the {component} area of {repo} rather "
            "than widening scope until the churn there settles."
        ),
        (
            "{component} absorbed the bulk of the {churn} lines changed this week across "
            "{files} files. Splitting attention now would leave it half-migrated."
        ),
    ),
    (
        "Hold the interface in {primary_path} stable",
        (
            "{primary_path} is frozen for the rest of this cycle. Changes that would alter "
            "its shape get deferred to the next window."
        ),
        (
            "It was touched in {commits} commits this week and is the file most other work "
            "depends on, so further churn there would ripple."
        ),
    ),
    (
        "Accept the {component} refactor as done",
        "The {component} refactor is accepted and will not be revisited this cycle.",
        (
            "The diff landed across {files} files with {churn} lines of churn and the tests "
            "stayed green, so the remaining concerns are cosmetic."
        ),
    ),
    (
        "Defer {component} cleanup",
        "Cleanup in {component} is deferred; we will revisit once the current work lands.",
        (
            "Only {commits} commits reached it this week, and pulling it forward would "
            "compete with the higher-churn work already in flight."
        ),
    ),
)


def _build_decisions(window, rng, components, paths, shas, occurred_on) -> tuple[Decision, ...]:
    count = 1 if window.commits < 8 else 2
    chosen = rng.sample(range(len(DECISION_SHAPES)), count)
    primary_path = paths[0] if paths else f"{window.repo_slug}/README.md"
    out = []
    for index in chosen:
        title_t, statement_t, rationale_t = DECISION_SHAPES[index]
        fields = {
            "component": components[0],
            "repo": window.repo_slug,
            "churn": f"{window.insertions + window.deletions:,}",
            "files": len(paths),
            "commits": window.commits,
            "primary_path": primary_path,
        }
        title = title_t.format(**fields)
        out.append(
            Decision(
                decision_id="dec_"
                + hashlib.sha256(f"{window.window_id}|{index}".encode()).hexdigest()[:12],
                window_id=window.window_id,
                repo_slug=window.repo_slug,
                title=title,
                statement=statement_t.format(**fields),
                rationale=rationale_t.format(**fields),
                decided_on=occurred_on,
                status="accepted" if rng.random() > 0.25 else "proposed",
                components=tuple(components[:2]),
                paths=paths,
                shas=shas,
            )
        )
    return tuple(out)


def _render_body(window, kind, occurred_on, participants, components, paths, subjects, decisions) -> str:
    lines = [
        f"> {SYNTHETIC_NOTICE}",
        "",
        f"# {window.repo_slug} {kind} — week of {window.week_start.isoformat()}",
        "",
        f"**Date:** {occurred_on.isoformat()}  ",
        f"**Repository:** {window.repo_slug}  ",
        f"**Attendees:** {', '.join(participants)}",
        "",
        "## Activity under discussion",
        "",
        (
            f"{window.commits} commits landed in {window.repo_slug} during the week of "
            f"{window.week_start.isoformat()}, touching {len(paths)} of the files listed below "
            f"and moving {window.insertions:,} insertions against {window.deletions:,} "
            f"deletions. The work concentrated in the {', '.join(components[:3])} area."
        ),
        "",
        "Files that carried the change:",
        "",
    ]
    lines += [f"- `{p}`" for p in paths]
    lines += ["", "Representative commits from the window:", ""]
    lines += [f"- {s}" for s in subjects]
    lines += ["", "## Discussion", ""]
    lines += [
        (
            f"The group walked through why {components[0]} drew so much of the week's "
            f"attention. {participants[0] if participants else 'The author'} noted that the "
            f"churn is concentrated rather than spread, which usually means one problem is "
            f"being worked rather than many small ones. The team agreed the shape of the "
            f"change is right and the open question is scope, not direction."
        ),
        "",
        (
            f"Concern was raised that `{paths[0] if paths else 'the main module'}` is becoming "
            f"a bottleneck for parallel work. No one proposed splitting it this cycle."
        ),
        "",
        "## Decisions",
        "",
    ]
    for d in decisions:
        lines += [
            f"### {d.title}",
            "",
            f"**Decision ({d.status}):** {d.statement}",
            "",
            f"**Rationale:** {d.rationale}",
            "",
        ]
    lines += ["## Grounding", "", "Real commits this record was generated from:", ""]
    lines += [f"- `{sha[:12]}`" for sha in window.shas[:8]]
    return "\n".join(lines)


def frontmatter(meeting: Meeting) -> str:
    return "\n".join(
        [
            "---",
            "synthetic: true",
            f'notice: "{SYNTHETIC_NOTICE}"',
            f"generator: {GENERATOR_VERSION}",
            f"meeting_id: {meeting.meeting_id}",
            f"window_id: {meeting.window_id}",
            f"repo: {meeting.repo_slug}",
            f"occurred_on: {meeting.occurred_on.isoformat()}",
            f"kind: {meeting.kind}",
            "grounded_commits:",
            *[f"  - {sha}" for sha in meeting.grounding_shas],
            "grounded_paths:",
            *[f"  - {path}" for path in meeting.grounding_paths],
            "---",
            "",
        ]
    )


def write_corpus(meetings: list[Meeting], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for meeting in meetings:
        path = out_dir / f"{meeting.slug}.md"
        path.write_text(frontmatter(meeting) + meeting.body + "\n")
        written.append(path)
    return written


def validate_grounding(meeting: Meeting, known_paths: set[str], known_shas: set[str]) -> list[str]:
    """Every path and sha a record cites must exist in the warehouse.

    Without this the corpus is only nominally grounded: a generator bug or a
    later edit could introduce a file that never existed, and retrieval would
    happily return it.
    """
    problems = []
    for path in meeting.grounding_paths:
        if path not in known_paths:
            problems.append(f"unknown path {path}")
    for sha in meeting.grounding_shas:
        if sha not in known_shas:
            problems.append(f"unknown sha {sha}")
    if SYNTHETIC_NOTICE not in meeting.body:
        problems.append("missing synthetic notice in body")
    return problems
