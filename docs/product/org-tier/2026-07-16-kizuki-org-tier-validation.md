# Kizuki Org Tier Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 3 and 4 require Connor personally, not an agent — see notes on each.

**Goal:** Determine whether a real VP/exec buyer wants the disclosed,
work-level-only Org tier pitch, before any infrastructure work begins.

**Architecture:** Not a build. A structured pressure-test: draft a one-page
pitch from the approved spec, define an explicit rubric for what counts as
real interest versus polite interest, run 1-2 conversations with real
VP/exec contacts, then record a go/no-go decision.

**Tech Stack:** N/A — this is a research/validation plan, not code. The
go/no-go outcome is recorded as a Backlog.md decision
(`mcp__mcp-backlog-md__create_decision`), since `backlog/` is already
initialized in this repo.

## Global Constraints

- Do not start any infrastructure work (event-schema generalization, hosted
  Postgres store, OAuth connectors, TEE hosting, rollup/RBAC/disclosure) until
  this validation returns a clear real-interest signal — per the spec's
  Sequencing section (`docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md`).
- The pitch must stay exactly as scoped in the spec's Feature set section:
  status reports, project/team-level deadline risk, team-level (not
  individual) resource signal. Never ad-lib the individual-level/person-
  scoring version the spec explicitly cut, even if a contact asks for it —
  record that ask as a data point instead (Task 5).
- Source every claim in the one-pager from the spec — no new capabilities
  invented for the pitch that aren't in the design doc.

---

### Task 1: Draft the one-page pitch summary

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-onepager.md`
- Source: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md`
  (Positioning section, Feature set section)

**Interfaces:**
- Consumes: the approved design spec's "Positioning: the moat and the
  narrative" and "Feature set" sections (already written, do not
  re-derive — extract and condense).
- Produces: a single markdown file readable in under two minutes, used
  verbatim in Task 4's conversations.

- [ ] **Step 1: Extract the positioning language**

Pull the five bullets from the spec's "Positioning" section (soul framing,
confidentiality-as-moat, monopoly framing, forward-deployed motion, TAM) and
condense each to one sentence.

- [ ] **Step 2: Extract the three features**

Pull the three items from the spec's "Feature set" section (frictionless
status reports, predictive deadline risk, scoped resource signal) verbatim —
keep the "team-level, not individual" qualifier on the resource signal
intact; this is the line most likely to get pushback in conversation, and
the pitch must not soften or drop it.

- [ ] **Step 3: Write the one-pager**

Structure: one-sentence hook (soul framing) → the three features as bullets
→ one line on confidentiality/moat → one line on what it explicitly will
never do (no per-person score). Target length: fits on one screen, no
scrolling.

- [ ] **Step 4: Check against the spec**

Re-read the draft next to the spec. Confirm every claim traces to a spec
sentence. Delete anything that doesn't.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-kizuki-org-tier-onepager.md
git commit -m "docs: add Kizuki Org tier pitch one-pager for VP validation"
```

---

### Task 2: Define the interest-signal rubric

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-signal-rubric.md`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the rubric Task 4's notes get scored against, and Task 5's
  go/no-go decision cites.

- [ ] **Step 1: Write the real-interest criteria**

Each criterion must be a yes/no test, not a vibe. Draft at least these three:
- Unprompted follow-up ask (they ask "what would it take to try this," not
  prompted by you asking if they're interested).
- Willingness to name a concrete next step with a timeframe (e.g. "loop in
  my ops lead this month") — not "sounds interesting, keep me posted."
- Names a specific number, timeframe, or internal stakeholder unprompted
  when discussing next steps (a budget range, a quarter, a named team).

- [ ] **Step 2: Write the polite-interest counter-examples**

For each criterion above, write the polite-but-not-real version next to it,
so scoring a conversation later is a lookup, not a judgment call in the
moment. Example: real = "send me a technical one-pager for my security
team"; polite = "yeah AI is definitely the future, we should chat again
sometime."

- [ ] **Step 3: Add the explicit off-spec-ask tracker**

Add a section: "If they ask for individual-level tracking or named-person
reallocation, write down the exact ask here — this is a separate data point
about market pull toward the version this spec cut, not something to
accommodate in the pitch." Leave it as an empty table with columns
(contact, exact ask, context) for Task 4 to fill.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-kizuki-org-tier-signal-rubric.md
git commit -m "docs: add real-interest rubric for Org tier VP validation"
```

---

### Task 3: Identify 1-2 target contacts

**This task is Connor's, not an agent's** — it requires real judgment about
his actual network. An agent can scaffold the place to record it.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-signal-rubric.md`
  (append a "Target contacts" section)

- [ ] **Step 1: Agent scaffolds the section**

Append a "Target contacts" table (columns: name, role, why they're a good
test, status) to the rubric doc, empty, ready for Connor to fill in.

- [ ] **Step 2: Connor fills in 1-2 names**

Real VP/exec-tier contacts Connor can actually reach — not hypothetical
personas. This step has no agent-executable action; the plan pauses here
until filled in.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-kizuki-org-tier-signal-rubric.md
git commit -m "docs: add target contacts for Org tier VP validation"
```

---

### Task 4: Conduct the conversations

**This task is entirely Connor's** — talking to real people isn't
agent-executable. The plan defines what "done" looks like so the notes are
usable in Task 5.

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-interview-notes.md`

- [ ] **Step 1: Agent scaffolds the notes template**

One section per target contact from Task 3, each with: date, the rubric
criteria from Task 2 as a checklist, a free-text quotes section, and the
off-spec-ask table from Task 2 repeated per-contact.

- [ ] **Step 2: Connor runs each conversation**

Show the one-pager from Task 1. Ask what they'd need to see to try it. Do
not lead the witness on the rubric criteria — let them raise interest or
objections unprompted, then score against the rubric afterward, not during.

- [ ] **Step 3: Connor fills in the notes template per contact**

Immediately after each conversation, before the next one, so recall stays
accurate.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-kizuki-org-tier-interview-notes.md
git commit -m "docs: record Org tier VP validation interview notes"
```

---

### Task 5: Synthesize and record the go/no-go decision

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md`
  (update the Sequencing section's status line)
- Create: a Backlog.md decision via `mcp__mcp-backlog-md__create_decision`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-16-kizuki-org-tier-interview-notes.md`
  (Task 4) scored against
  `docs/superpowers/specs/2026-07-16-kizuki-org-tier-signal-rubric.md`
  (Task 2).
- Produces: a recorded decision that either unblocks the architecture
  sequencing in the design spec, or shelves it.

- [ ] **Step 1: Score each conversation against the rubric**

For each contact in the interview notes, mark each rubric criterion met/not
met. No criterion met across all contacts = no-go. Any criterion clearly met
= go.

- [ ] **Step 2: Check the off-spec-ask table**

If multiple contacts independently asked for the individual-level version
this spec cut, note that explicitly in the decision — it's a real signal
about a different, riskier product, not evidence for or against this one.

- [ ] **Step 3: Record the decision**

Call `mcp__mcp-backlog-md__create_decision` with the outcome (go/no-go),
citing the specific rubric criteria met or unmet and the contacts involved.

- [ ] **Step 4: Update the design spec**

If go: update the Sequencing section's status line in
`docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md` to record the
validation result and date, and note that architecture sequencing
(event schema → hosted store → OAuth connectors → TEE → rollup/RBAC) is now
unblocked. If no-go: update the status line to record that too, and that
the idea is shelved pending new signal.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-16-kizuki-org-tier-design.md
git commit -m "docs: record Org tier VP validation outcome"
```
