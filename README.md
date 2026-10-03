# Kizuki

[![npm](https://img.shields.io/npm/v/kizuki)](https://www.npmjs.com/package/kizuki) [![CI](https://github.com/connortessaro/kizuki/actions/workflows/ci.yml/badge.svg)](https://github.com/connortessaro/kizuki/actions/workflows/ci.yml) [![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/connortessaro/kizuki/badge)](https://scorecard.dev/viewer/?uri=github.com/connortessaro/kizuki)

A study tool for your terminal. You add your course material and teach a concept in your own words. Kizuki plays the student: it asks about what you got wrong, what you left out, and what you said unclearly, and every question quotes your own material. Concepts you miss come back for review before you forget them.

*Kizuki* (気付き) means "noticing": the moment something clicks.

Website: [kizuki.dev](https://kizuki.dev) · Docs: [kizuki.dev/docs](https://kizuki.dev/docs/)

- **It never makes things up.** The model never writes facts in its own words. It points at sentences of your material, and Kizuki shows those sentences word for word, each with a numbered link to the page, slide, or cell it came from.
- **Your material wins.** When you and your material disagree, Kizuki shows the passage and asks which is right. If the material is wrong (a slide typo, or your professor corrected it in class), your correction wins from then on.
- **Nothing is saved without your OK.** Proposed concepts, prerequisite links, and "what you missed" all wait for you to confirm them.
- **Everything stays on your computer** unless you choose otherwise. By default Kizuki runs a small model through Ollama.

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
3. **Teach it back.** `/teach` picks the first concept that is due. Explain it from memory: Kizuki hides the material until you finish. Over up to three rounds, it asks where you disagree with the material, what you left out, and what you said vaguely. When you disagree, you say which is right; if the material is wrong, your correction wins.
4. **Confirm what you missed.** Kizuki lists sentences from the material you may have missed. You tick the ones you missed. Then it shows the passages, so you read the material after recalling it.
5. **Try again.** After misses, Kizuki offers another try right away, from memory, up to three tries.
6. **Review.** A clean session doubles the wait before the next review (1, 2, 4, 8 days, up to 60). A session with misses brings the concept back tomorrow. A concept waits until the concepts it needs are solid. Set an exam date with `/exam 2026-12-15` and reviews move before it.

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

See [Models](docs/guides/local-models.md) for every setting.

## Your data

Everything lives in `~/.kizuki/` (or the folder in `KIZUKI_HOME` or `--home`). To back up your study data, copy that folder. See [Storage and privacy](docs/guides/storage-and-privacy.md).

## Docs and development

The code reference and guides are at [kizuki.dev/docs](https://kizuki.dev/docs/). To work on Kizuki, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
