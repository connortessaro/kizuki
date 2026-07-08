# Kizuki — Jarvis presence-layer ideation (2026-07-07)

> Status: **ideation, not a build order.** Captured from an ADHD divergent-ideation
> session. Vision context lives in `docs/vision.md` (the A-path Jarvis north star).
> Nothing here is built before the v1→v2 validation gate. See the analysis at the
> bottom for the one slice that doubles as validation.

## What this explored

The A-path Jarvis has three organs already (memory = vault, senses = MCP
connectors, judgment = analysis/alerts). The missing organ is **presence**: making
Kizuki conversational, ambient, and proactive instead of three surfaces you go to
(CLI, dashboard, MCP). This session diverged on what presence looks like across 5
cognitive frames (3am on-call, game designer, executive chief-of-staff, remove-the-
interface-assumption, hardware/interrupt-controller).

## Idea pool (clustered by angle)

**Trust economy** — monotonic trust budget (right refunds, wrong drains, zero →
goes silent until you re-open it); hard daily interrupt quota, visibly spent;
user-tuned trust threshold; nightly self-replay that auto-tightens its own
thresholds.

**Right-moment (seams)** — deliver only in calendar/typing seams; doorway debrief
at meeting-end while context is hot; clock-domain handshake so nothing lands
mid-focus; wake-on-event cheap always-on watcher + expensive core that sleeps.

**Pre-send / pre-write intercept** — "before you send that…" whisper in the Slack
compose box; editor gutter ghost-note flagging the unstated assumption another team
will misread; pre-send arm-tap when an outgoing message contradicts known state.

**Ambient glanceable** — confidence-weather menubar glyph; a "holding" light (pull
not push). (Physical hardware — desk LED, wrist haptic — flagged as a trap for a
solo software founder.)

**Anti-feed** — one index card at a time, next hidden until you dismiss this one;
"ghost of things about to expire" (scarcity/expiry as pacing). (Boss-fight health
bars / streaks flagged as a gamification trap.)

**Legible restraint** — withheld ledger ("I held 3 things I judged not worth
interrupting — overrule me?"); why-now receipt (the exact source lines); dismiss
reasons become the training signal.

**Systems hygiene** — debounce until a signal is stable (don't fire on a
still-resolving thread); backpressure buffer that drops-with-notice under
saturation; coalesce interrupts by person/project; priority-inversion detector
(the low-looking item silently blocking your launch gets boosted).

**Voice / form factor** — push-to-talk hotkey with a sub-5s spoken answer from the
vault; walk-and-talk earbud briefing on the commute. (Riding Siri/home-speaker
flagged as a trap: platform lock + sends work data off the local-first box.)

**Ritual** — nightly narrated debrief; save-state conversations that resume
mid-thought.

## Shortlist (deepened)

1. **★★ Pre-send / pre-write intercept** — the single highest-value staff move: the
   quiet stop right before a mistake ships. Watch a compose surface; whisper one
   line + a why-now receipt when the draft contradicts known state; dismissable,
   never blocks. Observe-and-advise preserved. Risk: per-surface hooks are intrusive
   and creepiness-prone. First slice: `kizuki check "<draft>"` (no hooks) — see the
   companion spec.

2. **★ Trust economy + withheld ledger** — rationed, earned interrupts + nightly
   "here's what I held, overrule me." Makes proactivity acceptable and self-tuning;
   structurally kills cry-wolf. Risk: needs interrupt history to tune (cold-start).
   First slice: just log what fired / was held / was acted on.

3. **★ Right-moment seam engine + priority-inversion** — deliver in attention
   pockets (calendar/idle-aware), fed by surfacing the hidden blocker gating
   something you care about; debounce so only settled misalignments fire. Risk:
   seam detection is OS/permission-messy. First slice: meeting-end trigger only.

## Traps (seductive, rejected)

- **Internal prediction/futures/CDS markets** on decisions and promises — appeared
  ~5× (most-repeated idea in the vision pass) yet dead: it scores humans/agents
  (violates the no-scoring principle) and is socially toxic/gameable.
- **Physical hardware** (desk LED, wrist haptic, pendant) — a solo software founder
  building hardware is a death march; a menubar glyph gets the ambient win.
- **Gamification** (health bars, streaks, juice) — trivializes and edges toward
  scoring.
- **Riding Siri / home speaker** — platform lock and it sends work data off the
  local-first machine.

## Analysis (the strategic read)

- **Convergence is the signal.** "Earn the right to interrupt" and "right-moment
  timing" each surfaced independently in 4 of 5 frames. Ideas that recur across
  isolated frames are load-bearing, not decorative.
- **Frequency ≠ quality.** The most-repeated vision idea (markets) was a trap. Trust
  the scoring, not the vote count.
- **The core insight: presence is disciplined silence.** Nearly every strong idea is
  a way to *not* interrupt. The restraint engine is the product; conversation bolts
  on after.
- **Design is ahead of validation.** This is the risk. The product shape is clear;
  the bottleneck is zero external users and an open v1→v2 gate — not a shortage of
  ideas. Do not scaffold the presence layer before real-use evidence.
- **One slice doubles as validation:** `kizuki check` (paste a draft → get
  contradictions vs the vault) is a cheap spike of the #1 presence feature, useful
  solo today, and a direct test of the core wedge "does it catch what I'd miss."
  Building it is gate progress, not scaffolding. Everything else stays captured
  here as vision.
