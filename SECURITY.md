# Security Policy

## Supported versions

Kizuki is before version 1.0. Only the latest published version gets security fixes.

## Reporting a problem

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: open the [Security tab](https://github.com/connortessaro/kizuki/security/advisories/new) and create a draft security advisory. Include the version or commit, your system and Node.js version, steps to reproduce, and what you think the impact is.

You can expect a reply within 3 business days and a first assessment within 10. These are best-effort targets for a project maintained by one person.

## What Kizuki promises

Kizuki runs on one person's computer. These promises are in scope:

- **It only listens on this computer.** The app binds to `127.0.0.1` (so do `npm run dev` and `npm start`) and refuses requests whose Host header is not `127.0.0.1`, `localhost`, or `::1`, on every route including the Workflow SDK's `/.well-known/workflow/`, so a website that points its own domain at your computer cannot reach it. Server actions also check that requests come from the same origin, and background jobs refuse any data folder but the one Kizuki runs with.
- **Other sites can't use it through your browser.** Pages send headers that stop other sites from showing Kizuki in a frame, and the notices at the top of a page can only come from Kizuki itself, never from text in a link.
- **Your data stays local.** Files, logs, and the search file live in `~/.kizuki` (or `KIZUKI_HOME`), readable only by your user account. There is no telemetry and nothing is sent anywhere, unless you choose a hosted model in Settings, which needs you to tick "I understand" first.
- **API keys are never saved.** Settings stores only the name of an environment variable ending in `_API_KEY`; the key is read when needed and never written to a file or log.
- **Hostile files are refused, not run.** Word, PowerPoint, and Excel files unpack only their text parts, with size limits, and PDFs over 3000 pages are refused.
- **Releases can be checked.** The npm package and the GitHub release tarballs carry signed provenance from the release workflow: `npm view kizuki dist.attestations` or `gh attestation verify kizuki.tgz --repo connortessaro/kizuki`.
- **Quotes are checked.** Anything shown as a quote from your material has passed a word-for-word check against the stored text.

Especially interesting: anything that lets another website or user on the network read or change your data, any way to make Kizuki show text as a quote that is not in your material, and API keys ending up in files or logs.

## Known limits

- Anyone who can already run programs as you on your computer can read your data. That is out of scope.
- A hosted model receives the material you send it, under that provider's terms.

## Your own data

Your study data is never in the repository. If you point `KIZUKI_HOME` inside a clone, `.kizuki/` is gitignored, but check `git status` before you push.
