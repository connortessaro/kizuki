import duckdb
import pytest

from kizuki_analytics.ask.guard import (
    MAX_ROWS,
    QueryTimeout,
    UnsafeSQL,
    execute_guarded,
    validate,
)

ALLOWED = frozenset({"v_commit", "v_commit_file", "v_repo_activity", "dim_repo"})


def ok(sql):
    return validate(sql, ALLOWED)


def rejected(sql):
    with pytest.raises(UnsafeSQL) as e:
        validate(sql, ALLOWED)
    return str(e.value)


# --- what must pass -------------------------------------------------------

def test_a_plain_select_passes():
    assert "v_commit" in ok("SELECT * FROM v_commit").sql


def test_an_aggregate_with_group_by_passes():
    result = ok("SELECT repo_slug, count(*) FROM v_commit GROUP BY repo_slug")
    assert result.tables == frozenset({"v_commit"})


def test_a_join_across_two_allowlisted_views_passes():
    sql = "SELECT c.repo_slug FROM v_commit c JOIN v_commit_file f ON f.commit_sha = c.commit_sha"
    assert ok(sql).tables == frozenset({"v_commit", "v_commit_file"})


def test_a_cte_is_not_mistaken_for_a_table():
    # The trap: find_all(exp.Table) would see "recent" and reject it.
    sql = "WITH recent AS (SELECT * FROM v_commit) SELECT count(*) FROM recent"
    assert ok(sql).tables == frozenset({"v_commit"})


def test_several_chained_ctes_resolve_to_their_real_base_tables():
    sql = """
        WITH a AS (SELECT * FROM v_commit),
             b AS (SELECT * FROM a WHERE insertions > 10),
             c AS (SELECT repo_slug, count(*) n FROM b GROUP BY 1)
        SELECT * FROM c ORDER BY n DESC
    """
    assert ok(sql).tables == frozenset({"v_commit"})


def test_a_window_function_passes():
    sql = """
        SELECT repo_slug, commits,
               lag(commits) OVER (PARTITION BY repo_slug ORDER BY year_month) AS prev
        FROM v_repo_activity
    """
    assert ok(sql).limit_applied is True


def test_a_union_passes():
    sql = "SELECT repo_slug FROM v_commit UNION SELECT repo_slug FROM dim_repo"
    assert ok(sql).tables == frozenset({"v_commit", "dim_repo"})


def test_a_scalar_subquery_passes():
    sql = "SELECT repo_slug FROM v_commit WHERE insertions > (SELECT avg(insertions) FROM v_commit)"
    assert ok(sql).tables == frozenset({"v_commit"})


# --- limits ---------------------------------------------------------------

def test_a_missing_limit_is_added():
    result = ok("SELECT * FROM v_commit")
    assert result.limit_applied is True
    assert f"LIMIT {MAX_ROWS}" in result.sql


def test_a_small_limit_is_left_alone():
    result = ok("SELECT * FROM v_commit LIMIT 10")
    assert result.limit_applied is False
    assert "LIMIT 10" in result.sql


def test_an_oversized_limit_is_clamped():
    result = ok("SELECT * FROM v_commit LIMIT 999999")
    assert result.limit_applied is True
    assert f"LIMIT {MAX_ROWS}" in result.sql
    assert "999999" not in result.sql


def test_a_non_literal_limit_is_clamped():
    result = ok("SELECT * FROM v_commit LIMIT (SELECT 10000)")
    assert result.limit_applied is True


# --- what must be rejected ------------------------------------------------

def test_empty_input_is_rejected():
    assert "empty" in rejected("   ")


def test_unparsable_input_is_rejected():
    assert "parse" in rejected("SELECT FROM WHERE ((((")


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE v_commit",
        "DELETE FROM v_commit",
        "INSERT INTO v_commit VALUES (1)",
        "UPDATE v_commit SET subject = 'x'",
        "CREATE TABLE evil AS SELECT 1",
        "ALTER TABLE v_commit RENAME TO gone",
        "TRUNCATE TABLE v_commit",
    ],
)
def test_mutation_and_ddl_are_rejected(sql):
    assert rejected(sql)


def test_a_stacked_statement_is_rejected():
    # DuckDB runs every statement in a batch, so this is a real attack.
    assert "exactly one statement" in rejected("SELECT * FROM v_commit; DROP TABLE v_commit")


