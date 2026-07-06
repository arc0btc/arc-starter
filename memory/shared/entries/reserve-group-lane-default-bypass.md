---
id: reserve-group-lane-default-bypass
topics: [social-x-posting, content-calendar, arc-posting-scheduler, kill-switch, reserve-group]
source: task:21393 (root-cause of content-calendar thread posting out-of-window at 2026-07-06T01:02Z)
created: 2026-07-06
---

# reserve-group `--lane` default = 'post' silently drops a managed lane's window (FIXED)

**Incident (2026-07-06T01:02Z, task #21164):** the memory-papers content-calendar thread
(`content-calendar:2026-07-03-what-agent-memory-papers-...`, outbound_action ids 94-97) posted
at 01:02 UTC — OUTSIDE content-calendar's 15:00-18:00 window — with `lane='post'` and
`earliest/latest_utc_time = NULL`.

**Cause:** task #21164 carried pre-P3 instructions (from #21158's era, before the
`reserve-group` requirement). Its agent hit the newly-added managed-lane refusal
(`reservation_required` on legacy direct-post of `content-calendar:*`, added 2026-07-05T18:59Z),
so it improvised `reserve-group` **without `--lane content-calendar`**. In `cmdReserveGroup`,
`let lane = flags["lane"] ?? "post"` defaulted to the windowless `post` lane. `admitGroup` then
reserved the whole thread into `post` (NULL/NULL window = anytime), and the drain posted it
immediately. `cmdPost`'s fail-closed prefix guard can't catch this — the group HAD a reservation,
just in the wrong lane. This was the **first** content-calendar thread ever routed through
reserve-group (all 11 prior threads used the legacy direct-post path; `outbound_action` had zero
`lane='content-calendar'` rows, ever).

**Fix (committed ff2a49d8, 2026-07-06T02:42Z — same batch, ~1h40m after the incident):**
`cmdReserveGroup` now DERIVES lane from the source-key prefix, not caller flags:
`content-calendar:` → lane=content-calendar + window 15:00-18:00; `daily-read:` → 13:00-14:00.
It OVERRIDES a mismatched caller `--lane`/window (logs the override) and REFUSES mixed-prefix
groups (`mixed_lane_group`). Principle: **the lane a managed source key belongs to is a fact of
the KEY, not a caller opinion** — same principle as cmdPost's `MANAGED_LANE_SOURCE_PREFIX` refusal.

**Separate still-open finding from the same audit:** `outbound_enabled=false` (kill switch, since
2026-06-23) did NOT block this send, nor ANY of the 12 content-calendar threads posted daily
06-27..07-06. The three kill-switch guards (admitGroup admission since 06-19; legacy-post since
06-27; reserve-group drain since 07-05) all read `agent_config.outbound_enabled` yet none gated
this lane in the running system. Mechanism unproven from static evidence — candidates: relative-path
DB target `new Database("db/arc.sqlite")` at src/db.ts:250 (cwd-dependent,
[[p-bash-cwd-persistence-wrong-db-target]]); on-disk code diverging from git HEAD during the P2/P3
`.bak`-swap window; legacy guard blocking only on exact `"false"` (passes on missing row). Filed
as task #21395. A kill switch that doesn't kill is a latent safety failure. See
[[deferred-task-cross-day-owning-row]] for how the owning task was located.
