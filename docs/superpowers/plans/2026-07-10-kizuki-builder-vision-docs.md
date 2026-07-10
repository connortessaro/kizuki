# Kizuki Builder Vision Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a concise builder operating model and a separate product manifesto, both centered on Kizuki as a personal intelligence layer shared by the user's AI agents.

**Architecture:** `docs/PRODUCT.md` owns the concrete product model. `docs/MANIFESTO.md` owns the belief and motivation. `README.md` and `docs/vision.md` link to both while retaining their current jobs. No code or runtime behavior changes.

**Tech Stack:** Markdown, plain-text ASCII diagrams, existing Git documentation workflow.

## Global Constraints

- Keep diagrams readable as plain text and under 80 columns.
- Use direct, human prose. No startup slogans, market claims, decorative emoji, em dashes, or large tables.
- Preserve observe-and-advise: Kizuki never sends outward actions on its own.
- Center the personal intelligence layer. Team and enterprise remain later possibilities.
- State the responsibility split: agents gather and reason; deterministic Kizuki code validates and remembers; the human decides and acts.
- State that Kizuki does not passively read every chat.
- Do not modify code, schemas, CLI behavior, MCP behavior, roadmap order, or existing strategy claims.
- Do not stage or modify `docs/superpowers/specs/2026-07-09-kizuki-insight-capture-design.md.save`.

---

### Task 1: Builder operating model

**Files:**
- Create: `docs/PRODUCT.md`

**Interfaces:**
- Consumes: approved design in `docs/superpowers/specs/2026-07-10-kizuki-builder-vision-docs-design.md`.
- Produces: canonical builder answer to "What are we building?" for later links from README and vision.

- [ ] **Step 1: Draft the product definition and problem**

Create `docs/PRODUCT.md` with this opening structure:

```markdown
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
```

- [ ] **Step 2: Add the whole-system model**

Add `## The whole system` with this diagram and plain-language explanation:

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

The explanation must cover:

- Source connectors and API credentials belong to the calling agent or its MCP servers.
- Agents propose structured observations and captures.
- Deterministic Kizuki code validates identity, provenance, lifecycle, and file writes.
- Agents later query the same Kizuki state through MCP or trigger workflows through the CLI.
- The user approves any message, decision, or outward action.

- [ ] **Step 3: Add the information loop**

Add `## The information loop` with:

```text
capture -> validate -> remember -> retrieve -> interpret -> advise
   ^                                                        |
   +---------------------- feedback -------------------------+
```

Define each stage in one or two sentences:

- Capture: source-backed work activity or an explicit "Kizuki this" thought.
- Validate: deterministic rules reject malformed identity, unsafe provenance, and invalid lifecycle changes.
- Remember: durable entity records, signal history, and insight history survive one chat or agent session.
- Retrieve: any connected agent can search, list, and read relevant state.
- Interpret: agents compare new activity with existing decisions, dependencies, and uncertainty.
- Advise: Kizuki surfaces contradictions, follow-ups, evidence gaps, and drafts without sending them.
- Feedback: acted, dismissed, resolved, and archived states teach future runs what still matters.

- [ ] **Step 4: Add responsibilities, end state, and boundaries**

Add these sections:

```markdown
## Who owns what

## End-product experience

## Hard boundaries

## Builder test
```

`Who owns what` must include this diagram:

```text
agents gather and reason
Kizuki validates and remembers
human decides and acts
```

`End-product experience` must cover four moments:

1. While thinking, the user says "Kizuki this" and saves a distilled insight.
2. Before acting, an agent checks Kizuki for relevant facts, decisions, uncertainty, and conflicts.
3. During work, Kizuki surfaces a small number of source-backed signals at useful moments.
4. Afterward, lifecycle feedback keeps stale or low-value items from returning unchanged.

`Hard boundaries` must say Kizuki does not passively ingest every conversation, replace source systems, score people, claim hypotheses as facts, or act outwardly without the user.

`Builder test` must ask whether a proposed feature improves durable memory, evidence, interpretation, retrieval, or human control. If it does none of those, it does not belong in the core.

- [ ] **Step 5: Audit and verify the document**

Run:

```bash
rg -n '^## ' docs/PRODUCT.md
rg -n 'AI agents|deterministic|human decides|passively|hypoth' docs/PRODUCT.md
awk 'length($0) > 100 { print NR ":" length($0) }' docs/PRODUCT.md
rg -n '—|–|TBD|TODO' docs/PRODUCT.md
```

Expected:

- All named sections appear once.
- Contract phrases appear in substantive prose.
- No line exceeds 100 characters.
- Final command returns no matches.

Read the file aloud once. Apply stop-slop, then humanizer: remove filler, repeated three-part cadence, promotional claims, and generic conclusions while preserving every product contract.

- [ ] **Step 6: Commit the operating model**

```bash
git add docs/PRODUCT.md
git commit -m "docs: add Kizuki product model"
```

---

### Task 2: Product manifesto

**Files:**
- Create: `docs/MANIFESTO.md`

**Interfaces:**
- Consumes: product identity and boundaries from Task 1.
- Produces: canonical builder answer to "Why should Kizuki exist?" without repeating the operating model.

