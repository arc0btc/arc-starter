## 2026-06-24T02:25:00.000Z — stale worktree cleanup; MCP idle timeout 600s; compliance renames; 131 skills / 82 sensors

**Task #19814** | Diff: 6ca863f → afd71f6 (3 structural commits) | Sensors: 82 | Skills: 131

### Changed files

- `skills/arc-housekeeping/cli.ts` (afd71f6) — Stale worktree cleanup added to `runFix()`. Detects dirs in `.worktrees/` older than 6h, removes via `git worktree remove --force` + `git branch -D dispatch/<name>`. Closed detect-without-fix gap: sensor detected stale worktrees but fix command never removed them. Verified cleanup of 3 accumulated worktrees (5–21 days old).
- `src/dispatch.ts` (d80ccc49) — `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=600000` added to dispatch subprocess env. v2.1.187 introduced a 5-min idle abort for tool calls receiving no data. arc-mcp x402 payments and Stacks transactions can exceed 5min under network latency — spurious aborts were a risk. Distinct from `MCP_TOOL_TIMEOUT=120000` (total call timeout).
- `skills/whop/cli.ts`, `skills/x402-pull-loop/cli.ts` (665fb8a1) — Pre-commit hook compliance renames (`msg→message`, `res→fetchResponse`). No behavioral change.

### Step 1 — Requirements

- **Stale worktree cleanup**: Valid fix. The sensor already detected stale worktrees; the fix command was a stub. Adding removal closes the pipeline. The 6h threshold is appropriate — dispatch cycles run up to 30min, so any worktree >6h old is definitively orphaned. `--force` flag required because orphaned worktrees may have a working tree without a clean state.
- **MCP idle timeout**: Valid. v2.1.187 introduced a new code path that aborts idle tool calls. Arc's blockchain operations legitimately sit idle mid-call while waiting for network responses. Setting 600s (10min) aligns with the `MCP_TOOL_TIMEOUT=120000` pattern established at 7f3fdefc. Worth documenting the two-timeout contract: `MCP_TOOL_TIMEOUT` = max total call duration; `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` = max silence within a call.
- **Compliance renames**: Valid. Pre-commit hook enforcement; no behavioral change.

### Step 2 — Delete

No new deletion candidates from this diff. 3rd-carry items now warrant follow-up tasks rather than carry-watching:

- **[3RD-CARRY → FOLLOW-UP]** Dead import `recentTaskExistsForSource` in `arc-skill-manager/sensor.ts` — create a targeted fix task.
- **[3RD-CARRY → FOLLOW-UP]** `social-x-posting -- reply` CLI passthrough — create deprecation task.
- **[3RD-CARRY → FOLLOW-UP]** `social-engine/*.ts` migration scripts (005–011) in skill dir — create relocation task.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git — add `.gitignore` entry.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

### Step 3 — Simplify

- Worktree cleanup: implementation is clean. Branch name assumption `dispatch/<name>` matches the worktree naming convention in `src/dispatch.ts`. The `git branch -D` after `git worktree remove` handles the residual tracking branch. One minor fragility: if branch name doesn't match (e.g., non-standard worktree), `branch -D` silently fails — acceptable, the worktree itself is gone.
- MCP timeout: single env var, no structural change.

### Step 4 — Accelerate

- Stale worktree cleanup: frees disk space and git state. More importantly, accumulated worktrees could cause `git worktree add` failures if branch names collide on future dispatch cycles.
- MCP idle timeout: direct false-failure reduction for blockchain tasks. Prevents a class of spurious failures that would consume ARC-0011 retries.

### Step 5 — Automate

- Stale worktree pipeline now automated end-to-end. No additional automation needed.

### Flags

