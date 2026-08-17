<!--
Security fix? Do not open a public PR. See SECURITY.md.
-->

## What this changes

<!-- One or two sentences. Link the issue: Fixes #123 -->

## Why

<!-- The problem this solves. If there is an issue with the context, link it instead of repeating it. -->

## How it was verified

<!-- Commands you ran and what you saw. "Tests pass" on its own is not enough. -->

```
npm run lint
npm test
npm test --prefix mcp
```

## Checklist

- [ ] Tests added or updated, and the failing test came first
- [ ] `npm test` and `npm run lint` are green locally
- [ ] `npm run verify:dist` passes (ran `npm run build` if `skills/` changed)
- [ ] No vault data, real names or transcripts in the diff
- [ ] `lib/` and `server/` still import Node built-ins only
- [ ] Kizuki still only observes and advises — no new code sends, posts or mutates an external system
- [ ] Docs updated if behavior or a command changed
