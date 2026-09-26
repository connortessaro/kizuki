---
title: How these docs are made
---

# How these docs are made

These docs come from the code, and checks fail when the two drift apart. You change them in the same pull request as the code they describe.

## Commands

```bash
npm run docs         # write docs/openapi.json, then build the whole site into docs/api/
npm run docs:check   # what CI runs: fail if the HTTP docs are incomplete or docs/openapi.json is stale
npm run docs:site    # build the site from the committed docs/openapi.json (the kizuki.dev build)
```

Open `docs/api/index.html` to read the result. The HTTP reference is at `docs/api/http-api/index.html`; serve `docs/api/` over HTTP to view it, because the viewer loads `openapi.json` next to it.

## The code reference

TypeDoc reads the doc comments in `lib/`, `workflows/`, `app/`, `proxy.ts`, `next.config.ts`, and `bin/cli.d.mts` (the types of `bin/cli.mjs`). The guides in `docs/guides/` are part of the same site, and their `{@link}` references point at real code. `typedoc.json` turns every warning into an error, so the build fails when:

- an exported function, class, method, type, or constant has no doc comment;
- a property of an interface has no doc comment (`scripts/typedoc-plugin.mjs` adds this check);
- a `{@link}` in a comment or a guide points at nothing, or a guide links to a file that does not exist;
- an exported function uses a type that is not exported.

## The HTTP reference

`scripts/docs.ts` builds `docs/openapi.json` (OpenAPI 3.1). It finds what the server answers from the code:

- **Pages:** every `app/**/page.tsx` answers `GET`.
- **Route handlers:** every `app/**/route.ts` answers the methods it exports.
- **Background-job routes:** the Workflow SDK writes them into `app/.well-known/workflow/` when Next.js loads its config. The tool runs `next typegen` first, which does that in about a second.
- **Public files:** every file in `public/`.
- **Form actions:** every exported function in a `"use server"` file, the form fields it reads (`form.get("…")`, `text(form, "…")`, and helpers it passes the form to), and the pages whose `<form action={…}>` run it. Each page with forms gets one `POST` entry listing its actions.
- **Headers:** every header name the code writes: names read with `request.headers.get("…")`, keys of a `headers` object on a `Response`, in the `headers()` of `next.config.ts`, or sent with `fetch`.

The words come from an `@openapi` block in the doc comment next to the code. The block is YAML:

```ts
/**
 * Serves the original copy of an added file.
 *
 * @openapi
 * GET /files/{materialId}:
 *   summary: Open an added file
 *   parameters:
 *     - { name: materialId, in: path, required: true, schema: { type: string } }
 *   responses:
 *     "200":
 *       description: The file.
 */
export async function GET() {}
```

The text above `@openapi` becomes the description. A key can name several methods: `GET, HEAD /path`. Other keys:

| Key | Where | Holds |
| --- | --- | --- |
| `info`, `servers`, `tags` | `next.config.ts` | The reference's title, description, addresses, and groups |
| `components` | anywhere | Shared parts. Marked `x-on-every-request` or `x-on-every-response`, the tool adds them to every entry: the Host check from `proxy.ts`, the safety headers from `next.config.ts`. |
| `action` | each form action | `fields` (name to description) and `result` (where the browser goes next) |
| `actions` | the `"use server"` file | The request and responses shared by every form |
| `outbound` | `lib/model.ts` | The requests Kizuki sends to model servers |

`npm run docs:check` fails, naming the file and line, when:

- the server answers an address and method with no docs, or a page's or handler's docs sit in another file;
- the docs describe an address the server no longer answers (Next.js addresses such as `/_next/static/{path}` are marked `x-framework: true` and must be named in the file that documents them);
- the code writes a header the docs leave out, or the docs name a header no code writes (headers that Next.js adds for Kizuki, such as `Next-Action`, are listed in `FRAMEWORK_HEADERS` in `scripts/docs.ts` and allowed only while the code that makes Next.js use them is still there);
- a form action reads a field its docs leave out, or its docs name a field it no longer reads;
- an entry lacks a summary or responses, a path parameter is undocumented, or a tag has no description;
- `docs/openapi.json` differs from what the code produces. Run `npm run docs` and commit the file.

`scripts/docs.test.ts` tests each of these failures on a small made-up project.

## Publishing

kizuki.dev is built by Vercel from `site/`. `site/vercel.json` runs `npm run docs:site` and copies `docs/api/` to `/docs`, so the code docs are at kizuki.dev/docs and the HTTP reference at kizuki.dev/docs/http-api/. Every push to `main` that touches the site or the code the docs describe deploys it, and every pull request gets a preview. CI runs `npm run docs:check` on every pull request and push to `main`. The docs are not part of the npm package.

GitHub Pages carries a second copy at connortessaro.github.io/kizuki. `.github/workflows/pages.yml` builds it with `npm run docs:site` on every push to `main` and deploys it.

When you bump the version, `npm version` runs `npm run docs` and adds the new `docs/openapi.json` to the version commit, because the reference names the version.
