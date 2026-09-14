"""Loopback HTTP service for the ask pipeline.

Mirrors the existing Kizuki daemon's posture: 127.0.0.1 only, bearer token from
a 0600 file in the vault's state directory. The Next.js dashboard and the
`kizuki ask` CLI both talk to this rather than reimplementing retrieval, so
there is exactly one embedding model and one tokenizer in the system. Two
implementations of a similarity function in two languages would drift, and query
vectors would quietly land in a different region of space than the documents.

Run with a single worker. Each worker loads its own copy of the ONNX model.
"""

from __future__ import annotations

import json
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from ..retrieval import Embedder, PgVectorStore
from ..warehouse import DuckDBDriver
from .pipeline import AskPipeline

ANALYTICS_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_VAULT = ANALYTICS_ROOT.parent
DEFAULT_PORT = 4248

state: dict = {}


def config_path(vault: Path) -> Path:
    return vault / "state" / "ask.json"


def ensure_config(vault: Path, port: int = DEFAULT_PORT) -> dict:
    path = config_path(vault)
    if path.exists():
        return json.loads(path.read_text())
    config = {"version": 1, "host": "127.0.0.1", "port": port, "token": secrets.token_urlsafe(32)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n")
    path.chmod(0o600)
    return config


@asynccontextmanager
async def lifespan(app: FastAPI):
    vault = Path(os.environ.get("KIZUKI_VAULT", DEFAULT_VAULT))
    state["config"] = ensure_config(vault)
    # Load the model at boot, not on first request: a cold ONNX session costs
    # several seconds and would make the first demo query look broken.
    state["pipeline"] = AskPipeline(
        driver=DuckDBDriver(published_path=ANALYTICS_ROOT / "data" / "warehouse.duckdb"),
        store=PgVectorStore(dsn=os.environ.get("KIZUKI_PG_DSN", "postgresql://127.0.0.1:5433/kizuki")),
        embedder=Embedder(),
        cache_dir=ANALYTICS_ROOT / "data" / "sqlcache",
    )
    yield
    state["pipeline"].close()


app = FastAPI(title="Kizuki ask", lifespan=lifespan)


def authorize(authorization: str = Header(default="")) -> None:
    expected = state.get("config", {}).get("token")
    presented = authorization.removeprefix("Bearer ").strip()
    if not expected or not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=6, ge=1, le=20)
    allow_model: bool = True


@app.get("/v1/health")
def health() -> dict:
    pipeline = state.get("pipeline")
    return {
        "ok": pipeline is not None,
        "relations": sorted(pipeline.schema) if pipeline else [],
    }


@app.get("/v1/quality", dependencies=[Depends(authorize)])
def quality() -> dict:
    """Data-quality issues detected in the current warehouse build."""
    con = state["pipeline"]._con
    summary = con.execute(
        """
        SELECT check_name, severity, issues, total_magnitude
        FROM v_quality_summary
        ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, issues DESC
        """
    ).fetchall()
    issues = con.execute(
        """
        SELECT check_name, severity, subject_kind, subject, detail, magnitude
        FROM v_quality_issue
        ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
                 magnitude DESC
        LIMIT 200
        """
    ).fetchall()
    return {
        "summary": [
            {"check_name": r[0], "severity": r[1], "issues": r[2], "total_magnitude": r[3]}
            for r in summary
        ],
        "issues": [
            {
                "check_name": r[0], "severity": r[1], "subject_kind": r[2],
                "subject": r[3], "detail": r[4], "magnitude": r[5],
            }
            for r in issues
        ],
    }


@app.post("/v1/ask", dependencies=[Depends(authorize)])
def ask(request: AskRequest) -> dict:
    pipeline: AskPipeline = state["pipeline"]
    answer = pipeline.ask(request.question, k=request.k, allow_model=request.allow_model)
    return answer.to_dict()
