# Kizuki product model

> Builder north star. This describes the product we are trying to reach, not
> release order. Build order lives in [ROADMAP.md](ROADMAP.md).

## One sentence

Kizuki is a personal intelligence layer that gives your AI agents shared
memory, evidence, and interpretation while you keep authority over every
outward action.

## The problem

Each AI agent starts with a narrow window. One chat holds a decision, another
agent reads a ticket, and a third drafts a message without seeing either. More
agents can move work faster while pulling it in conflicting directions.

The missing piece is continuity. Agents need somewhere durable to leave useful
context, retrieve what other agents learned, and distinguish a fact from a
hypothesis. A folder of notes is not enough when nobody interprets how those
notes affect current work.

## The whole system

```text
Slack / GitHub / Jira / Outlook / meetings / conversations
                         |
                         v
                  AI agents gather
                  and interpret
                         |
                         v
              +---------------------+
              |       Kizuki        |
              | remember evidence   |
              | preserve certainty  |
              | connect context     |
              | track change        |
              +---------------------+
                         |
                         v
              AI agents retrieve context
              and propose the next move
                         |
                         v
                    human decides
```

Source systems still hold the raw work. The calling agent, or an MCP server it
uses, owns the credentials needed to read those systems. The agent gathers
material, interprets it, and proposes a structured update.

Kizuki takes over at the durable boundary. Deterministic code validates
identity, provenance, lifecycle, and file writes. Later, the same agent or a
different one can search and read that state through MCP. CLI workflows can
run larger sync and check passes against it.

The user stays at the end of the chain. Kizuki may recommend a message,
decision, or follow-up. The user chooses whether to act.

## The information loop

```text
capture -> validate -> remember -> retrieve -> interpret -> advise
   ^                                                        |
   +---------------------- feedback -------------------------+
```

- **Capture:** Kizuki receives source-backed work activity or an explicit
  "Kizuki this" thought. It does not copy an entire chat by default.
- **Validate:** Deterministic rules reject malformed identity, unsafe
  provenance, and invalid lifecycle changes before durable state changes.
- **Remember:** Entity records, signal history, and insight history survive one
  chat, one model, or one agent session.
- **Retrieve:** Any connected agent can search, list, and read the relevant
  state instead of asking the user to repeat it.
- **Interpret:** Agents compare new activity with existing decisions,
  dependencies, open questions, and uncertainty.
- **Advise:** Kizuki surfaces contradictions, follow-ups, evidence gaps, and
  drafts. It does not send them.
- **Feedback:** Acted, dismissed, resolved, and archived states tell later runs
  what still matters and what should stay quiet.

## Who owns what

```text
agents gather and reason
Kizuki validates and remembers
human decides and acts
```

Agents own source access, model reasoning, and the first interpretation of new
material. They can come from a CLI, an editor, an API-backed workflow, or any
other client that can use Kizuki's MCP server.

Kizuki owns durable identity, append-only history, provenance, lifecycle, and
safe local writes. It gives every connected agent the same place to retrieve
what previous work established.

The human owns intent and authority. A model can propose what something means.
It cannot quietly turn that proposal into a commitment made in the user's
name.

## End-product experience

1. **While thinking:** The user says "Kizuki this." The current agent distills
   a decision, learning, hypothesis, or question into the insight inbox.
2. **Before acting:** An agent checks Kizuki for relevant facts, decisions,
   uncertainty, and conflicts before it drafts or recommends the next move.
3. **During work:** Kizuki surfaces a small number of source-backed signals when
   they matter, with enough evidence to explain each one.
4. **Afterward:** The user records what was useful, stale, resolved, or no longer
   worth attention. Unchanged low-value items do not keep returning.

The user can move between Codex, Cursor, scheduled agents, and future clients
without rebuilding the full story in each session. Agents share continuity,
not a hidden stream of every conversation.

## Hard boundaries

- Kizuki does not passively ingest every conversation.
- Kizuki does not replace Slack, GitHub, Jira, email, or meeting tools.
- Kizuki does not treat a hypothesis or question as an established fact.
- Kizuki does not score people or turn work context into employee surveillance.
- Kizuki does not send messages or take outward action without the user.
- Kizuki does not let a model write arbitrary durable state. Deterministic code
  owns validation and storage.

## Builder test

A core feature should improve at least one of these: durable memory, evidence,
interpretation, retrieval, or human control.

Ask how the feature helps an agent carry the user's context across time without
overriding the user. If it only adds another feed, another source of truth, or
another autonomous action surface, it does not belong in Kizuki's core.
