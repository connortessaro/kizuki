---
title: Storage and privacy
---

# Storage and privacy

Everything Kizuki knows about your study lives in one folder on your computer. There is no account, no cloud copy, and no data in the app's own folder.

## The data folder

{@link lib/paths!kizukiHome | kizukiHome} picks the folder: `KIZUKI_HOME` if set, otherwise `~/.kizuki`. The `kizuki` command's `--home` option sets `KIZUKI_HOME` for the app. The default folder is hidden on purpose: on macOS, `~/Kizuki` would be the same folder as a `~/kizuki` clone of the repo, because folder names there ignore letter case. {@link lib/paths!homePaths | homePaths} lays out the rest:

| Path | Holds |
| --- | --- |
| `files/` | Copies of the files you added, named `<materialId><ending>` |
| `data/*.jsonl` | The logs. They are the truth. |
| `data/.lock` | The lock file that makes writers take turns |
| `index.sqlite` | The search file, rebuildable from the logs at any time |
| `settings.json` | Model settings. API keys are never saved here, only the names of the variables that hold them. |
| `workflow-data/` | The Workflow SDK's record of background runs |

To back up your study data, copy the folder.

## The logs

Each log is a `.jsonl` file: one event per line, and lines are only ever added. {@link lib/paths!LogName | LogName} names the logs, and {@link lib/events!LOG_SCHEMAS | LOG_SCHEMAS} holds the shape of every event:

| Log | Events |
| --- | --- |
| `courses.jsonl` | courses and exam dates |
| `materials.jsonl` | each file's progress, from added to done or failed |
| `passages.jsonl` | every passage of a file, written once after reading |
| `concepts.jsonl` | proposed, confirmed, renamed, dropped, and merged concepts |
| `links.jsonl` | proposed, confirmed, and dropped links |
| `sessions.jsonl` | each session: your explanation, questions, answers, misses, and result |
| `corrections.jsonl` | your corrections, and "what does this mean?" questions with your answers |
| `catches.jsonl` | catches you recorded |

{@link lib/log!appendLog | appendLog} checks every event against its shape before it writes, and writes nothing if one fails. It writes while holding the lock ({@link lib/lock!withLock | withLock}). A lock left by a process that stopped is taken over; waiting more than 30 seconds for a live one is an error that names the process. {@link lib/log!withWriteLock | withWriteLock} holds the lock across a check and a write, so no other write can come between them.

{@link lib/log!readLog | readLog} reads a log oldest first. A line that is not valid JSON, or does not match its shape, stops the read with an error naming the file and line number; Kizuki never skips a line. If Kizuki stopped halfway through writing a line, the error says so and tells you to delete that last line. The next write after such a stop starts on a new line, so only the half-written line is lost.

{@link lib/state!reduceState | reduceState} rebuilds the current state from the logs. It is pure: the same logs always give the same state. Every page reads the logs fresh ({@link lib/pageData!loadPageData | loadPageData}).

Kizuki creates `files/` and `data/` as folders only your user can open (mode 700), and the files it writes there and `settings.json` as files only your user can read (mode 600).

## What leaves your computer

With the default settings, nothing. Kizuki sends requests only to the model servers in your settings. With a hosted model, those requests carry your material's sentences, your corrections, and what you wrote in sessions; Kizuki asks for your OK before settings that do this take effect. See [Local models and host checks](./local-models.md) and the "Requests Kizuki sends" section of the HTTP reference.

The dashboard loads no scripts, fonts, or pictures from other sites. The kizuki.dev site, which hosts these docs, is separate from the app and never sees your data.

## Other things Kizuki keeps

- Messages from form actions are kept in memory only, at most {@link lib/messages!MAX_MESSAGES | MAX_MESSAGES}, and a restart forgets them.
- `lib/ids.ts` makes ids: {@link lib/ids!stableId | stableId} for things found in a file, so reading it again gives the same ids, and {@link lib/ids!newId | newId} (random) for everything else. Neither holds personal data.
- Tests use temporary folders, never your data folder.
