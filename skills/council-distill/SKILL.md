---
name: council-distill
description: Periodic refresh of council/coordination patterns from the fleet-digest into the source-artifact pool. 24h baseline + content-hash fast-path skip.
updated: 2026-08-14
tags:
  - inflows
  - content
  - council
---

# council-distill

Pulls the latest fleet-coordination patterns from the control plane's fleet-digest (delivered by
`manage-agents` `skills/fleet-digest/generate.ts`, landing at
`skills/council-distill/fleet-digest/latest.md`) and writes up to 5 ISO8601 nuggets into
`artifacts/distilled/council/`. Consumers use these for paid-room synthesis (premium context),
reactive replies (topic-matched), and the X `agent-philosophy` beat (14d window).

## Source repoint (2026-07-17)

Originally watched `Genesis-Works/agent-coordination` (a private GitHub repo — the old
cross-agent-coordination hub). That repo was RETIRED as a coordination channel in favor of
direct-to-dispatch (still exists, un-deleted, but nothing new lands there) — the sensor reported
"nothing new" forever (control-plane-remediation audit defect row 49). It now watches a local file
delivered by the control plane instead: `manage-agents` (a separate repo the Arc VM cannot
push/pull — VM-local commits only) runs a read-only SSH sweep of every agent VM's task activity
and `scp`s the result here after every run. No `gh` call, no network dependency, no GitHub
credential needed for this sensor at all.

## Cadence + freshness

24h sensor floor (`INTERVAL_MINUTES = 1440`). Each tick:

1. `sha256(skills/council-distill/fleet-digest/latest.md)` (cheap, local, no network).
2. Compare to `hookState.lastSeenDigestHash`.
3. If hash unchanged AND `hookState.lastDistillAt` is < 7 days old → skip without queuing.
4. If hash unchanged AND stale (≥7d), queue one more distill pass and bump
   `hookState.sameHashRepeatCount`. If the hash is *still* unchanged on the next stale cycle
   (`sameHashRepeatCount` reaches 2, ~14d of a stuck control plane), escalate instead of queuing
   again — see "Stale-digest escalation" below.
5. If hash changed → queue a refresh task and reset `sameHashRepeatCount` to 0.

This belt-and-braces approach gives daily freshness when the control plane has delivered a new
digest, and silences the sensor when nothing's changed.

## Stale-digest escalation (2026-08-14, #26184)

Fixed a loop where an unchanged digest got re-distilled every 7 days indefinitely (task #26180)
— re-queuing recycled the same month-old quotes under a fresh timestamp, risking duplicate
content across whop-chat/blog/x. Now: after 2 consecutive would-be-distill cycles with an
unchanged hash (~14d of the control plane not delivering anything new), the sensor emits one
`[ESCALATED]` blocked task to whoabuddy and applies a 48h cooldown (`hookState.failureCooldownUntil`),
instead of silently re-triggering. A genuinely new digest hash always resumes normal cadence
automatically — no manual reset needed for that path. Manual reset (clear
`sameHashRepeatCount` in `db/hook-state/council-distill.json`) is only for the "control plane
paused deliberately" case.

## Missing-digest tracking

A missing/unreadable `fleet-digest/latest.md` increments `hookState.consecutiveMissingDigest`. At
≥3 consecutive misses, the sensor emits a single `[ESCALATED]` blocked task to whoabuddy and
applies a 48h cooldown (sets `hookState.failureCooldownUntil`). Counter resets on the next
successful read. Aligns with MEMORY [P] "blocked external dependency: 3+ consecutive → 48h
cooldown" (same shape as the old `gh`-failure handling; new failure mode is "control plane hasn't
delivered a fresh digest yet", not an API failure).

## Gates

- `COUNCIL_DISTILL_ENABLED=true` — master gate.
- `COUNCIL_DISTILL_DRY_RUN=false` (cleared 2026-07-17, control-plane-remediation Phase 3) — the
  task writes artifacts into the pool AND updates `skills/whop/COUNCIL-CONTENT-WELL.md`.

`ARC_DISTILL_FORCE=1` bypasses `COUNCIL_DISTILL_ENABLED` for manual ticks (`COUNCIL_DISTILL_DRY_RUN`
is now live by default and no longer needs a bypass).

## Topic taxonomy (fixed)

The five council patterns — now interpreted against live fleet-digest content rather than
Genesis-Works-specific historical material:

- `coordination-primitive` — the fleet's live coordination mechanism (direct-to-dispatch,
  sensor/task patterns visible in the digest)
- `mandate-loop` — self-review / retrospective loops visible in a host's task chain
- `autonomy-tier` — per-host status/service tiers (legacy-arc-starter vs base-agent-runtime)
- `paired-artifact` — the digest + this sensor's narration IS itself a paired-artifact pattern
- `budget-rail` — cost/budget discipline visible in recent task activity

The dispatched session writes one nugget per topic OR fewer (skipping topics with no genuine match
in the current digest). 0-5 nuggets per tick; quality over quota.

## Quality bar

- ≤ 1200 chars per nugget (enforced by `writeDistilled`).
- Direct quotes from the digest + 1-sentence framing. Selection, not paraphrase.
- Citation: short pattern name + digest timestamp (e.g. `fleet-digest:2026-07-17T035539Z`).

## Channels

Each nugget routes to: `["whop-chat", "blog", "reactive", "x"]`. The X `agent-philosophy` beat
reads council on a 14-day window — slower than arxiv but slower-moving content. Reactive lane
surfaces a nugget when a member's question topically matches.
