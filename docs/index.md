Kizuki is a study tool that runs in your terminal. You add course material and teach a concept in your own words. Kizuki plays the student and asks about contradictions, gaps, and unclear words, always quoting your material. These docs describe how it works, generated from the code of the `main` branch.

- **Code reference**: every exported function, type, and constant, in the list of modules. `lib/` holds the study rules; `tui/` holds the terminal app.
- **Guides**, in reading order:
  1. [Adding material](./guides/adding-material.md): the formats Kizuki reads and what happens after you add a file.
  2. [Passages and sentences](./guides/passages-and-sentences.md): how text is split, labeled, checked, and searched.
  3. [Teach-back sessions](./guides/teach-back.md): how Kizuki plays the student and writes its questions.
  4. [The model never writes facts](./guides/the-model-never-writes-facts.md): the guards around every use of the model.
  5. [When you and the material disagree](./guides/conflicts.md): corrections, and why yours win.
  6. [Nothing is saved without your OK](./guides/nothing-saved-without-your-ok.md): proposals and confirmations.
  7. [Spaced review](./guides/spaced-review.md): when a concept comes back.
  8. [How people learn](./guides/how-people-learn.md): what the research says, and which methods Kizuki uses.
  9. [Models](./guides/local-models.md): Ollama, MLX, AI Gateway, and the settings.
  10. [Storage and privacy](./guides/storage-and-privacy.md): the data folder and the logs.
  11. [How these docs are made](./guides/how-the-docs-are-made.md): for contributors.

To start Kizuki, see the [README](https://github.com/connortessaro/kizuki#readme).