- [ ] **Step 1: Write the agent-age problem**

Open with:

```markdown
# Why Kizuki

We are giving more work to AI agents. Each one can move quickly. Each one also
sees a different slice of what we know.
```

Then include:

```text
more agents + fragmented context + no shared memory
                         |
                         v
          fast work in conflicting directions
```

Explain the concrete failure: one agent commits the user to a direction while another works from an older decision. Nobody notices because each answer looks reasonable inside its own context window.

- [ ] **Step 2: State the product belief**

Add `## What we believe` and this diagram:

```text
memory without interpretation = archive
interpretation without evidence = guessing
action without human judgment = loss of control

Kizuki = memory + evidence + interpretation
Human  = authority
```

Explain that Kizuki should give agents continuity without pretending to be the user. It remembers what happened, preserves where it came from, distinguishes decisions from hypotheses, and lets later agents reason from the same picture.

- [ ] **Step 3: Add privacy, restraint, and intended feeling**

Add:

```markdown
## The contract

## The product should feel like
```

`The contract` must cover local/private storage, explicit capture, source receipts, no people scoring, no passive chat surveillance, and no autonomous outward action.

`The product should feel like` should describe a quiet chief of staff: present when useful, silent when nothing changed, able to explain why an item surfaced, and willing to preserve uncertainty instead of inventing confidence.

End on a concrete intended outcome: the user can move between agents without retelling the whole story, and catches a conflicting assumption before work or a message goes the wrong way. Do not end with a slogan.

- [ ] **Step 4: Audit and verify the manifesto**

Run:

```bash
rg -n '^## ' docs/MANIFESTO.md
rg -n 'fragmented context|evidence|Human  = authority|passive|score|outward' docs/MANIFESTO.md
awk 'length($0) > 100 { print NR ":" length($0) }' docs/MANIFESTO.md
rg -n '—|–|TBD|TODO|groundbreaking|revolutionary|landscape|pivotal' docs/MANIFESTO.md
```

Expected:

- Both named sections appear once.
- Belief and boundary phrases appear.
- No line exceeds 100 characters.
- Final command returns no matches.

Apply stop-slop, then humanizer. Keep conviction and varied rhythm; remove manifesto theater, vague significance claims, false universals, and a polished slogan ending.

- [ ] **Step 5: Commit the manifesto**

```bash
git add docs/MANIFESTO.md
git commit -m "docs: add Kizuki manifesto"
```

---

### Task 3: Documentation navigation and final review

**Files:**
- Modify: `README.md:10-21`
- Modify: `docs/vision.md:1-6`

**Interfaces:**
- Consumes: `docs/PRODUCT.md` and `docs/MANIFESTO.md` from Tasks 1 and 2.
- Produces: discoverable documentation map without changing existing strategy or roadmap content.

- [ ] **Step 1: Link the product documents from README**

After the three "Use it" bullets and before `## Usage`, add:

```markdown
Product direction:

- [Product model](docs/PRODUCT.md): the builder north star and operating model.
- [Manifesto](docs/MANIFESTO.md): why Kizuki should exist.
- [Long-form vision](docs/vision.md): strategy, validation gates, and the personal Jarvis arc.
- [Roadmap](docs/ROADMAP.md): build order.
```

- [ ] **Step 2: Add navigation to the long-form vision**

After the status quote in `docs/vision.md`, add:

```markdown
Related docs:

- [Product model](PRODUCT.md) for the concise builder operating model.
- [Manifesto](MANIFESTO.md) for the product belief.
- [Roadmap](ROADMAP.md) for build order.
```

Do not edit the rest of `docs/vision.md`.

- [ ] **Step 3: Verify links, scope, and prose**

Run:

```bash
test -f docs/PRODUCT.md
test -f docs/MANIFESTO.md
rg -n 'docs/PRODUCT.md|docs/MANIFESTO.md|docs/vision.md|docs/ROADMAP.md' README.md
rg -n '\(PRODUCT.md\)|\(MANIFESTO.md\)|\(ROADMAP.md\)' docs/vision.md
git diff --check
git status --short
```

Expected:

- Both files exist.
- README and vision contain every intended link.
- `git diff --check` exits 0.
- Status lists only intended documentation edits plus the pre-existing untracked `.save` file.

Read `docs/PRODUCT.md` followed by `docs/MANIFESTO.md`. Remove repeated paragraphs or diagrams. Confirm the product file answers "what," the manifesto answers "why," and `docs/vision.md` still owns strategy.

- [ ] **Step 4: Commit navigation**

```bash
git add README.md docs/vision.md
git commit -m "docs: link Kizuki product direction"
```

---

## Final verification

Run:

```bash
rg -n '—|–|TBD|TODO' docs/PRODUCT.md docs/MANIFESTO.md
awk 'length($0) > 100 { print FILENAME ":" NR ":" length($0) }' docs/PRODUCT.md docs/MANIFESTO.md
git diff --check
git status --short --branch
```

Expected:

- First two commands print nothing.
- `git diff --check` exits 0.
- Branch is clean except the unrelated untracked `.save` file.
