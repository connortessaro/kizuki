"""Chunking, embedding and vector retrieval.

Two stores implement the same protocol. PgVectorStore is the real one;
NumpyBruteForceStore does an exact scan over the same vectors. Both exist so the
eval suite can report pgvector's recall against exact search rather than
asserting that an ANN index is obviously the right call at this corpus size. At
a few thousand chunks it very likely is not, and saying so with a measurement is
worth more than the index.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from getpass import getuser
from typing import Protocol
from urllib.parse import urlparse

import numpy as np

MODEL_ID = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384

# bge models are trained with an asymmetric prefix: queries get one, passages do
# not. Skipping it measurably degrades retrieval, and it is easy to forget.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

TARGET_CHARS = 900
OVERLAP_CHARS = 150


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    doc_id: str
    doc_kind: str
    source_path: str
    ordinal: int
    title: str | None
    body: str
    is_synthetic: bool
    repo_slug: str | None = None
    entity_type: str | None = None
    entity_name: str | None = None
    occurred_on: str | None = None

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.body.encode()).hexdigest()[:32]


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    doc_id: str
    doc_kind: str
    source_path: str
    title: str | None
    body: str
    is_synthetic: bool
    score: float
    repo_slug: str | None = None
    occurred_on: str | None = None


def chunk_text(
    text: str,
    *,
    doc_id: str,
    doc_kind: str,
    source_path: str,
    is_synthetic: bool,
    title: str | None = None,
    **meta,
) -> list[Chunk]:
    """Split on paragraph boundaries, packing up to a target size.

    Splitting mid-sentence is what makes retrieved passages read as gibberish in
    a UI, so paragraphs are kept whole unless one is itself oversized.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    packed: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > TARGET_CHARS:
            if current:
                packed.append(current)
                current = ""
            packed.extend(_split_long(para))
            continue
        if not current:
            current = para
        elif len(current) + len(para) + 2 <= TARGET_CHARS:
            current = f"{current}\n\n{para}"
        else:
            packed.append(current)
            current = para
    if current:
        packed.append(current)

    return [
        Chunk(
            chunk_id=hashlib.sha256(f"{doc_id}|{i}|{body}".encode()).hexdigest()[:32],
            doc_id=doc_id,
            doc_kind=doc_kind,
            source_path=source_path,
            ordinal=i,
            title=title,
            body=body,
            is_synthetic=is_synthetic,
            **meta,
        )
        for i, body in enumerate(packed)
    ]


