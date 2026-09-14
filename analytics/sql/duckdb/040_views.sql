-- Views are the only surface the text-to-SQL layer is allowed to query. They are
-- denormalized, narrowly named, and already exclude bots and off-default-branch
-- work, which removes whole classes of wrong answer before generation starts.

CREATE OR REPLACE VIEW v_commit AS
SELECT
    fc.commit_sha,
    fc.repo_slug,
    fc.authored_at,
    fc.authored_date,
    dd.year_month,
    dd.iso_week,
    dc.canonical_name        AS contributor,
    fc.subject,
    fc.files_changed,
    fc.insertions,
    fc.deletions,
    fc.net_lines,
    fc.conventional_type,
    fc.is_merge,
    fc.touched_components
FROM fact_commit AS fc
JOIN dim_contributor AS dc ON dc.contributor_id = fc.author_contributor_id
LEFT JOIN dim_date   AS dd ON dd.date_key = fc.authored_date
WHERE NOT dc.is_bot
  AND fc.on_default_branch;

CREATE OR REPLACE VIEW v_commit_file AS
SELECT
    fcf.commit_sha,
    fcf.repo_slug,
    fcf.path,
    fcf.component,
    fcf.change_kind,
    fcf.insertions,
    fcf.deletions,
    fcf.authored_date,
    dc.canonical_name AS contributor
FROM fact_commit_file AS fcf
JOIN dim_contributor  AS dc ON dc.contributor_id = fcf.author_contributor_id
WHERE NOT dc.is_bot
  AND fcf.on_default_branch;

CREATE OR REPLACE VIEW v_repo_activity AS
SELECT
    repo_slug,
    year_month,
    count(*)                        AS commits,
    count(DISTINCT contributor)     AS contributors,
    sum(insertions)                 AS insertions,
    sum(deletions)                  AS deletions,
    sum(files_changed)              AS files_touched
FROM v_commit
GROUP BY repo_slug, year_month;

CREATE OR REPLACE VIEW v_weekly_activity AS
SELECT
    repo_slug,
    date_trunc('week', authored_date)::DATE AS week_start,
    count(*)                                AS commits,
    count(DISTINCT contributor)             AS contributors,
    sum(insertions + deletions)             AS churn
FROM v_commit
GROUP BY repo_slug, week_start;

CREATE OR REPLACE VIEW v_component_churn AS
SELECT
    repo_slug,
    component,
    date_trunc('month', authored_date)::DATE AS month_start,
    count(DISTINCT commit_sha)               AS commits,
    count(DISTINCT path)                     AS files,
    sum(coalesce(insertions, 0) + coalesce(deletions, 0)) AS churn
FROM v_commit_file
GROUP BY repo_slug, component, month_start;

CREATE OR REPLACE VIEW v_contributor_activity AS
SELECT
    contributor,
    repo_slug,
    year_month,
    count(*)                    AS commits,
    sum(insertions)             AS insertions,
    sum(deletions)              AS deletions,
    min(authored_date)          AS first_commit_date,
    max(authored_date)          AS last_commit_date
FROM v_commit
GROUP BY contributor, repo_slug, year_month;

CREATE OR REPLACE VIEW v_file_hotspot AS
SELECT
    repo_slug,
    path,
    component,
    count(DISTINCT commit_sha)      AS commits,
    count(DISTINCT contributor)     AS contributors,
    sum(coalesce(insertions, 0) + coalesce(deletions, 0)) AS churn,
    min(authored_date)              AS first_touched,
    max(authored_date)              AS last_touched
FROM v_commit_file
GROUP BY repo_slug, path, component;
