"""Builds the embeddable document set and loads it into the vector store.

Two kinds of document go in, and the distinction is carried all the way to the
UI: repository and component summaries are generated from real warehouse rows
and are marked real; meeting and decision records are fabricated and are marked
synthetic. Nothing is embedded without an explicit is_synthetic value.
"""

from __future__ import annotations

from pathlib import Path

from .corpus import Meeting
from .retrieval import Chunk, Embedder, PgVectorStore, chunk_text

REPO_SUMMARY_SQL = """
SELECT
    r.repo_slug,
    r.commits_all_refs_incl_bots,
    r.commits_on_default_branch,
    r.first_commit_at::DATE,
    r.last_commit_at::DATE,
    r.merge_count,
    r.head_is_orphan,
    (SELECT count(DISTINCT contributor) FROM v_commit c WHERE c.repo_slug = r.repo_slug),
    (SELECT sum(insertions) FROM v_commit c WHERE c.repo_slug = r.repo_slug),
    (SELECT sum(deletions) FROM v_commit c WHERE c.repo_slug = r.repo_slug),
    (SELECT list(component ORDER BY churn DESC)[1:4]
     FROM (SELECT component, sum(churn) churn FROM v_component_churn cc
           WHERE cc.repo_slug = r.repo_slug GROUP BY component)),
    (SELECT list(path ORDER BY commits DESC)[1:6]
     FROM v_file_hotspot h WHERE h.repo_slug = r.repo_slug),
    (SELECT list(year_month ORDER BY commits DESC)[1:3]
     FROM v_repo_activity a WHERE a.repo_slug = r.repo_slug)
FROM dim_repo r
ORDER BY r.commits_all_refs_incl_bots DESC
"""


def repo_summary_docs(con) -> list[Chunk]:
    """One factual summary per repo, straight from warehouse rows.

    These are real. They give the retriever something truthful to return for
    questions about a repository, so the answer is not forced to lean entirely
    on the fabricated meeting records.
    """
    chunks: list[Chunk] = []
    for row in con.execute(REPO_SUMMARY_SQL).fetchall():
        (
            slug, commits, on_default, first, last, merges, orphan,
            contributors, insertions, deletions, components, hot_files, busy_months,
        ) = row
        orphan_note = (
            " The local checkout's HEAD is a parentless root commit, so the real history "
            "is only reachable through the remote default branch."
            if orphan
            else ""
        )
        body = (
            f"Repository {slug}. {commits} commits recorded in total, {on_default} of them on the "
            f"default branch, authored between {first} and {last} by {contributors} human "
            f"contributors. {merges} of those commits are merges.{orphan_note} "
            f"Line volume across the default branch is {insertions or 0:,} insertions against "
            f"{deletions or 0:,} deletions. Work concentrates in these areas: "
            f"{', '.join(components or []) or 'not classified'}. The files changed in the most "
            f"commits are: {', '.join(hot_files or []) or 'none recorded'}. The busiest months by "
            f"commit count were {', '.join(busy_months or []) or 'none recorded'}."
        )
        chunks += chunk_text(
            body,
            doc_id=f"repo::{slug}",
            doc_kind="repo_summary",
            source_path=f"warehouse://dim_repo/{slug}",
            is_synthetic=False,
            title=f"{slug} repository summary",
            repo_slug=slug,
        )
    return chunks


def meeting_docs(meetings: list[Meeting]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for meeting in meetings:
        chunks += chunk_text(
            meeting.body,
            doc_id=f"meeting::{meeting.meeting_id}",
            doc_kind="meeting",
            source_path=f"corpus/synthetic/{meeting.slug}.md",
            is_synthetic=True,
            title=meeting.title,
            repo_slug=meeting.repo_slug,
            occurred_on=meeting.occurred_on.isoformat(),
        )
        for decision in meeting.decisions:
            body = (
                f"{decision.title}. Decision ({decision.status}): {decision.statement} "
                f"Rationale: {decision.rationale} This decision concerns the "
                f"{', '.join(decision.components)} area of {decision.repo_slug} and the files "
                f"{', '.join(decision.paths[:5])}."
            )
            chunks += chunk_text(
                body,
                doc_id=f"decision::{decision.decision_id}",
                doc_kind="decision",
                source_path=f"corpus/synthetic/{meeting.slug}.md#{decision.decision_id}",
                is_synthetic=True,
                title=decision.title,
                repo_slug=decision.repo_slug,
                occurred_on=decision.decided_on.isoformat(),
            )
    return chunks


def vault_docs(vault_dir: Path) -> list[Chunk]:
    """Markdown the operator actually wrote, if any exists."""
    chunks: list[Chunk] = []
    for kind in ("people", "projects", "teams"):
        for path in sorted((vault_dir / kind).glob("*.md")):
            text = path.read_text(errors="replace")
            if not text.strip():
                continue
            chunks += chunk_text(
                text,
                doc_id=f"vault::{kind}::{path.stem}",
                doc_kind="vault_entity",
                source_path=str(path.relative_to(vault_dir)),
                is_synthetic=True,
                title=f"{kind[:-1]}: {path.stem}",
                entity_type=kind[:-1],
                entity_name=path.stem,
            )
    return chunks


def embed_and_store(
    chunks: list[Chunk], store: PgVectorStore, embedder: Embedder, batch_size: int = 16
) -> dict[str, int]:
    if not chunks:
        return {"chunks": 0, "upserted": 0}
    vectors = embedder.embed_passages([c.body for c in chunks], batch_size=batch_size)
    upserted = store.upsert(chunks, vectors, embedder.model_id)
    return {
        "chunks": len(chunks),
        "upserted": upserted,
        "synthetic": sum(1 for c in chunks if c.is_synthetic),
        "real": sum(1 for c in chunks if not c.is_synthetic),
    }
