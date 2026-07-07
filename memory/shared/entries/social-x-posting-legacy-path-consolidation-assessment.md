---
id: social-x-posting-legacy-path-consolidation-assessment
topics: [social-x-posting, architecture, dispatch-queue, tech-debt]
source: task:21521
created: 2026-07-07
---

# Assessment: consolidate cmdPost onto the engine (reserve-group) path only

**Trigger**: legacy path in `skills/social-x-posting/cli.ts::cmdPost` needed its own
independent fail-closed kill-switch fix (commit 38a60953) after the engine path
(`social-engine/admission.ts`) already had one — the two guard stacks drifted and had
to be patched twice for the same invariant.

## Current state

`cmdPost` has three branches:
1. **Engine fast path** — `--source` matches an `outbound_action` row (admitted via
   `reserve-group`). Used by `content-calendar` and `daily-read` (both migrated in P3
   arc-posting-scheduler). Dedup/kill-switch/budget/window all enforced atomically at
   admission + re-checked at drain.
2. **Fail-closed refusal** — `--source` matches `^(content-calendar|daily-read):` but
   has no `outbound_action` row → hard refuse (P3 fix, prevents silent fallthrough).
3. **Legacy guard stack** — everything else: independent kill-switch check, its own
   `DAILY_TWEET_CAP` counter (now correctly reading `budget_ledger` cross-lane, but as
   a *second* enforcement point, not the same code as `admitGroup()`'s backstop),
   daily-read root-post reservation gate, `checkBudget("posts")` + link-post budget,
   `planned_posts` deferred-row write on budget exhaustion, and its own 403 backoff.

**Only two live callers still hit branch 3**: `skills/whop-sales/sensor.ts` (GTM
acquisition quest posts, `quest:gtm:recurring:acquisition:*`) and
`skills/social-x-posting/sensor.ts`'s own cadence beat (`sensor:x-cadence:*`, gated by
`X_CADENCE_ENABLED`). Mentions/replies never touch `cmdPost` — separate lane via
`social-engine/reply-send.ts`.

**Dead code found during this assessment**: the content-calendar x_thread daily-cap
block inside branch 3 (`isContentCalendarXThreadRoot`, cli.ts ~line 977) is
unreachable — any `content-calendar:*` source either matches branch 1 (has a
reservation, returns before reaching branch 3) or branch 2 (refused, process exits).
Should be deleted regardless of the consolidation decision below.

## Recommendation

**Consolidate is worth it, but scope it as "migrate the last two callers to
reserve-group," not "delete the legacy path this cycle."** The legacy path carries
real behavior with no engine-side equivalent yet (link-post soft cap,
`planned_posts` auto-defer, daily-read root-reservation gate) — deleting it outright
would silently drop those. Concretely:

1. File a follow-up: migrate `whop-sales` GTM posts and the x-cadence beat to call
   `reserve-group` before `post`, same pattern content-calendar/daily-read already use.
2. Once both are migrated, extend the `MANAGED_LANE_SOURCE_PREFIX` fail-closed refusal
   to cover `quest:gtm:` and `sensor:x-cadence:` too (closes the loop — no more silent
   fallthrough possible for ANY known source shape).
3. At that point branch 3 only serves truly-unmigrated/ad-hoc `--source` values (or
   none) and becomes a candidate for outright deletion in a later pass, with its
   link-budget/planned_posts/daily-read-reservation logic either ported into
   `admission.ts` or intentionally dropped with sign-off.
4. Delete the dead CC cap block (item above) independent of the rest — zero risk,
   zero dependency.

Doing the full migration in one shot is a 2-3 file change (whop-sales/sensor.ts,
social-x-posting/sensor.ts, cli.ts's refusal regex) — bounded, sonnet-sized, not
opus. The risk is behavioral parity for GTM posts (they don't currently set a
lane/window, so `reserve-group` defaults need checking) — worth a dedicated task
rather than folding into this assessment.

See [[reserve-group-lane-default-bypass]] for the prior incident where a missing
`--lane` flag on `reserve-group` silently defaulted wrong — the same gotcha applies
to any new caller added here.
