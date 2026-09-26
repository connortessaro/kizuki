# Kizuki — study tool

**Date:** 2026-09-24
**Status:** built (v1). Replaces the org-intelligence product and the
2026-09-23 native-agent draft. Sections marked **Built:** record decisions made
while building, with the reason.

## What Kizuki is

Kizuki is a study tool that runs on your own computer. You give it your course
material. You teach a concept in your own words, and Kizuki plays the student:
it asks about what you got wrong, what you left out, and what you said
unclearly, always quoting your material. Concepts you miss come back for review
before you forget them.

*Kizuki* (気付き) means "noticing": the moment something clicks. The tool is
built to make you notice the gaps in your own understanding.

Kizuki does not do the thinking for you. It never gives the answer first, and
it never explains things in its own words. Small, cheap models are enough,
because the model only asks and quotes.

## Who it is for (v1)

One person (Connor first), studying their own courses. No accounts, no cloud,
no sharing.

## Not in v1

- Images, scanned PDFs, audio, and video (planned for v2, see below).
- Quiz mode, flashcards, and a question-and-answer tutor.
- Study plans ("week 1: A, then B").
- More than one user, or anything hosted online.

## The one rule: never misinform

When sources disagree, this order decides what is true:

1. **Your corrections.** If you say the material is wrong (a typo on a slide,
   or the professor corrected it in class), Kizuki records your correction with
   a note. Your version wins from then on.
2. **Your material.**
3. **Nothing else.** The model's own knowledge is never a source.

When your explanation disagrees with the material, Kizuki shows the passage and
asks you to choose: "the material is right" (it counts as a miss), "the
material is wrong" (it becomes a correction with a note), or "Kizuki misread
what I wrote" (neither: no miss, no correction). It never overrules you and
never silently accepts.

**Built:** the third choice exists because a small model sometimes sees a
disagreement that is not there, and without it you had to record a false miss
or a false correction.

When Kizuki is not sure how to read a passage, it shows the sentence and asks
you what it means, and stores your answer.

