<!--
Security fix? Do not open a public pull request. See SECURITY.md.
-->

## What this changes

<!-- One or two sentences. Link the issue: Fixes #123 -->

## Why

<!-- The problem this solves. -->

## How it was checked

<!-- Commands you ran and what you saw. "Tests pass" alone is not enough. -->

```
pnpm qc    # lint, types, docs, tests with coverage, PII check, pnpm audit
pnpm build
pnpm dev   # if a command or a screen changed: try it in a terminal
```

## Checklist

- [ ] The failing test came first, and `pnpm qc` passes
- [ ] Every new export has a doc comment (`pnpm docs:check` passes)
- [ ] If a prompt or guard changed: model test scores are in the description (`pnpm eval`)
- [ ] The model still never writes facts in its own words, and every shown quote is checked
- [ ] No personal data, real course files, or API keys in the diff
- [ ] Docs updated if behavior or a command changed
