-- Staging: read the append-only activity ledger straight out of JSONL.
-- The ledger stays canonical; everything below is a derived projection that can
-- be dropped and rebuilt at any time.

CREATE OR REPLACE TABLE stg_commit AS
SELECT
    commitId                      AS commit_id,
    repo                          AS repo_slug,
    sha                           AS commit_sha,
    CAST(authoredAt AS TIMESTAMP) AS authored_at,
    CAST(committedAt AS TIMESTAMP) AS committed_at,
    authorName                    AS raw_author_name,
    authorEmail                   AS raw_author_email,
    subject,
    parents                       AS parent_count,
    isMerge                       AS is_merge,
    onDefaultBranch               AS on_default_branch,
    len(files)                    AS files_changed
FROM read_json(
    getvariable('ledger_path'),
    format = 'newline_delimited',
    columns = {
        version: 'INTEGER', event: 'VARCHAR', commitId: 'VARCHAR', repo: 'VARCHAR',
        sha: 'VARCHAR', authoredAt: 'VARCHAR', committedAt: 'VARCHAR',
        authorName: 'VARCHAR', authorEmail: 'VARCHAR', subject: 'VARCHAR',
        parents: 'INTEGER', isMerge: 'BOOLEAN', onDefaultBranch: 'BOOLEAN',
        files: 'STRUCT("path" VARCHAR, "insertions" BIGINT, "deletions" BIGINT, "binary" BOOLEAN, "renamedFrom" VARCHAR)[]'
    }
);

CREATE OR REPLACE TABLE stg_commit_file AS
SELECT
    c.commitId                AS commit_id,
    c.repo                    AS repo_slug,
    c.sha                     AS commit_sha,
    CAST(c.authoredAt AS TIMESTAMP) AS authored_at,
    f.path,
    f.renamedFrom             AS old_path,
    f.insertions,
    f.deletions,
    f.binary                  AS is_binary
FROM read_json(
    getvariable('ledger_path'),
    format = 'newline_delimited',
    columns = {
        commitId: 'VARCHAR', repo: 'VARCHAR', sha: 'VARCHAR', authoredAt: 'VARCHAR',
        files: 'STRUCT("path" VARCHAR, "insertions" BIGINT, "deletions" BIGINT, "binary" BOOLEAN, "renamedFrom" VARCHAR)[]'
    }
) AS c
CROSS JOIN UNNEST(c.files) AS t(f);
