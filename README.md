# Kizuki

A study tool for your terminal. You add your course material and teach a concept in your own words. Kizuki plays the student: it asks about what you got wrong, what you left out, and what you said unclearly, and every question quotes your own material. Concepts you miss come back for review before you forget them.

*Kizuki* (気付き) means "noticing": the moment something clicks.

Website: [kizuki.dev](https://kizuki.dev) · Docs: [kizuki.dev/docs](https://kizuki.dev/docs/)

- **It never makes things up.** The model never writes facts in its own words. It points at sentences of your material, and Kizuki shows those sentences word for word, each with a numbered link to the page, slide, or cell it came from.
- **Your material wins.** When you and your material disagree, Kizuki shows the passage and asks which is right. If the material is wrong (a slide typo, or your professor corrected it in class), your correction wins from then on.
- **Nothing is saved without your OK.** Proposed concepts, prerequisite links, and "what you missed" all wait for you to confirm them.
- **Everything stays on your computer** unless you choose otherwise. By default Kizuki runs a small model through Ollama. There is no account and no cloud.

## Start

You need [Node.js](https://nodejs.org) 22.18 or newer and [Ollama](https://ollama.com).

```bash
ollama pull qwen3.5:2b
ollama pull nomic-embed-text
npx kizuki
```

That runs the latest version from npm in your terminal. To install it once and start it with `kizuki` from then on: `npm install -g kizuki`.

Options: `--home ~/my-study-data` picks the data folder, `--version`, and `--help`.

Version 1.0.0 replaced the web dashboard with the terminal app. Your data folder carries over as it is.

## How it works

Type `/course Biology 101` to make a course, then:

1. **Add material.** Drop files onto the window, or type `/add ~/Downloads/lecture1.pdf`. Kizuki reads PDFs with a text layer, PowerPoint, Word, Excel, CSV, markdown, and text, and remembers where every passage came from.
2. **Review concepts.** Every heading in your file becomes a proposed concept, and the model adds smaller ideas inside each section. `/review` shows them in a list: untick the ones you don't want and press Enter. Then Kizuki suggests an order ("A needs B first"), which you confirm too.
3. **Teach it back.** `/teach` picks the first concept that is due. Explain it from memory: Kizuki hides the material until you finish. It asks up to three rounds of questions:
   - *Does this fit?* The material says something different from what you wrote. You say which is right: the material, you (the material is wrong, so you correct it), or neither (Kizuki misread you).
   - *Something you left out.* The material has an idea you did not mention.
   - *Say more.* You used vague words.
4. **Confirm what you missed.** Kizuki lists sentences from the material you may have missed. You tick the ones you missed. Then it shows the passages, so you read the material after recalling it.
5. **Try again.** After misses, Kizuki offers another try right away, from memory, up to three tries.
6. **Review.** A clean session doubles the wait before the next review (1, 2, 4, 8 days, up to 60). A session with misses brings the concept back tomorrow. A concept waits until the concepts it needs are solid. Set an exam date with `/exam 2026-12-15` and reviews move before it.

The goal is at least one **catch** a week: something Kizuki caught that you would have gotten wrong on an exam. Record one with `/catch <note>` after a session; `/history` counts them.

## Commands

| Command | What it does |
| --- | --- |
| `/course [name]` | Switch course, or make a new one |
| `/add <files>` | Add files to the course, or drop them onto the window |
| `/review` | Confirm the concepts and links Kizuki proposed |
| `/teach [concept]` | Teach a concept back from memory; with no name, the first one due |
| `/due` | What is due, coming up, and waiting |
| `/concepts` | The course's confirmed concepts |
| `/rename <a> = <b>`, `/merge <a> into <b>`, `/drop <a>` | Change a concept |
| `/links` | The order you confirmed; untick a link to remove it |
| `/exam <YYYY-MM-DD>` | Set the exam date, or `/exam none` |
| `/open <n>` | Open source `[n]` in its usual app |
| `/correct <n>` | The material in source `[n]` is wrong: record your version |
| `/catch <note>` | Record something you would have gotten wrong on an exam |
| `/history` | The last 8 weeks |
| `/model [preset]` | Show or change models: `ollama`, `mlx`, `gateway` |
| `/rebuild` | Rebuild the search file |
| `/help`, `/quit` | Help, and leave (Ctrl+C twice also works) |

In a pick list, arrow keys move, space ticks, Enter confirms, and Esc stops without saving. End a line with `\` to add a new line instead of sending.

## Models

The defaults are `qwen3.5:2b` for choosing questions and `nomic-embed-text` for meaning search, both through Ollama. On Apple chips you can use MLX instead: start `mlx_lm.server --model mlx-community/Qwen3.5-2B-4bit` and type `/model mlx`.

For bigger models without a fast computer, use [Vercel AI Gateway](https://vercel.com/ai-gateway): set `AI_GATEWAY_API_KEY` where you start Kizuki, then type `/model gateway`. This sends your material, your explanations, and your answers off your computer, so Kizuki asks you first. `/model answer <name>` picks any model the gateway lists. API keys are read from environment variables and never saved.

A bigger model asks better questions and finds more misses. The rules stay the same at any size: code checks every quote and writes every question.

## Your data

Everything lives in `~/.kizuki/` (or the folder in `KIZUKI_HOME` or `--home`):

- `files/`: copies of your original files
- `data/*.jsonl`: logs of everything that happened. Each line is one event, and lines are only ever added. The logs are the truth.
- `index.sqlite`: the search file. `/rebuild` rebuilds it from the logs at any time.
- `settings.json`: which models to use

To back up your study data, copy that folder.

## Develop

```bash
pnpm install
pnpm build      # bundle the app into dist/
pnpm dev        # build, then start Kizuki
pnpm test       # plain tests, no model needed
pnpm qc         # every check CI runs: lint, types, docs, tests with coverage, PII check, pnpm audit
pnpm eval       # model tests against your local Ollama (slow)
pnpm run docs   # the docs site into docs/api/ (also at kizuki.dev/docs)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Docs

[kizuki.dev/docs](https://kizuki.dev/docs/) is generated from the code on `main` and rebuilt whenever a push to `main` changes it:

- Code reference: every exported function and type, from the doc comments.
- Guides: adding material, teach-back sessions, the rules that keep the model from making things up, how people learn, spaced review, models, and storage ([docs/guides/](docs/guides/)).

The docs build fails when an export has no doc comment or a link points at nothing. See [How these docs are made](docs/guides/how-the-docs-are-made.md).

## License

[Apache-2.0](LICENSE)
