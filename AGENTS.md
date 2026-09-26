# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, and others) working in this repository.

## What this is

Kizuki is a study tool that runs on the user's computer. The user adds course material and teaches a concept in their own words; Kizuki plays the student and asks about contradictions, gaps, and unclear words, always quoting the material. Concepts come back for review on a schedule.

Design: `docs/superpowers/specs/2026-09-24-kizuki-study-tool-design.md`. The org-intelligence tool this repo used to hold is tagged `org-intel-final`.

## The one rule: never misinform

- **The model never writes facts in its own words.** It only picks sentence labels (`S3`), question kinds, and words the user wrote. Plain code looks up the sentences and writes every question from a fixed template (`renderQuestion`).
- **Every quote is checked word for word** against its passage (`lib/quote.ts`) before it is shown or saved.
- **Nothing the model proposes is saved without the user's OK.** Concepts, links, clarifications, and misses are proposals until confirmed.
- **Truth order:** the user's corrections, then the material, then nothing. The model's own knowledge is never a source.
- Search, the review schedule, storage, and the "barely used" miss check are plain code with no model.

Do not weaken any of these without revisiting the spec with the user.

## Commands

```bash
npm run qc             # lint, types, docs, coverage, PII check, npm audit: run before every pull request
npm test               # vitest: every plain test, no model
npm run coverage       # tests with coverage; fails below the floor in vitest.config.ts (raise it, never lower it)
npm run e2e            # Playwright: the study loop in a browser against e2e/fake-model.mjs (build first)
npx vitest run lib/quote.test.ts   # one file
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run build          # next build
npm run dev            # dashboard with live reload
npm run eval           # Evalite model tests against local Ollama (slow)
node scripts/eval-summary.mjs <results.json>   # per-check averages from `npx evalite run --outputPath`
npm run docs           # docs/openapi.json (committed) and the docs site into docs/api/ (gitignored)
npm run docs:check     # fails if a route, header, form field, or export lacks docs, or docs/openapi.json is stale
npm run check:pii      # personal identifiers in tracked files
node bin/kizuki.mjs    # checks models, starts the built app, opens the browser (what users run)
```

## Layout

- `lib/`: the core, plain TypeScript, tested with Vitest. No React, no Next.
  - `events.ts`: the schema of every log line. The source of truth for data shapes.
  - `log.ts`, `lock.ts`, `paths.ts`: the `data/*.jsonl` logs (lines only ever added, one writer at a time) in the home folder (`KIZUKI_HOME` or `~/.kizuki`).
  - `state.ts`: rebuilds current state from the logs (`reduceState` is pure).
  - `extract/`: reads PDF, pptx, docx, xlsx, csv, md, and txt into sections and passages with locations.
  - `quote.ts`, `sentences.ts`, `words.ts`: the quote check, sentence labels, and word matching.
  - `search.ts`, `rebuild.ts`: keyword plus meaning search in one SQLite file, rebuildable from the logs.
  - `concepts.ts`, `links.ts`, `teach.ts`: the model steps, each with its prompt, reply shape, and guard.
  - `commands.ts`, `materialFlow.ts`, `sessionFlow.ts`: every change to data, each checked before writing.
  - `schedule.ts`, `views.ts`: the review rule and page views.
  - `model.ts`, `settings.ts`: the model connection (AI SDK, OpenAI-compatible) and settings.
- `workflows/`: Vercel Workflow SDK workflows. `material/` processes a file and pauses for review; `session/` runs a teach-back session and pauses for answers. Steps live in `steps.ts`; workflow files only order steps.
- `app/`: the Next.js dashboard. Pages are server components that read fresh state; `app/actions.ts` holds every server action.
- `bin/`: the `kizuki` start command, plain JavaScript with no build step.
- `e2e/`: Playwright end-to-end tests of the built app, and `fake-model.mjs`, an OpenAI-style stand-in for Ollama.
- `evals/`: Evalite model tests, hand-written answer keys (`keys.ts`), and openly licensed sample material.
- `site/`: the public page at kizuki.dev, plain HTML and CSS. Its only build step (`site/vercel.json`) runs `npm run docs:site` and serves the docs at kizuki.dev/docs (code reference, guides, and the HTTP API at /docs/http-api/).
- `docs/`: `guides/` (business logic guides, part of the docs site), `openapi.json` (the generated HTTP reference, committed), and the design spec. `scripts/docs.ts` builds the docs; see `docs/guides/how-the-docs-are-made.md`. Vercel skips deploys when neither the site nor the code the docs describe has changed. The app itself is never hosted: it needs the user's own model and files.

## Conventions

- **TypeScript, ESM.** Match the surrounding code.
- **Test first.** Write the failing test, then the code. Keep `npm test` passing.
- **Every export has a short doc comment** in plain words. TypeDoc fails CI without one. Other comments only where the code is not obvious.
- **Every route, page, and form action has an `@openapi` block** in its doc comment, and every header the code sets or reads is in the docs. `npm run docs:check` fails CI otherwise; run `npm run docs` and commit `docs/openapi.json` when the HTTP surface changes.
- **No jargon** in UI text, docs, or names. Plain words.
- **No silent failures.** Throw with a message that says what went wrong and how to fix it. A bad log line stops the read with its file and line number.
- **Model steps are guarded in code, not in the prompt.** A prompt can ask; only code can enforce.
- **Workflow steps must be safe to run twice.** Each step checks the logs before writing.
- Inject time and I/O where it helps tests (the model `Ask`, the `Embedder`, `fetchImpl`).

## Data safety

- Study data lives in the home folder, never in the repo. Tests use temporary folders.
- The old work-data folders (`people/`, `projects/`, `teams/`, `transcripts/`, `signals/`, `insights/`, `catches/`, `days/`, `state/`, `alerts/`, `activity/`) may still exist in a local checkout. They are gitignored and hold private work data. Never commit, move, or delete them.
- Personal email addresses and the employer name must never be committed; `scripts/check-pii.mjs` runs in CI.

## Skills

- `grill-me` / `grilling`: a global skill in `~/.claude/skills/`. It interviews the user one question at a time to test a plan before acting on it.
