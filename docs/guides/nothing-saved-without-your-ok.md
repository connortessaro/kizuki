---
title: Nothing is saved without your OK
---

# Nothing is saved without your OK

Everything the model proposes stays a proposal until you confirm it. The logs record proposals, but Kizuki only teaches, reviews, and counts what you confirmed.

| Proposal | Where you decide | Until you confirm |
| --- | --- | --- |
| Concepts (`concept.proposed`) | The course page, under each file, and the concept page | Not taught, not reviewed, not linked |
| Prerequisite links (`link.proposed`) | The course page | Ignored by the review schedule and the concept page |
| What you missed (`session.missesProposed`) | The end of a session | Only the items you tick count as misses |

## Concepts

On the course page each proposed concept shows its name and the sentences behind it. You can:

- **Confirm** it ({@link lib/commands!confirmConcept | confirmConcept}), or confirm every proposal from a file at once.
- **Rename** it ({@link lib/commands!renameConcept | renameConcept}): 1 to 120 characters, and no other proposed or confirmed concept in the course may have that name, ignoring case and a leading "the", "a", or "an".
- **Merge** it into another concept of the same course ({@link lib/commands!mergeConcept | mergeConcept}). The target keeps its name and gains the other's quotes, and sessions on the merged concept count for the target. Kizuki refuses a merge that would make a concept need itself through the confirmed links.
- **Drop** it ({@link lib/commands!dropConcept | dropConcept}). It stays in the logs and is never used.

Only confirmed concepts can start a session ({@link lib/commands!startSession | startSession}) or get a review date ({@link lib/schedule!planReviews | planReviews}).

## Links

After you press "Done reviewing: suggest links" for a file, the model proposes links among the course's confirmed concepts. {@link lib/links!validateLinkReply | validateLinkReply} drops links to unknown concepts, links that were already proposed, confirmed, or dropped, and links that would make a loop ({@link lib/links!wouldCreateLoop | wouldCreateLoop}). You confirm or drop each one. {@link lib/commands!confirmLink | confirmLink} checks for a loop again and writes while holding the write lock, so two links confirmed at the same moment cannot make a loop together.

## Misses

At the end of a session the page lists sentences you may have missed, each with its source. You tick the ones you missed and press "Finish session". {@link lib/sessionFlow!endSession | endSession} records the ticked ones as confirmed and the rest as rejected, and only confirmed misses make the session unclean.

## Settings

Settings never start sending your material to a server off your computer without your OK. Before saving settings that would, the form needs a ticked box saying you understand ({@link lib/model!sendsMaterialOut | sendsMaterialOut}). See [Local models and host checks](./local-models.md).

## Pauses that wait for you

The background jobs stop and wait for your decision instead of guessing. The file workflow pauses after proposing concepts, under the name from {@link lib/tokens!materialReviewToken | materialReviewToken}. A session pauses for each round's answers ({@link lib/tokens!sessionAnswersToken | sessionAnswersToken}) and for your misses ({@link lib/tokens!sessionReviewToken | sessionReviewToken}). The form actions resume these pauses. If Kizuki was restarted and a pause is gone, the actions finish the work themselves or start a new run that skips what the logs show is done.
