# Contributing to Kizuki

Thanks for taking a look. Kizuki is solo-maintained, so the fastest way to get a
change merged is a small PR that respects the architecture rules below.

By contributing you agree that your work is licensed under the
[Apache License 2.0](LICENSE), the same license as the project. You also agree
to the [Code of Conduct](CODE_OF_CONDUCT.md). There is no CLA.

## Before you write code

- **Bug fix:** open an issue or go straight to a PR. Either is fine.
- **New feature or behavior change:** open an issue first. Kizuki has an opinionated
  scope, and a design conversation up front saves you rework.
- **Security issue:** do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Getting set up

Kizuki needs **Node >= 20.11**. There is no build step for the core.

```bash
git clone https://github.com/connortessaro/kizuki.git
cd kizuki
npm ci
npm test
```

Point Kizuki at a scratch vault so you never touch real data while developing:

```bash
export KIZUKI_VAULT="$(mktemp -d)"
./kizuki init --agent claude
./kizuki doctor --no-smoke
```

## The checks CI runs

Run these before pushing. They are the same commands the workflow runs.

```bash
npm run lint          # eslint
npm test              # node --test, the full suite
npm test --prefix mcp # MCP integration tests (not matched by the default glob)
npm run typecheck     # tsc --noEmit for web/ (needs: npm ci --prefix web)
npm run verify:dist   # committed dist/skills matches skills/
```

To run one file: `node --test lib/vault.test.mjs`.

If you change anything under `skills/`, regenerate the committed output with
`npm run build` and commit the `dist/skills/` diff.

## Architecture rules

These are load-bearing. A PR that breaks one will be asked to change.

- **The agent returns one fenced JSON payload; deterministic JavaScript writes the
  files.** Never move file-writing into a prompt, and never let a model edit vault
  files directly. This is what makes Kizuki's output auditable.
- **`lib/` and `server/` import Node built-ins only.** The only runtime
  dependencies are `@modelcontextprotocol/sdk` and `zod`, and they may be imported
  only from `mcp/`. Keep the kernel dependency-free.
- **ESM `.mjs` throughout.** Match the surrounding style.
- **Test first.** Write the failing test, then the implementation. The suite must
  be green before a PR is ready.
- **No silent failures.** Throw loudly. No empty catch blocks, no swallowed errors.
- **Observe and advise.** Kizuki never sends a message, never mutates a source
  system, and never acts on a signal. It describes and drafts; the operator acts.
- **Vault mutations hold `state/vault.lock`**, and the append-only JSONL ledgers
  (`signals/`, `insights/`, `catches/`, `events/`) are never rewritten in place.
- **`spliceManagedSection` must not touch anything outside the `KIZUKI:ANALYSIS`
  markers.** Log dedup is an exact full-line match. Entity names are validated
  path-safe before they reach the filesystem.
- **Inject platform and I/O seams** (`platform`, `exec`, `now`, `fetchImpl`,
  `randomUUID`) rather than reading `process.platform` or spawning directly, so
  tests stay hermetic and pass on every OS.

## Never commit vault data

`people/`, `projects/`, `teams/`, `transcripts/`, `days/`, `state/`, `signals/`,
`insights/`, `alerts/`, `catches/`, `events/` and `kizuki.config.json` are
gitignored, and CI fails if any of them reach the npm tarball. Do not force-add
them. Run `git status` before you push.

If you need fixture data, add it under a temp dir created by the test, or use the
synthetic `web/demo-vault/`.

## Commits and PRs

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`,
  `ci:`. Add a scope when it helps, e.g. `fix(mcp): …`.
- Keep the subject under 72 characters and explain *why* in the body.
- One logical change per PR. Unrelated cleanups belong in their own PR.
- Fill in the PR template, including how you verified the change.

## Releasing

Maintainer only. Bump the version in `package.json`, then push a matching tag:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

The release workflow verifies that the tag matches `package.json`, runs the full
suite, and publishes to npm using OIDC trusted publishing.
