# Why Kizuki

We are giving more work to AI agents. Each one can move quickly. Each one also
sees a different slice of what we know.

```text
more agents + fragmented context + no shared memory
                         |
                         v
          fast work in conflicting directions
```

One agent can commit you to a direction while another keeps working from an
older decision. A third can draft a confident update from a hypothesis nobody
verified. Every answer can look reasonable inside its own context window while
the work as a whole drifts away from what you meant.

Humans solve this by carrying the story between tools, meetings, and people.
Now we also carry it between agents. Copying the same background into every new
chat does not scale, and raw search only returns pieces. Someone still has to
work out what changed, which source to trust, and what the new information means
for the next move.

## What we believe

```text
memory without interpretation = archive
interpretation without evidence = guessing
action without human judgment = loss of control

Kizuki = memory + evidence + interpretation
Human  = authority
```

Agents need continuity without pretending to be the user. Kizuki gives them a
shared place to leave useful context and retrieve what earlier work established.
It remembers what happened, preserves where it came from, and keeps decisions
separate from hypotheses and unanswered questions.

A message from Slack, a merged change, a meeting transcript, and an idea
captured during a chat do not carry the same certainty.
Kizuki keeps those differences visible so the next agent can reason with them
instead of flattening them into one confident summary.

When Kizuki gets a new fact, it connects that fact to the people, projects,
decisions, and dependencies it affects. It can point out that two sources
disagree, that a downstream team still has an older assumption, or that the
current evidence does not support the draft an agent is about to recommend.

## The contract

Kizuki deals with sensitive work context. Its defaults must protect that
context.

- Durable state stays local and private by default.
- A captured thought is explicit and distilled. Kizuki does not passively copy
  every chat or store raw tool output.
- Source-backed signals keep receipts so the user can inspect why they surfaced.
- Hypotheses and questions stay labeled until evidence changes their status.
- Kizuki does not score people, rank employees, or create a surveillance record.
- Kizuki does not send messages or take outward action on its own.

The agent may interpret. Deterministic code decides whether a proposed record is
valid and writes it safely. The human decides what leaves the system and what
commitments to make.

## The product should feel like

Kizuki should feel like a quiet chief of staff shared by your agents. It knows
where the useful context lives, notices when the picture changes, and explains
why something deserves attention. When nothing changed, it stays quiet.

It should preserve uncertainty instead of manufacturing confidence. When two
sources conflict, it should show the conflict. When an idea still needs proof,
it should help the next agent investigate rather than repeat the idea as fact.

The user should be able to leave one agent, open another, and continue without
retelling the whole story. Before work or a message goes the wrong way, the new
agent can retrieve the relevant decision, see the conflicting evidence, and ask
the user what to do.
