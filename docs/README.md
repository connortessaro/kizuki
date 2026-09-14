# Docs

## Engineering

Start here. These describe how the system actually works and were written to be
read by someone evaluating the code.

| Doc | What it covers |
|---|---|
| [`interview-walkthrough.md`](interview-walkthrough.md) | A five-minute tour of the whole system, then the questions it invites and where to look for each answer. |
| [`performance.md`](performance.md) | Three measured optimisations, including one deliberately *not* made. Every number is reproducible from a committed benchmark. |
| [`data-quality.md`](data-quality.md) | The checks that guard the warehouse, and a worked root-cause case where an ambiguous schema made the model answer confidently and wrongly. |
| [`2026-06-30-kizuki-design.md`](2026-06-30-kizuki-design.md) | The original design of the vault and sync pipeline the data plane was built on. |
| [`BRAND.md`](BRAND.md) | Visual and voice guidelines for the mark and the dashboard. |

## Product

[`product/`](product/) holds the product and go-to-market thinking — positioning,
roadmap, pricing, launch material. It is kept deliberately and separated just as
deliberately, so the engineering docs above are what you hit first.

## Design records

[`superpowers/`](superpowers/) holds dated design specs and implementation plans,
one pair per feature. They are a record of how decisions were made rather than
current documentation; where a spec and the code disagree, the code is right.
