# Kizuki onboarding — founding cohort

A shared checklist for getting you set up. We work through it together on the
onboarding call, then settle into a weekly rhythm.

## Before the call

- Jot down the three moments you most often find out about too late (a client
  going quiet, a decision waiting on you, a commitment you forgot).
- Note which sources hold your real work: Outlook mail and calendar, GitHub,
  Jira/Confluence, Slack, meeting transcripts.

## The onboarding call (about 45 minutes)

1. **What you're drowning in.** Your top few "found out too late" moments. This
   is what we tune Kizuki to catch.
2. **Source selection.** Pick three to five:
   - Outlook (mail + calendar)
   - GitHub
   - Jira/Confluence
   - Meeting transcripts
   - Slack, where your workspace allows it
   Google mail/calendar support is on the roadmap; founding members influence
   the order.
3. **Pack.** Founder or Consultant — whichever matches how you work. We
   configure it to your entities and the questions you care about.
4. **Install and hosting.** Choose one:
   - A dedicated instance we run for you, or
   - Your own infrastructure (your machine or your cloud); we set it up with you.
5. **Access.** Read-only, delegated grants for each source, nothing broader.
   Kizuki never writes back to a source system.
6. **First sync.** Connect one source live and look at the first analysis
   together, so you see what it produces before the call ends.

## First week

- **Day 1:** all sources connected, first full sync, we review the output
  together.
- **Each morning:** `kizuki start` runs a sync and gives you a brief on what
  changed and what needs attention.
- **End of day:** `kizuki stop` writes a short day summary.
- **Weekly review call:** we go through what it caught, what it missed, and tune
  the Pack.

## Recording catches

When Kizuki surfaces something that mattered — a slip it caught before it bit, or
a decision you would have missed — record it:

```bash
kizuki catch "client X went quiet, caught it before the renewal call"
```

This is how we both know it's earning its place. We review your catches on the
weekly call; they decide whether the setup is working for you.

## What Kizuki never does

- Never sends a message or takes an action for you. Observe and advise only.
- Runs on your own instance. We don't want your data.
- On exit, you can delete everything, anytime.
