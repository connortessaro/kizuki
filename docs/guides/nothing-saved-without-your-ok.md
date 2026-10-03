---
title: Nothing is saved without your OK
---

# Nothing is saved without your OK

Everything the model proposes stays a proposal until you confirm it. The logs record proposals, but Kizuki only teaches, reviews, and counts what you confirmed.

| Proposal | Where you decide | Until you confirm |
| --- | --- | --- |
| Concepts (`concept.proposed`) | `/review` | Not taught, not reviewed, not linked |
| Prerequisite links (`link.proposed`) | `/review`, after the concepts | Ignored by the review schedule |
| What you missed (`session.missesProposed`) | The end of a session | Only the items you tick count as misses |

Every decision is a pick list above the input. Arrow keys move, space ticks or unticks, and Enter saves. Esc stops and saves nothing from that list.

## Concepts

`/review` lists the course's proposed concepts, each with the place in your material it comes from. All start ticked. Enter confirms the ticked ones ({@link lib/commands!confirmConcept | confirmConcept}) and drops the rest ({@link lib/commands!dropConcept | dropConcept}). A dropped concept stays in the logs and is never used.

After you confirm a concept, you can change it with a command:

- `/rename old name = new name` ({@link lib/commands!renameConcept | renameConcept}): 1 to 120 characters, and no other proposed or confirmed concept in the course may have that name, ignoring case and a leading "the", "a", or "an".
- `/merge one into other` ({@link lib/commands!mergeConcept | mergeConcept}): the target keeps its name and gains the other's quotes, and sessions on the merged concept count for the target. Kizuki refuses a merge that would make a concept need itself through the confirmed links; remove one of the two concepts' links with `/links` first, then merge.
- `/drop name` asks once more, then drops the concept. Keeping it changes nothing.

Only confirmed concepts can start a session ({@link lib/commands!startSession | startSession}) or get a review date ({@link lib/schedule!planReviews | planReviews}).

## Links

Once you have decided on a file's concepts, `/review` asks the model for links among the course's confirmed concepts ({@link lib/run!finishMaterialReview | finishMaterialReview}). {@link lib/links!validateLinkReply | validateLinkReply} drops links to unknown concepts, links that were already proposed, confirmed, or dropped, and links that would make a loop ({@link lib/links!wouldCreateLoop | wouldCreateLoop}). The next list shows each link as "A needs B first", all ticked. {@link lib/commands!confirmLink | confirmLink} checks for a loop again and writes while holding the write lock, so two links confirmed at the same moment cannot make a loop together. Later, `/links` lists the course's confirmed links, all ticked; untick one and press Enter to remove it ({@link lib/commands!dropLink | dropLink}).

## Misses

At the end of a session Kizuki lists sentences you may have missed, each with its source, all unticked. You tick the ones you missed and press Enter. {@link lib/sessionFlow!endSession | endSession} records the ticked ones as confirmed and the rest as rejected, and only confirmed misses make the session unclean.

## Models off your computer

Kizuki never starts sending your material to a server off your computer without your OK. When `/model` would switch to such a server, Kizuki asks first, in plain words. Saying yes sets `sendOutAllowed` in the settings. {@link lib/settings!writeSettings | writeSettings} refuses to save settings that send material out ({@link lib/model!sendsMaterialOut | sendsMaterialOut}) unless `sendOutAllowed` is set, so the check holds in code, not only on the screen. See [Models](./local-models.md).

## Waiting for you

A file stops after proposing concepts and waits in status `review` until you use `/review`. A session waits for each round's answers and for your misses. These pauses are states in the logs, not running jobs, so quitting loses nothing: {@link lib/run!resumeUnfinished | resumeUnfinished} picks up the work next time, and `/teach` on the same concept offers to continue an open session.
