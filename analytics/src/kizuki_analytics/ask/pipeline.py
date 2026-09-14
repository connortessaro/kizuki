"""The ask pipeline: route, query, retrieve, answer.

The answer is assembled from what was actually retrieved and actually returned
by SQL. Nothing in the response is asserted without a citation pointing at
either a warehouse row or a retrieved chunk, and any citation drawn from the
fabricated corpus is labelled as such all the way to the caller.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..retrieval import Embedder, Hit, VectorStore
from ..warehouse import ALLOWED_RELATIONS, DuckDBDriver, schema_for_guard
from .guard import QueryTimeout, UnsafeSQL, execute_guarded, validate
from .router import Route, classify
from .sqlgen import SqlGenerator


@dataclass
class SqlOutcome:
    generated_sql: str | None = None
    executed_sql: str | None = None
    tables: list[str] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    row_count: int = 0
    error: str | None = None
    cache_hit: bool = False
    latency_ms: int = 0


@dataclass
class Citation:
    source_path: str
    title: str | None
    doc_kind: str
    is_synthetic: bool
    score: float
    excerpt: str


@dataclass
class Answer:
    question: str
    route: str
    answer: str
    sql: SqlOutcome
    citations: list[Citation]
    contains_synthetic: bool
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            **asdict(self),
            "sql": asdict(self.sql),
            "citations": [asdict(c) for c in self.citations],
        }


EXCERPT_CHARS = 320


def _excerpt(hit: Hit) -> str:
    body = " ".join(hit.body.split())
    return body[:EXCERPT_CHARS] + ("…" if len(body) > EXCERPT_CHARS else "")


class AskPipeline:
    def __init__(
        self,
        driver: DuckDBDriver,
        store: VectorStore,
        embedder: Embedder,
        cache_dir: Path,
        max_rows: int = 100,
        timeout_s: float = 8.0,
    ):
        self.driver = driver
        self.store = store
        self.embedder = embedder
        self.max_rows = max_rows
        self.timeout_s = timeout_s
        self._con = driver.connect_read_only()
        self.schema = schema_for_guard(self._con)
        self.generator = SqlGenerator(schema=self.schema, cache_dir=cache_dir)

    def close(self) -> None:
        self._con.close()

    def ask(self, question: str, k: int = 6, allow_model: bool = True) -> Answer:
        routing = classify(question)
        warnings: list[str] = []
        sql = SqlOutcome()
        citations: list[Citation] = []

        if routing.route in (Route.SQL, Route.HYBRID):
            sql = self._run_sql(question, allow_model, warnings)

        if routing.route in (Route.SEMANTIC, Route.HYBRID):
            citations = self._retrieve(question, k)
        elif sql.error:
            # SQL was the plan and it failed; retrieval is better than nothing.
            citations = self._retrieve(question, k)
            warnings.append("SQL failed; answered from retrieved documents only")

        answer = self._compose(question, routing.route, sql, citations)
        return Answer(
            question=question,
            route=routing.route.value,
            answer=answer,
            sql=sql,
            citations=citations,
            contains_synthetic=any(c.is_synthetic for c in citations),
            warnings=warnings,
        )

    def _run_sql(self, question: str, allow_model: bool, warnings: list[str]) -> SqlOutcome:
        out = SqlOutcome()
        try:
            generation = self.generator.generate(question, allow_model=allow_model)
        except (LookupError, RuntimeError) as error:
            out.error = str(error)
            return out
        out.generated_sql = generation.sql
        out.cache_hit = generation.cache_hit
        out.latency_ms = generation.latency_ms

        try:
            guarded = validate(generation.sql, ALLOWED_RELATIONS, max_rows=self.max_rows)
        except UnsafeSQL as error:
            out.error = f"rejected by guard: {error}"
            warnings.append(out.error)
            return out
        out.executed_sql = guarded.sql
        out.tables = sorted(guarded.tables)

        try:
            rows, columns = execute_guarded(self._con, guarded.sql, timeout_s=self.timeout_s)
        except (QueryTimeout, Exception) as error:  # noqa: BLE001 - reported, never raised
            out.error = f"execution failed: {error}"
            warnings.append(out.error)
            return out
        out.columns = columns
        out.rows = [list(r) for r in rows]
        out.row_count = len(rows)
        return out

    def _retrieve(self, question: str, k: int) -> list[Citation]:
        vector = self.embedder.embed_query(question)
        return [
            Citation(
                source_path=hit.source_path,
                title=hit.title,
                doc_kind=hit.doc_kind,
                is_synthetic=hit.is_synthetic,
                score=round(hit.score, 4),
                excerpt=_excerpt(hit),
            )
            for hit in self.store.search(vector, k=k)
        ]

    def _compose(self, question: str, route: Route, sql: SqlOutcome, citations: list[Citation]) -> str:
        parts: list[str] = []

        if sql.executed_sql and sql.row_count:
            parts.append(_describe_rows(sql))
        elif sql.error:
            parts.append(f"The analytical query could not be answered: {sql.error}")

        if citations:
            top = citations[0]
            label = "a synthetic record" if top.is_synthetic else "warehouse-derived content"
            parts.append(
                f"The closest supporting context is “{top.title}” ({label}, "
                f"similarity {top.score:.2f}): {top.excerpt}"
            )
            if route == Route.HYBRID and sql.row_count:
                parts.append(
                    "The figures above come from the commit warehouse; the explanation comes "
                    "from the retrieved records listed below."
                )

        if not parts:
            parts.append("Nothing in the warehouse or the document store answers this question.")
        return "\n\n".join(parts)


def _describe_rows(sql: SqlOutcome) -> str:
    head = sql.rows[0]
    pairs = ", ".join(f"{c}={v}" for c, v in zip(sql.columns, head))
    if sql.row_count == 1:
        return f"The warehouse returns one row: {pairs}."
    return (
        f"The warehouse returns {sql.row_count} rows across {', '.join(sql.tables)}. "
        f"The leading row is {pairs}."
    )
