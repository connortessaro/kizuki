"""Generates SQL by spawning the configured agent CLI.

Every call is content-addressed and cached on
sha256(prompt_version | schema_fingerprint | question). Three reasons, all of
them load-bearing:

* Evals have to be reproducible. An LLM that answers differently on each run
  makes every metric noise.
* The eval suite can then run with no model access at all, which is what makes
  it usable as a CI gate rather than a token bill.
* A live demo does not hang for ten seconds on a question that has been asked
  before.

The subprocess runs in a scratch directory with no CLAUDE.md and no MCP config.
The agent CLI otherwise inherits project context from its working directory,
which would both pollute a text-to-SQL prompt and risk pulling private repo
content into a generation request.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

PROMPT_VERSION = "sqlgen-v1"

SYSTEM = """You translate a question into exactly one DuckDB SELECT statement.

Rules:
- Output ONLY the SQL. No prose, no explanation, no markdown code fence.
- Exactly one statement. No semicolon-separated statements.
- SELECT only. Never INSERT, UPDATE, DELETE, CREATE, DROP, ATTACH, COPY or PRAGMA.
- Use only the relations listed below. Never reference any other table.
- Prefer explicit column names over SELECT *.
- Always alias aggregates with a readable name.

Available relations and their columns:
{schema}

Notes on the data:
- v_commit and v_commit_file already exclude bot authors and commits that are
  not on the default branch. Do not filter for those again.
- year_month is a 'YYYY-MM' string. authored_date is a DATE.
- contributor is a display name, already resolved across multiple git identities.

Question: {question}
"""


@dataclass(frozen=True)
class Generation:
    sql: str
    cache_hit: bool
    latency_ms: int
    prompt_hash: str


def schema_fingerprint(schema: dict[str, dict[str, str]]) -> str:
    return hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()[:16]


def render_schema(schema: dict[str, dict[str, str]]) -> str:
    return "\n".join(
        f"  {table}({', '.join(f'{c} {t}' for c, t in cols.items())})"
        for table, cols in sorted(schema.items())
    )


def _strip_fence(text: str) -> str:
    text = text.strip()
    fenced = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fenced:
        text = fenced.group(1)
    return text.strip().rstrip(";").strip()


@dataclass
class SqlGenerator:
    schema: dict[str, dict[str, str]]
    cache_dir: Path
    agent_cmd: tuple[str, ...] = ("claude", "-p", "--model", "sonnet")
    timeout_s: int = 90

    def prompt_for(self, question: str) -> str:
        return SYSTEM.format(schema=render_schema(self.schema), question=question.strip())

    def cache_key(self, question: str) -> str:
        raw = f"{PROMPT_VERSION}|{schema_fingerprint(self.schema)}|{question.strip().lower()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    def generate(self, question: str, allow_model: bool = True) -> Generation:
        key = self.cache_key(question)
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            payload = json.loads(path.read_text())
            return Generation(payload["sql"], True, 0, key)

        if not allow_model:
            raise LookupError(
                f"no cached SQL for question {question!r} (key {key}) and model calls are disabled"
            )

        started = time.perf_counter()
        sql = self._spawn(self.prompt_for(question))
        latency_ms = int((time.perf_counter() - started) * 1000)

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "question": question,
                    "sql": sql,
                    "prompt_version": PROMPT_VERSION,
                    "schema_fingerprint": schema_fingerprint(self.schema),
                    "latency_ms": latency_ms,
                },
                indent=2,
            )
        )
        return Generation(sql, False, latency_ms, key)

    def _spawn(self, prompt: str) -> str:
        with tempfile.TemporaryDirectory(prefix="kizuki-sqlgen-") as scratch:
            result = subprocess.run(
                [*self.agent_cmd, prompt],
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
                cwd=scratch,
                check=False,
            )
        if result.returncode != 0:
            raise RuntimeError(f"agent CLI failed: {result.stderr.strip()[:400]}")
        sql = _strip_fence(result.stdout)
        if not sql:
            raise RuntimeError("agent CLI returned no SQL")
        return sql
