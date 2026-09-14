-- Dimensions. contributor_identity and dim_contributor are populated from
-- Python (see identity.py) because the resolution rules need real logic, not a
-- pile of CASE expressions; everything else is derivable in SQL.

CREATE OR REPLACE TABLE dim_repo AS
SELECT
    repo_slug,
    -- Named for exactly what they count. An earlier version had a bare
    -- "commit_count" here that included every ref and every bot, which does not
    -- match v_commit, and generated SQL picked whichever name looked closest.
    count(*)                                          AS commits_all_refs_incl_bots,
    sum(on_default_branch::INT)                       AS commits_on_default_branch,
    count(DISTINCT raw_author_email)                  AS raw_identity_count,
    min(authored_at)                                  AS first_commit_at,
    max(authored_at)                                  AS last_commit_at,
    sum(is_merge::INT)                                AS merge_count,
    -- A repo whose entire history is one parentless commit is almost always a
    -- detached local checkout, not a one-commit project. Flag it rather than
    -- letting it quietly read as "barely any work here".
    (count(*) = 1 AND max(parent_count) = 0)          AS head_is_orphan
FROM stg_commit
GROUP BY repo_slug;

CREATE OR REPLACE TABLE dim_date AS
SELECT
    d::DATE                                    AS date_key,
    year(d)                                    AS year,
    quarter(d)                                 AS quarter,
    month(d)                                   AS month,
    day(d)                                     AS day,
    week(d)                                    AS iso_week,
    isodow(d)                                  AS day_of_week,
    dayname(d)                                 AS day_name,
    monthname(d)                               AS month_name,
    strftime(d, '%Y-%m')                       AS year_month,
    isodow(d) >= 6                             AS is_weekend
FROM (
    SELECT unnest(generate_series(
        (SELECT min(authored_at)::DATE FROM stg_commit),
        (SELECT max(authored_at)::DATE FROM stg_commit),
        INTERVAL 1 DAY
    )) AS d
);

CREATE OR REPLACE TABLE dim_file AS
WITH touched AS (
    SELECT
        repo_slug,
        path,
        count(*)                        AS touch_count,
        count(DISTINCT commit_id)       AS commit_count,
        min(authored_at)                AS first_touched_at,
        max(authored_at)                AS last_touched_at,
        sum(coalesce(insertions, 0))    AS insertions,
        sum(coalesce(deletions, 0))     AS deletions,
        bool_or(is_binary)              AS ever_binary
    FROM stg_commit_file
    GROUP BY repo_slug, path
)
SELECT
    md5(repo_slug || '|' || path)                        AS file_id,
    repo_slug,
    path,
    regexp_extract(path, '^(.*)/[^/]+$', 1)              AS directory,
    regexp_extract(path, '([^/]+)$', 1)                  AS basename,
    lower(coalesce(nullif(regexp_extract(path, '\.([A-Za-z0-9]+)$', 1), ''), ''))  AS extension,
    CASE
        WHEN path LIKE 'test/%' OR path LIKE 'tests/%'
             OR path LIKE '%.test.%' OR path LIKE '%_test.%'
             OR path LIKE '%.spec.%'                     THEN 'test'
        WHEN path LIKE 'docs/%' OR path LIKE '%.md'      THEN 'docs'
        WHEN path LIKE '.github/%'                       THEN 'ci'
        WHEN path LIKE 'web/%' OR path LIKE 'site/%'
             OR path LIKE 'app/%' OR path LIKE 'src/app/%' THEN 'web'
        WHEN path LIKE 'lib/%' OR path LIKE 'src/%'      THEN 'core'
        WHEN path LIKE 'mcp/%'                           THEN 'mcp'
        WHEN path LIKE 'server/%' OR path LIKE 'api/%'   THEN 'server'
        WHEN path LIKE 'analytics/%'                     THEN 'analytics'
        WHEN path LIKE 'scripts/%' OR path LIKE 'bin/%'  THEN 'tooling'
        WHEN path LIKE '%lock%' OR path LIKE '%.json'
             OR path LIKE '%.yaml' OR path LIKE '%.yml'
             OR path LIKE '%.toml'                       THEN 'config'
        ELSE 'other'
    END                                                  AS component,
    touch_count,
    commit_count,
    first_touched_at,
    last_touched_at,
    insertions,
    deletions,
    ever_binary
FROM touched;
