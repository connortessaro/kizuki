CREATE SCHEMA IF NOT EXISTS kz;

CREATE TABLE IF NOT EXISTS kz.doc_chunk (
    chunk_id      TEXT PRIMARY KEY,
    doc_id        TEXT        NOT NULL,
    doc_kind      TEXT        NOT NULL,
    source_path   TEXT        NOT NULL,
    ordinal       INTEGER     NOT NULL,
    title         TEXT,
    body          TEXT        NOT NULL,
    -- NOT NULL with no default on purpose: every insert has to state whether
    -- the content is fabricated, so nothing can be shipped unlabelled.
    is_synthetic  BOOLEAN     NOT NULL,
    repo_slug     TEXT,
    entity_type   TEXT,
    entity_name   TEXT,
    occurred_on   DATE,
    content_hash  TEXT        NOT NULL,
    model_id      TEXT        NOT NULL,
    embedding     vector(384) NOT NULL,
    embedded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (doc_id, ordinal)
);

CREATE INDEX IF NOT EXISTS doc_chunk_hnsw
    ON kz.doc_chunk USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS doc_chunk_fts
    ON kz.doc_chunk USING gin (to_tsvector('english', body));

CREATE INDEX IF NOT EXISTS doc_chunk_synthetic ON kz.doc_chunk (is_synthetic);
CREATE INDEX IF NOT EXISTS doc_chunk_repo      ON kz.doc_chunk (repo_slug);
CREATE INDEX IF NOT EXISTS doc_chunk_date      ON kz.doc_chunk (occurred_on);
