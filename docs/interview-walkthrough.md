# Interview walkthrough

A five-minute tour, then the questions to expect and where to look before you
need to answer them.

---

## The five minutes

### 0:00 — What it solves (30s)

Engineering questions usually need two different kinds of evidence. "How many
commits landed in April" is a warehouse question. "Why did that happen" is a
documents question. Most tools answer one and hand-wave the other.

Kizuki ingests real git activity into a columnar warehouse, embeds the written
record alongside it, routes each question to SQL, retrieval, or both, and returns
an answer that cites both halves.

Demo question: *"Why did activity in the harbor repository increase in April
2026?"* SQL finds 19 commits in March against 236 in April. Retrieval surfaces
the records from those weeks. The answer shows the generated SQL, the rows, and
every source with a real/synthetic badge.

### 0:30 — Architecture (45s)

Two planes. Node already existed — a CLI, an MCP server, a Next.js dashboard over
append-only JSONL ledgers, with a hard rule that `lib/` imports Node built-ins
only. Python is new and owns the data and retrieval layer.

The seam is a ledger. `kizuki ingest git` writes validated commit events to
`activity/events.jsonl`; everything downstream is a derived projection that can
be dropped and rebuilt. That is the single most important property — DuckDB and
pgvector are never a second source of truth.

The connector deliberately stays in Node rather than moving into a Dagster asset,
so there is one git parser and the existing validation, idempotency and locking
still apply. Dagster orchestrates it.

### 1:15 — Ingestion and orchestration (45s)

One `git log --all --numstat` pass per repository. Commit identity is
`sha256(repo|sha)`, so re-ingestion is a genuine no-op — which is what makes the
retry policy meaningful instead of decorative.

Partitioned by repository, not by time, and the reason is in the data: one month
holds over a third of the corpus, so a monthly grid would be mostly empty
buckets. Repositories fail independently — one of them has a detached local
`HEAD` — which is what a partition grid should model.

Four asset checks run on every materialisation. `dagster dev` is not the
documented path; the webserver plus daemon costs several hundred MB and this was
built on an 8 GB machine.

### 2:00 — Analytical database (30s)

DuckDB, in-process, full rebuild in 0.39 s from 1,792 commits and 11,184 file
rows. Behind an `OlapDriver` protocol so ClickHouse could slot in — named as a
seam, not stubbed, because a driver that has never run is a claim.

Published with a staging file and an atomic rename, because DuckDB refuses to
open a file read-write while a reader holds it. Without that, every rebuild would
fail whenever the ask service was running.

The part worth pointing at is `identity_resolution_rule`: 16 raw git identities
collapse to 8 contributors, and every merge records the rule that caused it and a
confidence. One person appears under four addresses including an employer one.

### 2:30 — RAG (30s)

`bge-small-en-v1.5`, 384 dimensions, local ONNX — no API key, which was a
constraint that became an advantage because eval runs have no provider drift.

Two backends behind one protocol: pgvector with HNSW, and an exact numpy scan.
Both are measured on every eval run. At 153 chunks the index has recall 1.000 and
is 36× slower than exact search. That is published in the README rather than
hidden, and the eval reports it so the crossover shows up as a number when the
corpus grows.

### 3:00 — Text-to-SQL safety (45s)

Five layers. Lead with the one that matters: a read-only DuckDB connection with
`enable_external_access=False`. DDL and DML are physically impossible there
regardless of what the parser concludes. Everything above it is defence in depth.

Then: exactly one statement (DuckDB executes every statement in a batch, so
`SELECT 1; DROP TABLE x` is real); SELECT-only by AST node type including
`exp.Command` so unmodelled syntax fails closed; a table allowlist resolved
through scope analysis rather than `find_all(exp.Table)`, which would match CTE
names and reject every legitimate `WITH` query; a forced row limit; then
re-render from the validated AST with quoted identifiers.

47 adversarial tests. The generated SQL is shown in the UI.

### 3:45 — Hybrid reasoning (30s)

