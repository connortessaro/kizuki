# Vigil — Future Notes (speculative)

Status: **not validated. Do not build any of this before Task 8 passes.**
Task 8 = run `./sync <real-teammate>` on the work machine with real codex + MCP,
and answer: *does the output tell me something I didn't know, or hand me a draft
worth sending?* Everything below is contingent on that being "yes." These are
notes to think against, not a roadmap.

---

## 1. Monetization thesis: open-core, TEE-hosted

**Verdict from strategy pass:** plain open-core freemium (OSS CLI + vanilla paid
hosting) is structurally weak for the CLI alone — no moat (~200 lines,
rebuildable in a weekend), and normal hosting *contradicts* the tool's one
differentiator (data is internal work info + transcripts; the reason it's local
is so org intel never leaves).

**The fix that makes it cohere: the hosting is confidential (TEE).** That turns
the privacy contradiction into the paid moat:

- Give away the commodity CLI (OSS) — distribution / top-of-funnel.
- Sell the managed service whose value is *managed convenience WITHOUT giving up
  confidentiality* — the part that's genuinely hard to replicate and that a
  security team will actually approve.

This reuses the Phantom edge (TEE + attestation as the "silent closer") and
slots into the YC confidential-execution wedge.

### Buy-not-build stack
- **Phala Cloud** — deploy the app inside a TEE.
- **RedPill** — TEE LLM inference with attestation (for the confidential-inference
  requirement below).
- Both are top-up-the-account, not build-from-scratch. This is why the
  confidential version is achievable fast rather than being a ground-up startup.

### Hard requirement: confidential inference, not just confidential hosting
Vigil's processing IS an LLM call. If the enclave calls a normal LLM API
(OpenAI/Anthropic), the org data leaves the enclave to the model provider and
attestation is theater. The model must run inside the boundary (RedPill / a
confidential-compute GPU endpoint). This is non-negotiable for the promise to be
real.

### Moat, stated honestly
If confidential compute is a commodity you rent, a copycat rents the same
Phala + RedPill. So TEE is **differentiation vs non-confidential competitors +
our speed/credibility**, NOT exclusivity vs a copycat. Real defensibility =
product + distribution + trust brand + shipping-it-correctly-first. Don't
overclaim "we have the enclave, they don't."

### Due-diligence items (resolve before banking on this)
1. **Attestation must chain across two enclaves.** App (Phala) + inference
   (RedPill) = two hops. Customer wants ONE receipt proving end-to-end
   confidentiality. Confirm RedPill returns attestation we can chain + surface.
2. **RedPill model quality vs the Task-8 bar.** Value = quality of "what they
   don't know / draft this." If RedPill serves only smaller/OSS models, we trade
   confidentiality for weaker insight — which hits the exact acceptance test.
   Check which models RedPill serves. (OPEN — flagged to investigate.)
3. **Token custody.** Hosted = we hold the customer's Slack/GitHub/Atlassian/
   Outlook OAuth tokens to run MCP pulls. TEE protects processing; "who holds our
   tokens, at what scope, stored where" is a separate security-review
   conversation. Attestation helps but doesn't answer it alone.
4. **Cost.** TEE inference > commodity API → enterprise pricing, not cheap
   prosumer hosting. Kills any low-margin prosumer hosted tier.

---

## 2. Enterprise plan (expanded)

The CLI is single-operator. The payable product is the **team / org-graph**
version — deferred multiplayer. Enterprise is where the money is; the OSS CLI is
the funnel.

### Tiers (draft)
- **Free — OSS CLI (self-run).** Single operator, local vault, bring-your-own
  codex + MCP. No support. Purpose: distribution, credibility, dogfooding funnel.
- **Team — managed, TEE-hosted.** Shared org-graph across a team (people /
  projects / teams as shared state, not one person's local vault). Confidential
  inference. Per-seat pricing. Convenience + "your security team approves it."
- **Enterprise.** Team + the controls that clear procurement:
  - SSO / SAML, SCIM provisioning
  - RBAC (who sees which people/projects/teams in the graph)
  - Audit log of every sync + who read what
  - **Attestation receipts** — exportable proof that data was processed
    confidentially (the compliance/legal closer)
  - Data residency / retention controls
  - Deployment choice: TEE-managed by us, OR customer self-hosted in their own
    Phala tenancy for the most paranoid buyers
  - SLA + support

### Motion
- Bottom-up: individual adopts OSS CLI → wants team to share it → team tier.
- The conversion trigger to watch: "I want my team to see this too." That is the
  single metric that matters for whether the team product is real.
- Enterprise close is security-review-led: don't pitch "TEE," pitch "managed
  org-intelligence your security team will actually sign off on." Attestation
  wins the review, not the demo.

### Open product questions for the team version
- Shared graph = new privacy surface. If everyone's org-intel pools, who sees
  whose "what they don't know" analysis? RBAC design is load-bearing and could
  make or break trust internally.
- Multiplayer reintroduces the exact privacy objection the local CLI avoided —
  TEE hosting is what buys it back. So Team tier and TEE hosting are coupled;
  can't ship shared-graph on vanilla cloud.
- Frontmatter/org-graph gap (UAT finding #1): the pipeline never populates
  role/team/manager/stakeholders/members. The team product NEEDS a real
  structured org graph, so that gap becomes must-fix here (it's fine for the
  solo CLI).

---

## 3. Sequencing (non-negotiable order)
1. **Task 8** — validate the insight matters at all (solo CLI, real codex+MCP).
2. **Team demand** — landing page for the *team* version; measure single-player
   → "I want my team on this." Interview 3-5 coworkers/teams on willingness to
   pay to share it.
3. **TEE hosting + enterprise** — only after 1 and 2. Wire Phala/RedPill,
   resolve the four due-diligence items, build shared graph + RBAC + attestation
   receipts.

Do not invert. Do not wire Phala before step 1 is a yes. (Concord lesson:
scaffolded before a validating team existed.)
