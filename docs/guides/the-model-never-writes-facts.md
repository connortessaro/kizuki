---
title: The model never writes facts
---

# The model never writes facts

Kizuki's one rule is to never misinform you. The model never writes facts in its own words. It picks sentence labels, question kinds, and words you wrote, and plain code does the rest. When sources disagree, your corrections come first, then your material, and the model's own knowledge never counts.

A prompt can ask the model to behave. Only code can check that it did, so each place the model is used has a guard in code.

| The model... | It replies with | The guard |
| --- | --- | --- |
| proposes concepts | a name and sentence labels ({@link lib/concepts!conceptReplySchema | conceptReplySchema}) | {@link lib/concepts!validateConceptReply | validateConceptReply} |
| points at sentences it cannot read | sentence labels | the same guard; the question is fixed words |
| proposes prerequisite links | concept labels like `C3` ({@link lib/links!linkReplySchema | linkReplySchema}) | {@link lib/links!validateLinkReply | validateLinkReply} |
| chooses teach-back questions | a kind, a sentence label, and your words ({@link lib/teach!teachReplySchema | teachReplySchema}) | {@link lib/teach!validateTeachReply | validateTeachReply} |
| adds to what you missed | sentence labels ({@link lib/teach!missesReplySchema | missesReplySchema}) | {@link lib/teach!validateMisses | validateMisses} |

Search, the review schedule, storage, and the "barely used" miss check use no model.

## Labels instead of quotes

The model sees every sentence with a label such as `[S3]` ({@link lib/sentences!numberSentences | numberSentences}) and answers with labels. {@link lib/sentences!lookupSentence | lookupSentence} looks up the exact sentence, so the model has no way to make up a quote. The word-for-word check ({@link lib/quote!quoteMatches | quoteMatches}) still runs on every quote as a second guard. A label that points nowhere drops the item, and the page counts what was dropped.

## Questions are templates

{@link lib/teach!renderQuestion | renderQuestion} writes every teach-back question from a fixed template around the exact sentence, its location, and your words. A question about a sentence Kizuki cannot read is always {@link lib/concepts!UNCLEAR_QUESTION | UNCLEAR_QUESTION}: "Kizuki is not sure how to read this sentence. What does it mean?" The model only points at the sentence.

## Concept names

A concept name is the one place the model writes words that Kizuki shows. {@link lib/concepts!validateConceptReply | validateConceptReply} keeps a name only when:

- at least one of its sentences is real and passes the quote check;
- it has at most {@link lib/concepts!MAX_NAME_WORDS | MAX_NAME_WORDS} words, has no question mark, and does not start with "Unclear", "Note", or "Question";
- every meaningful word in it appears in its section (the heading or the section's text), apart from words that name a kind of topic, such as "structure", "process", or "types". So "Mitochondria make glucose" is dropped when the section never says "make" or "glucose";
- the course has no concept with the same name, or the same name with filler words like "definition of" added;
- its section has fewer than {@link lib/concepts!MAX_MODEL_CONCEPTS_PER_SECTION | MAX_MODEL_CONCEPTS_PER_SECTION} model concepts so far.

Concepts for real headings do not come from the model at all. {@link lib/concepts!headingConcepts | headingConcepts} names each after its heading and backs it with the first sentences of its section.

## Reply shapes

The model must reply in a fixed JSON shape. With Ollama or OpenAI the server enforces the shape. With MLX, which ignores shapes, {@link lib/model!askWithShapeInPrompt | askWithShapeInPrompt} puts the shape in the instructions, checks the reply with {@link lib/model!parseJsonReply | parseJsonReply}, and asks once more after a broken reply. A second broken reply is an error. Error messages never include the model's own words, because Kizuki saves errors and shows them on the page.

## Where this is tested

The guards have plain tests with no model (`lib/*.test.ts`). The model tests in `evals/` (run with `npm run eval`) check real small models against hand-written answer keys with planted mistakes.
