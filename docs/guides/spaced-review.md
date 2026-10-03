---
title: Spaced review
---

# Spaced review

Kizuki brings a concept back for review on a schedule that grows while your sessions on it stay clean. {@link lib/schedule!planReviews | planReviews} works it out in plain code, with no model, from the logs every time Kizuki needs it.

## The rule

- A concept is due the day you confirm it.
- A **clean** session doubles the wait: 1, 2, 4, 8, 16, 32 days, then {@link lib/schedule!MAX_GAP_DAYS | MAX_GAP_DAYS} at most. The streak counts clean sessions in a row since the last unclean one.
- An unclean session (a confirmed miss, or "the material is right" on a "Does this fit?" question) brings the concept back the next day and resets the streak.
- The date counts from the calendar day the last session ended, in your computer's time zone ({@link lib/schedule!localDate | localDate}).
- Only first tries count. Another try in the same sitting, after misses ({@link lib/commands!startRetry | startRetry}), is practice and never moves the next review ({@link lib/views!reviewPlans | reviewPlans} leaves it out).

## Prerequisites

A concept is **blocked** while any concept it needs first (a confirmed link to a confirmed concept) has never had a clean session. `/due` lists blocked concepts with what they wait on. After an unclean session, Kizuki names those weak prerequisites ({@link lib/views!weakPrerequisites | weakPrerequisites}) as the likely reason.

## Exam dates

Set an exam date with `/exam 2026-12-15`, or clear it with `/exam none` ({@link lib/commands!setExamDate | setExamDate}). While the exam is today or later, a review that would fall after the day before the exam moves to the day before the exam, or to today if that day has passed.

## Merged concepts

Sessions on a concept that was later merged count toward the concept it was merged into ({@link lib/views!reviewPlans | reviewPlans} follows merges with {@link lib/state!resolveConceptId | resolveConceptId}).

## Where it shows

{@link lib/views!todayView | todayView} builds three lists from the plans: due now (today or earlier), coming up, and blocked, each sorted by date. `/due` prints them for the current course, and Kizuki prints them at start. The line under the input shows how many concepts are due. `/concepts` shows "due now", "next …", or "waiting on what it needs" for each concept. Every session's result says when the concept comes back.

Each plan ({@link lib/schedule!ReviewPlan | ReviewPlan}) holds the due date, the status, the streak, the current wait in days, and what blocks it.
