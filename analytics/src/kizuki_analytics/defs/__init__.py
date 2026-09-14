"""Dagster asset graph for the Kizuki data plane.

Partitioned by repo, not by time. The commit distribution is extremely lumpy
(one month holds well over a third of all commits), so a monthly partition grid
would be mostly empty buckets and would misrepresent the workload. Repos, by
contrast, really are independently ingestable and independently failable -- a
detached local checkout breaks exactly one partition.

Run it without a daemon:

    uv run dagster asset materialize -m kizuki_analytics.defs --select '*'

`dagster dev` runs a webserver plus a daemon and costs several hundred MB. That
is deliberate to avoid on a memory-constrained machine; the CLI materializes
in-process.
"""

import json
import subprocess
from pathlib import Path

import yaml
from dagster import (
    AssetCheckResult,
    AssetExecutionContext,
    Backoff,
    Definitions,
    MetadataValue,
    Output,
    RetryPolicy,
    StaticPartitionsDefinition,
    asset,
    asset_check,
)

from ..warehouse import DuckDBDriver

REPO_ROOT = Path(__file__).resolve().parents[3]
PROJECT_ROOT = REPO_ROOT.parent
CONFIG = REPO_ROOT / "config"
DATA = REPO_ROOT / "data"

KIZUKI_BIN = PROJECT_ROOT / "kizuki"
LEDGER = Path(__file__).resolve().parents[4] / "activity" / "events.jsonl"


def _repo_config() -> dict:
    return yaml.safe_load((CONFIG / "repos.yaml").read_text())


def _repo_slugs() -> list[str]:
    return [r["slug"] for r in _repo_config()["repos"]]


repo_partitions = StaticPartitionsDefinition(_repo_slugs())

# The connector shells out to git through the Node CLI. That can fail on a
# locked index or a transient filesystem error, and re-running is a no-op
# because commit identity is (repo, sha), so a retry is always safe.
CONNECTOR_RETRY = RetryPolicy(max_retries=3, delay=2, backoff=Backoff.EXPONENTIAL)


@asset(
    partitions_def=repo_partitions,
    retry_policy=CONNECTOR_RETRY,
    group_name="ingest",
    description="Append one repo's commit history to the activity ledger via the Node connector.",
)
def raw_git_activity(context: AssetExecutionContext) -> Output[dict]:
    slug = context.partition_key
    entry = next(r for r in _repo_config()["repos"] if r["slug"] == slug)
    path = Path(entry["path"]).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"repo path does not exist: {path}")

    vault = Path(_repo_config().get("vault", PROJECT_ROOT)).expanduser()
    result = subprocess.run(
        [str(KIZUKI_BIN), "ingest", "git", str(path)],
        capture_output=True,
        text=True,
        timeout=300,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "KIZUKI_VAULT": str(vault)},
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"kizuki ingest failed for {slug}: {result.stderr.strip()}")

    summary = result.stdout.strip()
    context.log.info(summary)
    return Output(
        {"repo": slug, "summary": summary},
        metadata={"summary": MetadataValue.text(summary)},
    )


@asset(
    deps=[raw_git_activity],
    group_name="warehouse",
    description="Rebuild the DuckDB analytical projection from the ledger and publish it atomically.",
)
def warehouse(context: AssetExecutionContext) -> Output[dict]:
    vault = Path(_repo_config().get("vault", PROJECT_ROOT)).expanduser()
    ledger = vault / "activity" / "events.jsonl"
    if not ledger.exists():
        raise FileNotFoundError(f"activity ledger not found at {ledger}; run the ingest assets first")

    driver = DuckDBDriver(published_path=DATA / "warehouse.duckdb")
    counts = driver.build(ledger)
    context.log.info(json.dumps(counts))
    return Output(
        counts,
        metadata={**{k: MetadataValue.int(v) for k, v in counts.items()},
                  "published": MetadataValue.path(str(driver.published_path))},
    )


@asset_check(asset=warehouse, description="Every commit row resolves to a contributor.")
def every_commit_has_a_contributor() -> AssetCheckResult:
    con = DuckDBDriver(published_path=DATA / "warehouse.duckdb").connect_read_only()
    orphans = con.execute(
        "SELECT count(*) FROM fact_commit WHERE author_contributor_id IS NULL"
    ).fetchone()[0]
    return AssetCheckResult(passed=orphans == 0, metadata={"unresolved_commits": orphans})


@asset_check(asset=warehouse, description="Fact row counts match the ledger exactly.")
def facts_match_the_ledger() -> AssetCheckResult:
    con = DuckDBDriver(published_path=DATA / "warehouse.duckdb").connect_read_only()
    staged, facts = con.execute(
        "SELECT (SELECT count(*) FROM stg_commit), (SELECT count(*) FROM fact_commit)"
    ).fetchone()
    return AssetCheckResult(
        passed=staged == facts,
        metadata={"stg_commit": staged, "fact_commit": facts},
    )


@asset_check(asset=warehouse, description="No commit is dated outside the observed corpus window.")
def commit_dates_are_plausible() -> AssetCheckResult:
    con = DuckDBDriver(published_path=DATA / "warehouse.duckdb").connect_read_only()
    bad = con.execute(
        """
        SELECT count(*) FROM fact_commit
        WHERE authored_at < TIMESTAMP '2000-01-01'
           OR authored_at > current_localtimestamp() + INTERVAL 2 DAY
        """
    ).fetchone()[0]
    return AssetCheckResult(passed=bad == 0, metadata={"implausible_timestamps": bad})


@asset_check(asset=warehouse, description="A bot is never merged into a human contributor.")
def bots_are_not_merged_into_humans() -> AssetCheckResult:
    con = DuckDBDriver(published_path=DATA / "warehouse.duckdb").connect_read_only()
    mixed = con.execute(
        """
        SELECT count(*) FROM (
            SELECT contributor_id FROM contributor_identity
            GROUP BY contributor_id HAVING count(DISTINCT is_bot) > 1
        )
        """
    ).fetchone()[0]
    return AssetCheckResult(passed=mixed == 0, metadata={"mixed_contributors": mixed})


defs = Definitions(
    assets=[raw_git_activity, warehouse],
    asset_checks=[
        every_commit_has_a_contributor,
        facts_match_the_ledger,
        commit_dates_are_plausible,
        bots_are_not_merged_into_humans,
    ],
)
