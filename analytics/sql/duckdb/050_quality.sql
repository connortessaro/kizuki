-- Data-quality surface.
--
-- One row per detected issue, with enough context to act on it. Severity is
-- about what the issue does to an answer, not how odd it looks: "error" means a
-- query can return a wrong number, "warn" means a number is explainable but
-- surprising, "info" means it is worth knowing and nothing more.
--
-- Every check here fires on real conditions present in this data. None are
-- hypothetical.

CREATE OR REPLACE VIEW v_quality_issue AS

-- An author who commits under several addresses is one person the warehouse
-- has to merge. Left unmerged, every per-contributor number is wrong.
SELECT
    'identity_alias'                                    AS check_name,
    'warn'                                              AS severity,
    'contributor'                                       AS subject_kind,
    dc.canonical_name                                   AS subject,
    'resolved from ' || dc.identity_count || ' git identities' AS detail,
    dc.identity_count                                   AS magnitude
FROM dim_contributor AS dc
WHERE dc.identity_count > 1

UNION ALL

-- The same display name under two unrelated addresses, where no rule merged
-- them. Either a missing override or two genuinely different people.
SELECT
    'name_collision', 'warn', 'contributor', ci.raw_name,
    'same display name across ' || count(DISTINCT ci.contributor_id) || ' unmerged contributors',
    count(DISTINCT ci.contributor_id)
FROM contributor_identity AS ci
GROUP BY ci.raw_name
HAVING count(DISTINCT ci.contributor_id) > 1

UNION ALL

-- Automation authoring commits. Not a defect, but it inflates activity metrics
-- if it reaches a contributor-facing view.
SELECT
    'bot_author', 'info', 'contributor', dc.canonical_name,
    dc.total_commits || ' commits authored by automation', dc.total_commits
FROM dim_contributor AS dc
WHERE dc.is_bot

UNION ALL

-- A repo whose whole local history is one parentless commit is a detached
-- checkout. Reading it as a one-commit project understates it badly.
SELECT
    'orphan_head', 'error', 'repo', dr.repo_slug,
    'local HEAD is a parentless root commit; real history is on the remote default branch', 1
FROM dim_repo AS dr
WHERE dr.head_is_orphan

UNION ALL

-- Author date after commit date. Usually a rebase or a skewed clock; it means
-- the two time axes disagree about ordering.
SELECT
    'timestamp_inversion', 'warn', 'commit', fc.commit_sha,
    'authored_at is after committed_at in ' || fc.repo_slug, 1
FROM fact_commit AS fc
WHERE fc.authored_at > fc.committed_at + INTERVAL 1 MINUTE

UNION ALL

-- Dates that cannot be real.
SELECT
    'implausible_timestamp', 'error', 'commit', fc.commit_sha,
    'authored ' || fc.authored_at::VARCHAR || ' in ' || fc.repo_slug, 1
FROM fact_commit AS fc
WHERE fc.authored_at < TIMESTAMP '2000-01-01'
   OR fc.authored_at > current_localtimestamp() + INTERVAL 2 DAY

UNION ALL

-- A commit with no resolved contributor breaks every join through the
-- contributor dimension.
SELECT
    'unresolved_author', 'error', 'commit', fc.commit_sha,
    'no contributor resolved for this commit in ' || fc.repo_slug, 1
FROM fact_commit AS fc
WHERE fc.author_contributor_id IS NULL

UNION ALL

-- File rows whose parent commit is missing: a broken relationship.
SELECT
    'orphan_file_row', 'error', 'file', fcf.path,
    'file row references commit ' || fcf.commit_sha || ' which is not in fact_commit', 1
FROM fact_commit_file AS fcf
LEFT JOIN fact_commit AS fc ON fc.commit_id = fcf.commit_id
WHERE fc.commit_id IS NULL

UNION ALL

-- Non-merge commits that changed no files. Real, but it means files_changed
-- cannot be used as a proxy for "did work happen".
SELECT
    'commit_without_files', 'info', 'repo', fc.repo_slug,
    count(*) || ' non-merge commits recorded no file changes', count(*)
FROM fact_commit AS fc
WHERE NOT fc.is_merge AND fc.files_changed = 0
GROUP BY fc.repo_slug

UNION ALL

-- git emits no numstat for merges without -m, so merge commits have no file
-- rows by construction. Recorded so the coverage gap is explained rather than
-- discovered later.
SELECT
    'merge_without_file_rows', 'info', 'repo', fc.repo_slug,
    count(*) || ' merge commits carry no file rows (git omits numstat for merges)', count(*)
FROM fact_commit AS fc
WHERE fc.is_merge
GROUP BY fc.repo_slug

UNION ALL

-- A repo nobody has touched in a long time is not a defect, but an answer
-- about "current activity" that includes it is misleading.
SELECT
    'stale_repo', 'info', 'repo', dr.repo_slug,
    'no commits since ' || dr.last_commit_at::DATE::VARCHAR,
    date_diff('day', dr.last_commit_at, current_localtimestamp())
FROM dim_repo AS dr
WHERE dr.last_commit_at < current_localtimestamp() - INTERVAL 60 DAY

UNION ALL

-- Binary files have no line counts, so churn sums silently skip them.
SELECT
    'binary_without_line_counts', 'info', 'repo', fcf.repo_slug,
    count(*) || ' binary file changes contribute no insertions or deletions', count(*)
FROM fact_commit_file AS fcf
WHERE fcf.is_binary
GROUP BY fcf.repo_slug

UNION ALL

-- Commit subjects repeated across a repo. Usually amends or cherry-picks; worth
-- surfacing because it is what people expect "duplicate commits" to mean.
SELECT
    'repeated_subject', 'info', 'repo', fc.repo_slug,
    count(*) || ' commit subjects appear more than once', count(*)
FROM (
    SELECT repo_slug, subject
    FROM fact_commit
    GROUP BY repo_slug, subject
    HAVING count(*) > 1
) AS fc
GROUP BY fc.repo_slug;


CREATE OR REPLACE VIEW v_quality_summary AS
SELECT
    check_name,
    severity,
    count(*)      AS issues,
    sum(magnitude) AS total_magnitude
FROM v_quality_issue
GROUP BY check_name, severity;
