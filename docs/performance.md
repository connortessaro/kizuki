# Performance case studies

Three optimisations, each found by measurement rather than inspection. Every
number here was produced by a script in this repo on the machine described at
the bottom; nothing is estimated and nothing is extrapolated.

Reproduce with:

```bash
node scripts/benchmark-ingest.mjs ~/kizuki ~/harbor ~/4x-war --runs 3
```

---

## 1. Commit ingestion: one subprocess per commit → one per repository

### The original implementation

The obvious way to read commit history mirrors how you think about the problem:
for each commit, ask git what it changed.

```js
for (const sha of await shas(dir)) {
  const { stdout } = await execFileAsync(
    "git", ["-C", dir, "show", "--numstat", "--format=" + FORMAT, sha],
  );
  files += parseGitLog(stdout, repo).reduce((n, c) => n + c.files.length, 0);
}
```

### Why it was slow

The work git does is not the cost. Reading commits out of a packfile is cheap;
git is built for it. The cost is that this spawns **one process per
commit**. Each spawn pays for `fork`/`exec`, dynamic linker work, git's own
startup (reading `.git/config`, discovering the repository, loading the object
store index), and then tears all of it down to do the same thing again for the
next commit.

Across the corpus that is 1,792 setup/teardown cycles that produce no data. The
parsing code is identical in both strategies, so the difference is spawn cost
and nothing else.

### The fix

`git log --numstat` already emits exactly this information for every commit in
one stream. Frame the records with `%x00` and the fields with `%x1f` so subjects
containing tabs or pipes cannot corrupt the parse, then read the whole history
in a single pass.

```js
const { stdout } = await execFileAsync(
  "git", ["-C", dir, "log", "--all", "--numstat", "--format=" + FORMAT],
  { maxBuffer: 1 << 28 },
);
return parseGitLog(stdout, repo);
```

`lib/gitIngest.mjs` ships this shape. The parser is unchanged between the two
strategies, and the benchmark asserts both produce the same commit count before
reporting a timing, so this is a like-for-like comparison.

### Measured result

All 15 repositories, median of 3 runs per strategy, warm page cache:

| Repository | Commits | File rows | Per-commit | Batched | Speedup | Spawns removed |
|---|---:|---:|---:|---:|---:|---:|
| kizuki | 449 | 1,797 | 3,919 ms | 106 ms | **36.9×** | 449 |
| harbor | 408 | 3,704 | 4,643 ms | 554 ms | 8.4× | 408 |
| 4x-war | 361 | 2,243 | 2,842 ms | 317 ms | 9.0× | 361 |
| ringi | 204 | 983 | 1,950 ms | 237 ms | 8.2× | 204 |
| omni | 140 | 824 | 1,254 ms | 217 ms | 5.8× | 140 |
| polyedge | 108 | 230 | 836 ms | 53 ms | 15.7× | 108 |
| phantom | 43 | 486 | 451 ms | 151 ms | 3.0× | 43 |
| shopify-web-replicator | 35 | 482 | 355 ms | 75 ms | 4.7× | 35 |
| agentauth | 16 | 46 | 118 ms | 13 ms | 8.9× | 16 |
| polyedge-mcp | 12 | 39 | 93 ms | 12 ms | 7.7× | 12 |
| connortesaro.dev | 7 | 139 | 82 ms | 28 ms | 2.9× | 7 |
| agentsync | 4 | 22 | 40 ms | 10 ms | 4.0× | 4 |
| leadops | 3 | 24 | 28 ms | 8 ms | 3.3× | 3 |
| trading | 2 | 124 | 29 ms | 16 ms | 1.8× | 2 |
| fulfillment-risk-monitor | 1 | 52 | 21 ms | 13 ms | 1.6× | 1 |
| **Total** | **1,792** | **11,195** | **16,660 ms** | **1,810 ms** | **9.2×** | **1,792** |

Whole-corpus ingestion goes from **16.7 s to 1.8 s** and eliminates **1,792
process spawns**.

The per-repo speedup varies from 1.6× to 36.9×, and the variance is the
interesting part. The gain tracks the ratio of commits to files, because spawn
cost scales with commits while parsing cost scales with file rows. `kizuki` has
1,797 file rows across 449 commits — four files per commit — so spawn overhead
dominates almost everything and it gains 36.9×. `fulfillment-risk-monitor` has
52 file rows in a single commit, so there is exactly one spawn to save and the
strategies are nearly identical at 1.6×.

That relationship is the reason to state the range rather than only the total: a
repository shaped differently from these would land somewhere predictable on it,
and "9.2× faster" on its own would not tell you where.

