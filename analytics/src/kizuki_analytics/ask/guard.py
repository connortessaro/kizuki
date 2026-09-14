"""Validation for model-generated SQL.

Layered, and deliberately so. The read-only connection in `execute_guarded` is
the actual wall: DuckDB physically cannot run DDL or DML on it, whatever the
parser does or fails to do. Everything above that is there to reject bad SQL
early, with a message worth feeding back for a repair attempt, rather than to be
the only thing standing between a model and the data.

The executed string is always re-rendered from the validated AST, never the
original text, so there is no gap between what was checked and what runs.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

import duckdb
import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError
from sqlglot.optimizer.scope import build_scope

DIALECT = "duckdb"
MAX_ROWS = 500
DEFAULT_TIMEOUT_S = 8.0

FORBIDDEN_NODES: tuple[type[exp.Expression], ...] = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Drop,
    exp.Create,
    exp.Alter,
    exp.Copy,
    exp.Attach,
    exp.Detach,
    exp.Set,
    exp.Use,
    exp.Grant,
    exp.TruncateTable,
    exp.Merge,
    exp.Pragma,
    # Command is sqlglot's catch-all for statements it does not model, which
    # includes INSTALL, LOAD and CALL. Rejecting it makes unknown syntax fail
    # closed rather than slipping through unrecognised.
    exp.Command,
)

# Table functions that reach outside the database.
BANNED_FUNCTIONS = frozenset(
    {
        "read_csv",
        "read_csv_auto",
        "read_parquet",
        "read_json",
        "read_json_auto",
        "read_text",
        "read_blob",
        "read_ndjson",
        "glob",
        "parquet_scan",
        "sniff_csv",
        "load",
        "install",
        "shell",
        "system",
        "getvariable",
        "duckdb_settings",
        "duckdb_extensions",
    }
)


class UnsafeSQL(ValueError):
    """The generated SQL was rejected before execution."""


class QueryTimeout(RuntimeError):
    """The query ran longer than the allowed budget and was interrupted."""


@dataclass(frozen=True)
class GuardResult:
    sql: str
    tables: frozenset[str] = field(default_factory=frozenset)
    limit_applied: bool = False


def _function_name(fn: exp.Func) -> str:
    """The callable's name, for both modelled and unmodelled functions.

    sqlglot models some table functions as dedicated classes (read_parquet ->
    ReadParquet) whose `.name` is empty, and leaves others as Anonymous where
    `.name` carries it. Checking only one of the two leaves a whole family of
    file-reading functions unguarded.
    """
    if isinstance(fn, exp.Anonymous):
        return (fn.name or "").lower()
    names = getattr(type(fn), "sql_names", None)
    return names()[0].lower() if names else type(fn).__name__.lower()


def _referenced_tables(root: exp.Expression) -> set[str]:
    """Real tables only.

    sqlglot's own docs warn against `find_all(exp.Table)` for this: it also
    matches CTE names, so a perfectly good `WITH recent AS (...) SELECT * FROM
    recent` would look like a reference to a table called `recent`. Scope
    analysis knows the difference.
    """
    scope = build_scope(root)
    if scope is None:
        return {t.name for t in root.find_all(exp.Table)}
    tables: set[str] = set()
    for sub in scope.traverse():
        for _alias, source in sub.selected_sources.values():
            if isinstance(source, exp.Table):
                tables.add(source.name)
    return tables


def validate(sql: str, allowed_tables: frozenset[str], max_rows: int = MAX_ROWS) -> GuardResult:
    if not sql or not sql.strip():
        raise UnsafeSQL("empty query")

    try:
        statements = sqlglot.parse(sql, read=DIALECT)
    except ParseError as error:
        raise UnsafeSQL(f"could not parse as {DIALECT} SQL: {error}") from error

    statements = [s for s in statements if s is not None]
    if len(statements) != 1:
        # DuckDB executes every statement in a batch, not just the last one, so
        # "SELECT 1; DROP TABLE x" is a real attack and not a parser curiosity.
        raise UnsafeSQL(f"expected exactly one statement, got {len(statements)}")

    root = statements[0]
    if not isinstance(root, (exp.Select, exp.Union, exp.Except, exp.Intersect, exp.Subquery)):
        raise UnsafeSQL(f"only SELECT queries are allowed, got {type(root).__name__}")

    for node in root.walk():
        if isinstance(node, FORBIDDEN_NODES):
            raise UnsafeSQL(f"forbidden statement type: {type(node).__name__}")

    for fn in root.find_all(exp.Func):
        name = _function_name(fn)
        if name in BANNED_FUNCTIONS:
            raise UnsafeSQL(f"forbidden function: {name}")

    tables = _referenced_tables(root)
    if not tables:
        raise UnsafeSQL("query references no table")
    disallowed = sorted(tables - set(allowed_tables))
    if disallowed:
        raise UnsafeSQL(f"table(s) not in the allowlist: {', '.join(disallowed)}")

    root, limit_applied = _clamp_limit(root, max_rows)
    # identify=True quotes every identifier on the way out. The guard's parser is
    # not the executor's parser: sqlglot happily accepts a CTE named `freeze`,
    # and DuckDB then rejects it as a reserved word. Quoting closes that gap
    # instead of trying to keep a keyword list in sync with the engine.
    return GuardResult(
        sql=root.sql(dialect=DIALECT, pretty=True, identify=True),
        tables=frozenset(tables),
        limit_applied=limit_applied,
    )


def _clamp_limit(root: exp.Expression, max_rows: int) -> tuple[exp.Expression, bool]:
    limit = root.args.get("limit")
    if limit is None:
        return root.limit(max_rows), True
    value = limit.expression
    if isinstance(value, exp.Literal) and value.is_int and int(value.name) <= max_rows:
        return root, False
    return root.limit(max_rows), True


def execute_guarded(con, sql: str, timeout_s: float = DEFAULT_TIMEOUT_S):
    """Run validated SQL with a wall-clock budget.

    DuckDB has no statement_timeout. `con.interrupt()` works because the
    executor checks for interruption between tasks rather than blocking in one
    uninterruptible call. `execute` materializes eagerly, so the timer has to
    cover `execute` itself and not just the fetch.
    """
    timer = threading.Timer(timeout_s, con.interrupt)
    timer.start()
    try:
        cursor = con.execute(sql)
        return cursor.fetchall(), [d[0] for d in cursor.description]
    except duckdb.InterruptException as error:
        raise QueryTimeout(f"query exceeded {timeout_s}s and was interrupted") from error
    finally:
        timer.cancel()
