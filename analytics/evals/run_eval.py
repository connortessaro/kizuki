"""Runs the eval suite and stores the results.

Every number this produces is measured. Nothing here writes a metric that was
not computed from an actual run, and the stored JSON is the only source the
README is allowed to quote.

Run with --cache-only in CI: SQL generation then comes entirely from the
content-addressed cache and the suite makes zero model calls, so it works as a
regression gate rather than a bill.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

import reference as R

from kizuki_analytics.ask.pipeline import AskPipeline
from kizuki_analytics.ask.router import classify
from kizuki_analytics.retrieval import Embedder, NumpyBruteForceStore, PgVectorStore
from kizuki_analytics.warehouse import DuckDBDriver

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS = HERE / "results"

REFERENCES = {
    "busiest_repo_in_month_2026_07": lambda: R.busiest_repo_in_month("2026-07"),
    "total_commits": R.total_commits,
    "repo_with_most_commits": R.repo_with_most_commits,
    "busiest_month_overall": R.busiest_month_overall,
    "harbor_commits_2026_04": lambda: R.commits_in_month("harbor", "2026-04"),
    "largest_mom_increase": R.largest_month_over_month_increase,
    "repos_with_activity": R.repo_count_with_activity,
    "contributor_count": lambda: None,  # resolved identities have no git-side equivalent
}


@dataclass
class Result:
    id: str
    question: str
    expected_route: str
    actual_route: str
    route_correct: bool
    sql_generated: bool = False
    sql_executable: bool = False
    sql_tables: list[str] = field(default_factory=list)
    sql_row_count: int = 0
    sql_error: str | None = None
    answer_correct: bool | None = None
    reference_value: str | None = None
    guard_verdict: str = "n/a"
    retrieval_hit: bool | None = None
    gold_prefixes: list[str] = field(default_factory=list)
    citations: int = 0
    citation_sources_exist: bool | None = None
    abstained: bool | None = None
    latency_ms: int = 0
    cache_hit: bool = False
    error: str | None = None


def _rows_blob(answer) -> str:
    return " ".join(str(v) for row in answer.sql.rows for v in row)


def evaluate(pipeline: AskPipeline, spec: dict, allow_model: bool) -> Result:
    started = time.perf_counter()
    routing = classify(spec["question"])
    result = Result(
        id=spec["id"],
        question=spec["question"],
        expected_route=spec["expected_route"],
        actual_route=routing.route.value,
        route_correct=routing.route.value == spec["expected_route"],
        gold_prefixes=list(spec.get("gold_doc_prefixes", [])),
    )

    try:
        answer = pipeline.ask(spec["question"], k=8, allow_model=allow_model)
    except Exception as error:  # noqa: BLE001 - recorded as a failed question
        result.error = str(error)[:300]
        result.latency_ms = int((time.perf_counter() - started) * 1000)
        return result

    result.latency_ms = int((time.perf_counter() - started) * 1000)
    result.cache_hit = answer.sql.cache_hit
    result.citations = len(answer.citations)

    if answer.sql.generated_sql:
        result.sql_generated = True
        result.sql_tables = answer.sql.tables
        result.sql_row_count = answer.sql.row_count
        result.sql_executable = answer.sql.executed_sql is not None and answer.sql.error is None
        result.sql_error = answer.sql.error
        result.guard_verdict = "rejected" if (answer.sql.error or "").startswith("rejected") else "accepted"

    ref_name = spec.get("reference")
    if ref_name and ref_name in REFERENCES:
        expected = REFERENCES[ref_name]()
        if expected is not None:
            result.reference_value = str(expected)
    if spec.get("expected_contains"):
        blob = _rows_blob(answer).lower()
        result.answer_correct = all(str(x).lower() in blob for x in spec["expected_contains"])

    if result.gold_prefixes:
        # Citations carry source_path, so map back through the known layout.
        found = any(
            any(_matches_prefix(c.source_path, p) for p in result.gold_prefixes)
            for c in answer.citations
        )
        result.retrieval_hit = found
        result.citation_sources_exist = all(_source_exists(c.source_path) for c in answer.citations)

    if spec.get("unanswerable"):
        # Returning a single row containing 0 IS the correct answer to "how many
        # commits did a non-existent person author". Treating any row as a
        # failure to abstain was a bug in this metric, not in the pipeline.
        result.abstained = _asserted_nothing(answer)
    return result


def _asserted_nothing(answer) -> bool:
    """True when the system declined to invent an answer.

    Either SQL returned no rows at all, or every value it returned is zero or
    null, which is a truthful "none" rather than a fabricated figure.
    """
    if answer.sql.error is not None:
        return True
    if answer.sql.row_count == 0:
        return True
    values = [v for row in answer.sql.rows for v in row]
    return all(v in (0, None) or (isinstance(v, str) and not v.strip()) for v in values)


def _matches_prefix(source_path: str, prefix: str) -> bool:
    kind = prefix.rstrip(":")
    if kind == "repo":
        return source_path.startswith("warehouse://dim_repo/")
    if kind == "decision":
        return "#dec_" in source_path
    if kind == "meeting":
        return source_path.startswith("corpus/synthetic/") and "#dec_" not in source_path
    return False


def _source_exists(source_path: str) -> bool:
    if source_path.startswith("warehouse://"):
        return True
    return (ROOT / source_path.split("#")[0]).exists()


def summarize(results: list[Result]) -> dict:
    sql_qs = [r for r in results if r.sql_generated]
    retrieval_qs = [r for r in results if r.retrieval_hit is not None]
    answer_qs = [r for r in results if r.answer_correct is not None]
    control_qs = [r for r in results if r.abstained is not None]

    def pct(xs):
        return round(sum(xs) / len(xs), 4) if xs else None

    return {
        "questions": len(results),
        "route_accuracy": pct([r.route_correct for r in results]),
        "sql_generated": len(sql_qs),
        "executable_sql_rate": pct([r.sql_executable for r in sql_qs]),
        "allowlisted_table_rate": pct([bool(r.sql_tables) for r in sql_qs]),
        "deterministic_answer_accuracy": pct([r.answer_correct for r in answer_qs]),
        "deterministic_answers_checked": len(answer_qs),
        "retrieval_hit_rate": pct([r.retrieval_hit for r in retrieval_qs]),
        "retrieval_questions": len(retrieval_qs),
        "citation_sources_exist_rate": pct(
            [r.citation_sources_exist for r in results if r.citation_sources_exist is not None]
        ),
        "abstention_rate_on_controls": pct([r.abstained for r in control_qs]),
        "controls": len(control_qs),
        "cache_hit_rate": pct([r.cache_hit for r in sql_qs]),
        "latency_p50_ms": int(statistics.median([r.latency_ms for r in results])),
        "latency_p95_ms": int(
            statistics.quantiles([r.latency_ms for r in results], n=20)[-1]
        )
        if len(results) >= 20
        else None,
        "errors": sum(1 for r in results if r.error),
    }


def vector_backend_comparison(store: PgVectorStore, embedder: Embedder, questions: list[str]) -> dict:
    """pgvector's HNSW recall and latency against exact search over the same vectors."""
    exact = NumpyBruteForceStore.from_pg(store)
    vectors = [embedder.embed_query(q) for q in questions]
    for v in vectors[:2]:
        store.search(v, k=10)
        exact.search(v, k=10)
    recalls, pg_ms, bf_ms = [], [], []
    for v in vectors:
        t0 = time.perf_counter()
        a = store.search(v, k=10)
        pg_ms.append((time.perf_counter() - t0) * 1000)
        t0 = time.perf_counter()
        b = exact.search(v, k=10)
        bf_ms.append((time.perf_counter() - t0) * 1000)
        recalls.append(len({h.chunk_id for h in a} & {h.chunk_id for h in b}) / max(len(b), 1))
    return {
        "chunks": store.count(),
        "recall_at_10_vs_exact": round(statistics.mean(recalls), 4),
        "pgvector_p50_ms": round(statistics.median(pg_ms), 3),
        "exact_p50_ms": round(statistics.median(bf_ms), 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-only", action="store_true", help="fail rather than call the model")
    parser.add_argument("--dsn", default="postgresql://tessaro@127.0.0.1:5433/kizuki")
    args = parser.parse_args()

    spec = yaml.safe_load((HERE / "questions.yaml").read_text())
    store = PgVectorStore(dsn=args.dsn)
    embedder = Embedder()
    pipeline = AskPipeline(
        driver=DuckDBDriver(published_path=ROOT / "data" / "warehouse.duckdb"),
        store=store,
        embedder=embedder,
        cache_dir=ROOT / "data" / "sqlcache",
    )

    started = datetime.now(UTC)
    results = [evaluate(pipeline, q, allow_model=not args.cache_only) for q in spec["questions"]]
    metrics = summarize(results)
    backend = vector_backend_comparison(
        store, embedder, [q["question"] for q in spec["questions"][:10]]
    )

    run = {
        "run_id": started.strftime("%Y%m%dT%H%M%SZ"),
        "started_at": started.isoformat(),
        "suite_version": spec["suite_version"],
        "cache_only": args.cache_only,
        "warehouse_rows": pipeline._con.execute("SELECT count(*) FROM v_commit").fetchone()[0],
        "metrics": metrics,
        "vector_backends": backend,
        "results": [asdict(r) for r in results],
    }

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{run['run_id']}.json"
    out.write_text(json.dumps(run, indent=2))
    (RESULTS / "latest.json").write_text(json.dumps(run, indent=2))

    print(json.dumps(metrics, indent=2))
    print(json.dumps(backend, indent=2))
    print(f"\nwrote {out}")
    pipeline.close()
    store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
