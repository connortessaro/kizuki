# Security Policy

## Supported versions

Kizuki is pre-1.0. Only the latest published version receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |
| < 0.1   | no        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately through GitHub:

1. Go to the [Security tab](https://github.com/connortessaro/kizuki/security/advisories/new).
2. Open a draft security advisory.

If private reporting is unavailable, email **hello@kizuki.dev** with `SECURITY` in
the subject.

Please include the version or commit, your platform and Node version, steps to
reproduce, and the impact you believe it has.

### What to expect

- Acknowledgement within **3 business days**.
- An initial assessment within **10 business days**.
- Credit in the advisory and release notes, unless you ask otherwise.

This is a solo-maintained project, so these are best-effort targets, not a
commercial SLA.

## Threat model

Kizuki is a **local-first, single-operator** tool. Understanding its boundaries
tells you what counts as a vulnerability.

Design guarantees, and therefore in scope:

- **Observe and advise only.** Kizuki never sends messages, never mutates a
  source system, and never acts on your behalf. Anything that breaks that is a
  security bug.
- **The vault stays local.** Entity files and the append-only JSONL ledgers live
  on your disk in a git repository you control. Kizuki has no telemetry and no
  phone-home.
- **The daemon is loopback-only.** The local HTTP API binds `127.0.0.1` and
  requires a bearer token from `state/daemon.json` (mode `0600`, 32 random
  bytes). Authentication is checked before routing, using a timing-safe compare.
- **Path safety.** Entity names are validated before they reach the filesystem;
  traversal attempts are rejected.
- **Writes are serialized.** All vault mutations take `state/vault.lock`.

Especially interesting to us: path traversal in entity names, daemon auth
bypass, token leakage into logs, prompt content escaping the vault, and anything
that causes Kizuki to take an action rather than describe one.

### Out of scope

- **Your AI agent provider.** Kizuki spawns whatever CLI or HTTP endpoint you
  configure in `kizuki.config.json`. Prompt content goes to that provider under
  their terms. Choosing an untrustworthy provider is not a Kizuki vulnerability.
- **Content of the vault.** Kizuki records what you feed it. Putting secrets into
  a transcript and syncing it is a workflow problem, not a Kizuki bug.
- Attacks requiring an already-compromised local user account or root.
- Vulnerabilities in dependencies with no exploitable path in Kizuki. Report
  those upstream; tell us if Kizuki's usage makes them reachable.

## Handling your own data

The vault directories (`people/`, `projects/`, `teams/`, `transcripts/`,
`days/`, `state/`, `signals/`, `insights/`, `alerts/`, `catches/`, `events/`)
and `kizuki.config.json` are gitignored by default. Keep it that way. If you
fork this repository for your own vault, verify with `git status` before every
push, and never force-add those paths.
