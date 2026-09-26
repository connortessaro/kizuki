# Kizuki

A study tool that runs on your computer. You add your course material and teach a concept in your own words. Kizuki plays the student: it asks about what you got wrong, what you left out, and what you said unclearly, and every question quotes your own material. Concepts you miss come back for review before you forget them.

*Kizuki* (気付き) means "noticing": the moment something clicks.

Website: [kizuki.dev](https://kizuki.dev) · Docs: [kizuki.dev/docs](https://kizuki.dev/docs/)

- **It never makes things up.** The model never writes facts in its own words. It points at sentences of your material, and Kizuki shows those sentences word for word, each with a link to the page, slide, or cell it came from.
- **Your material wins.** When you and your material disagree, Kizuki shows the passage and asks which is right. If the material is wrong (a slide typo, or your professor corrected it in class), your correction wins from then on.
- **Nothing is saved without your OK.** Proposed concepts, prerequisite links, and "what you missed" all wait for you to confirm them.
- **Everything stays on your computer.** Kizuki runs a small model through Ollama. There is no account and no cloud.

## Start

You need [Node.js](https://nodejs.org) 22.18 or newer and [Ollama](https://ollama.com).

```bash
ollama pull qwen3.5:2b
ollama pull nomic-embed-text
npx kizuki
```

That runs the latest version from npm. It checks that both models are installed, starts Kizuki, and opens the dashboard at `http://127.0.0.1:3700`. To install it once and start it with `kizuki` from then on: `npm install -g kizuki`.

Options: `--port 4000`, `--home ~/my-study-data`, `--no-open`.

## How it works

1. **Add material.** Create a course and upload files: PDFs with a text layer, PowerPoint, Word, Excel, CSV, markdown, and text. Kizuki reads the text and remembers where every passage came from.
2. **Review concepts.** Every heading in your file becomes a proposed concept, and a small model adds smaller ideas inside each section. Each concept is backed by sentences from the file. You confirm, rename, merge, or drop them. Then Kizuki suggests an order ("A needs B first"), which you confirm too.
3. **Teach it back.** Pick a due concept and explain it without notes. Kizuki asks up to three rounds of questions:
   - *Does this fit?* The material says something different from what you wrote. You say which is right: the material, you (the material is wrong, so you correct it), or neither (Kizuki misread you).
   - *Something you left out.* The material has an idea you did not mention.
   - *Say more.* You used vague words.
4. **Confirm what you missed.** At the end Kizuki lists sentences from the material you may have missed. You tick the ones you really missed.
5. **Review.** A clean session doubles the wait before the next review (1, 2, 4, 8 days, up to 60). A session with misses brings the concept back tomorrow. A concept waits until the concepts it needs are solid. Set an exam date and reviews move before it.

The goal is at least one **catch** a week: something Kizuki caught that you would have gotten wrong on an exam. Record catches on the session page; the History page counts them.

## Your data

Everything lives in `~/.kizuki/` (or the folder in `KIZUKI_HOME`):

- `files/`: copies of your original files
- `data/*.jsonl`: logs of everything that happened. Each line is one event, and lines are only ever added. The logs are the truth.
- `index.sqlite`: the search file. Settings can rebuild it from the logs at any time.
- `settings.json`: which models to use

To back up your study data, copy that folder.

## Models

The defaults are `qwen3.5:2b` for choosing questions and `nomic-embed-text` for meaning search, both through Ollama. On Apple chips you can use MLX instead: start `mlx_lm.server --model mlx-community/Qwen3.5-2B-4bit` and pick the MLX settings (in testing it caught fewer planted mistakes than Ollama, at about the same speed). Any hosted model that speaks the OpenAI format works too. Before a choice would send your material off your computer, Settings asks you to tick that you understand. API keys are read from environment variables and never saved.

## Develop

```bash
npm ci
npm test          # plain tests, no model needed
npm run qc        # every check CI runs: lint, types, docs, tests with coverage, PII check, npm audit
npm run e2e       # the study loop in a browser against a fake model (run npm run build first)
npm run dev       # dashboard with live reload, on 127.0.0.1 only
npm run eval      # model tests against your local Ollama (slow)
npm run docs      # the docs site into docs/api/, and docs/openapi.json (also at kizuki.dev/docs)
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The design is in [docs/superpowers/specs/2026-09-24-kizuki-study-tool-design.md](docs/superpowers/specs/2026-09-24-kizuki-study-tool-design.md).

## Docs

[kizuki.dev/docs](https://kizuki.dev/docs/) is generated from the code on `main` and rebuilt whenever a push to `main` changes it:

- [HTTP API](https://kizuki.dev/docs/http-api/): every address the local server answers, with its headers ([docs/openapi.json](docs/openapi.json), OpenAPI 3.1).
- Code reference: every exported function and type, from the doc comments.
- Guides: adding material, teach-back sessions, the rules that keep the model from making things up, spaced review, local models, and storage ([docs/guides/](docs/guides/)).

The docs build fails when an export, a route, a header, or a form field has no docs. See [How these docs are made](docs/guides/how-the-docs-are-made.md).

## License

[Apache-2.0](LICENSE)
