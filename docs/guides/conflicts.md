---
title: When you and the material disagree
---

# When you and the material disagree

Kizuki never overrules you and never accepts a disagreement without asking. When sources disagree, this order decides what is true:

1. **Your corrections.** If the material is wrong (a slide typo, or your professor corrected it in class), you record a correction and your version wins from then on.
2. **Your material.**
3. **Nothing else.** The model's own knowledge is never a source.

## In a session

A "Does this fit?" question shows the sentence of the material that differs from what you wrote. You choose one answer ({@link lib/events!answerSchema | answerSchema}):

| Your choice | Saved as | Effect |
| --- | --- | --- |
| The material is right. I got this wrong. | verdict `material-right` | A miss: the session is not clean, and the sentence is listed under "What you got wrong". |
| The material is wrong. | verdict `material-wrong`, plus your version | {@link lib/sessionFlow!recordAnswers | recordAnswers} saves a correction ({@link lib/commands!addCorrection | addCorrection}) tied to the session, with your answer as its note. Your version is required. |
| Neither: Kizuki misread what I wrote. | verdict `misread` | No miss and no correction. A small model sometimes sees a disagreement that is not there. |

The form refuses to send a round until every "Does this fit?" question has a choice.

## On a source page

Every quote links to its passage at `/sources/{passageId}`, which shows the passage with its neighbors, any corrections, and a link to the original file (at the right page for a PDF). "Correct this passage" asks for the wrong text, your version, and an optional note. `addCorrectionAction` refuses the correction unless the wrong text passes the word-for-word quote check against the passage.

## How a correction wins

Corrections live in `corrections.jsonl` as `correction.added` events ({@link lib/events!correctionEventSchema | correctionEventSchema}). From then on:

- The model sees each correction under its passage: "Your correction: “…” should be “…”."
- No question may quote a sentence you corrected, and no sentence you corrected is proposed as a miss. {@link lib/teach!isCorrected | isCorrected} matches a correction against any sentence that contains the corrected words, or that the corrected words contain, in any passage. The same wrong words stay wrong wherever they appear, including in a new copy of the file.
- Wherever Kizuki shows a quote (the `Quote` component), your correction appears under it.

## "What does this mean?"

When the model points at a sentence it cannot read, Kizuki records a `clarification.asked` event with the fixed question {@link lib/concepts!UNCLEAR_QUESTION | UNCLEAR_QUESTION}. The course page lists open questions. Your answer ({@link lib/commands!answerClarification | answerClarification}) becomes "Your reading of “…”", shown under the passage to you and to the model in later sessions.