**Built:** the question is always the same fixed words ("Kizuki is not sure how
to read this sentence. What does it mean?"). The model only points at the
sentence. A model-written "X or Y?" question would be the model's own words,
which the one rule forbids.

## Guards against made-up content

The model is used in exactly four places. Each one has a guard in plain code:

| The model... | Guard |
|---|---|
| proposes concepts | Each concept points at sentences of the material. You confirm it before it is used. A name that is a question or a note ("Unclear: …") is dropped. |
| proposes prerequisite links ("A needs B first") | You confirm each link. Plain code rejects any link that would create a loop. |
| chooses teach-back questions | The model picks a kind and a sentence label; Kizuki writes the question from a fixed template around the exact sentence. A label that does not exist drops the question. |
| adds to what you missed | Proposed at the end of a session, after the plain-code list (below). You confirm or reject each item. Only confirmed items are saved. |

**Built: sentence labels instead of quotes.** In the first model tests, the
small model often quoted the wrong sentence or changed words. Now every
sentence the model sees is labeled `[S1]`, `[S2]`, and so on, and the model
answers with labels only. Kizuki looks up the exact sentence, so the model
cannot make up a quote at all; the word-for-word check still runs on every
quote as a second guard. Together with a step-by-step prompt (compare each
detail first, then look for gaps, then vague words), catching planted mistakes
went from 25% to 83% in the model tests.

**Built: questions are templates.** The model never writes question text:

- contradiction: `Page 12 of x.pdf says: “…” You wrote: “…”. How does that fit?`
  (the "You wrote" part appears only when those words are really in your text)
- gap: `Page 12 of x.pdf says: “…” Where does that fit in your explanation?`
- unclear: `What do you mean by “…”?`

Rules that hold everywhere:

- The model never states facts in its own words. It only quotes and asks.
- **Quote check:** a quote passes only if it appears word for word in its
  stored passage, ignoring differences in spaces, line breaks, letter case,
  quote-mark style, dash style, and PDF ligatures, and never starting or ending
  mid-word (a contraction like "can't" is one word, so "can" never matches
  inside it). A word split by a hyphen at a line end ("photo-" / "synthesis")
  matches the whole word. **Built:** dash styles and line-end hyphens were
  added because PDFs use both, and neither changes meaning.
  Words the model says you used ("What do you mean by W?") must appear word for
  word in your own explanation.
- If search finds no passage, Kizuki says "not in your material" and stops.
- Nothing the model produces is saved without your OK.
- Search, the review schedule, and storage are plain code with no model.
- Every quote links to its page, slide, or cell, so you can check it in one
  click.

This cannot reach zero risk: a real quote can still be picked out of context.
The one-click link to the source is the backstop.

## Material

**Built:** readers are `unpdf` for PDFs (outline bookmarks become sections when
present, otherwise one section per page), and `fflate` plus `fast-xml-parser`
for pptx, docx, and xlsx (slide titles, heading styles, and sheet names become
sections; speaker notes are their own passages). Markdown formatting marks are
removed so quotes match the words.

**v1 (exact text):** PDFs with a text layer, slides (`pptx`), documents
(`docx`), spreadsheets (`xlsx`, `csv`), and notes (`md`, `txt`). Text comes
out as written, so quotes can be checked word for word.

**v2 (extracted text):** images and scanned PDFs (read with OCR, meaning text
recognition from images), and audio and video (transcribed). This text can be
wrong, so every quote from it is labeled "extracted", shown next to the
original (image crop or video timestamp), and confirmed by you when the
extraction is unsure. Uses existing tools such as `tesseract`, `whisper.cpp`,
and `ffmpeg`.

You add material by uploading on the dashboard. Kizuki keeps a copy of the
original file and splits its text into passages. Each passage remembers where
it came from: file, page, slide, sheet and cell, and its exact position in the
text.

## Concept map

For each course:

1. Plain code builds a skeleton from the material's structure: headings, slide
   titles, and sheet names.
2. The model proposes concepts under each heading. Each concept cites the
   passages it comes from.
3. You confirm, merge, rename, or drop each proposal on the dashboard. Only
   confirmed concepts are used for teach-back and review.

**Built: headings become concepts in plain code.** The small model's concept
lists changed from run to run and sometimes left out a main topic. Now every
real heading (markdown and Word headings, slide titles, PDF bookmarks; not page
numbers or file names) becomes a proposed concept named after it, backed by the
first sentences of its section. The model only adds smaller ideas inside a
section, at most 3 per section, each named in at most 6 words (a name is a
topic, never a sentence), and never a repeat of an existing concept such as
"Definition of osmosis" next to "Osmosis". **Built:** every meaningful word of
a model's name must appear in the concept's section (its heading or text),
so a name can never state a fact in the model's own words ("Mitochondria make
glucose"). Some good names made of other words are dropped; you can rename a
concept after confirming it.

## Prerequisite map

Concepts link to each other as "A needs B first". The model proposes links
between confirmed concepts, and you confirm them. Plain code rejects a link
that would create a loop (A needs B, B needs A).

Kizuki uses the links to:

- review a concept only after its prerequisites are solid,
- trace a miss back to a weak prerequisite ("you missed X; Y is not solid
  yet"),
- suggest what to study next.

## A teach-back session

1. You pick a concept. The dashboard lists due concepts first.
2. You write your explanation.
3. Search finds the passages for that concept: the passages it was confirmed
   with, plus search matches for your explanation.
4. The model returns up to three questions in a fixed shape: the kind
   (contradiction, gap, or unclear), the question, the quote, and the passage
   it quotes.
   - Contradiction: "Slide 12 says X. How does that fit with what you said?"
     Always a question, never a verdict.
   - Gap: "Your notes mention Z. Where does it fit?"
   - Unclear: "What do you mean by W?"
5. The quote check drops any question that fails. If nothing is left and no
   passage matched, Kizuki says "not in your material". **Built:** "no passage
   matched" means search found nothing for what you wrote; the concept's own
   passages are always shown to the model, so they don't count.
6. You answer. Steps 3 to 6 repeat, up to three rounds.
7. Kizuki proposes a list of what you missed, each item a sentence of the
   concept's own passages. You confirm or reject each one.

   **Built:** the list starts with plain code: the sentences of the concept
   whose meaningful words you barely used (less than half) are proposed, the
   least-covered first, at most 5 in all, so the review stays short. A
   sentence you corrected is never proposed. Then
   the model may add sentences. In testing the small model returned an empty
   list every time, while the word check found the left-out point in every
   case. Only the concept's own passages count, so points from other topics are
   never listed.
8. Kizuki saves the session result and sets the next review date.

## Review schedule

Plain code, no model:

- Every confirmed concept has a next review date. A new concept is due right
  away.
- A clean session (no confirmed misses) doubles the wait: 1 day, 2, 4, 8, and
  so on, up to 60 days.
- A session with misses sets the wait back to 1 day.
- A concept is not scheduled until every concept it needs has had at least one
  clean session.
- If you set an exam date for a course, any review that falls after the exam
  moves to before it.

A concept that passes its review date without a session is due. In a study
tool, "stale" means "about to be forgotten".

A better formula, such as the one Anki uses, can replace the doubling rule
later without changing anything else.

## Search

Two kinds of search, combined, in one SQLite file on your computer.

**Built:** a keyword match needs at least two words of the text (one if the
text has one word), and a meaning match must be closer than 0.3 (cosine
distance). Measured with `nomic-embed-text`, related text scored 0.12 to 0.21
and unrelated text 0.33 and up. Without these, off-topic text such as "plate
tectonics" found passages through single common words like "moves".


- **Keyword search** (SQLite's built-in full-text search, FTS5) finds exact
  terms and names.
- **Meaning search** (`sqlite-vec`) finds passages that say the same thing in
  different words. This matters for teach-back, because you explain in your own
  words. A small local model turns each passage into a list of numbers that
  captures its meaning.

Search only finds candidates. The quote check still decides what you see.

## Storage

Everything lives in `~/.kizuki/` (or `KIZUKI_HOME`), outside the repo.

**Built:** not `~/Kizuki/`. On macOS folder names ignore letter case, so
`~/Kizuki` is the same folder as a `~/kizuki` clone of this repo, and study data
would have landed inside it.


- `files/` — copies of your original material.
- `data/*.jsonl` — logs. Each line records one thing that happened. New lines
  are added; old lines are never changed. The logs are the truth.
  - `materials.jsonl` — files added and their progress.
  - `passages.jsonl` — every passage of each file, written once. Kept apart so
    reading the other logs stays fast.
  - `concepts.jsonl` — concepts proposed, confirmed, merged, renamed, dropped.
  - `links.jsonl` — prerequisite links proposed, confirmed, dropped.
  - `sessions.jsonl` — teach-back sessions and confirmed misses.
  - `corrections.jsonl` — your corrections to the material and your answers
    to "what does this mean?".
  - `courses.jsonl` — courses and exam dates.
  - `catches.jsonl` — things you would have gotten wrong on an exam.
- `index.sqlite` — the search file. It can always be rebuilt from `files/` and
  `data/`, so it is never the truth.

Review dates are worked out from the logs each time. They are not stored.

`workflow-data/` holds the Workflow SDK's runs. **Built:** the SDK's Next.js
plugin stores runs inside `.next/` by default, which a rebuild or an update
wipes, losing any session that was waiting for you. `next.config.ts` points it
at the home folder instead. If a run is lost anyway, sending your answers starts
a new run for the session, which skips every step already in the logs.

Writes to the logs go through one lock, so an upload and a session cannot
write at the same moment. A log line that fails to read stops Kizuki with the
file name and line number. It is never skipped.

## Models

- **Default:** Ollama, running on your computer at
  `http://localhost:11434/v1`.
  - Answer model: `qwen3.5:2b` (already installed).
  - Search model: `nomic-embed-text` (already installed).
- **Option:** MLX, Apple's tool for running models on Apple chips, through
  `mlx_lm.server`. It speaks the same format as Ollama, so no extra code is
  needed. Both are timed on the M1 early in the build, and the faster one
  becomes the default.
- **Option:** any hosted model that speaks the OpenAI format, for computers
  too slow to run a local model. The settings screen warns that this sends your
  material off your computer. The API key is read from an environment variable
  when needed. It is never written to a file or a log.
- **Memory limit:** the dev machine is an M1 with 8GB. The answer model stays
  at about 4B size or smaller, because the app, the answer model, and the
  search model share that memory.

## Building blocks

| Part | Choice |
|---|---|
| Language | TypeScript |
| App and dashboard | Next.js (App Router), run locally |
| Model calls | AI SDK (`ai`) with `@ai-sdk/openai-compatible`. `generateText` with `Output.object` makes replies follow a fixed shape. `embed` and `embedMany` for meaning search. |
| Steps | Vercel Workflow SDK. `"use step"` steps retry and save their results. `createHook` pauses a workflow until you confirm. Runs are stored in a local folder. `npx workflow web` shows every run step by step. |
| Search file | `better-sqlite3` with FTS5 and `sqlite-vec` |
| Tests | Vitest for plain tests. Evalite for model tests. |
| Code docs | TypeDoc, generated from doc comments in the code |
| Start command | `bin/kizuki.mjs`, plain JavaScript so it runs without a build |

No agent framework. The steps are fixed and written in plain code. The model
never chooses what to do next; it only fills in the four places listed under
"Guards".

## Starting Kizuki

One command: `npx kizuki` (options `--port`, `--home`, `--no-open`). It:

1. checks that Ollama (or MLX) is running and both models are installed, and
   prints how to fix anything missing,
2. starts the app on your computer,
3. opens the dashboard in your browser.

**Built: install path.** `kizuki` is published on npm. 0.2.1 went out first
from the maintainer's computer, because npm's trusted publishing needs a first
version to exist; from 0.3.0 on, the Release workflow publishes with signed
provenance after the maintainer approves it. `npx kizuki` works as designed. Every GitHub release also carries the
package, so
`npx https://github.com/connortessaro/kizuki/releases/latest/download/kizuki.tgz`
still works.

**Built:** the app answers only requests whose Host header names this computer
(`127.0.0.1`, `localhost`, `::1`), so a website that points its own domain at
your computer cannot reach it. The npm package ships the built app (`.next/`),
so `npx kizuki` does not build on first run.

## Tests

- **Plain tests (Vitest)** run on every change, with no model: the quote
  check, the review schedule, the loop check for links, log reading and
  writing, text extraction for each format, and search rebuilds.
- **End-to-end tests (Playwright)** run the built app in a browser on every
  change, with a fake model server in place of Ollama: add files, confirm
  concepts and a link, teach back, correct the material, record a catch. They
  also check the host rule and the security headers.
- **Coverage** is measured on every change; CI fails if it drops below the
  floor in `vitest.config.ts`, which is only ever raised.
- **Model tests (Evalite)** run separately (`npm run eval`), because they are
  slow. They use openly licensed course material (for example an OpenStax
  textbook) checked into the repo. Your own course files never go in the repo.
  Answer keys are written by hand, never by the model, so the tests can catch
  the model's own mistakes. They check:
  1. **Made-up quotes getting through.** Must be 0. One is a failure.
  2. **Trap questions** whose answers are not in the material. Kizuki must say
     "not in your material".
  3. **Planted mistakes.** Wrong explanations written on purpose. Kizuki must
     ask about them.
  4. **Concept proposals** compared with a hand-made concept list.
  5. **Speed and quality** of each model on the M1, Ollama and MLX.

Every change keeps the plain tests passing. Every change to a model step keeps
the model tests passing.

## Docs

Code docs are generated, not hand-written:

- Every exported function, type, and component has a short doc comment
  (TSDoc, the standard `/** ... */` comment format for TypeScript) in plain
  words. Other comments only where the code is not obvious.
- `npm run docs` runs TypeDoc and writes HTML to `docs/api/`. The output is
  generated, so it is gitignored and never committed.
- CI runs TypeDoc with `validation.notDocumented` on and
  `--treatValidationWarningsAsErrors`, so an export without a doc comment
  fails the build.

Hand-written markdown is limited to what an open-source repo needs, plus the
agent instructions and design records:

- `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and
  `.github/PULL_REQUEST_TEMPLATE.md`
- `AGENTS.md` (instructions for coding agents). **Built:** it used to have a
  twin, `CLAUDE.md`, kept in sync by hand; the twin was removed after 0.3.0 so the
  rules live in one file.
- `docs/superpowers/specs/` (one design record per feature)

Anything else that explains the code belongs in a doc comment, so it is
generated with the code and cannot drift from it.

## Changes to this repo

In this order:

1. Tag the current `main` as `org-intel-final`. Git history keeps all of it.
2. Delete `lib/`, `server/`, `mcp/`, `analytics/`, `skills/`, and the `kizuki`
   executable in one commit. Their markdown (the synthetic corpus, skill
   rituals) goes with them.
3. Move the Next.js app from `web/` to the repo root. Remove the landing page
   copy built around the org-alert idea, and the `web/demo-vault/` sample data.
4. Rewrite `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and
   `SECURITY.md` for the study tool, in plain words. New rules replace the old
   ones, including permission to use npm packages. Set up TypeDoc (see
   "Docs").
5. **Leave the local work-data folders alone.** `people/`, `projects/`,
   `teams/`, `transcripts/`, `alerts/`, `signals/`, `insights/`, `catches/`,
   `days/`, `state/`, and `activity/` hold real work data that is not in git.
   The new `.gitignore` keeps ignoring them so they can never be committed by
   accident.

## Success test

At least one thing a week that you would have gotten wrong on an exam, caught
by Kizuki. You record it with a "Catch" button on the session page. The
dashboard shows the weekly count.

## Build list

Each step starts with a failing test, then the code. Tests pass before the
next step.

1. **Repo reset.** The changes above. Vitest and TypeDoc set up and passing.
2. **Logs.** Read and add lines to `data/*.jsonl`, the write lock, and errors
   that name the file and line.
3. **Text extraction (v1).** PDF, `pptx`, `docx`, `xlsx`, `csv`, `md`, `txt`
   into passages with their locations.
4. **Quote check.** Word-for-word check against a passage and against your own
   explanation.
5. **Search file.** Keyword and meaning search, rebuilt from the logs.
6. **Model connection and model tests.** AI SDK to Ollama, fixed-shape
   replies, the start-up checks, and Evalite with the open textbook and first
   answer keys. Each later model step adds its own test cases here.
7. **Upload workflow.** Extract, split, index, build the skeleton, propose
   concepts, check quotes, then pause until you confirm.
8. **Dashboard: material and concept map.** Upload, then confirm, merge,
   rename, or drop concepts.
9. **Prerequisite links.** Propose, loop check, confirm.
10. **Teach-back workflow and page.** The session described above.
11. **Corrections and disagreements.** "The material is right" or "the
    material is wrong", notes, and "what does this mean?" answers.
12. **Review schedule.** Doubling rule, prerequisites first, exam dates, due
    list.
13. **Catches.** The Catch button and the weekly count.
14. **Model timing.** Ollama against MLX on the M1. Pick the default.
15. **`npx kizuki`.** Checks, start, open browser.

## Checked during the build

- `sqlite-vec` loads in `better-sqlite3` on the M1, with keyword search (FTS5)
  and cosine distance. Yes.
- The Workflow SDK's local storage holds up for one person: runs survive a
  restart once stored in the home folder, and lost runs recover (see Storage).
- `qwen3.5:2b` with thinking off, final model-test run on the finished code
  (each teach-back case run 3 times):
  - made-up quotes shown: 0 in every test
  - planted mistakes caught: 92% (75% to 83% before the field descriptions
    and written-out sentences below)
  - model answers kept by the checks: 100%
  - key concepts found: 88%; proposals that match the hand-made list: 62%
    (93% after names had to use the material's own words, in 0.3.0; the check
    now drops most of the smaller concepts you would have dropped yourself)
  - "not in your material" right: 100%; left-out points found: 100%
  - about 2 seconds per round of questions; about 15 seconds to propose the
    concepts of a short file
- With thinking on, the same tests did not finish in 30 minutes, so thinking
  stays off by default (Settings can turn it on).
- MLX against Ollama, same model (`mlx-community/Qwen3.5-2B-4bit` against
  Ollama's `qwen3.5:2b`), on the M1 with 8GB:
  - MLX ignores Ollama's thinking switch and does not enforce reply shapes.
    **Built:** Kizuki also sends Qwen's own thinking switch
    (`chat_template_kwargs.enable_thinking`), and a `replyShape: "prompt"`
    setting puts the reply shape in the instructions, reads the reply itself,
    and asks once more after a broken reply. The MLX preset uses it.
  - MLX wrote sentences out instead of their labels. **Built:** a written-out
    sentence is accepted only if it matches exactly one real sentence (at least
    4 words), and the real sentence is shown. Every reply field now carries a
    short description.
  - Results: MLX caught 67% of planted mistakes (Ollama 92%), kept 88% of its
    answers (Ollama 100%), and showed no made-up quotes. Speed was about the
    same: 2.7 seconds per round of questions (Ollama 1.8 to 2.8).
  - **Default stays Ollama.** MLX is a working option in Settings.
  - Running both at once on 8GB fills memory and slows everything about five
    times. Use one at a time.
- Answer keys in `evals/keys.ts` were drafted by Claude while building and need
  a review by Connor.

## Kept from the old repo

- `scripts/check-pii.mjs`, which CI runs to stop personal email addresses and
  the employer name from reaching the public repo. Kept as plain JavaScript so
  CI runs it without installing anything.
- `backlog/`, which is gitignored local data and is left alone.
