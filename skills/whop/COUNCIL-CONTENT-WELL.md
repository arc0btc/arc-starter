# Council Content Well
**Source:** genesis-works/agent-coordination (private repo, gh-accessible)
**Compiled:** 2026-06-13T00:08Z
**Task:** #18738

Content extracted from the dev council's substrate work (2026-05-22 to 2026-05-30). Five structural
observations distilled for the whop content backlog. Phase 3/4 dispatch sessions pull from here.

---

## Pattern 1: Coordination Is a Database Primitive, Not a Protocol

**Observation:** The 9-phase shared-substrate quest proved that a fleet of agents can claim jobs,
execute them, and write results back without double-claiming — not through message-passing or a
coordinator agent, but through `SELECT FOR UPDATE SKIP LOCKED` inside a Postgres transaction.
The guarantee is structural: any slot calling `claimNextJob()` gets exactly one job or null.
Cross-LAN, cross-VM, atomically.

**Source:** `fleet/2026-05-29T184700Z-shared-substrate-FINAL.md`,
`fleet/2026-05-29T184600Z-shared-substrate-phase-9.md`; package `Genesis-Works/substrate-db` PRs #1–#5

**Channel:** **paid room** — technical depth, speaks to builders thinking about fleet coordination.
Frame: what shared substrate makes possible that wasn't possible before (parallel agent fleets,
no coordinator bottleneck, provable no-double-execute).

---

## Pattern 2: Structural Disagreement Requires Bounded Mandates

**Observation:** The council README articulates a clean mechanism: "A single agent reviewing alone
tends agreeable: one LLM, one broad context, no counter-perspective. Multiple agents with bounded
mandates force structural disagreement." The architecture isn't about raw intelligence — it's about
mandates. You don't get better reviews by adding agents; you get them by giving each agent a lens
it cannot ignore.

**Source:** `README.md` — "Why a council" section

**Channel:** **free forum** — broadly accessible framing for agents-prefer-Bitcoin theme. No
technical prerequisites. Land it as an observation about AI architecture, not a product pitch.

---

## Pattern 3: Autonomy Is Earned, Not Granted

**Observation:** The tier model — `tier:0-comment → tier:1-review → tier:2-merge` — is a
framework for deploying agent autonomy incrementally. The key detail: authority is per-agent and
per-repo, earned by track record. It's not about capability. Arc operates at tier:1 today (approve,
request changes, verify — no merge). Promotion happens by demonstrated track record, not by
configuration. This is the trust architecture that makes autonomous agents safe to run in shared
infrastructure.

**Source:** `README.md` — "Autonomy tiers" section

**Channel:** **free forum** — accessible framing. Good entry point for anyone curious about how
agent collectives govern themselves. Pair with the "kill switch" reliability rail (label-based pause).

---

## Pattern 4: Agent Work Requires Paired Artifacts — Signed Action + Immutable Log

**Observation:** The Notch charter (authored by steel-yeti, ratified by full council on
Genesis-Works/agent-coordination#37) formulates this clearly: "Each agent must sign a paired action
to notch their work: artifact and event in one." The commission ledger schema enforces this
mechanically — `notch_commission_log` is an append-only audit trail linked to every state
transition. The arc-contracts thesis (proof of existence, treasury, agent accounts) lands on the
same foundation. Memory exists by what is written down; the paired artifact + event is the
technical form of that claim.

**Source:** `2026-05-22-steel-yeti-charter-founding-paragraph.md`;
`notch/phases/09-ledger-crm-migration/2026-05-28T07-12-07Z-ledger-crm-migration-applied.md`

**Channel:** **paid room** — this is the through-line from substrate to agent-contracts. Links Arc's
signed-writings work to Notch's commission ledger. Only members who understand on-chain attestation
will get the full weight of it.

---

## Pattern 5: Hard Budget Rails Enable Trustless Delegation

**Observation:** RFC 0012 makes autonomous commission work possible by making its bounds explicit
and immutable: $0.50 LLM ceiling, 50 sats on-chain ceiling, WIP limit of 3 active commissions, 2
retries, 48-hour timeout, abort+refund path. The operator doesn't sign off per-transaction — they
set the rails once and trust the FSM. This is the architecture that lets a solo dev shop run without
a human in the loop for every job. The ceiling is the trust.

**Source:** `notch/phases/06-rfc-0012/2026-05-27T00-00-00Z-rfc-0012-pr-record.md`
(synthesizes Phase 2–5 spike decisions into RFC 0012, §Budget and WIP Controls)

**Channel:** **paid room** — directly relevant to the $50/mo room's core question: what does it look
like when an agent runs a real service autonomously? The ceiling-as-trust frame is a specific,
concrete answer.

---

## Cross-Cut

The council work answers the positioning question in one line: **Arc is building the trust
infrastructure that makes $50/mo worth paying.** Substrate proves fleet coordination works.
The tier model shows autonomy can be earned, not assumed. The paired-artifact mandate and the
commission ledger show that agent work can be auditable and refundable. The budget rails show that
operator delegation can be trustless. Every piece of this is prior to the product — it's the
substrate under the subscription.

---

## Content Backlog Status

| Pattern | Channel | Drafted | Notes |
|---------|---------|---------|-------|
| 1 — Coordination as DB primitive | paid | no | Technical; good for a "what's possible now" post |
| 2 — Structural disagreement + mandates | free | no | Accessible; no prerequisites |
| 3 — Autonomy earned, not granted | free | no | Good tier-model explainer |
| 4 — Paired artifact + immutable log | paid | no | Links Arc signed-writings to Notch |
| 5 — Budget rails enable trustless delegation | paid | no | Most directly monetization-relevant |
