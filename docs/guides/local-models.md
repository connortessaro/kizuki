---
title: Models
---

# Models

Kizuki uses two models: an **answer model** that proposes concepts and links and chooses questions, and a **meaning-search model** that turns passages into numbers for search. By default both run in Ollama on your computer, so your material never leaves it. For bigger models without a fast computer, Kizuki can use Vercel AI Gateway instead, after asking you.

## Settings

{@link lib/settings!DEFAULT_SETTINGS | DEFAULT_SETTINGS} points both at Ollama, `http://localhost:11434/v1`, with `qwen3.5:2b` for answers and `nomic-embed-text` for meaning search. Settings live in `settings.json` in the data folder ({@link lib/settings!settingsSchema | settingsSchema}):

- `provider` for each model: `openai-compatible` for any server that speaks the OpenAI format (Ollama, MLX), or `gateway` for Vercel AI Gateway. Settings saved before this field existed read as `openai-compatible`.
- `baseURL` and `model` for each model.
- `apiKeyEnv`: the **name** of an environment variable that holds an API key, ending in `_API_KEY`. Kizuki refuses anything that is not such a name, so a key is never saved. {@link lib/model!chatModel | chatModel} reads the key from the environment at the moment it calls.
- `reasoning`: `none` turns thinking off, which is much faster on small models. `default` leaves it to the model.
- `replyShape`: `server` lets the server enforce the reply's JSON shape (Ollama, AI Gateway). `prompt` makes Kizuki describe the shape in the instructions and check the reply itself (MLX).
- `sendOutAllowed`: true once you agreed to send your material to a model off your computer. See below.

{@link lib/settings!readSettings | readSettings} treats a broken `settings.json` as an error that names the file, never as a silent reset to the defaults.

## Changing models

`/model` shows both models and their addresses. {@link lib/settings!PRESETS | PRESETS} holds three ready-made choices, each switching both models at once:

| Command | Answer model | Meaning search | Key |
| --- | --- | --- | --- |
| `/model ollama` | `qwen3.5:2b` on Ollama | `nomic-embed-text` on Ollama | none |
| `/model mlx` | `mlx-community/Qwen3.5-2B-4bit` on MLX (`http://localhost:8080/v1`) | `nomic-embed-text` on Ollama | none |
| `/model gateway` | `openai/gpt-5.4-mini` on AI Gateway | `openai/text-embedding-3-small` on AI Gateway | `AI_GATEWAY_API_KEY` |

`/model answer <name>` and `/model search <name>` change one model's name and keep its address. With AI Gateway, any model name the gateway lists works, such as `anthropic/claude-sonnet-5.5`.

Meaning-search numbers from one model can't be compared with another's. When the meaning-search model changes, Kizuki says the search file is out of date; `/rebuild` rebuilds it from the logs ({@link lib/rebuild!rebuildIndex | rebuildIndex}).

## Checking the models

{@link lib/model!checkModels | checkModels} asks each server for its model list and reports a problem with a fix: "Start Ollama with: ollama serve", "Install it with: ollama pull qwen3.5:2b", or the name of an API key variable that is not set. For AI Gateway it asks the gateway's own model list. Kizuki checks at start and after every `/model` change, prints any problems, and keeps going, so you can still review and browse without a working model.

## Talking to the models

Kizuki calls the models through the AI SDK:

- For `openai-compatible` servers it uses the OpenAI-compatible provider. {@link lib/model!makeAsk | makeAsk} sends `POST {baseURL}/chat/completions` with temperature 0.2 and the reply shape. With reasoning `none` it also sends Qwen's switch to turn thinking off ({@link lib/model!requestBodyFor | requestBodyFor}, {@link lib/model!providerOptionsFor | providerOptionsFor}). {@link lib/model!makeEmbedder | makeEmbedder} sends `POST {baseURL}/embeddings`.
- For AI Gateway it uses the AI SDK's own gateway provider (`createGateway`), which the AI SDK docs recommend over pointing an OpenAI-format provider at the gateway. Kizuki sends no temperature there, because hosted reasoning models reject one.
- For nomic models each text starts with `search_document: ` or `search_query: ` ({@link lib/model!embedPrefix | embedPrefix}).

Requests carry your material's sentences, your corrections and readings, and, in a session, your explanation and answers. API keys go in the `Authorization` header only when the settings name a key variable.

## Before material leaves your computer

{@link lib/settings!isLocalUrl | isLocalUrl} counts an address as local only when its host is `localhost`, `127.0.0.1`, or `::1`. {@link lib/model!sendsMaterialOut | sendsMaterialOut} is true when either model's address is not local.

When `/model` would switch to such settings and you have not agreed before, Kizuki asks: "These models run off your computer. Kizuki will send them your material, your explanations, and your answers. Send them?" No changes nothing. Yes saves the settings with `sendOutAllowed` set. {@link lib/settings!writeSettings | writeSettings} refuses settings that send material out without it, so the rule holds even if something other than `/model` writes the settings.
