# Kizuki

[![CI](https://github.com/connortessaro/kizuki/actions/workflows/ci.yml/badge.svg)](https://github.com/connortessaro/kizuki/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Ask questions about your engineering work that need both a number and a
reason.** Kizuki ingests real git activity into a columnar warehouse, embeds the
written record alongside it, and answers questions by using whichever half is
required — usually both.

> *"Why did activity in the harbor repository increase in April 2026?"*
>
> SQL finds the jump: **19 commits in March → 236 in April**. Retrieval finds the
> records from those weeks that explain it. The answer cites both, and labels
> which sources are real and which are generated.

The product story — a local-first, agent-neutral intelligence layer over your
work — is in [`docs/product/product-readme.md`](docs/product/product-readme.md). This file is
about how the data and retrieval system is built.

---

## Architecture

Two planes, one seam. The Node plane is the existing product; the Python plane is
the data and retrieval layer.

```
 Node plane (zero-dep, node:test)          Python plane (uv, analytics/)
 ───────────────────────────────           ─────────────────────────────
 kizuki ingest git <repo>                  Dagster asset graph
   git log --all --numstat        writes     1. invoke the connector per repo
   → validated events            ────────▶   2. project JSONL → DuckDB
   → activity/events.jsonl                   3. resolve author identities
        (append-only ledger)                 4. chunk + embed (fastembed/ONNX)
                                             5. upsert vectors → pgvector
 web/ Next.js  ──── HTTP ─────────────────▶ FastAPI ask service :4248
 kizuki ask    ──── HTTP ─────────────────▶   classify → generate SQL
 kizuki quality ─── HTTP ─────────────────▶   → SQLGlot guard → DuckDB
                                              → pgvector retrieve
                                              → answer with citations
```

**The ledger is canonical.** DuckDB and pgvector are derived projections,
rebuildable from `activity/events.jsonl` at any time. Nothing reads them as a
source of truth, which is what keeps the analytical layer from becoming a second
place where the truth lives.

**The connector stays in Node** so there is one git parser and the existing event
validation, idempotency keys and vault lock still apply. Dagster orchestrates it
rather than reimplementing it.

**Embeddings are local** — `fastembed` on ONNX, no API key, no GPU, ~370 MB
resident. That was a constraint (no provider keys on the machine) that turned
into an advantage: eval runs have no provider drift.

---

## The data

Real git history from 15 local repositories: **1,792 commits, 11,184 file rows,
2026-03-08 to 2026-09-13**, resolving to 3 human contributors and 5 bots from 16
raw git identities.

The meeting and decision corpus is **generated** — 26 records, deterministic and
seeded, built *from* the real commit timeline so every record names real files,
real SHAs and a real date window. Every generated file carries a
`synthetic: true` banner, the vector store has a `NOT NULL` `is_synthetic`
column, and the UI badges every citation.

Commits, authors, dates, paths and churn are real. Discussion and decisions are
fabricated. The README, the API and the UI all say so.

---

## Ingestion and orchestration

`kizuki ingest git <repo>...` walks history in a single `git log --all --numstat`
pass and appends validated events to a fifth append-only ledger.

Commit identity is `sha256(repo|sha)`, so re-ingesting is a no-op — which is what
makes the Dagster retry policy meaningful rather than decorative.

```bash
./kizuki ingest git ~/kizuki ~/harbor      # 1,792 commits in ~1.8s
./kizuki ingest git ~/kizuki ~/harbor      # appended 0, already present 1,792
```

Dagster partitions ingestion **by repository, not by time**. The commit
distribution is severely lumpy — one month holds over a third of the corpus — so
a monthly grid would be mostly empty buckets. Repositories genuinely fail
independently, which is the thing a partition grid should model.

```bash
export DAGSTER_HOME=~/.dagster-kizuki
uv run dagster asset materialize -m kizuki_analytics.defs --select warehouse
```

`dagster dev` is deliberately not the documented path. The webserver plus daemon
costs several hundred MB, and this was built on an 8 GB machine that swaps at
idle. The CLI materialises in-process.

---

## Analytical layer

DuckDB, in-process, rebuilt in **0.39 s** from the ledger. Written behind an
`OlapDriver` protocol so a ClickHouse backend could be added — the seam is named,
and deliberately not stubbed, because a driver that has never run is a claim
rather than a seam.

The build writes to a staging file and `os.replace`s onto the published path.
DuckDB refuses to open a file read-write while a reader holds it, so without the
atomic swap every rebuild would fail whenever the ask service was up.

Star-ish schema: `fact_commit`, `fact_commit_file`, `dim_repo`, `dim_file`,
`dim_date`, `dim_contributor`, plus `contributor_identity` and
`identity_resolution_rule` — the audit trail for how 16 git identities collapsed
into 8 contributors, with a named rule and a confidence for every merge.

---

## Retrieval

`bge-small-en-v1.5`, 384 dimensions, 153 chunks. Stored in Postgres with an HNSW
index via pg8000, and mirrored into an exact numpy scan so the index stays
accountable.

Measured, both backends, same vectors:

| Backend | Recall@10 vs exact | p50 |
|---|---:|---:|
| pgvector HNSW | 1.000 | 2.33 ms |
| Exact numpy scan | 1.000 by definition | 0.13 ms |

At this corpus size the ANN index costs latency and buys nothing. That is in the
README rather than hidden because it is the honest result, and the eval suite
reports it on every run so the crossover shows up as a number when the corpus
grows. See [`docs/performance.md`](docs/performance.md).

---

## Text-to-SQL safety

Generated SQL passes five layers before it runs, in
[`analytics/src/kizuki_analytics/ask/guard.py`](analytics/src/kizuki_analytics/ask/guard.py):

1. **Read-only connection** with `enable_external_access=False`. This is the
   actual wall — DDL and DML are physically impossible regardless of what the
   parser concludes. Everything else is defence in depth.
2. **Exactly one statement.** DuckDB executes every statement in a batch, not
   just the last, so `SELECT 1; DROP TABLE x` is a real attack.
3. **SELECT-only by AST node type**, including `exp.Command` — sqlglot's
   catch-all for syntax it does not model, so `INSTALL`/`LOAD`/`CALL` fail closed.
   Plus a banned-function list covering `read_csv`, `read_parquet`, `glob` and
   friends, checked against both `Anonymous` nodes and sqlglot's dedicated
   function classes.
4. **Table allowlist via scope analysis**, not `find_all(exp.Table)` — that would
   match CTE names and reject every legitimate `WITH` query.
5. **Forced row limit**, then re-render from the validated AST with quoted
   identifiers. The executed string is always the tree that was checked.

47 adversarial tests in `analytics/tests/test_guard.py`. The generated SQL is
returned in every response and rendered in the UI.

---

## Evals

27 questions — 10 pure SQL, 8 pure retrieval, 7 hybrid, 2 unanswerable controls.
Latest stored run (`analytics/evals/results/latest.json`):

| Metric | Value |
|---|---:|
| Route accuracy | 1.000 |
| Executable SQL rate | 1.000 (18/18) |
| Allowlisted table rate | 1.000 |
| Deterministic answer accuracy | 1.000 (9/9) |
| Retrieval hit rate | 0.933 (14/15) |
| Citation sources exist | 1.000 |
| Abstention on controls | 1.000 (2/2) |
| p50 / p95 latency (cached) | 6 ms / 46 ms |

**Ground truth is computed independently.** `analytics/evals/reference.py` shells
out to `git` and never touches DuckDB. If expected answers came from the pipeline
under test, the suite would pass whenever the pipeline was self-consistently
wrong — which is the failure mode that actually matters.

SQL generation is content-addressed and cached on
`prompt_version | schema_fingerprint | question`, so `--cache-only` reproduces
every metric with **zero model calls** — verified by running it with `claude`
removed from `PATH`. That is what makes it a CI gate rather than a token bill.

The one retrieval miss is real and left in: a question about a repository is
outranked by 138 synthetic meeting chunks that mention it. Hybrid lexical+vector
retrieval is the fix; it is not built yet.

---

## Data quality

Four Dagster asset checks enforce invariants on every build. Thirteen quality
views surface conditions that are not violations but will mislead an answer.
Severity is defined by consequence: **error** means a query can return a wrong
number.

The current build reports 45 issues — 1 error (a repository whose local `HEAD` is
a parentless root commit, so its 407 real commits live only on the remote), 5
warnings (identity aliases), the rest informational.

```bash
./kizuki quality        # or the /quality page
```

[`docs/data-quality.md`](docs/data-quality.md) has the full system and a worked
root-cause case: two relations both exposing a column that reads as "commits"
with different meanings, which made the model confidently pick the wrong one.
Answer accuracy went 0.778 → 1.000 once the allowlist offered a single
definition.

---

## Engineering tradeoffs

| Decision | Why |
|---|---|
| DuckDB, not ClickHouse | In-process, zero daemon, 0.39 s rebuild. ClickHouse in server mode on 8 GB would cost more than the query workload justifies. The driver seam is named. |
| Two stores (DuckDB + pgvector) | Columnar engine for analytics, pgvector for ANN. At 153 chunks either alone would do — this is a deliberate choice to exercise both, and the measured cost is published above rather than glossed. |
| pg8000, not psycopg | psycopg is LGPL-3.0 and the dependency-review gate denies LGPL for an Apache-2.0 project. Adding a carve-out for the one thing that tripped the gate would defeat it; pg8000 is BSD-3-Clause and pgvector supports it. Costs ~1.7× per query, which is noise behind an LLM call. |
| Dagster, not cron | Kizuki already had launchd and a watcher. Dagster adds the asset graph, partition grid, retry policy and asset checks. It runs CLI-only; the webserver is for screenshots. |
| Rule-based router, not an LLM | Routing is a 3-class problem with strong lexical signals. Deterministic means eval numbers measure retrieval and SQL rather than drifting with a classifier. Its accuracy is measured like everything else. |
| Local embeddings | No API key existed. The upside is reproducible evals. |
| Agent CLI for SQL generation | Matches how Kizuki already gets model access. Spawned from a scratch cwd with no `CLAUDE.md` so project context cannot leak into a generation prompt. |
| A fifth ledger, not the existing one | `lib/platformEvents.mjs` hard-rejects any type but `capture.recorded`, and its write path is O(n²). Commits are observed facts, not user commands — different aggregate, different lifecycle. |
| Pseudonymous contributors | The commit data includes collaborators who did not sign up for a portfolio demo. Raw names and emails stay in the local-only DuckDB file; overrides key on salted hashes so the config is committable. |

---

## Local setup

```bash
# 1. Postgres with pgvector, on 5433 to avoid colliding with an existing install
brew install postgresql@18 pgvector
echo "port = 5433" >> /opt/homebrew/var/postgresql@18/postgresql.conf
brew services start postgresql@18
createdb -h 127.0.0.1 -p 5433 kizuki
psql -h 127.0.0.1 -p 5433 -d kizuki -c 'CREATE EXTENSION vector;'

# 2. Python plane
cd analytics && uv sync --extra dev
psql -h 127.0.0.1 -p 5433 -d kizuki -f sql/pg/001_init.sql

# 3. Ingest real git history, then build the warehouse
cd .. && ./kizuki ingest git ~/your-repo ~/another-repo
cd analytics
export DAGSTER_HOME=~/.dagster-kizuki
uv run dagster asset materialize -m kizuki_analytics.defs --select warehouse

# 4. Ask service
export KIZUKI_PG_DSN="postgresql://$USER@127.0.0.1:5433/kizuki"
uv run uvicorn kizuki_analytics.ask.app:app --host 127.0.0.1 --port 4248 --workers 1

# 5. Ask
cd .. && ./kizuki ask "Which repository had the most commits last month?"
./kizuki quality
```

Dashboard: `npm --prefix web run dev`, then `/ask` and `/quality`.

Tests: `npm test` (540), `cd analytics && uv run pytest` (62),
`uv run python evals/run_eval.py --cache-only`.

---

## Where things live

| Path | What |
|---|---|
| `lib/gitIngest.mjs` | git connector, single-pass parser |
| `lib/activityEvents.mjs`, `lib/activityStore.mjs` | append-only activity ledger |
| `analytics/sql/duckdb/` | staging, dims, facts, views, quality |
| `analytics/src/kizuki_analytics/identity.py` | author identity resolution + audit trail |
| `analytics/src/kizuki_analytics/warehouse.py` | OLAP driver, atomic publish |
| `analytics/src/kizuki_analytics/defs/` | Dagster assets and checks |
| `analytics/src/kizuki_analytics/ask/guard.py` | SQL validation |
| `analytics/src/kizuki_analytics/ask/pipeline.py` | route → SQL → retrieve → cite |
| `analytics/evals/` | questions, independent reference, runner, stored results |
| `docs/performance.md`, `docs/data-quality.md` | case studies |
| `docs/interview-walkthrough.md` | 5-minute tour |
