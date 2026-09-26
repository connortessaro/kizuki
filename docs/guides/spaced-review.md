---
title: Spaced review
---

# Spaced review

Kizuki brings a concept back for review on a schedule that grows while your sessions on it stay clean. {@link lib/schedule!planReviews | planReviews} works it out in plain code, with no model, from the logs every time a page loads.

## The rule

- A concept is due the day you confirm it.
- A **clean** session doubles the wait: 1, 2, 4, 8, 16, 32 days, then {@link lib/schedule!MAX_GAP_DAYS | MAX_GAP_DAYS} at most. The streak counts clean sessions in a row since the last unclean one.
- An unclean session (a confirmed miss, or "the material is right" on a "Does this fit?" question) brings the concept back the next day and resets the streak.
- The date counts from the calendar day the last session ended, in your computer's time zone ({@link lib/schedule!localDate | localDate}).

## Prerequisites

A concept is **blocked** while any concept it needs first (a confirmed link to a confirmed concept) has never had a clean session. The Today page lists blocked concepts with what they wait on. After an unclean session, the session page names those weak prerequisites ({@link lib/views!weakPrerequisites | weakPrerequisites}) and suggests teaching them first.

## Exam dates

Set an exam date on a course page ({@link lib/commands!setExamDate | setExamDate}). While the exam is today or later, a review that would fall after the day before the exam moves to the day before the exam, or to today if that day has passed.

## Merged concepts

Sessions on a concept that was later merged count toward the concept it was merged into ({@link lib/views!reviewPlans | reviewPlans} follows merges with {@link lib/state!resolveConceptId | resolveConceptId}).

## Where it shows

{@link lib/views!todayView | todayView} builds the Today page's three lists from the plans: due now (today or earlier), coming up, and blocked, each sorted by date. The concept page shows "Due now.", "Next review …", or "Waiting on …", and the streak. A clean session's result says when the concept comes back.

Each plan ({@link lib/schedule!ReviewPlan | ReviewPlan}) holds the due date, the status, the streak, the current wait in days, and what blocks it.
