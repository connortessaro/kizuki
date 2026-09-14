-- Facts. These join staging to the resolved contributor dimension.

CREATE OR REPLACE TABLE fact_commit AS
SELECT
    c.commit_id,
    c.commit_sha,
    c.repo_slug,
    ci.identity_id                                      AS author_identity_id,
    ci.contributor_id                                   AS author_contributor_id,
    c.authored_at,
    c.committed_at,
    c.authored_at::DATE                                 AS authored_date,
    c.subject,
    c.parent_count,
    c.is_merge,
    c.on_default_branch,
    c.parent_count = 0                                  AS is_root,
    c.files_changed,
    coalesce(f.insertions, 0)                           AS insertions,
    coalesce(f.deletions, 0)                            AS deletions,
    coalesce(f.insertions, 0) - coalesce(f.deletions, 0) AS net_lines,
    lower(nullif(regexp_extract(c.subject, '^([a-zA-Z]+)(\([^)]*\))?!?:', 1), '')) AS conventional_type,
    nullif(regexp_extract(c.subject, '^[a-zA-Z]+\(([^)]*)\)!?:', 1), '')           AS conventional_scope,
    regexp_matches(c.subject, '^[a-zA-Z]+(\([^)]*\))?!?: ')                        AS is_conventional,
    coalesce(f.components, [])                          AS touched_components
FROM stg_commit AS c
-- Joined on the raw pair rather than a recomputed hash: the identity hash is
-- defined once, in Python, and reimplementing it in SQL would let the two drift.
LEFT JOIN contributor_identity AS ci
       ON ci.raw_email = c.raw_author_email
      AND ci.raw_name  = c.raw_author_name
LEFT JOIN (
    SELECT
        scf.commit_id,
        sum(coalesce(scf.insertions, 0)) AS insertions,
        sum(coalesce(scf.deletions, 0))  AS deletions,
        list_distinct(list(df.component)) AS components
    FROM stg_commit_file AS scf
    JOIN dim_file AS df ON df.repo_slug = scf.repo_slug AND df.path = scf.path
    GROUP BY scf.commit_id
) AS f ON f.commit_id = c.commit_id;

CREATE OR REPLACE TABLE fact_commit_file AS
SELECT
    scf.commit_id,
    scf.commit_sha,
    scf.repo_slug,
    df.file_id,
    scf.path,
    scf.old_path,
    df.component,
    CASE
        WHEN scf.is_binary                         THEN 'binary'
        WHEN scf.old_path IS NOT NULL              THEN 'rename'
        WHEN coalesce(scf.deletions, 0) = 0        THEN 'add'
        WHEN coalesce(scf.insertions, 0) = 0       THEN 'delete'
        ELSE 'modify'
    END                                            AS change_kind,
    scf.insertions,
    scf.deletions,
    scf.is_binary,
    scf.authored_at,
    scf.authored_at::DATE                          AS authored_date,
    fc.author_contributor_id,
    fc.on_default_branch
FROM stg_commit_file AS scf
JOIN dim_file    AS df ON df.repo_slug = scf.repo_slug AND df.path = scf.path
JOIN fact_commit AS fc ON fc.commit_id = scf.commit_id;
