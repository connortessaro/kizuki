"""Builds the analytical projection from the activity ledger.

The ledger is canonical. This module only ever reads it and rebuilds derived
tables, so dropping the warehouse file and rebuilding is always safe and always
produces the same result.

The build writes to a staging path and atomically renames onto the published
path. DuckDB refuses to open a file read-write while another process holds it
read-only, so a long-lived reader (the ask service) would otherwise make every
rebuild fail. The rename mirrors how the Node side already writes its ledgers.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import duckdb
import yaml

from .corpus import PSEUDONYMS
from .identity import RawIdentity, identity_hash, is_bot, resolve

SQL_DIR = Path(__file__).resolve().parents[2] / "sql" / "duckdb"
CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

BUILD_STEPS = (
    "010_staging.sql",
    "020_dims.sql",
    "030_facts.sql",
    "040_views.sql",
    "050_quality.sql",
)

# Only these may appear in generated SQL. Views, not base tables: they already
# exclude bots and non-default-branch commits.
#
# dim_repo is deliberately absent. It counts every ref and every bot, so it
# disagrees with v_commit about what "a commit" is, and an eval question asking
# for "the repository with the most commits" got two different answers depending
# on which relation the model happened to pick. One definition, one surface.
ALLOWED_RELATIONS = frozenset(
    {
        "v_commit",
        "v_commit_file",
        "v_repo_activity",
        "v_weekly_activity",
        "v_component_churn",
        "v_contributor_activity",
        "v_file_hotspot",
        "dim_date",
        "dim_contributor",
    }
)


class OlapDriver(Protocol):
    """The seam a ClickHouse backend would implement.

    Only DuckDB is built. A second driver is not stubbed out, because a stub
    that has never run is a claim, not a seam.
    """

    def connect_read_only(self): ...

    def build(self, ledger_path: Path) -> dict[str, int]: ...


@dataclass(frozen=True)
class DuckDBDriver:
    published_path: Path
    memory_limit: str = "1GB"
    threads: int = 4
    # The commit data is the operator's own, but collaborators appear in it and
    # did not sign up to be in a portfolio demo. Display names are replaced with
    # stable pseudonyms by default; raw names and emails stay in
    # contributor_identity, which never leaves the machine.
    pseudonymize: bool = True

    @property
    def staging_path(self) -> Path:
        return self.published_path.with_suffix(f".duckdb.tmp-{uuid.uuid4().hex[:8]}")

    def _configure(self, con) -> None:
        # DuckDB defaults memory_limit to 80% of system RAM. On an 8 GB laptop
        # that is 6.4 GB and it will swap the machine into a stall.
        con.execute(f"SET memory_limit = '{self.memory_limit}'")
        con.execute(f"SET threads = {self.threads}")

    def connect_read_only(self):
        con = duckdb.connect(str(self.published_path), read_only=True)
        self._configure(con)
        return con

    def build(self, ledger_path: Path) -> dict[str, int]:
        staging = self.staging_path
        staging.parent.mkdir(parents=True, exist_ok=True)
        con = duckdb.connect(str(staging))
        try:
            self._configure(con)
            con.execute("SET VARIABLE ledger_path = ?", [str(ledger_path)])
            con.execute(read_sql("010_staging.sql"))
            _build_identities(con, pseudonymize=self.pseudonymize)
            for step in BUILD_STEPS[1:]:
                con.execute(read_sql(step))
            counts = _row_counts(con)
        finally:
            con.close()
        os.replace(staging, self.published_path)
        return counts


def read_sql(name: str) -> str:
    return (SQL_DIR / name).read_text()


def load_overrides(path: Path | None = None) -> dict[str, str]:
    path = path or (CONFIG_DIR / "identity_overrides.yaml")
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text()).get("groups") or {}


def _build_identities(
    con, overrides: dict[str, str] | None = None, pseudonymize: bool = True
) -> None:
    rows = con.execute(
        """
        SELECT raw_author_email, raw_author_name, count(*), list(DISTINCT repo_slug)
        FROM stg_commit GROUP BY 1, 2
        """
    ).fetchall()
    identities = [
        RawIdentity(email=e, name=n, commit_count=c, repos=tuple(r)) for e, n, c, r in rows
    ]
    resolutions, contributors = resolve(identities, overrides or load_overrides())
    by_id = {i.identity_id: i for i in identities}

    con.execute(
        """
        CREATE OR REPLACE TABLE contributor_identity (
            identity_id VARCHAR, raw_email VARCHAR, raw_name VARCHAR,
            email_hash VARCHAR, contributor_id VARCHAR, is_bot BOOLEAN,
            commit_count BIGINT, repo_count INTEGER
        )
        """
    )
    con.executemany(
        "INSERT INTO contributor_identity VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                r.identity_id,
                by_id[r.identity_id].email,
                by_id[r.identity_id].name,
                identity_hash(by_id[r.identity_id].email),
                r.contributor_id,
                is_bot(by_id[r.identity_id].email, by_id[r.identity_id].name),
                by_id[r.identity_id].commit_count,
                len(by_id[r.identity_id].repos),
            )
            for r in resolutions
        ],
    )

    con.execute(
        """
        CREATE OR REPLACE TABLE identity_resolution_rule (
            identity_id VARCHAR, contributor_id VARCHAR, rule_kind VARCHAR,
            evidence VARCHAR, confidence DOUBLE
        )
        """
    )
    con.executemany(
        "INSERT INTO identity_resolution_rule VALUES (?, ?, ?, ?, ?)",
        [(r.identity_id, r.contributor_id, r.rule_kind, r.evidence, r.confidence) for r in resolutions],
    )

    display = _display_names(contributors, pseudonymize)

    con.execute(
        """
        CREATE OR REPLACE TABLE dim_contributor (
            contributor_id VARCHAR, canonical_name VARCHAR, canonical_email_hash VARCHAR,
            identity_count INTEGER, is_bot BOOLEAN, total_commits BIGINT
        )
        """
    )
    con.executemany(
        "INSERT INTO dim_contributor VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                c["contributor_id"],
                display[c["contributor_id"]],
                c["canonical_email_hash"],
                c["identity_count"],
                c["is_bot"],
                c["total_commits"],
            )
            for c in contributors.values()
        ],
    )


def _display_names(contributors: dict[str, dict], pseudonymize: bool) -> dict[str, str]:
    """Stable pseudonyms for humans; bots keep their real names.

    Ordered by commit count so the mapping does not shuffle between builds when
    a new contributor appears.
    """
    if not pseudonymize:
        return {cid: c["canonical_name"] for cid, c in contributors.items()}
    humans = sorted(
        (c for c in contributors.values() if not c["is_bot"]),
        key=lambda c: (-c["total_commits"], c["contributor_id"]),
    )
    mapping = {
        c["contributor_id"]: PSEUDONYMS[i % len(PSEUDONYMS)] for i, c in enumerate(humans)
    }
    for cid, c in contributors.items():
        mapping.setdefault(cid, c["canonical_name"])
    return mapping


COUNTED = (
    "stg_commit",
    "stg_commit_file",
    "dim_repo",
    "dim_file",
    "dim_date",
    "dim_contributor",
    "contributor_identity",
    "identity_resolution_rule",
    "fact_commit",
    "fact_commit_file",
)


def _row_counts(con) -> dict[str, int]:
    return {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in COUNTED}


def schema_for_guard(con) -> dict[str, dict[str, str]]:
    """Column types for the allowlisted relations, for SQLGlot qualification."""
    schema: dict[str, dict[str, str]] = {}
    rows = con.execute(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_name IN ({})
        ORDER BY table_name, ordinal_position
        """.format(",".join(f"'{t}'" for t in sorted(ALLOWED_RELATIONS)))
    ).fetchall()
    for table, column, dtype in rows:
        schema.setdefault(table, {})[column] = dtype
    return schema
