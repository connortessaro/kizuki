"""Decides whether a question needs SQL, retrieval, or both.

Deliberately rule-based. Routing here is a three-way choice with strong lexical
signals, and a deterministic router means eval numbers measure the retrieval and
SQL layers rather than drifting with a classifier's mood. It also costs nothing
and adds no latency. Its accuracy is measured against labelled expectations in
the eval suite like any other component, so if it turns out to be the weak link
that will show up as a number rather than a hunch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class Route(str, Enum):
    SQL = "sql"
    SEMANTIC = "semantic"
    HYBRID = "hybrid"


# Counting, ranking, comparing, trending: things only the warehouse knows.
SQL_SIGNALS = (
    r"\bhow many\b", r"\bhow much\b", r"\bcount\b", r"\btotal\b", r"\bsum\b",
    r"\baverage\b", r"\bmost\b", r"\bleast\b", r"\btop \d*\b", r"\bfewest\b",
    r"\bhighest\b", r"\blowest\b", r"\bbiggest\b", r"\blargest\b", r"\bsmallest\b",
    r"\brank\b", r"\bcompare\b", r"\btrend\b", r"\bover time\b", r"\bper (month|week|repo)\b",
    r"\bwhich (repo|repository|file|contributor|component|month|week)\b",
    r"\bbusiest\b", r"\bmore than \d+\b", r"\bincrease\b", r"\bdecrease\b",
)

# Reasons, intent, discussion: things only the documents know.
SEMANTIC_SIGNALS = (
    r"\bwhy\b", r"\bdecid", r"\bdecision\b", r"\brationale\b", r"\breason(ing)?\b",
    r"\bdiscuss", r"\bmeeting\b", r"\bagree", r"\bconcern\b", r"\bproposed\b",
    r"\bwhat was said\b", r"\bcontext\b", r"\bexplain", r"\bargument\b",
    r"\bunresolved\b", r"\bopen question\b",
)

# Phrasings that explicitly demand both halves.
HYBRID_SIGNALS = (
    r"\bwhy did .* (increase|decrease|spike|drop|change|jump)\b",
    r"\bdid .* (ship|land|happen)\b.*\?",
    r"\bwhat (happened|changed) after\b",
    r"\band (how|what) (many|much)\b",
    r"\bfollowed\b",
)


@dataclass(frozen=True)
class Routing:
    route: Route
    sql_score: int
    semantic_score: int
    matched: tuple[str, ...]


def _hits(patterns: tuple[str, ...], text: str) -> list[str]:
    return [p for p in patterns if re.search(p, text)]


def classify(question: str) -> Routing:
    text = question.lower()
    hybrid = _hits(HYBRID_SIGNALS, text)
    sql = _hits(SQL_SIGNALS, text)
    semantic = _hits(SEMANTIC_SIGNALS, text)

    if hybrid or (sql and semantic):
        route = Route.HYBRID
    elif sql:
        route = Route.SQL
    elif semantic:
        route = Route.SEMANTIC
    else:
        # An unsignalled question is usually a lookup about the corpus, and
        # retrieval degrades more gracefully than a guessed aggregate.
        route = Route.SEMANTIC

    return Routing(
        route=route,
        sql_score=len(sql),
        semantic_score=len(semantic),
        matched=tuple(hybrid + sql + semantic),
    )
