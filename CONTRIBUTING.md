# Contributing to Kizuki

Thanks for taking a look. Kizuki is maintained by one person, so the fastest way to get a change merged is a small pull request that follows the rules below.

By contributing you agree that your work is licensed under the [Apache License 2.0](LICENSE), the same license as the project, and you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). There is no contributor agreement to sign.

## Before you write code

- **Bug fix:** open an issue or go straight to a pull request.
- **New feature or change in behavior:** open an issue first, so we can agree on the design before you spend time on it.
- **Security problem:** do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22.18 or newer. For the model tests and for running the app you also need [Ollama](https://ollama.com) with `qwen3.5:2b` and `nomic-embed-text`.

```bash
git clone https://github.com/connortessaro/kizuki.git
cd kizuki
npm ci
npm test
```

To try the app with a throwaway data folder:

```bash
KIZUKI_HOME="$(mktemp -d)" npm run dev
```

## Checks

These are the same checks CI runs. `npm run qc` runs all but the last two in one go:

```bash
npm run qc          # lint, types, docs, tests with coverage, personal identifiers, npm audit
npm run build
npm run e2e         # the study loop in a real browser, against a fake model server
```

`npm run coverage` fails if coverage drops below the floor in `vitest.config.ts`; raise the floor when you add tests, never lower it. The report is in `coverage/index.html`. The end-to-end tests need a build first and Playwright's browser once: `npx playwright install chromium`. They use `e2e/fake-model.mjs` in place of Ollama, so every run is the same.

`npm run eval` runs the model tests against your local Ollama. They are slow and not run in CI; run them when you change a prompt or a guard, and include the scores in your pull request. `node scripts/eval-summary.mjs <file>` prints the averages from `npx evalite run --outputPath <file>`.

## Rules

A pull request that breaks one of these will be asked to change.

- **Never misinform.** The model never writes facts in its own words. It picks sentence labels and question kinds; plain code looks up the exact sentences and writes each question from a template. Every quote passes the word-for-word check in `lib/quote.ts` before it is shown.
- **Guards live in code, not prompts.** A prompt can ask the model to behave; only code can make sure it did.
- **Nothing is saved without the user's OK.** Anything the model proposes waits for confirmation.
- **The logs are the truth.** `data/*.jsonl` lines are only ever added, through `appendLog`, one writer at a time. The search file is always rebuildable from the logs.
- **Workflow steps are safe to run twice.** A step checks the logs before it writes.
- **Test first.** Write the failing test, then the code.
- **Every export has a short doc comment** in plain words. Every route, page, and form action also has an `@openapi` block; see [How these docs are made](docs/guides/how-the-docs-are-made.md). When the HTTP surface changes, run `npm run docs` and commit `docs/openapi.json`.
- **Plain words everywhere.** No jargon in the UI, docs, or names.
- **No silent failures.** Errors say what went wrong and how to fix it.

## Never commit personal data

Study data lives outside the repo (`~/.kizuki` or `KIZUKI_HOME`). Tests use temporary folders. Course files used for model tests must be openly licensed or written for Kizuki, and go in `evals/material/`.

## Commits and pull requests

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
- Keep the subject under 72 characters and explain *why* in the body.
- One change per pull request.
- Fill in the pull request template, including how you checked the change.

## Releasing

Maintainer only. Bump the version and push the tag:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

`npm version` also regenerates `docs/openapi.json`, which names the version, and adds it to the version commit. The release workflow checks that the tag matches `package.json`, runs the checks, builds, and publishes to npm.