def test_a_trailing_semicolon_alone_is_fine():
    assert ok("SELECT * FROM v_commit;").tables == frozenset({"v_commit"})


@pytest.mark.parametrize("sql", ["ATTACH 'evil.db'", "DETACH other", "PRAGMA database_list"])
def test_attach_and_pragma_are_rejected(sql):
    assert rejected(sql)


@pytest.mark.parametrize("sql", ["INSTALL httpfs", "LOAD httpfs", "CALL pragma_version()"])
def test_unmodelled_statements_fail_closed(sql):
    assert rejected(sql)


def test_copy_to_a_file_is_rejected():
    assert rejected("COPY (SELECT * FROM v_commit) TO '/tmp/leak.csv'")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM read_csv_auto('/etc/passwd')",
        "SELECT * FROM read_json_auto('/etc/passwd')",
        "SELECT * FROM read_parquet('s3://bucket/x.parquet')",
        "SELECT * FROM glob('/Users/**')",
        "SELECT * FROM read_text('/etc/passwd')",
    ],
)
def test_functions_that_reach_outside_the_database_are_rejected(sql):
    assert "forbidden function" in rejected(sql)


def test_an_unlisted_table_is_rejected():
    assert "not in the allowlist" in rejected("SELECT * FROM contributor_identity")


def test_an_unlisted_table_hidden_in_a_join_is_rejected():
    sql = "SELECT * FROM v_commit c JOIN contributor_identity i ON true"
    assert "contributor_identity" in rejected(sql)


def test_an_unlisted_table_hidden_in_a_cte_is_rejected():
    sql = "WITH leak AS (SELECT * FROM contributor_identity) SELECT * FROM leak"
    assert "contributor_identity" in rejected(sql)


def test_an_unlisted_table_hidden_in_a_subquery_is_rejected():
    sql = "SELECT * FROM v_commit WHERE repo_slug IN (SELECT raw_email FROM contributor_identity)"
    assert "contributor_identity" in rejected(sql)


def test_a_cte_named_after_an_allowlisted_view_does_not_smuggle_a_real_table():
    sql = "WITH v_commit AS (SELECT * FROM contributor_identity) SELECT * FROM v_commit"
    assert "contributor_identity" in rejected(sql)


def test_information_schema_is_not_allowlisted():
    assert rejected("SELECT * FROM information_schema.tables")


def test_a_query_against_no_table_is_rejected():
    assert "no table" in rejected("SELECT 1")


def test_a_comment_cannot_hide_a_second_statement():
    assert rejected("SELECT * FROM v_commit /* x */; DROP TABLE v_commit")


# --- execution ------------------------------------------------------------

def test_the_executed_string_is_rerendered_from_the_validated_ast():
    result = ok("select   *   from   v_commit   limit 3")
    assert result.sql != "select   *   from   v_commit   limit 3"
    assert "v_commit" in result.sql


def test_a_read_only_connection_refuses_a_write_even_if_the_guard_were_bypassed(tmp_path):
    path = tmp_path / "w.duckdb"
    duckdb.connect(str(path)).execute("CREATE TABLE t AS SELECT 1 AS a").close()
    con = duckdb.connect(str(path), read_only=True)
    with pytest.raises(duckdb.Error):
        con.execute("DROP TABLE t")


def test_execute_guarded_returns_rows_and_column_names(tmp_path):
    path = tmp_path / "w.duckdb"
    duckdb.connect(str(path)).execute("CREATE TABLE v_commit AS SELECT 'kizuki' AS repo_slug").close()
    con = duckdb.connect(str(path), read_only=True)
    rows, cols = execute_guarded(con, "SELECT repo_slug FROM v_commit", timeout_s=5)
    assert rows == [("kizuki",)] and cols == ["repo_slug"]


def test_execute_guarded_interrupts_a_runaway_query(tmp_path):
    path = tmp_path / "w.duckdb"
    duckdb.connect(str(path)).execute("CREATE TABLE t AS SELECT 1").close()
    con = duckdb.connect(str(path), read_only=True)
    with pytest.raises(QueryTimeout):
        execute_guarded(
            con,
            "SELECT count(*) FROM range(100000000000) a, range(100000) b",
            timeout_s=1.0,
        )
