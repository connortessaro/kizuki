---
title: Teach-back sessions
---

# Teach-back sessions

In a session you explain a confirmed concept without notes. Kizuki plays a curious student: it asks about what does not match your material, what you left out, and vague words you used. Every question about the material quotes it.

## The steps

1. On a concept's page you write your explanation. `startSessionAction` calls {@link lib/commands!startSession | startSession}, which refuses a concept you have not confirmed and an empty explanation, and records `session.started`.
2. The {@link workflows/session!teachSession | teachSession} workflow starts. For up to {@link lib/limits!MAX_ROUNDS | MAX_ROUNDS} rounds it chooses questions ({@link lib/sessionFlow!runRound | runRound}) and pauses for your answers ({@link lib/sessionFlow!recordAnswers | recordAnswers}). It stops early when a round has no questions, or when you press "Send and finish".
3. Kizuki proposes what you may have missed ({@link lib/sessionFlow!proposeMisses | proposeMisses}) and pauses until you tick the ones you missed.
4. {@link lib/sessionFlow!endSession | endSession} ends the session. It is **clean** only if you confirmed no misses and never answered "the material is right" to a "Does this fit?" question. Clean or not decides the next review date (see [Spaced review](./spaced-review.md)).

The session page shows where the session is with {@link lib/state!SessionStatus | SessionStatus}: thinking, answering, reviewing, ended, or failed. While Kizuki is thinking, the page reloads itself. If a session stays in thinking for more than two minutes, the page offers "Restart it", which starts a new run that skips finished steps. On the concept page, "Stop it and start over" marks an open session as stopped.

## What the model sees

For each round, Kizuki gathers:

- the passages the concept was confirmed with, then passages that search finds for your explanation and answers, up to {@link lib/sessionFlow!MAX_SESSION_PASSAGES | MAX_SESSION_PASSAGES} ([Passages and sentences](./passages-and-sentences.md));
- every sentence of those passages, labeled `S1`, `S2`, and so on;
- under each passage, your corrections ("Your correction: “…” should be “…”") and your answers to "what does this mean?" questions;
- what you wrote so far, and the questions already asked.

{@link lib/teach!TEACH_SYSTEM | TEACH_SYSTEM} tells the model to compare the details you wrote with the material first (places, numbers, names, directions, causes, and results), then look for missing ideas, then vague words, and to ask at most {@link lib/limits!MAX_QUESTIONS | MAX_QUESTIONS} questions.

## The three kinds of question

The model replies in the shape {@link lib/teach!teachReplySchema | teachReplySchema}: for each question a kind, a sentence label, and words copied from what you wrote. It never writes the question. {@link lib/teach!renderQuestion | renderQuestion} writes it from a fixed template:

| Kind | On the page | Template |
| --- | --- | --- |
| contradiction | Does this fit? | `Page 4 of ch1.pdf says: “…” You wrote: “…”. How does that fit?` The "You wrote" part appears only when those words pass the check against your own text; otherwise it ends `How does that fit with what you said?` |
| gap | Something you left out | `Page 4 of ch1.pdf says: “…” Where does that fit in your explanation?` |
| unclear | Say more | `What do you mean by “…”?` |

{@link lib/teach!validateTeachReply | validateTeachReply} is the guard. A contradiction or gap question survives only if its label points at a real sentence that passes the quote check. An unclear question survives only if its words appear word for word in your own explanation and answers, in at most 6 words. An unclear question that points at a sentence but not at your words becomes a gap question. It drops questions that repeat an earlier one and questions that quote text you corrected, and keeps at most {@link lib/limits!MAX_QUESTIONS | MAX_QUESTIONS}. The page says how many questions were dropped.

If search found nothing for what you wrote and no question survived, the round says **"Not in your material"** and Kizuki asks nothing. With no passages at all, {@link lib/teach!askQuestions | askQuestions} returns that answer without asking the model.

## Your answers

For each question you can write an answer. A "Does this fit?" question also needs one of three choices:

- **The material is right. I got this wrong.** Counts as a miss, so the session is not clean.
- **The material is wrong.** You write the correct version, and it becomes a correction that wins from then on. See [When you and the material disagree](./conflicts.md).
- **Neither: Kizuki misread what I wrote.** No miss and no correction.

## What you missed

{@link lib/teach!askMisses | askMisses} builds the list in two parts, using only the concept's own passages, so points from other topics never appear:

1. Plain code first: every sentence whose meaningful words you barely used, meaning less than {@link lib/teach!MISS_COVERAGE | MISS_COVERAGE} of them appear in what you wrote ({@link lib/words!coverage | coverage}), least covered first.
2. Then any sentences the model lists in the shape {@link lib/teach!missesReplySchema | missesReplySchema}.

{@link lib/teach!validateMisses | validateMisses} keeps only real sentences that pass the quote check, drops repeats and sentences you corrected, and keeps at most {@link lib/limits!MAX_MISSES | MAX_MISSES}. You tick the ones you missed; only those count.

After an unclean session, the page names the concepts this one needs first that have no clean session yet ({@link lib/views!weakPrerequisites | weakPrerequisites}), as the likely reason. You can also record a **catch**, something Kizuki caught that you would have gotten wrong on an exam ({@link lib/commands!recordCatch | recordCatch}). The Today and History pages count catches per week, against a goal of one a week.