### Prevention

The benchmark is committed, so the comparison can be re-run after any change to
the connector. It fails loudly if the two strategies disagree about how many
commits exist, which would mean an optimisation had quietly changed the result.

---

## 2. pgvector search: a new connection on every query

### The original implementation

```python
def search(self, vector, k=8, **filters):
    with self._connect() as con, con.cursor() as cur:   # new connection, every call
        cur.execute("SELECT ... ORDER BY embedding <=> %s LIMIT %s", [vector, k])
```

(The driver has since changed from psycopg to pg8000 — see the note at the end of
this section — but the bug and the fix are the same either way.)

### How it was found

Not by profiling the database. It surfaced while measuring pgvector's recall
against an exact numpy scan, where pgvector came out roughly 200× slower. That
ratio was not believable for 153 vectors, which is what prompted looking at what
the measurement actually included. The answer was a TCP connect, a Postgres
authentication handshake, and `register_vector` type lookups on every single
query — none of which is search.

This is worth stating plainly because the lesson is not "pool your connections",
which everyone knows. The lesson is that an implausible benchmark result is
usually measuring the wrong thing, and the ratio being *too* dramatic is the
signal.

### The fix

One long-lived connection per store, reopened only if it has been closed.

```python
def _connect(self):
    if self._con is None:
        con = Connection(user=..., host=..., port=..., database=...)
        register_vector(con)
        object.__setattr__(self, "_con", con)
    return self._con
```

### Measured result

Median of 6 query embeddings, after two warmup queries:

| Strategy | p50 latency |
|---|---:|
| New connection per call | 24.391 ms |
| Reused connection | **2.326 ms** |

**10.5× faster**, and the remaining 2.3 ms is actual query time.

### A driver change, and why

The store originally used `psycopg`. It is **LGPL-3.0**, and this repository's
`dependency-review` gate denies LGPL for an Apache-2.0 project — CI caught it on
the pull request that introduced it.

The tempting fix is to add an exception: nothing here redistributes psycopg, and
LGPL's copyleft attaches to modifications of the library rather than to code that
imports it. But a deny-list with a carve-out for the one thing that tripped it is
not a deny-list. pgvector ships an adapter for `pg8000`, which is BSD-3-Clause,
so the swap keeps the gate strict.

It costs something, and the cost is worth stating: pg8000 is pure Python, so it
is roughly 1.7× slower per query than the C-backed driver (2.33 ms against a
previously measured 1.38 ms on the same corpus). At 153 chunks behind an LLM call
that takes seconds, that is not a tradeoff worth arguing about. At a corpus where
vector latency mattered, it would be — and the number above is what you would
re-measure to decide.

---

## 3. The optimisation not made: pgvector's HNSW index

Having fixed the measurement, the comparison it was built for gives an
uncomfortable answer.

| Backend | Recall@10 vs exact | p50 latency |
|---|---:|---:|
| pgvector, HNSW (`m=16`, `ef_construction=64`) | 1.000 | 2.326 ms |
| Exact cosine scan in numpy | 1.000 by definition | **0.130 ms** |

At 153 chunks the entire corpus is a 153×384 float32 matrix — **230 KB**. One
matmul over it is ~18× faster than an index lookup, and returns exactly the same
ten documents.

So the ANN index currently costs latency and buys nothing. It is kept anyway,
and both backends are kept behind one `VectorStore` protocol, for reasons that
are about the corpus growing rather than the corpus today:

- Exact search is linear. It wins at 153 chunks and loses somewhere in the tens
  of thousands. The crossover is a measurement waiting to be taken, not a guess
  to be argued about.
- pgvector gives transactional upserts on re-embed, concurrent readers alongside
  a writer, and index tuning. The numpy store is a read-only mirror that has to
  be rebuilt wholesale.
- `NumpyBruteForceStore` is the ground truth the eval suite measures HNSW recall
  against. Without it, "recall@10 = 1.000" would be an assumption.

`analytics/evals/run_eval.py` reports both on every run, so if the corpus grows
past the crossover the numbers will say so rather than someone remembering to
check.

---

## Conditions

All measurements on an 8 GB M1 MacBook Air (`MacBookAir10,1`), macOS 26.6,
Node 26.0.0, Python 3.13.5, DuckDB 1.5.5, PostgreSQL 18.6 with pgvector 0.8.6,
connected via pg8000 1.31.5.

The machine runs under real memory pressure — around 0.3 GiB free with roughly
1.2 GiB in the compressor during these runs — so absolute latencies are higher
than a well-provisioned machine would show. The ratios are what matter, and each
pair was measured back to back under the same conditions.
