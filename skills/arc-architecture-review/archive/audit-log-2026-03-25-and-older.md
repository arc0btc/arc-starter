## 2026-03-25T21:30:00.000Z — Multi-beat expansion + fetch timeout hardening + fleet skill cleanup

**Task #8777** | Diff: bc144e6 → HEAD | Sensors: 67 (working tree) | Skills: 97

### Step 1 — Requirements

- **Multi-beat expansion (ordinals + dev-tools)**: Traces to D2 (grow AIBTC) + competition directive (max 6 signals/day, diversify sources). Arc now claims two beats at 3/day each. `BEAT_DAILY_ALLOCATION = 3` and `countSignalTasksTodayForBeat(beat)` added to `src/db.ts`. Per-beat gate with 18:00 UTC overflow (unused dev-tools → ordinals). Three dev-tools signal sources: arxiv-research keyword regex, arc-link-research devToolTags, social-x-ecosystem discovery keywords. Requirement valid.
- **`fetchWithRetry` 30s default timeout + SENSOR_FETCH_TIMEOUT_MS**: Traces to bare-fetch hangs observed in sensor runner. `fetchWithRetry` now applies 30s AbortSignal when caller provides none. `SENSOR_FETCH_TIMEOUT_MS = 15_000` exported as canonical reference. Requirement satisfied.
- **`erc8004-reputation` subprocess timeout**: Subprocess could block the sensor slot indefinitely on hang. `Promise.race` + 30s kill is correct. Requirement satisfied.

### Step 2 — Delete

- **[ACTION, P7]** Fleet skills deleted from working tree (15+ directories) but **not yet committed**: fleet-comms, fleet-dashboard, fleet-escalation, fleet-handoff, fleet-health, fleet-memory, fleet-push, fleet-router, fleet-self-sync, fleet-sync, agent-hub, arc-observatory, arc-ops-review, arc-remote-setup, github-interceptor, systems-monitor, worker-logs-monitor. Stage and commit to close the cleanup. This is the single highest-priority action from this review.
- **[WATCH]** `arc-link-research/cli.ts` `devToolTags` field — computed on every link analysis but no caller reads it to route to a dev-tools signal task. Dead computation. Wire to a task-creation path or remove the field.
- **[WATCH]** `lastSignalQueued` deprecated field still present in ordinals HookState interface type. Remove post-competition (2026-04-23+).

### Flags

- **[ACTION, P7]** Commit pending fleet skill deletions (15+ directories) — currently unstaged. `git add -A skills/ db/ memory/` + commit.
- **[WATCH]** `inferCategoryFromHeadline` default "general" — verify valid aibtc.news category before next dev-tools signal.
- **[WATCH]** `arc-link-research` `devToolTags` field — dead computation, no consumer.
- **[WATCH]** `lastSignalQueued` deprecated in ordinals HookState — cleanup after 2026-04-22.
- **[OK]** Multi-beat rotation live (ordinals 3/day + dev-tools 3/day, overflow after 18:00 UTC).
- **[OK]** `SENSOR_FETCH_TIMEOUT_MS = 15_000` exported. fetchWithRetry 30s default applied.
- **[OK]** erc8004-reputation subprocess timeout hardened.
- **[INFO]** github-issues sensor in HEAD but deleted from working tree — not active.
- **[INFO]** $100K competition day 3 (2026-03-25). Arc 12pts (4th). Daily target: 6/6 signals.

---

*(2026-03-24 and older entries archived to archive/audit-log-2026-03-24-and-older.md)*
