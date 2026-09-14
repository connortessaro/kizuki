# SQL generation cache

One file per question, named `sha256(prompt_version | schema_fingerprint |
question)`. Each holds the SQL a model produced for that question, plus the
latency of the call that produced it.

These are committed on purpose. The eval suite runs with `--cache-only` in CI,
which serves every query from here and makes **zero model calls** — verified by
running the suite with the agent CLI removed from `PATH`. Without the cache,
evals would either cost tokens on every push or not run in CI at all.

The key includes the schema fingerprint, so changing a column name invalidates
every entry that depended on it rather than silently serving SQL written against
a schema that no longer exists. That has already happened once: renaming
`dim_repo.commit_count` invalidated the whole cache, which is the intended
behaviour.

Regenerate by deleting a file and re-running `evals/run_eval.py` without
`--cache-only`.
