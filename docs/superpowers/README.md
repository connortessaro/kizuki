# Design records

One spec per feature, dated, written before the code. They record *why* a thing
was built the way it was — the constraint, the options considered, the decision.

Where a spec and the code disagree, the code is right. These are a history of
decisions, not current documentation.

## What used to be here

Each spec originally had a matching implementation plan: a task-by-task
checklist of the work. Those are gone. They were 448 KB across 18 files — more
than twice the size of the specs — and they recorded sequencing that the git log
already shows, in more detail and less accurately. A 64 KB checklist for one
feature documents process, not design.

The specs stayed because the reasoning in them is not recoverable from the
commits.
