---
title: Local models and host checks
---

# Local models and host checks

Kizuki uses two models: an **answer model** that proposes concepts and links and chooses questions, and a **meaning-search model** that turns passages into numbers for search. By default both run in Ollama on your computer, so your material never leaves it.

## Settings

{@link lib/settings!DEFAULT_SETTINGS | DEFAULT_SETTINGS} points both at Ollama, `http://localhost:11434/v1`, with `qwen3.5:2b` for answers and `nomic-embed-text` for meaning search. Settings live in `settings.json` in the data folder ({@link lib/settings!settingsSchema | settingsSchema}):

- `baseURL` and `model` for each model. Any server that speaks the OpenAI format works.
- `apiKeyEnv`: the **name** of an environment variable that holds an API key, ending in `_API_KEY`. Kizuki refuses anything that is not such a name, so a key is never saved. {@link lib/model!chatModel | chatModel} reads the key from the environment at the moment it calls.
- `reasoning`: `none` turns thinking off, which is much faster on small models. `default` leaves it to the model.
- `replyShape`: `server` lets the server enforce the reply's JSON shape (Ollama, OpenAI). `prompt` makes Kizuki describe the shape in the instructions and check the reply itself (MLX).

{@link lib/settings!PRESETS | PRESETS} holds three ready-made choices: Ollama, MLX (`http://localhost:8080/v1` with `mlx-community/Qwen3.5-2B-4bit`), and hosted (OpenAI with `OPENAI_API_KEY`). Meaning search stays on Ollama in all three. {@link lib/settings!readSettings | readSettings} treats a broken `settings.json` as an error that names the file, never as a silent reset to the defaults.

## Checking the models

{@link lib/model!checkModels | checkModels} asks each server for its model list (`GET {baseURL}/models`) and reports a problem with a fix: "Start Ollama with: ollama serve", or "Install it with: ollama pull qwen3.5:2b". The Today and Settings pages show these problems, and the `kizuki` command checks the same way at start (`bin/cli.mjs`) and starts the dashboard anyway.

## Talking to the models

Kizuki calls the models through the AI SDK with the OpenAI-compatible provider:

- {@link lib/model!makeAsk | makeAsk} sends `POST {baseURL}/chat/completions` with temperature 0.2 and the reply shape. With reasoning `none` it also sends Qwen's switch to turn thinking off ({@link lib/model!requestBodyFor | requestBodyFor}, {@link lib/model!providerOptionsFor | providerOptionsFor}).
- {@link lib/model!makeEmbedder | makeEmbedder} sends `POST {baseURL}/embeddings`. For nomic models each text starts with `search_document: ` or `search_query: ` ({@link lib/model!embedPrefix | embedPrefix}).

The HTTP reference lists these under "Requests Kizuki sends".

## Before material leaves your computer

{@link lib/settings!isLocalUrl | isLocalUrl} counts an address as local only when its host is `localhost`, `127.0.0.1`, or `::1`. {@link lib/model!sendsMaterialOut | sendsMaterialOut} is true when either model's address is not local. Saving settings (or choosing the hosted preset) that would start sending material out requires a ticked box saying you understand; without it the settings are not saved.

## Host checks

Kizuki has no login. It listens only on `127.0.0.1`: `npm start`, `npm run dev`, and the `kizuki` command all pass `-H 127.0.0.1`. That still leaves one way in from the web: a website could point its own domain name at your computer's address and have your browser send requests there. {@link proxy!proxy | proxy} stops that. It runs before every page, form action, file, and background-job address (all but the built files under `/_next/`) and answers 403 unless {@link lib/hosts!isLocalHost | isLocalHost} says the Host header names this computer: `127.0.0.1`, `localhost`, or `[::1]`, with any port.

More safeguards sit behind the host check:

- Next.js runs a form action only when the Origin header matches the Host header, so another site's page cannot post Kizuki's forms.
- Every answer carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, so no site can show Kizuki in a frame and trick a click on "Hosted model"; `X-Content-Type-Options: nosniff`; and `Referrer-Policy: no-referrer` (set in `next.config.ts`).
- Background jobs take the data folder as input, so {@link lib/paths!runHome | runHome} refuses any folder other than the one Kizuki runs with, and {@link workflows/home!ownHome | ownHome} stops such a run without retries.
- Messages from form actions travel as a random id in the page address ({@link lib/messages!withMessage | withMessage}). A page shows only messages this running Kizuki stored ({@link lib/messages!shownMessage | shownMessage}), so a link cannot make a page show text that looks like Kizuki's.
