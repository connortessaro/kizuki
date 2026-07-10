# Kizuki builder vision docs

Date: 2026-07-10
Status: approved design

## Goal

Give builders two short documents that answer different questions:

- `docs/PRODUCT.md`: What are we building?
- `docs/MANIFESTO.md`: Why should it exist?

Both describe Kizuki as a personal intelligence layer shared by the user's AI
agents. Team and enterprise products remain possible later extensions, not the
center of these documents.

## File boundaries

### `docs/PRODUCT.md`

Builder operating model. A new contributor should understand Kizuki's end state
without reading implementation specs or the roadmap.

Sections:

1. One-line product definition.
2. The personal context problem.
3. Whole-system ASCII diagram.
4. Information lifecycle: capture, remember, interpret, retrieve, advise,
   feedback.
5. Responsibility split between source connectors, AI agents, Kizuki, and the
   human.
6. End-product experience across thinking, checking, and daily work.
7. Hard boundaries and a builder test for new features.

The document describes the target product, not a release checklist. It may name
current foundations where that helps explain the model, but it does not catalog
commands or implementation files.

### `docs/MANIFESTO.md`

Short statement of conviction. It should explain why agent-heavy work creates a
continuity problem and why retrieval alone does not solve it.

Sections:

1. More agents create more fragmented context and conflicting action.
2. Kizuki gives those agents shared memory, evidence, and interpretation.
3. The human remains the authority.
4. Privacy and provenance are product behavior, not deployment details.
5. Kizuki should earn attention through useful restraint.

This file may use first-person plural sparingly. It should sound like a builder
with a point of view, not marketing copy.

## Diagram language

Use several small ASCII diagrams instead of one large architecture diagram.
Keep lines under 80 columns and make every diagram readable as plain text.

Core model:

```text
work sources + captured thoughts
              |
              v
        AI agents read
              |
              v
      Kizuki remembers
      Kizuki interprets
      Kizuki tracks change
              |
              v
    AI agents retrieve context
    and propose next moves
              |
              v
         human decides
```

Manifesto model:

```text
more agents + fragmented context + no shared memory
                         |
                         v
          fast work in conflicting directions
```

Responsibility model:

```text
agents gather and reason
Kizuki validates and remembers
human decides and acts
```

The final prose can tighten these sketches, but it must preserve their meaning.

## Relationship to existing docs

- `docs/vision.md` stays the longer strategic thesis: alignment wedge, personal
  Jarvis arc, agent-age risk, business shape, and validation gates.
- `docs/PRODUCT.md` becomes the canonical builder north star.
- `docs/MANIFESTO.md` carries the product belief in a shorter voice.
- `docs/ROADMAP.md` remains build order.
- Feature specs remain implementation contracts.

Add a short navigation note to `README.md` and cross-links near the top of
`docs/vision.md`. Do not rewrite the existing strategy or roadmap in this task.

## Writing rules

- Prefer concrete nouns and short sentences.
- Avoid startup slogans, market claims, and invented certainty.
- No em dashes, decorative emoji, or large tables.
- Keep each diagram focused on one relationship.
- Preserve Kizuki's observe-and-advise boundary.
- Say explicitly that agents own source access and reasoning, while
  deterministic Kizuki code validates and stores durable state.
- Say explicitly that Kizuki does not passively read every chat or act outwardly
  on its own.

## Acceptance

A builder should finish both files able to answer:

- What information enters Kizuki?
- What does Kizuki own that an AI agent does not?
- How do agents use Kizuki later?
- Why are evidence and epistemic state important?
- Who has final authority?
- Which proposed features do not belong?

The two files should complement each other without repeating whole sections.

## Non-goals

- No code, CLI, MCP, dashboard, or schema changes.
- No new team or enterprise commitment.
- No replacement of `docs/vision.md`.
- No passive session ingestion design.
- No implementation plan beyond these documentation edits.