- **[RESOLVED]** Detect-without-fix gap for stale worktrees — closed afd71f6 ✓
- **[ACTION-NEEDED]** Dead import `recentTaskExistsForSource` — 3rd carry, create fix task.
- **[ACTION-NEEDED]** `social-x-posting -- reply` passthrough — 3rd carry, create deprecation task.
- **[ACTION-NEEDED]** `social-engine/*.ts` migration scripts (005–011) — 3rd carry, create relocation task.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` in git — add `.gitignore` entry.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm.

---

## 2026-06-23T14:22:00.000Z — whop state-aware dedup; dispatch-gate credential refactor; social-engine monitors; x402-pull-loop relocated; 131 skills / 82 sensors

**Task #19755** | Diff: 0a6d7ff → 6ca863f (6 structural commits) | Sensors: 82 | Skills: 131

### Changed files

- `src/db.ts` (3054e64b) — `getTaskStatusForSource()` added: returns most-recent task status for a source key (or null). Enables state-aware dedup — callers can distinguish in-flight (pending/active) from terminal (completed/failed/blocked) without a second query.
- `skills/whop/sensor.ts` + `skills/whop/cli.ts` (3054e64b) — `pollWhopReplies()` now branches on `getTaskStatusForSource()` result: terminal tasks emit "already_replied", in-flight tasks emit "already_queued". Fixes the 116-tick/0-task anomaly (all showing `already_queued` when they were actually `already_replied`). `debug-reply-dedup` CLI added for diagnosing message dedup state.
- `src/dispatch-gate.ts` (5d7c44e5) — `loadDiscordToken()` refactored from `execFileSync(bash, [...])` subprocess with hardcoded `/home/dev/.bun/bin/bun` path to `await getCredential("discord", "bot_token")` import. Eliminates subprocess spawn overhead and fragile path hardcoding.
- `skills/social-engine/monitor-post-lane.ts`, `monitor-reply-lane.ts`, `north-star-gauge.ts` (7497edbe, 6b221794) — observability monitoring scripts for post/reply lanes and north-star KPI. Not sensor.ts files — CLI-invoked, not auto-executed.
- `skills/x402-pull-loop/SKILL.md` + `cli.ts` (7a669968) — relocated from loose `skills/x402-pull-loop.ts` at skills root to proper `skills/x402-pull-loop/` skill directory. **[RESOLVED]** carry-watch from 2026-06-23T02:30Z audit.
- `.gitignore` (f0086f37) — `*.bak` and `*.bak-*` added. **[RESOLVED]** carry-watch; also covers the `admission.ts.bak-m0p0b` naming convention used by social-engine.
- Cache files + web assets — non-structural.

### Step 1 — Requirements

- **`getTaskStatusForSource()`**: Valid. The binary `pendingTaskExistsForSource()` was insufficient for surfacing accurate skip reasons — the anomaly (116 ticks/0 tasks) required distinguishing why tasks were being skipped. The new primitive is narrow (SELECT status + ORDER BY id + LIMIT 1) and correctly exposes the most recent terminal state.
- **`loadDiscordToken()` refactor**: Valid simplification. The `execFileSync` approach spawned a shell process for a simple credential read — fragile, path-dependent, and inconsistent with how every other credential read in the codebase works.
- **`debug-reply-dedup` CLI**: Valid. Diagnose-ability is a prerequisite for operating a dedup-gated lane. One-liner output per message in the current window.
- **Social-engine monitors**: Valid. Active production system; monitoring scripts are correct additions.
- **x402-pull-loop relocation**: Valid compliance fix. The 4-file skill pattern is required for pre-commit lint coverage.

### Step 2 — Delete

- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `skills/arc-skill-manager/sensor.ts` (line 4): imported but only appears in string literals/regex — never called as a function in this file. Remove from import on next edit.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — still present; remove or deprecate once social-engine reply lane confirmed stable.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — still in skill dir vs `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git (`arc.sqlite`, `arc.sqlite-shm`, `arc.sqlite-wal`). No `.gitignore` entry for `skills/arc-architecture-review/db/` — add it. SQLite binaries are binary, volatile, and should not be versioned.

### Step 3 — Simplify

- `getTaskStatusForSource()` follows the same pattern as existing db.ts query helpers. Correctly narrow. No simplification needed.
- `loadDiscordToken()` is now simpler — one await, no subprocess, no hardcoded path. Pattern is correct. Replicate this pattern if any other `execFileSync(bash,["credential-read"])` calls exist in src/.
- `debug-reply-dedup` is a diagnostic CLI, not a sensor. Correct placement.

### Step 4 — Accelerate

- `loadDiscordToken()` refactor: removes a subprocess spawn (~8s timeout path) from the auth-alert code path. Minor but directionally correct.
- State-aware dedup: the anomaly (116 ticks/0 tasks from `already_queued` labeling) was inflating reactive-lane skip counters but not blocking real work. Fix clarifies signal, no throughput change.

### Step 5 — Automate

- `skills/arc-architecture-review/db/` sqlite files: one `.gitignore` line prevents recurrence. Follow-up task warranted.

### Flags

- **[RESOLVED]** `skills/x402-pull-loop.ts` at skills root → `skills/x402-pull-loop/` with SKILL.md ✓
- **[RESOLVED]** `*.bak` / `*.bak-*` added to `.gitignore` ✓
- **[CARRY-WATCH]** `skills/arc-architecture-review/db/*.sqlite*` tracked in git — add to `.gitignore`.
- **[CARRY-WATCH]** Dead import `recentTaskExistsForSource` in `skills/arc-skill-manager/sensor.ts` — remove on next edit.
- **[CARRY-WATCH]** `social-x-posting -- reply` CLI passthrough — remove or deprecate.
- **[CARRY-WATCH]** `social-engine/*.ts` migration scripts (005–011) — relocate to `db/migrations/`.
- **[CARRY-WATCH]** context-review skip list ~18 entries — refactor at >20.
- **[CARRY-WATCH]** whop-sales P10/P11 requires operator confirm before `WHOP_SALES_DRY_RUN=false`.

---

## 2026-06-23T02:30:00.000Z — Discord auth alert; retry watchdog; P4 reply hardening; $9 tripwire; reply-copy-pool; 132 skills / 84 sensors

**Task #19703** | Diff: c42bf23 → 0a6d7ff (5 auto-commits) | Sensors: 84 | Skills: 132

[Earlier entries archived — see previous archive files for 2026-06-22 and before]
