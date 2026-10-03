---
title: How these docs are made
---

# How these docs are made

These docs come from the code, and a check fails when the two drift apart. You change them in the same pull request as the code they describe.

## Commands

```bash
pnpm run docs     # build the site into docs/api/
pnpm docs:check   # what CI runs: the same build, writing nothing, failing on any warning
pnpm docs:site    # the kizuki.dev build; the same as pnpm run docs
```

Open `docs/api/index.html` to read the result. `docs/api/` is not committed.

## The code reference

TypeDoc reads the doc comments in `lib/` and `tui/`, leaving out tests and test helpers. The guides in `docs/guides/` are part of the same site, and their `{@link}` references point at real code. `docs/index.md` is the front page. `typedoc.json` turns every warning into an error, so the build fails when:

- an exported function, class, method, type, or constant has no doc comment;
- a property of an interface or class has no doc comment (`scripts/typedoc-plugin.mjs` adds this check);
- a `{@link}` in a comment or a guide points at nothing, or a guide links to a file that does not exist;
- an exported function uses a type that is not exported.

Write doc comments in plain words. Say what the thing does for the person studying, then any rule it enforces.

## Publishing

kizuki.dev is built by Vercel from `site/`. `site/vercel.json` runs `pnpm docs:site` and copies `docs/api/` to `/docs`, so the code docs and guides are at kizuki.dev/docs. Vercel rebuilds when a push to `main` changes `site/`, `lib/`, `tui/`, `docs/`, `scripts/`, `typedoc.json`, or the package files, and every pull request gets a preview. CI runs `pnpm docs:check` on every pull request and push to `main`. The docs are not part of the npm package.

GitHub Pages carries a second copy at connortessaro.github.io/kizuki. `.github/workflows/pages.yml` builds it with `pnpm docs:site` on every push to `main` and deploys it.
