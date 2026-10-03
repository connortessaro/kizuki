# Contributing to Kizuki

Kizuki is maintained by one person, so a small pull request that follows the rules below gets merged fastest.

By contributing you agree that your work is licensed under the [Apache License 2.0](LICENSE), the same license as the project, and you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). There is no contributor agreement to sign.

## Before you write code

- **Bug fix:** open an issue or go straight to a pull request.
- **New feature or change in behavior:** open an issue first, so we can agree on the design before you spend time on it.
- **Security problem:** do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22.18 or newer and [pnpm](https://pnpm.io/installation) 10. `package.json` pins the exact pnpm version, and pnpm switches to it on its own. For the model tests and for running the app you also need [Ollama](https://ollama.com) with `qwen3.5:2b` and `nomic-embed-text`.

```bash
git clone https://github.com/connortessaro/kizuki.git
cd kizuki
pnpm install
pnpm test
```

To try the app with a throwaway data folder:

```bash
KIZUKI_HOME="$(mktemp -d)" pnpm dev
```

`lib/` holds every study rule in plain TypeScript, with no screen code. `tui/` holds the terminal app: `tui/study.ts` turns commands into calls to `lib/`, and `tui/App.tsx` draws the screen with [Ink](https://github.com/vadimdemedes/ink). `pnpm build` bundles both into `dist/kizuki.mjs`, which `bin/kizuki.mjs` starts.

`site/` is kizuki.dev, a separate Next.js app with its own lockfile. Install it on its own:

```bash
cd site
pnpm install
pnpm dev
```

## Checks

CI runs these, plus a package-contents check and a dependency review:

```bash
pnpm qc                                  # lint, types, docs, tests with coverage, personal identifiers, pnpm audit
pnpm build
cd site && pnpm lint && pnpm typecheck && pnpm build   # when you change site/
```

`pnpm coverage` fails if coverage drops below the floor in `vitest.config.ts`; raise the floor when you add tests, never lower it. `test/fake-model.mjs` is an OpenAI-style stand-in for Ollama, for trying the built app by hand.

`pnpm eval` runs the model tests against your local Ollama. They are slow and not run in CI; run them when you change a prompt or a guard, and include the scores in your pull request. `node scripts/eval-summary.mjs <file>` prints the averages from `pnpm exec evalite run --outputPath <file>`.

## Rules

A pull request that breaks one of these will be asked to change.

- **Never misinform.** The model never writes facts in its own words, and code checks every quote word for word. See [The model never writes facts](docs/guides/the-model-never-writes-facts.md).
- **Guards live in code, not prompts.** A prompt can ask; only code can make sure.
- **Nothing is saved without the user's OK.**
- **The logs are the truth.** `data/*.jsonl` lines are only ever added, through `appendLog`.
- **Long steps are safe to run twice.** Each step in `lib/run.ts` checks the logs before it writes.
- **Test first**, and **every export has a short doc comment** in plain words.
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

The release workflow checks that the tag matches `package.json`, runs the checks, builds the package, and creates a GitHub release with it. To publish to npm too, run the Release workflow by hand on the tag with `publish_npm` ticked; it waits for the maintainer's approval.
