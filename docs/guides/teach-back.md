---
title: Teach-back sessions
---

# Teach-back sessions

In a session you explain a confirmed concept without notes. Kizuki plays a curious student: it asks about what does not match your material, what you left out, and vague words you used. Every question about the material quotes it.

## The steps

1. `/teach osmosis` starts a session on a confirmed concept. `/teach` alone picks the first concept due in the course and names it.
2. **Recall first.** Kizuki shows the concept's name and nothing from your material. You explain from memory, because recalling beats explaining with the page open (see [How people learn](./how-people-learn.md)). {@link lib/commands!startSession | startSession} refuses a concept you have not confirmed and an empty explanation, and records `session.started`.
3. For up to {@link lib/limits!MAX_ROUNDS | MAX_ROUNDS} rounds, Kizuki chooses questions ({@link lib/sessionFlow!runRound | runRound}) and shows them one at a time, each with its numbered source. After the last question of a round you pick "Send and keep going" or "Send and finish"; the last round always finishes. The session stops early when a round has no questions.
4. Kizuki proposes what you may have missed ({@link lib/sessionFlow!proposeMisses | proposeMisses}) and waits until you tick the ones you missed.
5. {@link lib/sessionFlow!endSession | endSession} ends the session. It is **clean** only if you confirmed no misses and never answered "the material is right" to a "Does this fit?" question. Clean or not decides the next review date (see [Spaced review](./spaced-review.md)).
6. Kizuki says when the concept comes back, then lists the passages it used, in full, under "Now read the material". You read the material after recalling it, not before.

{@link lib/run!continueSession | continueSession} moves a session to the next point where it waits for you, and {@link lib/run!answerRound | answerRound} saves a round's answers and moves on. Where a session stands comes from {@link lib/state!SessionStatus | SessionStatus}: thinking, answering, reviewing, ended, or failed. If you quit in the middle, `/teach` on the same concept asks whether to pick it up where you left off or stop it and start over. A model error marks the session failed, and Kizuki prints the message and asks you to start a new one.

## Ask again until clean

After a session with misses, Kizuki asks "Explain it again now, from memory?" Yes starts another try at the same concept, again with the material hidden. {@link lib/commands!startRetry | startRetry} records it as a new session that points back at the first try. Kizuki offers tries until one comes back clean or you say no, at most {@link lib/limits!MAX_TRIES | MAX_TRIES} tries counting the first.

Only the first try sets the schedule. A first try with misses brings the concept back the next day, even if a later try in the same sitting is clean. Later tries are practice: they show in `/history` as "another try" and never make the next review later.

## What the model sees

For each round, Kizuki gathers:

- the concept's passages plus search matches ([which ones, and how many](./passages-and-sentences.md));
- every sentence of those passages, labeled `S1`, `S2`, and so on;
- under each passage, your corrections ("Your correction: “…” should be “…”") and your answers to "what does this mean?" questions;
- what you wrote so far, and the questions already asked.

{@link lib/teach!TEACH_SYSTEM | TEACH_SYSTEM} tells the model to compare the details you wrote with the material first (places, numbers, names, directions, causes, and results), then look for missing ideas, then vague words, and to ask at most {@link lib/limits!MAX_QUESTIONS | MAX_QUESTIONS} questions.

## The three kinds of question

The model replies in the shape {@link lib/teach!teachReplySchema | teachReplySchema}: for each question a kind, a sentence label, and words copied from what you wrote. It never writes the question. {@link lib/teach!renderQuestion | renderQuestion} writes it from a fixed template:

| Kind | Meaning | Template |
| --- | --- | --- |
| contradiction | Does this fit? | `Page 4 of ch1.pdf says: “…” You wrote: “…”. How does that fit?` The "You wrote" part appears only when those words pass the check against your own text; otherwise it ends `How does that fit with what you said?` |
| gap | Something you left out | `Page 4 of ch1.pdf says: “…” Where does that fit in your explanation?` |
| unclear | Say more | `What do you mean by “…”?` |

{@link lib/teach!validateTeachReply | validateTeachReply} is the guard. A contradiction or gap question survives only if its label points at a real sentence that passes the quote check. An unclear question survives only if its words appear word for word in your own explanation and answers, in at most 6 words. An unclear question that points at a sentence but not at your words becomes a gap question. It drops questions that repeat an earlier one and questions that quote text you corrected, and keeps at most {@link lib/limits!MAX_QUESTIONS | MAX_QUESTIONS}. Kizuki says how many questions were dropped.

If search found nothing for what you wrote and no question survived, the round says **"Not in your material"** and Kizuki asks nothing. With no passages at all, {@link lib/teach!askQuestions | askQuestions} returns that answer without asking the model.

## Your answers

For each question you can write an answer; Enter with nothing typed skips it. A "Does this fit?" question first shows a pick list of three choices, and {@link lib/sessionFlow!recordAnswers | recordAnswers} refuses a round where one has no choice:

- **The material is right. I got this wrong.** Counts as a miss, so the session is not clean.
- **The material is wrong.** You write the correct version, and it becomes a correction that wins from then on. See [When you and the material disagree](./conflicts.md).
- **Neither: Kizuki misread what I wrote.** No miss and no correction.

## What you missed

{@link lib/teach!askMisses | askMisses} builds the list in two parts, using only the concept's own passages, so points from other topics never appear:

1. Plain code first: every sentence whose meaningful words you barely used, meaning less than {@link lib/teach!MISS_COVERAGE | MISS_COVERAGE} of them appear in what you wrote ({@link lib/words!coverage | coverage}), least covered first.
2. Then any sentences the model lists in the shape {@link lib/teach!missesReplySchema | missesReplySchema}.

{@link lib/teach!validateMisses | validateMisses} keeps only real sentences that pass the quote check, drops repeats and sentences you corrected, and keeps at most {@link lib/limits!MAX_MISSES | MAX_MISSES}. You tick the ones you missed; only those count.

After an unclean session, Kizuki names the concepts this one needs first that have no clean session yet ({@link lib/views!weakPrerequisites | weakPrerequisites}), as the likely reason. You can also record a **catch**, something Kizuki caught that you would have gotten wrong on an exam: `/catch <note>` saves it for the last session that ended ({@link lib/commands!recordCatch | recordCatch}). `/history` counts catches over the last 8 weeks.
