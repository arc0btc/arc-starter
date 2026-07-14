---
id: dead-ends-convention
topics: [memory, architecture, blocker-resolution, dead-ends]
source: task:17905
created: 2026-05-29
---

# Dead-Ends vs MEMORY.md Convention

## Two distinct registries

**`memory/dead-ends.md`** — APPROACH-level dead-ends (JSONL, machine-readable)
> "When attempting `<approach>` in context of `<topic>`, it fails because `<why>`. Do `<alternative>` instead."

Loaded at dispatch start when `task.subject` or `task.skills` overlaps a topic. Used to skip known-bad approaches before spending tokens re-discovering them. One entry per failed approach, not per situation.

**`MEMORY.md [A] Active Items`** — SITUATION-level operational context
> Items Arc needs as live context during any dispatch cycle — policy flags, budget state, active escalations Arc can still act on.

## What belongs where

### Goes in dead-ends.md (approach-level)
- A specific approach that failed and has a better alternative
- A tool/API behavior Arc will rediscover without this entry (e.g., `gh pr reviews` silent exit 1)
- The "do X instead of Y" rule

### Stays in MEMORY.md [A] (situation-level)
- Global policy all cycles need: `signal-filing-paused`, model routing changes
- Active budget/resource state: x402 signal budget, wallet balance flags
- Recently escalated items (<14 days): still might get a response
- Items where Arc might take a NEW autonomous action (not just waiting)

### Moves from MEMORY.md [A] to a 1-liner pointer
When ALL of the following are true:
1. Item has been in [A] for **>14 days** without progress
2. Resolution requires human action (whoabuddy outreach, external policy decision)
3. Escalation has already been sent (task closed, email sent, etc.)
4. A `dead-ends.md` entry exists for the autonomous-resolution approach

**Migration steps:**
1. Add/verify a `dead-ends.md` JSONL entry: `{"topic":"...", "approach":"Autonomous resolution of <topic>", "why_failed":"<situation + who must act>", "date":"...", "source_task":"..."}`
2. Collapse the [A] entry to: `**topic** [DEAD-END, dead-ends.md:<topic>] <one-liner status>. Awaiting <who>.`
3. Commit as `chore(memory): migrate stale blocker to dead-ends`

## Resolved items

Remove from [A] entirely when:
- Status changed to RESOLVED or COMPLETE
- Keep a 1-liner in MEMORY.md [P] Patterns or [E] Evaluations if there's a lesson, otherwise drop it

## Sweep schedule

- **Per-task close**: if closing as `failed` with "requires whoabuddy direct outreach" AND item has been in [A] > 7 days → migrate immediately
- **Monthly consolidation**: scan all [A] items for >14-day stale threshold, migrate eligible ones

## Current state (2026-07-14, audit #22547)

Still open, no autonomous path — kept in dead-ends.md:
- `amber-otter` (cred exposure, escalated 2026-05-22, no autonomous path)
- `payout-disputes` (stale since 2026-04-26, "requires whoabuddy direct outreach")
- `wallet-rotation` (awaiting whoabuddy policy decision since 2026-04-24)
- `signal-filing` → kept as 1-liner POLICY flag (affects all cycles)

Pruned as RESOLVED (2026-07-14, #22547):
- `loom-spiral` — root cause fixed via redesign, not resumption. `arc-workflows` state machine is now structurally loom-spiral-proof (see `state-machine.ts` comments + `skills/daily-brief-inscribe/AGENT.md` token-budget guard).
- `pr-511` — aibtc-mcp-server PR #511 closed 2026-05-17 (not merged); no longer an open blocker to re-review.

## Related

- [[prompt-caching-exclude-dynamic]] — context budget discipline
- [[harness-engineering-five-subsystems]] — CLAUDE.md Lost-in-Middle risk (why [A] bloat is costly)
