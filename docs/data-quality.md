# Data quality

Two layers, with different jobs.

**Asset checks** (`analytics/src/kizuki_analytics/defs/__init__.py`) run inside
Dagster as part of every warehouse materialisation. They are invariants: if one
fails, the build is wrong and should not be trusted. There are four, and all
four pass on the current build.

| Check | Invariant |
|---|---|
| `facts_match_the_ledger` | `fact_commit` has exactly as many rows as the ledger |
| `every_commit_has_a_contributor` | no commit fails to resolve to a contributor |
| `commit_dates_are_plausible` | no timestamp before 2000 or more than 2 days in the future |
| `bots_are_not_merged_into_humans` | no contributor group mixes a bot with a person |

**Quality views** (`analytics/sql/duckdb/050_quality.sql`) are the other half.
They surface conditions that are not invariant violations but will still make an
answer misleading if nobody knows about them. Severity is defined by consequence,
not by how odd the condition looks:

- **error** — a query can return a wrong number
- **warn** — a number is explainable but surprising
- **info** — worth knowing, and nothing more

Read them with `kizuki quality`, or on the `/quality` page.

## What it finds in this data

Every check below fires on a real condition. None are hypothetical.

```
check                          severity  issues  magnitude
orphan_head                    error          1          1
identity_alias                 warn           5         13
merge_without_file_rows        info           9        157
binary_without_line_counts     info           8        309
stale_repo                     info           7        722
commit_without_files           info           5          7
repeated_subject               info           5        270
bot_author                     info           5         39
```

Five checks report zero issues on this build and are therefore invisible above —
`name_collision`, `timestamp_inversion`, `implausible_timestamp`,
`unresolved_author`, `orphan_file_row`. They are worth keeping precisely because
they are the ones that would matter most if they ever fired.

The `info` rows are mostly explanations of coverage gaps rather than defects.
`merge_without_file_rows` exists because git emits no `--numstat` output for
merge commits without `-m`, so 157 merges legitimately carry no file rows. Left
undocumented, someone would eventually discover that `files_changed` does not
sum to the repository's real churn and would go looking for a bug that is not
there.

---

## Root-cause case study: the repository with the most commits

### Problem

The eval suite reported `deterministic_answer_accuracy` at 0.778. One of the
failures was about as simple a question as the system handles:

> Which repository has the most commits overall?

The pipeline answered **kizuki, 449**. The reference implementation in
`analytics/evals/reference.py`, which shells out to `git` and never touches
DuckDB, said **harbor, 402**.

Both numbers are defensible on their face, which is what made it interesting.
This was not a crash or a malformed query — it was two confident, different
answers to a question with one obvious meaning.

### Investigation

First step was to look at the SQL the model actually produced, which is stored
in the generation cache:

```sql
SELECT repo_slug, commit_count AS total_commits
FROM dim_repo
ORDER BY commit_count DESC
LIMIT 1
```

That query is correct. It runs, it references an allowlisted relation, and it
answers the question as asked. The guard had nothing to object to.

So the next question was whether `dim_repo` and `v_commit` agreed:

```sql
SELECT r.repo_slug,
       r.commit_count AS dim_repo_count,
       (SELECT count(*) FROM v_commit c WHERE c.repo_slug = r.repo_slug) AS v_commit_count
FROM dim_repo r ORDER BY dim_repo_count DESC LIMIT 4;
```

```
kizuki   449  228
harbor   408  402
4x-war   361  203
ringi    204  189
```

They disagree, and they disagree by different amounts per repository — which is
the shape of a definitional difference rather than a counting bug.

### Root cause

`dim_repo.commit_count` was built from `stg_commit`, which is every commit on
every ref including bot authors. `v_commit` filters to the default branch and
excludes bots. Both are legitimate figures. `kizuki` has many feature branches,
so its all-refs count is nearly double its default-branch count; `harbor` has
almost none, so the two nearly agree. That is why the ranking flips depending on
which relation you read.

The defect was not in either number. It was that **two relations in the
text-to-SQL allowlist both offered a column that reads as "commits", meaning
different things, with no way for the model to tell them apart.** A column named
`commit_count` sitting next to a question about commit counts will get picked.
The model behaved reasonably; the schema was ambiguous.

This is a failure mode specific to exposing a schema to a language model. A human
analyst would ask which one you meant. The model cannot, so any ambiguity in the
surface becomes a silent wrong answer rather than a question.

### Fix

Two changes, in `analytics/sql/duckdb/020_dims.sql` and
`analytics/src/kizuki_analytics/warehouse.py`:

1. Rename the columns to say exactly what they count, so no future reader has to
   guess:

   ```sql
   count(*)                    AS commits_all_refs_incl_bots,
   sum(on_default_branch::INT) AS commits_on_default_branch,
   ```

2. Remove `dim_repo` from `ALLOWED_RELATIONS` entirely. The all-refs count is an
   operational figure — useful for the quality views, not for answering questions
   about activity. The allowlisted surface now offers exactly one definition of
   "a commit", carried by `v_commit` and the views built on it.

`deterministic_answer_accuracy` went from **0.778 to 1.000** on the next run.

### Prevention

- **The allowlist is the schema contract.** Anything exposed to generation has
  to have one unambiguous meaning. Base tables stay out by default; the views are
  narrow and pre-filtered specifically so there is less to misread.
- **The reference implementation stays independent.** Had the expected answers
  been computed with the same DuckDB pipeline under test, both sides would have
  read `dim_repo`, agreed, and the eval would have passed while being wrong. That
  independence is the only reason this surfaced at all.
- **The column names now carry the semantics.** `commits_all_refs_incl_bots` is
  ugly on purpose. It cannot be confused with anything.

## A second one worth recording

Also found by the eval suite, in the same session, and worth noting because it
is a different class of problem: the guard's parser is not the executor's parser.

The model generated a CTE named `freeze`. sqlglot parsed it without complaint,
the guard approved it, and DuckDB then rejected it — `freeze` is a reserved word
there. `executable_sql_rate` sat at 0.944 because of it.

The fix was not to maintain a keyword list. It was to render the validated AST
with `identify=True` so every identifier comes out quoted, which sidesteps the
entire class rather than the one instance. `executable_sql_rate` went to 1.000.

The wider point is the one that justifies the layering in
`analytics/src/kizuki_analytics/ask/guard.py`: parser approval is not execution
safety. The read-only DuckDB connection with `enable_external_access=False` is
the actual wall, because it holds whatever the parser happens to miss.
