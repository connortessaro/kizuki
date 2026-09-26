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
npm run qc      # lint, types, docs, tests with coverage, PII check, npm audit
npm run build
npm run e2e     # if a page, action, or workflow changed
```

## Checklist

- [ ] The failing test came first, and `npm run qc` passes
- [ ] Every new export has a doc comment, and every new route, page, or form action has an `@openapi` block (`npm run docs:check` passes)
- [ ] If a prompt or guard changed: model test scores are in the description (`npm run eval`)
- [ ] The model still never writes facts in its own words, and every shown quote is checked
- [ ] No personal data, real course files, or API keys in the diff
- [ ] Docs updated if behavior or a command changed
