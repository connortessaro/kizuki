---
title: Passages and sentences
---

# Passages and sentences

Every quote Kizuki shows is a sentence of a stored passage. This guide covers how text becomes passages, how passages become labeled sentences, how a quote is checked, and how search finds passages.

## Passages

A passage ({@link lib/events!Passage | Passage}) is a short piece of one file with its id, its section, its position, its text, and its {@link lib/events!Location | Location}: page, slide (and whether it is from the notes), sheet and cells, heading, or paragraph. {@link lib/sources!describeLocation | describeLocation} turns a location into the label you see, such as "Slide 12 of Week 3.pptx" or "Cells A1:D15 of sheet “Data” in grades.xlsx".

The readers hand their paragraphs to {@link lib/extract/chunk!chunkParagraphs | chunkParagraphs}:

- A passage holds at most {@link lib/extract/chunk!MAX_PASSAGE | MAX_PASSAGE} characters, small enough for a small model to read many at once.
- Short paragraphs next to each other join into one passage when they share a group: the same page, slide, or section, depending on the reader. They are joined with a blank line.
- A paragraph longer than the limit is split at sentence ends. A single sentence longer than the limit is split at the last space before the limit.
- A joined passage keeps the location of its first paragraph.

Spreadsheet rows are grouped by {@link lib/extract/cells!rowsToPassages | rowsToPassages} instead, and each passage records its cell range.

## Sentences and their labels

{@link lib/sentences!splitSentences | splitSentences} splits a passage into sentences at `.`, `!`, or `?` followed by a space, at blank lines, and at line breaks between list lines or titles. It keeps these whole:

- A sentence that runs over a printed line break, as in PDFs: the line does not end a sentence and the next line starts in lower case, or the line ends on a word like "of", "the", or "and", or on a comma.
- A word split by a hyphen at a line end ("photo-" then "synthesis").
- Abbreviations such as "e.g.", "i.e.", "etc.", "vs.", "Fig.", and "Dr.".

When Kizuki asks the model anything about your material, {@link lib/sentences!numberSentences | numberSentences} (or {@link lib/concepts!conceptPrompt | conceptPrompt} for concepts) writes every sentence with a label: `[S1] …`, `[S2] …`. The model answers with labels only. {@link lib/sentences!lookupSentence | lookupSentence} turns a label back into the exact sentence. It reads the first `S` and number in what the model wrote, so ` s3 ` or `Passage 2: [S6] Most of…` still work. If the model writes a sentence out instead of its label, Kizuki accepts it only when those words appear word for word in one sentence and no other, with at least {@link lib/sentences!MIN_WRITTEN_WORDS | MIN_WRITTEN_WORDS} words, and uses that whole real sentence.

## The quote check

{@link lib/quote!quoteMatches | quoteMatches} is the word-for-word check. It runs on every quote before Kizuki shows or saves it, even though a looked-up sentence comes from the passage already. A quote passes when it appears in its passage after {@link lib/quote!normalizeForMatch | normalizeForMatch} makes these differences disappear:

- letter case, runs of spaces, and line breaks;
- curly versus straight quote marks, and dash styles;
- PDF ligatures such as "ﬁ".

Quote marks and punctuation around the quote are ignored. The quote must contain a letter or digit, and it must start and end on word edges: "can" never matches inside "can't". A word split by a hyphen at a line end matches the whole word.

{@link lib/quote!findQuote | findQuote} finds which passage holds a quote, checking the passage the model cited first. {@link lib/quote!termInText | termInText} runs the same check against your own writing, for "What do you mean by …?" questions.

## Search

Kizuki keeps one search file, `index.sqlite`, with SQLite keyword search and `sqlite-vec` meaning search ({@link lib/search!openIndex | openIndex}). The meaning numbers for each passage come from the meaning-search model ({@link lib/model!makeEmbedder | makeEmbedder}), stored per course, so a search only looks at its own course.

{@link lib/search!searchPassages | searchPassages} runs both searches and merges their ranked lists:

- A keyword match needs at least two of the meaningful words in your text (one if your text has only one). {@link lib/words!contentWords | contentWords} leaves out common words like "the" and "of", and {@link lib/words!sameWord | sameWord} treats "release" and "releases" as the same word.
- A meaning match must be closer than {@link lib/search!MAX_MEANING_DISTANCE | MAX_MEANING_DISTANCE}, so text about something else finds nothing.

A teach-back session shows the model the passages the concept was confirmed with, then search matches for your explanation and answers, up to {@link lib/sessionFlow!MAX_SESSION_PASSAGES | MAX_SESSION_PASSAGES} in all.

The search file is never the truth. {@link lib/rebuild!rebuildIndex | rebuildIndex} builds it again from the logs, for example after you change the meaning model. It builds the new file next to the old one and swaps it in only when it is complete, so a failure leaves the old one working. The search file refuses to mix meaning models: {@link lib/search!indexPassages | indexPassages} stops with "Rebuild the search file in Settings" when the model or its number count changed.