A rule-based router picks SQL, retrieval, or both. Deterministic on purpose:
routing is a three-class problem with strong lexical signals, and a deterministic
router means the eval numbers measure retrieval and SQL rather than drifting with
a classifier. Its accuracy is measured like every other component.

Hybrid runs both halves and composes an answer that cites each, labelling which
sources are generated.

### 4:15 — Evals and what they caught (30s)

27 questions, real stored results. Route accuracy 1.000, executable SQL 1.000,
deterministic answer accuracy 1.000 against a reference that shells out to `git`
and never touches DuckDB.

That independence is the whole point, and it earned its keep: the suite caught a
schema bug where two relations both exposed a column reading as "commits" with
different meanings, so the model picked the wrong one and answered confidently.
Accuracy was 0.778 until the allowlist offered a single definition.

`--cache-only` reproduces every metric with zero model calls — verified by
running it with `claude` removed from `PATH`.

### 4:45 — Performance (15s)

Ingestion was one subprocess per commit. Batched to one per repository:
16.7 s → 1.8 s across the corpus, 1,792 spawns eliminated, 9.2× overall and
36.9× on the repository with the most commits and fewest files each.

Separately: pgvector search opened a connection per call. Pooling it was 7.2×.
That one was found because the benchmark result was *too* dramatic to believe.

---

## Questions to expect, and where to look first

### On the data

**"Is this real data?"** — The structured half is: 1,792 real commits from 15
local repositories. Meetings and decisions are generated, deterministically, from
the real commit timeline so they reference real files, SHAs and date windows.
Every generated file carries a banner, the vector table has a `NOT NULL`
`is_synthetic` column, and the UI badges each citation. Be the one to say this
before they ask.
→ `analytics/src/kizuki_analytics/corpus.py`, `analytics/sql/pg/001_init.sql`

**"Why only 26 meeting records?"** — That is how many week-windows in the real
data have four or more commits. Generating 100 would have meant inventing windows
that do not exist, which would break the grounding validator.
→ `corpus.find_windows`, `corpus.validate_grounding`

**"How do you know the warehouse is right?"** — `evals/reference.py` recomputes
answers from `git` directly. It matches on every check: 1,288 default-branch
non-bot commits, harbor busiest, 2026-07 the busiest month. It has to replicate
three conventions exactly — author date not commit date, UTC not local, bots
excluded — and getting any wrong shows up as a disagreement.
→ `analytics/evals/reference.py`

### On ingestion

**"What happens if ingestion runs twice?"** — Nothing. Commit identity is
`sha256(repo|sha)`, the ledger is append-only and rejects rewrites, and a re-run
reports `appended 0, already present 1792`. There is a test asserting the file is
byte-identical.
→ `lib/activityStore.mjs`, `lib/gitIngest.test.mjs`

**"Why not put commits in the existing event ledger?"** — Two reasons, and the
second is the real one. `lib/platformEvents.mjs:245` hard-rejects any type but
`capture.recorded` and its write path re-validates the whole file per event. But
more fundamentally that ledger holds *user commands* with idempotency keys and
visibility scopes; commits are *observed facts about an external system*.
Different aggregate, different lifecycle.

**"What about merge commits?"** — git emits no `--numstat` for merges without
`-m`, so 157 merges legitimately carry no file rows. Recorded as `is_merge` and
surfaced as an `info` quality issue so the coverage gap is explained rather than
discovered.

**"Any repository give you trouble?"** — One. Its local `HEAD` is a parentless
root commit; all 407 real commits live on `refs/remotes/origin/main`. A connector
defaulting to `HEAD` ingests one commit and looks like it worked. The connector
resolves the default ref through a candidate list and records `onDefaultBranch`
per commit; `orphan_head` is the one error-severity quality check firing today.

### On the analytical layer

**"Why DuckDB over ClickHouse?"** — In-process, no daemon, 0.39 s rebuild on an
8 GB machine. ClickHouse in server mode would cost more than this query workload
justifies. There is an `OlapDriver` protocol with one implementation; a second
one that had never run would be a claim, not a seam.