def _split_long(para: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", para)
    out: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > TARGET_CHARS:
            out.append(current)
            current = current[-OVERLAP_CHARS:] + " " + sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        out.append(current)
    return out


class Embedder:
    """Wraps fastembed so the model is loaded once and reused.

    Loading costs several seconds and a few hundred MB, so this must be a
    long-lived singleton in any server process, not a per-request construction.
    """

    def __init__(self, model_id: str = MODEL_ID, cache_dir: str | None = None):
        from fastembed import TextEmbedding

        self.model_id = model_id
        self._model = TextEmbedding(model_id, cache_dir=cache_dir)

    def embed_passages(self, texts: Sequence[str], batch_size: int = 16) -> np.ndarray:
        vectors = list(self._model.embed(list(texts), batch_size=batch_size))
        return np.asarray(vectors, dtype=np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return np.asarray(
            next(iter(self._model.query_embed([text]))), dtype=np.float32
        )


class VectorStore(Protocol):
    def upsert(self, chunks: Sequence[Chunk], vectors: np.ndarray, model_id: str) -> int: ...

    def search(self, vector: np.ndarray, k: int = 8, **filters) -> list[Hit]: ...

    def count(self) -> int: ...


@dataclass
class PgVectorStore:
    """Postgres-backed vector store.

    Uses pg8000 rather than psycopg. psycopg is LGPL-3.0, which this repository's
    dependency-review gate denies for an Apache-2.0 project; pg8000 is
    BSD-3-Clause and pgvector ships an adapter for it. It is pure Python, so it
    is slower per round trip than a C driver — irrelevant at this corpus size,
    and measured in docs/performance.md rather than assumed.
    """

    dsn: str
    table: str = "kz.doc_chunk"
    _con: object | None = field(default=None, repr=False, compare=False)

    def _connect(self):
        """One long-lived connection, reused.

        Opening a fresh connection per search dominated query time by an order of
        magnitude and made the index look slow when the handshake was the cost.
        """
        from pg8000.native import Connection
        from pgvector.pg8000 import register_vector

        if self._con is None:
            parts = urlparse(self.dsn)
            con = Connection(
                user=parts.username or getuser(),
                host=parts.hostname or "127.0.0.1",
                port=parts.port or 5432,
                database=(parts.path or "/").lstrip("/") or "postgres",
                password=parts.password,
            )
            register_vector(con)
            object.__setattr__(self, "_con", con)
        return self._con

    def close(self) -> None:
        if self._con is not None:
            try:
                self._con.close()
            finally:
                object.__setattr__(self, "_con", None)

    def upsert(self, chunks: Sequence[Chunk], vectors: np.ndarray, model_id: str) -> int:
        if len(chunks) != len(vectors):
            raise ValueError("chunk count and vector count differ")
        con = self._connect()
        sql = f"""
            INSERT INTO {self.table}
                (chunk_id, doc_id, doc_kind, source_path, ordinal, title, body,
                 is_synthetic, repo_slug, entity_type, entity_name, occurred_on,
                 content_hash, model_id, embedding)
            VALUES (:chunk_id, :doc_id, :doc_kind, :source_path, :ordinal, :title, :body,
                    :is_synthetic, :repo_slug, :entity_type, :entity_name,
                    CAST(:occurred_on AS DATE), :content_hash, :model_id, :embedding)
            ON CONFLICT (doc_id, ordinal) DO UPDATE SET
                chunk_id = EXCLUDED.chunk_id, body = EXCLUDED.body,
                title = EXCLUDED.title, embedding = EXCLUDED.embedding,
                content_hash = EXCLUDED.content_hash, model_id = EXCLUDED.model_id,
                embedded_at = now()
            WHERE {self.table}.content_hash IS DISTINCT FROM EXCLUDED.content_hash
               OR {self.table}.model_id IS DISTINCT FROM EXCLUDED.model_id
        """
        for chunk, vector in zip(chunks, vectors):
            con.run(
                sql,
                chunk_id=chunk.chunk_id, doc_id=chunk.doc_id, doc_kind=chunk.doc_kind,
                source_path=chunk.source_path, ordinal=chunk.ordinal, title=chunk.title,
                body=chunk.body, is_synthetic=chunk.is_synthetic, repo_slug=chunk.repo_slug,
                entity_type=chunk.entity_type, entity_name=chunk.entity_name,
                occurred_on=chunk.occurred_on, content_hash=chunk.content_hash,
                model_id=model_id, embedding=vector,
            )
        return len(chunks)

    def search(self, vector: np.ndarray, k: int = 8, **filters) -> list[Hit]:
        con = self._connect()
        where, params = ["TRUE"], {"q": vector, "k": k}
        if (repo := filters.get("repo_slug")) is not None:
            where.append("repo_slug = :repo")
            params["repo"] = repo
        if (kinds := filters.get("doc_kinds")) is not None:
            where.append("doc_kind = ANY(:kinds)")
            params["kinds"] = list(kinds)
        rows = con.run(
            f"""
            SELECT chunk_id, doc_id, doc_kind, source_path, title, body,
                   is_synthetic, repo_slug, occurred_on,
                   1 - (embedding <=> :q) AS score
            FROM {self.table}
            WHERE {' AND '.join(where)}
            ORDER BY embedding <=> :q
            LIMIT :k
            """,
            **params,
        )
        return [_hit(r) for r in rows]

    def count(self) -> int:
        return self._connect().run(f"SELECT count(*) FROM {self.table}")[0][0]

    def load_all(self) -> tuple[list[Hit], np.ndarray]:
        rows = self._connect().run(
            f"""
            SELECT chunk_id, doc_id, doc_kind, source_path, title, body,
                   is_synthetic, repo_slug, occurred_on, embedding
            FROM {self.table} ORDER BY chunk_id
            """
        )
        hits = [_hit((*r[:9], 0.0)) for r in rows]
        vectors = np.asarray(
            [r[9].to_numpy() if hasattr(r[9], "to_numpy") else r[9] for r in rows],
            dtype=np.float32,
        )
        return hits, vectors


@dataclass
class NumpyBruteForceStore:
    """Exact cosine search over an in-memory matrix.

    The honest baseline. At a few thousand 384-dim vectors this is a ~3 MB
    matrix and a single matmul, so it is both exact and fast; it exists to keep
    the ANN index accountable.
    """

    hits: list[Hit]
    matrix: np.ndarray

    @classmethod
    def from_pg(cls, store: PgVectorStore) -> NumpyBruteForceStore:
        hits, vectors = store.load_all()
        return cls(hits=hits, matrix=_normalize(vectors))

    def upsert(self, chunks, vectors, model_id):  # pragma: no cover - read-only mirror
        raise NotImplementedError("brute-force store is a read-only mirror of pgvector")

    def search(self, vector: np.ndarray, k: int = 8, **filters) -> list[Hit]:
        if len(self.hits) == 0:
            return []
        scores = self.matrix @ _normalize(vector.reshape(1, -1))[0]
        order = np.argsort(-scores)[:k]
        return [
            Hit(**{**self.hits[i].__dict__, "score": float(scores[i])}) for i in order
        ]

    def count(self) -> int:
        return len(self.hits)


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.clip(norms, 1e-12, None)


def _hit(row: Iterable) -> Hit:
    chunk_id, doc_id, doc_kind, source_path, title, body, is_synthetic, repo, occurred, score = row
    return Hit(
        chunk_id=chunk_id,
        doc_id=doc_id,
        doc_kind=doc_kind,
        source_path=source_path,
        title=title,
        body=body,
        is_synthetic=is_synthetic,
        repo_slug=repo,
        occurred_on=str(occurred) if occurred else None,
        score=float(score),
    )