**"Why is `dim_repo` not queryable?"** — Because it caused a wrong answer. Have
`docs/data-quality.md` open for this one; it is the strongest story here.

**"How do you handle the same person with several emails?"** — Union-find over
four rule kinds — normalized email, GitHub noreply login, operator override, bot
pattern — with bots partitioned so they can merge with each other but never with
a person. Every merge writes an audit row with evidence and confidence. Overrides
key on salted hashes so the config contains no addresses.
→ `analytics/src/kizuki_analytics/identity.py`, `config/identity_overrides.yaml`

### On retrieval and SQL

**"Why pgvector if brute force is faster?"** — Say the number first: at 153
chunks exact search is 36× faster with identical recall, so the index buys
nothing today. It is kept because exact search is linear and loses somewhere in
the tens of thousands, pgvector gives transactional upserts and concurrent
readers, and the exact store is the ground truth the eval measures HNSW recall
against. The crossover is a measurement waiting to happen.

**"How do you stop the model writing to the database?"** — Lead with the
read-only connection, not the parser. Then the layers above it. Then the point
that guard approval is not execution safety — a CTE named `freeze` passed sqlglot
and was rejected by DuckDB as a reserved word, which is why the AST is re-rendered
with quoted identifiers.
→ `analytics/src/kizuki_analytics/ask/guard.py`, `tests/test_guard.py`

**"Why isn't the router an LLM?"** — Determinism. A drifting classifier turns
every retrieval and SQL metric into noise. Its accuracy is measured against
labelled expectations; if it becomes the weak link that will show up as a number.

**"How fast is a real query?"** — Uncached, 8–12 s, dominated by the agent CLI.
Cached, 6 ms p50. The cache is content-addressed on prompt version, schema
fingerprint and question, so a schema change correctly invalidates it — which it
did, visibly, when the column rename landed.

### On evals

**"Could the eval pass while the system is wrong?"** — Not for the SQL half. The
reference never touches DuckDB. The retrieval half is known by construction
because the generator records which window each record came from. The honest gap
is that answer *composition* is not graded beyond citation correctness.

**"What is the 0.933 retrieval hit rate?"** — One question about a repository
where the single real repo summary is outranked by 138 synthetic meeting chunks
that mention it. Left in rather than tuned away. The fix is hybrid lexical+vector
retrieval — the GIN index is already there, unused.

**"Where are the results?"** — `analytics/evals/results/*.json`, one file per
run, committed. No number in any document was typed by hand.

### On scaling

**"What breaks at 100× the data?"** — In order: the exact numpy store stops being
viable and pgvector starts earning its index. `fact_commit_file` at ~1.1 M rows is
still comfortable for DuckDB but the full-rebuild-from-ledger model stops being
free, so ingestion would need to become incremental with the ledger as a
watermark. The ledger itself is a single JSONL file — fine at 1,792 events, needs
partitioning by repo well before 100×. Embedding is the wall-clock cost at
9 s/153 chunks, so that becomes a batched, incremental asset keyed on content
hash, which the upsert already supports.

**"What would you do differently?"** — Hybrid retrieval from the start; the
lexical index is sitting there unused and would have fixed the one miss. And a
formal schema-contract test asserting that no two allowlisted relations expose
columns with colliding semantics, since that bug was found by luck rather than by
a check.

---

## Before the interview

Read these four, in this order:

1. `analytics/src/kizuki_analytics/ask/guard.py` — the most likely deep-dive
2. `analytics/src/kizuki_analytics/identity.py` — the most likely data-modelling question
3. `docs/data-quality.md` — the root-cause narrative
4. `lib/gitIngest.mjs` — where all the data comes from

Have running: the ask service on 4248, the `/ask` and `/quality` pages, and
`analytics/evals/results/latest.json` open in a tab.

Lead the demo with the harbor question. It is the only one that exercises the
whole system in a single request.
