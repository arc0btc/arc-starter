## 2026-03-16T21:33:00.000Z

5 findings: 0 error, 1 warn, 4 info → **HEALTHY**

**Codebase changes since last audit (07:00Z 2026-03-16, commits b6d343b → 441474e):**

- **External watchdog added** (`src/external-watchdog.ts` + `arc-watchdog.service/timer`): Runs independently on its own 15-min systemd timer. Reads `cycle_log` directly via SQLite; sends email to whoabuddy if no cycle in >2h with pending tasks. Critically independent from sensors/dispatch — survives dispatch service death. State: `db/hook-state/external-watchdog.json`.
- **`dispatch-watchdog` sensor** (10min): Complements external watchdog. Detects stalls >95min, writes structured incident to `memory/topics/incidents.md`, creates P2 alert task (deduped per stall event). Runs inside sensors service, so only operates when sensors are up.
- **`credential-health` sensor** (60min): Validates ARC_CREDS_PASSWORD, iterates all credentials for readability, checks API endpoints (email, Cloudflare). Writes to `memory/topics/integrations.md` on failure + P3 task.
- **`fleet-handoff` skill restored**: Was deleted 2026-03-11 and referenced in CLAUDE.md's GitHub-handoff policy without a real implementation. Now has proper `cli.ts` with `initiate/status/list` subcommands.
- **Budget gate corrected to $200**: `DAILY_BUDGET_USD` was $500 but D4 directive is $200/day cap. Fixed to match directive (commit 441474e).
- **`arc-mcp` deleted**: Superseded by `arc-mcp-server`. Skill directory cleaned. Skill count: 103 → 105 (net +2: dispatch-watchdog, credential-health added; arc-mcp deleted; fleet-handoff restored).
- **`resolveSkillContextAndHashes` refactor**: Reads each SKILL.md once instead of twice (was separate `resolveSkillContext` + `computeSkillHashes` calls). No behavior change; eliminates redundant I/O.
- **Web dashboard header normalization**: All 6 dashboard pages (tasks, sensors, schedule, skills, email, identity) now share consistent header markup per Arc Audit findings.

**5-Step Review (2026-03-16T21:33Z):**

**Step 1 — Requirements:**
- [WARN] Two stall-detection systems now exist: `dispatch-watchdog` sensor (runs in sensors service) and `external-watchdog.ts` (runs in its own systemd timer). The external watchdog was explicitly designed to survive dispatch service death; dispatch-watchdog is only useful when sensors are running. Requirements for both remain valid but they should not duplicate alert logic. Current state: dispatch-watchdog writes to incidents.md (structured memory), external watchdog emails whoabuddy. Complementary, not redundant.
- `credential-health` requirement is valid — Cloudflare token expiry in overnight brief shows a real gap that an earlier sensor would have caught.
- `fleet-handoff` restoration requirement: CLAUDE.md's mandatory GitHub handoff policy was referencing a skill that didn't exist. This was a structural gap; restoration is justified.

**Step 2 — Delete:**
- Nothing deleted this cycle beyond arc-mcp (done).

**Step 3 — Simplify:**
- `resolveSkillContextAndHashes` refactor is correct simplification — eliminates one file-read pass.

**Step 4 — Accelerate:**
- External watchdog fires every 15min and operates independently. Latency for human alert is now 15min worst-case from stall detection vs. prior best-case of waiting for a human to notice.

**Step 5 — Automate:**
- All new sensors follow the correct `claimSensorRun` → dedup → insert pattern. No issues.

**Context delivery audit:**
- All new skill SKILL.md files are under 2000 tokens.
- dispatch-watchdog has no AGENT.md (sensor-only, no agent context needed). Correct.
- credential-health has no AGENT.md (sensor-only). Correct.
- fleet-handoff has no AGENT.md — the CLI is the interface. Correct.

**Sensor count: 79** (was 77 at last audit 07:00Z, +dispatch-watchdog +credential-health)
**Skill count: 105** (was 103, +dispatch-watchdog +credential-health +fleet-handoff-restored -arc-mcp)

---

## 2026-03-16T07:00:00.000Z

3 findings: 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (18:49Z 2026-03-13, commits 1f20f98 → b6d343b):**
- **Memory Architecture V2** (3 commits: 035558d → d20983c): Three-phase implementation of structured memory.
  - Phase 1: Topical file split — `memory/topics/*.md` (fleet, incidents, cost, integrations, defi, publishing, identity, infrastructure). `resolveMemoryContext()` in `src/memory-topics.ts` maps task skills → topic files. Only relevant topics loaded per dispatch, not full MEMORY.md.
  - Phase 2: `arc_memory` FTS5 table added to `src/db.ts` — key/value/domain/importance/TTL structured store. `arc memory search` and `arc memory add` CLI commands added. Retrospective tasks now instructed to also call `arc memory add` for reusable patterns.
  - Phase 3: Wired into dispatch via `resolveFtsMemoryContext()` — injects top-10 importance>=3 FTS entries from relevant domains into every prompt. Phase 3b: FTS CLI `--syntax` flag documenting FTS5 query syntax added.
- **`arc-memory-expiry` skill added** (12348cf): New sensor (1440min) — deletes TTL-expired `arc_memory` entries daily. No task creation; runs inline.
- **`arc-operational-review` skill added**: Self-audit sensor (6h) — surfaces failed tasks with no follow-up, stale blocked tasks, overdue scheduled tasks. Has CLI.
- **`src/dispatch-gate.ts` + `src/services.ts`** (2459747): Auto-persist on Stop — service shutdown now writes final state before exit.
- **`skills/worker-logs-monitor/cli.ts`** (0ca2243): Parse `/apps` response via `.data` field — API response structure fix.

**5-Step Review (2026-03-16T07:00Z):**

**Step 1 — Requirements:** INFO — Memory V2 requirement is well-founded: full MEMORY.md (1600+ lines in MEMORY.md context notes) loaded every dispatch was burning tokens on irrelevant domain context. Topical split + FTS is an appropriate solution to a real problem. `arc-memory-expiry` sensor requirement is valid — FTS entries need TTL enforcement or the table grows unbounded.

**Step 2 — Delete:** INFO — `arc-mcp` and `arc-mcp-server` now coexist as separate skill directories. If they serve identical purposes, one should be deleted. Investigate whether both are actively used or if one is a superseded version. Marking as needs-investigation.

**Step 3 — Simplify:** INFO — `SKILL_TOPIC_MAP` in `src/memory-topics.ts` is a manual maintenance burden — any new skill that touches a domain requires a manual map update. The current fallback (load fleet+incidents default) is reasonable. Consider: could the skill SKILL.md frontmatter declare its domain? That would eliminate the manual map entirely. Not critical now, but the pattern will cause map drift as skills multiply.

**Step 4 — Accelerate:** No bottlenecks introduced. Memory loading is synchronous file reads + one SQLite query — minimal overhead.

**Step 5 — Automate:** Memory V2 was itself an automation step — replacing ad-hoc memory management with FTS + TTL. No additional automation opportunities identified at this time.

**Architecture Assessment:** Healthy. Memory V2 is a meaningful improvement to context efficiency. Two new skills (arc-memory-expiry, arc-operational-review) are correctly scoped. One needs-investigation item: arc-mcp vs arc-mcp-server duplication.

---

## 2026-03-13T18:49:00.000Z

4 findings: 0 error, 1 warn, 3 info → **WARN**

**Codebase changes since last audit (06:47Z 2026-03-13, commits e626519 → 44af48e):**
- **`aibtc-repo-maintenance` toggled off/on** (9c8bf7f → 44af48e): Disabled for creating noise (too broad a scope across aibtcdev repos), then re-enabled per whoabuddy with scope clarified. Net: sensor active, same behavior.
- **`aibtc-dev-ops` simplified** (44af48e): Prod-grade audit checks (tsconfig, tests, release-please) removed. Created false positives on repos where they don't apply. Log review (4h cadence) preserved.
- **`--skills` flag added to `arc tasks update`** (73eb83a): Retroactive skill tagging on any task, including completed ones. Accepts comma-separated skill names, stored as JSON array. Fills the analytics gap where untagged tasks couldn't be categorized.
- **`EmailThreadMachine` retrospective_pending state** (e90a1eb): Pattern analysis found 104 recurrences of arc-email-sync threads without a retrospective step. Retrospective_pending now explicit state — previously ad-hoc follow-up tasks.
- **`blog-publishing` 23h cooldown** (0f51aed): Sensor dedup now blocks re-queue for 23h after completion (not just while pending). Expected 80% token reduction. Already in audit context from memory.

**SpaceX 5-step findings (2026-03-13T18:49Z):**
- **(S1 — Requirements) [WARN]:** `aibtc-repo-maintenance` requires human override to fix scope — the sensor's trigger conditions were broad enough to create noise across repos Arc doesn't own. Pattern: when a sensor needs human intervention to clarify scope, the sensor's selectivity criteria are wrong. Pre-flight check on sensor activation should gate on explicit repo allowlist rather than "all aibtcdev repos". Watch for recurrence.
- **(S2 — Delete) [INFO]:** `aibtc-dev-ops` prod-grade audit removal is correct S2 application. False-positive checks are worse than no checks — they train the system to ignore signals. Removing tsconfig/tests/release-please assertions from a general log-review sensor was the right call. Precedent: prefer narrow sensors that are always correct over broad sensors that are sometimes wrong.
- **(S3 — Simplify) [INFO]:** `EmailThreadMachine` retrospective_pending makes implicit workflow explicit. 104 recurrences of ad-hoc retrospective follow-ups → first-class state. Simplification via formalization. The missing state was generating observable but invisible volume in email-sync costs.
- **(S5 — Automate) [INFO]:** `--skills` retroactive tagging enables analytics automation. Previously, any task created before skill tags were standard was analytically dark. Now correctable post-hoc. Retroactive correction capability is a force multiplier for future audit tooling.

---

## 2026-03-13T06:47:00.000Z

4 findings: 0 error, 1 warn, 3 info → **WARN**

**Codebase changes since last audit (18:46Z 2026-03-12, commits 5a9c34e → e626519):**
- **`aibtc-news-editorial` v2 API migration** (533382e): Auth moved from POST body to HTTP headers (X-BTC-Address, X-BTC-Signature, X-BTC-Timestamp). Snake_case request bodies. cli.ts, SKILL.md, AGENT.md all updated.
- **`aibtc-news-classifieds` v2 API migration** (e626519): Same auth header pattern. `cmdGetInscription` removed (v2 endpoint deleted). Cleaner than v1.
- **`aibtc-news-deal-flow` sensor added** (auto-commit): 5-hook sensor at 60min cadence. Ordinals volume ($2M threshold), sats auctions (50k sat), x402 escrow ($5M), bounty activity, DAO treasury (1 BTC change). Sensors: 74→75.
- **`arc-mcp` skill scaffolded** (69c0fb5): Phase 1 Bun HTTP server on port 3100. Read-only endpoints: /health, /tasks, /tasks/:id, /skills. MCP Phase 1 milestone begun.
- **`arc-payments` CLI added** (bbdc107): Payment inspection and manual scan commands.
- **`arc-cost-reporting` fix** (918791e): Dual cost fields (cost_usd + api_cost_usd) now tracked in all report sections.
- **`SkillMaintenanceMachine` added** (state-machine.ts): New workflow for email-signal→audit→fix pattern. Instance key: skill-maintenance-{skill}-{YYYY-MM-DD}.

**SpaceX 5-step findings (2026-03-13T06:47Z):**
- **(S1 — Requirements) [WARN]:** `aibtc-news-deal-flow` sensor — 2 of 5 hooks (DAO treasury, bounty activity) are permanently-skip until `daoTreasuryContract` / `bountyContract` are set in hook state. These are dead code at deploy time. Before next review, either configure the contracts in hook state or document intended activation timeline. Creating a follow-up task.
- **(S2 — Delete) [INFO]:** `buildAuthHeaders` is now duplicated in both `aibtc-news-editorial/cli.ts` and `aibtc-news-classifieds/cli.ts`. Per CLAUDE.md, two copies is acceptable. A third news skill copying this would warrant a shared `skills/aibtc-news-shared/` module. Watch for the pattern.
- **(S3 — Simplify) [INFO]:** v2 API migration removed legacy body-auth fields cleanly. Breaking endpoint (`cmdGetInscription`) removed rather than shim-preserved. Good precedent — delete over backwards-compat hacks.
- **(S5 — Automate) [INFO]:** `SkillMaintenanceMachine` codifies a previously ad-hoc cycle. The email-signal→audit→fix chain is now a first-class workflow. Pattern extends naturally to dependency-change events beyond email (e.g. sensor detecting API schema change could trigger same machine).

---

## 2026-03-12T18:46:00.000Z

2 findings: 0 error, 0 warn, 2 info → **CLEAN**

**Codebase changes since last audit (06:46Z, commits 08ebb9b → 5a9c34e):**
- **`mempool-watch` skill added** (9ab381e): Sensor-only skill (10min cadence). Two functions: (1) fee spike detection — task when `fastestFee >= 50 sat/vB`, 60min cooldown to prevent spam; (2) Arc BTC address unconfirmed tx watch — task per new mempool tx to `bc1qlezz2...`, seen_txids dedup capped at 500. API: mempool.space (no key). Sensors: 73→74.
- **`arc-cost-alerting` → `arc-cost-reporting`** (e7998c2): Threshold/alert logic removed. New sensor runs every 60min, creates one daily report task (P9 haiku) covering top tasks by cost, top tasks by tokens, top skills by cost, top sensors by cost. Simpler, single-purpose.
- **`stacks-payments` → `arc-payments`** (daa0b40): Renamed. Now watches both STX `token_transfer` and sBTC SIP-010 `contract_call`. Already reflected in prior audit.
- **Web dashboard: sensor schedule page** (171ca77): `/sensors/schedule` with 24h heatmap, sortable schedule table, `/api/sensors/schedule` endpoint. No structural change to sensors/dispatch.
- **Operational commits**: fleet-status, pool-state, patterns.md consolidation — no structural changes.

**SpaceX 5-step findings (2026-03-12T18:46Z):**
- **(S3 — Simplify) [INFO]:** `arc-cost-alerting → arc-cost-reporting` is a good simplification. Threshold tuning was operational overhead; daily reports give the same signal without false urgency. Pattern to follow for other alert sensors.
- **(S2 — Delete) [INFO]:** Inventory still contains 8 "(deleted)" fleet skill entries (fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-exec, fleet-task-sync, fleet-handoff, arc-dual-sdk, arc-roundtable). These were deleted 2026-03-11. Safe to prune from inventory after 30 days (2026-04-11) once no cross-references remain.

## 2026-03-12T06:46:00.000Z

2 findings: 1 error, 0 warn, 1 info → **ACTION REQUIRED**

**Codebase changes since last audit (18:44Z, commits 18072c0 → 08ebb9b):**
- **Skill consolidation** (483d2c7): 10 context-only fleet/infra skills deleted; content moved to `docs/fleet-coordination.md` and `docs/agent-infrastructure.md`. Skill count: 110→100. CLI count: 69→64. **Resolves S2 WARN from 3 consecutive audits.**
- **SESSIONEND hook timeout** (cb544e5): `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS = "30000"` added to dispatch env. Prevents runaway session-end hooks from blocking cycles.
- **blog-deploy fix** (349f3ac): `resolveFnmBinDir` now checks `npm` on PATH instead of `node` — avoids false negatives when node is present but npm isn't symlinked.
- **Memory/state-only commits**: fleet-status, pool-state, zest-v2 health-state — routine operational data, no structural changes.

**SpaceX 5-step findings (2026-03-12T06:46Z):**
- **(S1 — Requirements) [ERROR]:** `tasks.model` is never written by dispatch. `cycleModelLabel` (opus/sonnet/haiku/codex:/openrouter:) is correctly computed at dispatch.ts:700-704 and written to `cycle_log.model`, but `markTaskActive()` and `updateTaskCost()` do not update `tasks.model`. Result: all dispatch-originated tasks have `model = null`. Analytics relying on `tasks.model` are blind. Fix: add `updateTask(task.id, { model: cycleModelLabel })` after `insertCycleLog` at dispatch.ts:713. Follow-up task created.
- **(S2 — Delete) [INFO]:** 10 context-only fleet/infra skills RESOLVED this cycle. Previously flagged in 3 consecutive audits (2026-03-10, 2026-03-11T07Z, 2026-03-11T18Z). No new deletion candidates in this delta.
- **(S1 — Requirements) [RESOLVED]:** `defi-bitflow` vs `bitflow` overlap resolved — both SKILL.md files now contain explicit distinction paragraphs. No longer ambiguous.

## 2026-03-11T18:44:00.000Z

4 findings: 0 error, 2 warn, 2 info → **REVIEW RECOMMENDED**

**Codebase changes since last audit (07:00Z, commits 41bac86 → 18072c0):**
- **Dispatch refactored (circuit breaker → dispatch gate):** `src/dispatch-gate.ts` extracted. On/off switch replaces 15-min half-open circuit breaker. Rate limit → immediate stop + email whoabuddy. 3 consecutive failures → same. No auto-recovery; requires `arc dispatch reset`. Sends email on stop (via arc-email-sync). State: `db/hook-state/dispatch-gate.json`.
- **Dispatch modules extracted:** `src/openrouter.ts` (327 lines), `src/fleet-status.ts`, `src/safe-commit.ts`, `src/models.ts` separated from dispatch.ts. dispatch.ts now 948 lines (was 1,611 at peak, 924 at overnight brief write — minor delta).
- **New skill: aibtc-welcome** (sensor only, 60min): Detects new AIBTC agents from platform user list, sends 100-sat welcome via x402. Interaction-history dedup (skips agents with prior contact). x402 sentinel gate (`db/hook-state/x402-nonce-conflict.json`) blocks all sends when relay nonce is stuck. Sensors: 72→73.
- **4 new state machine templates:** WalletFundingMachine, ContentPromotionMachine, CredentialRotationMachine, PsbtEscalationMachine (from pattern analysis on overnight brief tasks).
- **arc-email-sync:** Thread by subject + message-id storage. Reply dedup checks newest unread (not oldest). 3 bug fixes shipped overnight.
- **fleet-router suspended-worker gate:** Layer-2 offline guard added — tasks for suspended workers are re-routed before any LLM spend.

**SpaceX 5-step findings (2026-03-11T18:44Z):**
- **(S2 — Delete) [WARN]:** 10 "context only" fleet skills flagged in BOTH prior audits (07:00Z and 10T18:45Z) — still not cleaned up: fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-exec, fleet-handoff, fleet-task-sync, arc-roundtable, arc-dual-sdk. This is the third audit flagging the same issue. Escalating to follow-up task.
- **(S1 — Requirements) [WARN]:** `defi-bitflow` vs `bitflow` overlap also flagged in prior two audits — still unresolved. One needs to be canonical. Escalating.
- **(S3 — Simplify) [INFO]:** Dispatch gate is cleaner than the old circuit breaker (no timer-based auto-recovery). The trade: operator must now manually reset. This is the right trade — rate-limit stops deserve human review, not auto-recovery.
- **(S4 — Accelerate) [INFO]:** Worker allowlist logic (13 sensors) is running dead weight while all workers are suspended. No structural problem — sensors just skip. Will clean itself when workers return.

## 2026-03-11T07:00:00.000Z

5 findings: 0 error, 2 warn, 3 info → **REVIEW RECOMMENDED**

**Codebase changes since last audit (18:45Z, commits 07a5471 → 41bac86):**
- **New skills (4):** `agent-hub` (fleet registry + API + sensor), `bitflow` (DEX swaps + pool monitor), `zest-v2` (lending/borrowing + liquidation monitor), `arc-umbrel` (Bitcoin Core RPC + Umbrel node). Skills: 105→109. Sensors: 68→72.
- **Shutdown gate (`src/shutdown.ts`):** `db/shutdown-state.json` now gates BOTH sensors entry and dispatch entry. Clean, symmetric. Exit path: file absent or `enabled:false`.
- **Fleet suspended-agent filtering:** All fleet sensors (fleet-health, fleet-comms, fleet-sync, etc.) skip agents in suspended state. Added resilience during the Anthropic plan suspension.
- **Worker allowlist corrected:** 13 sensors (diagram was wrong: said 10). Added `reputation-tracker`, `erc8004-reputation-monitor` to the set.
- **aibtc-news-editorial:** `fetch-ordinals-data` CLI using Unisat API (replaces deprecated Hiro Ordinals/BRC-20 API shutdown 2026-03-09).
- **arc-reputation sensor:** Tightened match criteria to reduce task volume.
- **arc-email-sync:** Fixed remote overwrite of local read state.

**SpaceX 5-step findings (2026-03-11T07:00Z):**
- **(S1 — Requirements):** `defi-bitflow` AND `bitflow` both exist as DEX skills on Stacks. Purpose overlap unclear — `defi-bitflow` predates `bitflow`. Needs an owner to confirm which is canonical.
- **(S2 — Delete) [WARN]:** 10 "context only" fleet skills still in inventory with no sensor/CLI/agent capability: fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-exec, fleet-handoff, fleet-task-sync, arc-roundtable, arc-dual-sdk. They consume `arc skills` list space and context weight. Consolidate into 1-2 reference docs.
- **(S2 — Delete) [WARN]:** `defi-bitflow` vs `bitflow` — two DEX skill directories. If `bitflow` supersedes `defi-bitflow`, remove or archive the old one.
- **(S3 — Simplify):** `agent-hub` (registry) + `fleet-router` (routing) + `fleet-rebalance` (work-stealing) do overlapping fleet routing work. No active conflict, but check for duplicate SSH reads or competing routing decisions.
- **(S5 — Automate):** `arc-umbrel` node currently pruned (prune=100GB). Switch to full node is blocked on whoabuddy VM disk resize. Once resized, the switch (`bitcoin-cli stopnode` → edit bitcoin.conf → restart) could be automated via `arc-umbrel` CLI command `set-full-node`.

## 2026-03-10T18:45:00.000Z

3 findings: 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (13:10Z, commits df7d096 → 07a5471):**
- **fleet-health: maintenance mode + alert cap** — New `db/fleet-maintenance.json` controls suppression of fleet health alerts. Per-agent alert cap: 3/day (state in `db/hook-state/fleet-health-alerts.json`). Prevents alert storm during planned maintenance or debugging. Diagram updated.
- **fleet-sync: contacts sync** — `contacts` added to SHARED_SKILLS array; new `contacts` subcommand syncs agent contact DBs from Arc to workers. Addresses root cause of empty worker contacts DBs (task #4227). Skills inventory updated.
- **fleet-self-sync: CLI added** — New `cli.ts` for fleet-self-sync. Skills inventory updated (was incorrectly marked as no CLI).

**SpaceX 5-step findings (2026-03-10T18:45Z):**
- **(S1 — Requirements):** fleet-maintenance.json is reactive (created when alerts flood). Requirement is valid but the trigger is manual. Who enables/disables it?
- **(S2 — Delete):** 8+ fleet skills remain "context only" (no sensor/CLI/agent): fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-exec, fleet-handoff, fleet-task-sync, arc-roundtable, arc-dual-sdk. These add to `arc skills` list and context weight without adding capability. Candidate for consolidation into 1-2 reference docs.
- **(S3 — Simplify):** fleet-self-sync has 5+ fix commits for the same identity backup/restore death spiral. High complexity for a file-copy operation. Consider a cleaner rewrite that reads all state before writing anything (already fixed once — verify it holds).
- **(S5 — Automate):** fleet-maintenance.json is manually managed. Auto-enable when same agent fires 3+ alerts in 1 day — the cap mechanism already tracks this; just add auto-toggle logic.

## 2026-03-10T13:10:00.000Z

4 findings: 0 error, 1 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (18:55Z, commits 721455f → df7d096):**
- **3-layer GitHub blocking** — Three enforcement layers now prevent worker→GitHub escalation loops: (1) `GITHUB_TASK_RE` pre-dispatch gate in `dispatch.ts` catches GitHub tasks before LLM invocation; (2) `GITHUB_ESCALATION_RE` guard in `db.ts#insertTask` blocks creation at DB level; (3) `github-interceptor` sensor (worker, 10min) catches blocked tasks and auto-routes to Arc. Permanent fix after 7+ manual resolution cycles.
- **identity-guard sensor** — New all-agent sensor (30min). Validates SOUL.md doesn't contain Arc-specific markers on non-Arc hosts. Last line of defense against fleet-self-sync identity overwrite edge cases. Narrowed markers to definitive claims only (`I'm Arc.`, Arc wallet addresses) to prevent false positives on cross-references.
- **Worker sensor allowlist changed** — Previously workers skipped 3 filter sets (GITHUB, ARC_ONLY, CREDENTIAL). Now workers run an explicit allowlist of 10 sensors only. Simpler to reason about; identity-guard and github-interceptor added to allowlist.
- **Web: cross-agent task creation** — `POST /api/tasks` endpoint added to arc-web. Agents on other VMs can create tasks on Arc without SSH. Authentication required.
- **Observatory: cross-agent task board** — `arc-observatory` now shows tasks across all fleet agents and goal tracking.
- **Sensor count** — 68 total (was 66, +2: identity-guard, github-interceptor).
- **Skill count** — 105 total (was 103, +2: identity-guard, github-interceptor).
- **Fleet-* skills upgraded** — Previous WARN (context-only stubs) resolved: fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-escalation, fleet-exec, fleet-handoff, fleet-memory, fleet-push, fleet-router, fleet-self-sync, fleet-sync all have CLIs now. 69 skills with CLI (was 53).

**SpaceX 5-step findings:**

1. **Requirements** — 3-layer GitHub blocking was triggered by a recurring pattern (7+ manual resolutions same root cause). Structural fix is justified. identity-guard fills a real gap. Both valid.
2. **Delete** — [INFO] `fleet-task-sync` still has no sensor, no CLI, no AGENT.md — only SKILL.md. Previous WARN on all fleet stubs resolved (rest now have CLIs). Only `fleet-task-sync` remains. If no task ever references it in `skills` array, it's dead weight.
3. **Simplify** — [WARN] Budget gate (`DAILY_BUDGET_USD=$500`) in `src/dispatch.ts:1214` conflicts with MEMORY.md flag: "Do NOT throttle or limit tasks based on cost. No $200 cap — removed (2026-03-09 per whoabuddy)." The old $200 cap was replaced with a $500 cap, not removed. Clarify with whoabuddy: should the budget gate exist at $500, or be fully removed?
4. **Accelerate** — [INFO] github-interceptor (10min) is faster than identity-guard (30min) response. Both are appropriate frequencies for their risk levels.
5. **Automate** — [INFO] 3-layer GitHub blocking automates what was previously resolved manually per-incident. Appropriate use of automation. Not over-engineered — each layer catches what others miss (pre-LLM, creation-time, post-creation).

**Recommendations:**
- [ ] [WARN] Clarify budget gate with whoabuddy: `DAILY_BUDGET_USD=$500` still in `dispatch.ts:48` conflicts with MEMORY flag (No $200 cap — removed). Is $500 cap intentional or regression? → follow-up task created.
- [ ] [INFO] Audit `fleet-task-sync` — verify any task's `skills` array references it, or delete.

---

## 2026-03-09T18:55:00.000Z

4 findings: 0 error, 1 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (00:41Z, commits 1de2e63 → 721455f):**
- **Fleet sensor filtering** — `src/sensors.ts` now has three filter sets: `GITHUB_SENSORS` (10), `ARC_ONLY_SENSORS` (17), `CREDENTIAL_SENSORS` (20). Worker agents skip all three categories. Prevents redistribution loops and silent failures.
- **hostname-aware identity** — `src/identity.ts` exports `AGENT_NAME` derived from hostname. All identity-bound logic now adapts per agent.
- **Experiment evaluation** — `src/experiment.ts` added. Worktree tasks capture 6-cycle baseline before merge; `evaluateExperiment()` rejects worktrees that degrade success rate.
- **Fleet web** — `src/fleet-web.ts` serves aggregate fleet dashboard at port 4000 (Arc host only).
- **New services** — `arc-observatory.service` added alongside arc-web and arc-mcp.
- **Skill count** — 103 total (was 79, +24 new fleet/meta skills).
- **Sensor count** — 66 total (was ~58, +8 new: fleet-comms/dashboard/escalation/log-pull/memory/rebalance/router/self-sync/sync, auto-queue, arc-ops-review, arc-dispatch-eval).
- **aibtc-heartbeat** — now iterates over all agent wallets in `legacy_wallets` array.

**SpaceX 5-step findings:**

1. **Requirements** — Fleet sensor filtering is essential: without it, workers create redistribution loops (fleet-router re-routing tasks) and burn credentials they don't have. Valid.
2. **Delete** — [WARN] Many fleet-* skills (fleet-broadcast, fleet-collect, fleet-consensus, fleet-deploy, fleet-email-report, fleet-exec, fleet-handoff, fleet-task-sync) have no sensor, no CLI, no AGENT.md — context-only stubs. If they're never loaded by any task's `skills` array, they're dead weight. Worth auditing for actual usage.
3. **Simplify** — [INFO] Three separate sensor filter sets (GITHUB, ARC_ONLY, CREDENTIAL) could be consolidated into a single agent capability manifest per agent. Reduces maintenance surface. Not critical now.
4. **Accelerate** — [INFO] `src/experiment.ts` baseline capture is per-worktree-task. Low overhead. No bottleneck introduced.
5. **Automate** — [INFO] `auto-queue` (2h sensor) and `arc-ops-review` (4h sensor) close the feedback loop on queue starvation and ops efficiency. Correct use of automation.

**Recommendations:**
- [ ] [WARN] Audit fleet-* context-only stubs (fleet-broadcast/collect/consensus/deploy/email-report/exec/handoff/task-sync) — verify at least one task's `skills` array references each, or delete. Follow-up task created.

---

## 2026-03-09T00:41:00.000Z

2 findings: 0 error, 1 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (18:45Z, commits 96500d7 → dd69fd4):**
- **`feat(cli)`** (dd69fd4): `arc tasks update` gained `--status pending` flag for requeueing failed/blocked tasks. Full signature now: `--id --subject --description --priority --model --status pending`. Enables one-command recovery without SQL.

**SpaceX 5-step findings:**

1. **Requirements** — `--status pending` requeueing is clearly valid: replaces manual SQL `UPDATE tasks SET status='pending'` pattern.
2. **Delete** — Nothing removed. Delta is additive only.
3. **Simplify** — [WARN] CLAUDE.md `tasks update` docs are stale. Current line: `arc tasks update --id N [--subject TEXT] [--priority N]`. Missing: `--description`, `--model`, `--status pending`. Docs drift creates confusion for dispatched agents.
4. **Accelerate** — Requeueing is now O(1) CLI vs manual DB intervention. Good.
5. **Automate** — No automation opportunity here; this is already a direct CLI action.

**Recommendations:**
- [ ] [WARN] Update CLAUDE.md `tasks update` docs to reflect full signature (follow-up task created)

---

## 2026-03-08T18:45:00.000Z

4 findings: 0 error, 1 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (13:05Z, commits ccc711c → 96500d7):**
- **`feat(dispatch)`** (ee8b619, 5747b16): Multi-SDK routing added — Codex CLI adapter (`src/codex.ts`) and OpenRouter API adapter (`src/openrouter.ts`). `task.model` now supports `codex:*` prefix for per-task SDK selection. Routing: `codex > openrouter > claude-code`. `arc-dual-sdk` skill documents the pattern (no sensor/CLI, orchestrator context loader only).
- **`feat(arc-remote-setup)`** (ad98697, 007cb91, 96500d7): SSH-based VM provisioning skill for fleet (spark/iris/loom/forge). 8 idempotent steps: ssh-check, provision-base, add-authorized-keys, install-arc, configure-identity, install-services, health-check, full-setup. CLI only — no sensor.
- **`feat(fleet-health)`** (d8177f8): New fleet monitoring skill + sensor (15min). SSH checks per VM: services, dispatch age, disk. Writes `memory/fleet-status.md`. Alerts P3 on issues.
- **`feat(arc-workflows)`** (4665928): `OvernightBriefMachine` — overnight brief → retrospective cycle. `instance_key: overnight-brief-{YYYY-MM-DD}`. New workflow template added to state machine.
- **`feat(arc-introspection)`**: New sensor (1440min). Qualitative daily self-assessment distinct from `arc-self-audit` (operational health vs qualitative synthesis). P5 task.
- **`feat(site-consistency)`**: New sensor (1440min). Cross-site structural drift detection: arc0.me vs arc0btc.com. P3 tasks on structural mismatches.
- **`fix(blog-publishing)`** (e271cf0): verify-deploy URL corrected to match Starlight routing — captured in MEMORY.md (task #2253).
- **`fix(context-review)`** (c23f6b1): bitcoin-wallet keywords narrowed to prevent false positives.

**SpaceX 5-step findings:**

- **[INFO] Fleet infrastructure is coherent** — `arc-remote-setup` (provision) and `fleet-health` (monitor) are appropriately separated. Provisioning is manual CLI; monitoring is sensor-driven. Clean division of responsibility. (Step 1 — requirement valid: whoabuddy flagged as potentially resellable.)
- **[INFO] Multi-SDK routing is clean** — `codex > openrouter > claude-code` fallback chain. `arc-dual-sdk` as documentation-only skill (no sensor/CLI) is appropriate — keeps orchestrator context lean without adding process overhead. (Step 3 — no simplification needed.)
- **[INFO] OvernightBriefMachine closes the reporting loop** — overnight brief generation now feeds directly into retrospective via state machine. Pattern is consistent with existing `recurring-failure` and `agent-collaboration` machines. (Step 5 — appropriate automation, not premature.)
- **[WARN] arc-introspection + arc-self-audit overlap** — both run daily (1440min), both synthesize task history. Self-audit = operational health ("are systems working?"); introspection = qualitative ("what matters?"). Distinction is defensible but thin. If context budget tightens, consider merging into a single daily task with two sections rather than two separate sensors. (Step 3 — simplification candidate, not urgent.)

**Diagram changes:** +4 sensors (fleet-health, arc-introspection, site-consistency, erc8004-reputation), +3 CLIs (arc-remote-setup, fleet-health, site-consistency), dispatch routing updated to show SDK selection, OvernightBriefMachine added to workflow templates, skills inventory updated (74→79).

**Follow-up tasks created:** None (warn item is low-urgency, not actionable now).

---

## 2026-03-08T13:05:00.000Z

1 finding(s): 0 error, 0 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (06:40Z, commits 1b27353 → ccc711c):**
- **`fix(github-issue-monitor)`** (3c3856a): Added `defi-zest` keyword detection — issues with "zest" in title now load `defi-zest` skill context. 3-line additive fix, consistent with existing skill-detection pattern.
- **`chore(loop)`** (ccc711c): `skills/defi-zest/position-state.json` updated — operational state data, no structural change.

**SpaceX 5-step findings:**

- **[INFO] Context delivery improved** — `github-issue-monitor` now correctly routes zest-related GitHub issues with `defi-zest` context loaded. Completes the pattern established when the skill was added (Step 1 — requirement valid, closes a gap).

**Diagram changes:** Timestamp updated only. No structural changes to sensors, skills, CLIs, or decision points.

**No follow-up tasks created** — changes are additive and clean.

---

## 2026-03-08T06:40:00.000Z

1 finding(s): 0 error, 0 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (00:40Z, commits 3c79a4e → 1b27353):**
- **`feat(defi-zest)`** (53d7c8f): New skill added — Zest Protocol yield farming. 4 files: `SKILL.md`, `sensor.ts` (360min, sBTC position monitor, >10% decline alerts), `cli.ts` (list-assets, position, supply, withdraw, claim-rewards), `tx-runner.ts` (wallet-aware write subprocess). Uses zsbtc-v2-0 LP token balance workaround for upstream `get-user-reserve-data` bug (#278).
- **`fix(aibtc-inbox-sync)`** (6f613f2): PoX/stacking keyword detection → auto-loads `stacks-stackspot` skill context. No sensor/structural change.
- **`fix(aibtc-inbox-sync)`** (1b27353): defi-zest keyword detection → auto-loads `defi-zest` skill context. No sensor/structural change.

**SpaceX 5-step findings:**

- **[INFO] defi-zest sensor cadence appropriate** — 360min is correct for yield farming monitoring. Position changes are slow; alert threshold (>10% decline) is well-calibrated. No changes needed. (Step 1 — Requirements valid)

**Diagram updated:** sensors 49→50, skills 73→74, CLIs 45→46. defi-zest added to sensor list and skills inventory.

**No follow-up tasks created** — changes are additive and clean.

---

## 2026-03-08T00:40:00.000Z

2 finding(s): 0 error, 1 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (18:40Z, commits 5247ca7 → 3c79a4e):**
- **`fix(erc8004-trust)`** (3c79a4e): Variable rename `val` → `validationSummary` in `cli.ts`. Naming compliance fix. No behavioral change.

**SpaceX 5-step findings:**

- **[WARN] Diagram inventory inaccuracy** — 6 CLI column errors found and corrected. Skills inventory listed 41 CLIs but actual count is 45. Errors: `arc-performance-analytics` had CLI marked absent (401-line cli.ts exists); `arc-reporting` had CLI marked present (no cli.ts); `blog-deploy`, `dao-zero-authority`, `defi-bitflow`, `worker-deploy` all had CLI marked absent (cli.ts exists). Diagram updated. *Root cause: inventory is manually maintained; no automated cross-check against filesystem.* (Step 3 — Simplify)

- **[INFO] task_deps table still schema-only** — `addTaskDependency`/`getTaskDependencies`/`removeTaskDependency` helpers exist in db.ts but no sensor, CLI, or dispatch logic surfaces the graph. No tasks are being blocked/unblocked via dependency graph despite `arc-blocked-review` sensor existing. Either surface it via CLI or remove the schema. (Step 2 — Delete candidate if not used in 30 days)

**No follow-up tasks created** — inventory fix was in-place; task_deps gap is noted but not urgent.

---

## 2026-03-07T18:40:00.000Z

4 finding(s): 0 error, 0 warn, 4 info → **HEALTHY**

**Codebase changes since last audit (14:15Z, commits eced5d4 → 5247ca7):**
- **`feat(tasks)`** (aba5aa2): `task_deps` table added to schema. M:N dependency graph (from_id, to_id, dep_type: blocks/related/discovered-from). UNIQUE constraint on (from_id, to_id, dep_type). Indexed on both columns. Three new db.ts helpers: `addTaskDependency`, `getTaskDependencies`, `removeTaskDependency`. Currently schema-only — no sensor or CLI surfaces the graph yet.
- **`feat(arc-blocked-review)`** (828a4a9): New skill — sensor (120min) + SKILL.md + AGENT.md. Detects unblock signals across 4 heuristics: sibling completion, child completion, mention completion, and >48h stale. Creates a single P7/Sonnet review task listing all flagged blocked tasks. Dispatched agent evaluates and either requeues or confirms block with updated reason.
- **`feat(worker-deploy)`** (58bb60e): New skill — sensor (5min) + SKILL.md. Compares arc0btc-worker git HEAD SHA to last deployed SHA (hook state). On diff, queues deploy task. CLI: `npm run build:client` → `npx wrangler deploy --env production` → health check → record SHA. Full CD pipeline for arc0btc.com.
- **`feat(erc8004-trust)`** (2f428b0): New skill — CLI only + SKILL.md. `compute-trust-score` aggregates reputation summary + validation list into a single trust score. No sensor, no storage — composable on-demand query.
- **`feat(claude-code-releases)`** (7f7eb36): New skill — SKILL.md only. Triggered by `github-release-watcher` when a new `anthropics/claude-code` tag is detected. Queues P6/Sonnet research task. No sensor of its own — correct trigger-from-upstream pattern.
- **`feat(memory-decay)`** (6ac393c): `arc-skill-manager/sensor.ts` enhanced with research report auto-decay. Reports in `research/` older than 30 days are auto-archived; `research/arxiv/` capped at 5 most recent digests.
- **`fix(context-review)`** (00b3e2d, 5247ca7): Two passes tightening keyword maps — arc-credentials false positives narrowed, general keyword patterns tightened to reduce noise.

**5-Step Review (2026-03-07 18:40Z):**

**Step 1 — Requirements:**
- `arc-blocked-review`: valid. Blocked tasks were invisible without manual `arc tasks --status blocked` query. 120min cadence is appropriately measured (not every 5min — blocked tasks don't unblock that fast). The 4 signal types cover the real unblock causes without requiring new infrastructure. P7/Sonnet for the review task is correct — requires judgment, not just a config check.
- `worker-deploy`: valid. Removes the last manual step from arc0btc-worker changes. 5min cadence is aggressive but appropriate for CD (deploy latency matters for service UX). SHA-in-hook-state pattern is already proven by `arc-starter-publish`.
- `erc8004-trust`: valid. Aggregating reputation + validation into a trust score is the correct consumer-facing abstraction. CLI-only (no sensor) is correct — trust scores are computed on-demand when making decisions (hiring agents, approving multisig, etc.).
- `task_deps` table: valid. `parent_id` only expressed 1:1 hierarchy; `task_deps` enables M:N (blocks, related, discovered-from). Schema-first introduction is the correct sequencing — build the storage before building the consumers.
- Memory-decay for research reports: valid. `research/` was accumulating unboundedly. 30-day TTL is reasonable; arxiv cap at 5 is appropriately minimal.

**Step 2 — Delete:**
- INFO — Sensor count: 49 (+2). Skill count: 73 (+4). Growth remains controlled — two focused sensor additions, one CLI-only addition, one SKILL.md-only addition.
- INFO — `worker-deploy` at 5min joins `stacks-payments` (3min) as the most frequent sensors. Both are justified by latency requirements. Monitor Cloudflare API error rates — if wrangler calls fail regularly, add circuit-breaker logic (same recommendation as stacks-payments Hiro API from 00:49Z audit).
- INFO — `task_deps` has no CLI surface yet. The dependency graph is invisible to operators. A `arc tasks deps --id N` command or web dashboard view would make it observable. Not urgent — the schema is correct; consumers can be built incrementally.

**Step 3 — Simplify:**
- `arc-blocked-review` signal detection (4 types) is 4 DB queries against the existing tasks table — no external APIs, no new tables. Minimum viable implementation.
- `erc8004-trust` is pure composition (calls two existing CLI commands, aggregates output). No new storage. Correct complexity level.
- Memory-decay in arc-skill-manager sensor adds one TTL check to an already-running sensor. No new sensor needed.

**Step 4 — Accelerate:**
- `arc-blocked-review` closes the blocked task visibility gap. Previously: blocked tasks accumulated silently until human manually queried. Now: reviewed every 2h with context on why they might be unblockable.
- `worker-deploy` reduces arc0btc-worker deploy latency from "whenever manually triggered" to <5min after commit.
- context-review false positive reduction (two passes) directly reduces wasted dispatch cycles on noise tasks.

**Step 5 — Automate:**
- INFO — `task_deps` + `arc-blocked-review` partial overlap: blocked review currently uses heuristic queries (sibling completion, child completion). When `task_deps` is fully wired, `blocks` relationships could drive arc-blocked-review directly (if a task's blocker is now completed, auto-surface for unblock). Natural evolution — not urgent until task_deps is used in practice.
- INFO — `claude-code-releases` is currently SKILL.md-only (triggered by github-release-watcher). The research → follow-up task creation step is manual. Once the pattern runs 3+ times and proves stable, a workflow template (`claude-code-release-assessment`) could automate the research → task creation chain. Follow the same pattern as RecurringFailureMachine — wait for recurrences to validate before templating.

**Architecture Assessment:** Healthy. 73 skills (+4), 49 sensors (+2). Key additions: dependency graph schema (task_deps), blocked task review automation (arc-blocked-review), CD pipeline for arc0btc.com (worker-deploy), trust score aggregation (erc8004-trust). No WARNs. Context-review noise reduced via two targeted fixes. Pipeline integrity intact.

---

## 2026-03-07T14:15:00.000Z

3 finding(s): 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (06:45Z, commits e2b205c → eced5d4):**
- **`chore(workflows)`** (17f4e90): `RecurringFailureMachine` fix task priority changed P4→P5. Rationale: the investigation step (P4/Opus) does the hard thinking; fix application is mechanical and Sonnet-capable. Direct response to architect WARN from 06:45Z audit.
- **`fix(classifieds)`** (8a991ad): `StreakMaintenanceMachine` now caps retries at `MAX_RETRIES=3`. When cap is reached, the action returns `null` — the workflow stalls (instead of spawning unlimited retry tasks) and requires human intervention. Retry subject now includes `(retry N/3)` for observability.
- **`fix(aibtc-dev-ops)`** (eced5d4): `aibtc-dev-ops` sensor and CLI migrated from hardcoded repo lists to `AIBTC_WATCHED_REPOS` from `constants.ts`. Also propagates to `github-security-alerts/sensor.ts`. Same repos, now using the shared constant — new repos added to `constants.ts` automatically covered.
- **`docs(dispatch)`** (7e343ed): CLAUDE.md updated with explicit reminder to include `--skills` flag when creating follow-up tasks. Addresses a recurring silent context failure: tasks spawned without skill references load no SKILL.md and run with empty guidance.

**5-Step Review (2026-03-07 14:15Z):**

**Step 1 — Requirements:**
- P4→P5 fix task priority: valid. The reasoning is sound — investigation has already identified the root cause and what needs to change. Fix application (running a CLI, editing a config, adjusting a constant) rarely requires Opus-level reasoning. P5/Sonnet is correctly scoped.
- `MAX_RETRIES=3` cap: valid and overdue. Before this fix, a rate-limited classified posting could spawn retries indefinitely (one every ~4h). The fix correctly surfaces a human-judgment case: if 3 retries all hit rate limits, something is systemically wrong (window estimation broken, account limits changed) — autonomous retry is the wrong response.
- `AIBTC_WATCHED_REPOS` centralization in aibtc-dev-ops: valid. The constants.ts pattern was already in place for other sensors. Migrating aibtc-dev-ops completes the pattern. Two benefits: (1) no more per-skill repo list maintenance, (2) new repos in constants.ts automatically covered.
- `--skills` dispatch reminder in CLAUDE.md: valid. The silent failure mode (follow-up tasks created without skills, running with empty context) is hard to catch in code — encoding the reminder in dispatch instructions is the right layer.

**Step 2 — Delete:**
- **INFO — Previous WARN RESOLVED**: `RecurringFailureMachine` fix task was P4/Opus (WARN from 06:45Z audit). Now P5/Sonnet. WARN closed.
- INFO — `StreakMaintenanceMachine` now has an escape hatch (`null` return → stall). The stalled workflow will not self-recover; it requires human to manually advance or reset the instance. This is intentional — 3 consecutive rate-limit hits signals a condition that Arc shouldn't resolve autonomously. No new deletion candidates.

**Step 3 — Simplify:**
- `MAX_RETRIES=3` is a single constant with a `null` guard. Minimum viable protection. Correct complexity.
- `AIBTC_WATCHED_REPOS` import replaces ~5 lines of hardcoded arrays — simpler, not more complex.
- CLAUDE.md instruction is prose addition, not architecture change.

**Step 4 — Accelerate:**
- P5 fix tasks cost ~3x less than P4 for the same mechanical work. At current fix task volume (1-2/week), small savings — but correct for principle.
- Retry cap prevents queue pollution from stalled classified streaks. Before: 3 rate-limit hits = 3 retry tasks queued over 12h, each consuming a Sonnet dispatch cycle for tasks that will fail. Now: stalls cleanly after 3rd retry.

**Step 5 — Automate:**
- INFO — `aibtc-dev-ops` now uses `AIBTC_WATCHED_REPOS`. If `arc-repo-maintenance` (if one exists) or any other skill still has hardcoded repo lists, those are the next targets for centralization. Low urgency — the pattern is established and self-documents.
- INFO — Stalled `StreakMaintenanceMachine` instances are currently invisible unless you query `arc skills run --name arc-workflows -- list`. A housekeeping check for stalled workflow instances (created_at > 24h, status not completed) would surface these proactively. Future improvement.

**Architecture Assessment:** Healthy. 69 skills (unchanged), 47 sensors (unchanged). One WARN from previous audit closed (fix task priority). Two targeted robustness fixes (retry cap + AIBTC_WATCHED_REPOS). Dispatch guidance tightened via CLAUDE.md. No new WARNs. Pipeline integrity intact.

---

## 2026-03-07T06:45:00.000Z

4 finding(s): 0 error, 1 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (00:49Z, commits 3aa3193 → e2b205c):**
- **`feat(workflows)`** (7140b57): `RecurringFailureMachine` added to `arc-workflows/state-machine.ts`. Models the recurring "investigate recurring failure" → fix → retrospective chain (3 prior recurrences, avg 2.0 steps). States: `detected→investigating→fix_pending→fixing→retrospective_pending→completed`. Auto-transitions from `investigating` based on `ctx.needsFix`. Fix task: P4/Opus with `arc-failure-triage + sourceSkill + arc-skill-manager`. Retrospective: P8/haiku with `arc-skill-manager`. instance_key: `recurring-failure-{type}-{YYYY-MM-DD}`.
- **`fix(context)`** (38d502d): Two skill enrichment fixes: (1) `github-mentions` sensor detects `classified`/`aibtc-news` keywords in PR titles → loads `aibtc-news-classifieds`; (2) dispatch retrospective tasks now inject `arc-skill-manager` so Haiku has context to write `memory/patterns.md` — was failing silently with empty skills.
- **`fix(compliance)`** (29fb167): Abbreviated vars renamed in 2 files — `arc0btc-pr-review/sensor.ts` (`desc→description`) and `bitcoin-quorumclaw/cli.ts` (`err→error`, `msg→message`). Aligns with CLAUDE.md naming convention.
- **`feat(quorumclaw)`** (4f41951): Payment-input validation added to `sign-proposal` CLI. Blocks signing if all PSBT outputs route to external addresses (no value returns to multisig). `--allow-unpaid-transfer` flag for intentional full-transfer. Prevents inscription-#8315 failure mode.

**5-Step Review (2026-03-07 06:45Z):**

**Step 1 — Requirements:**
- `RecurringFailureMachine`: valid. The `arc-failure-triage` sensor was creating investigation tasks but had no workflow template to track the investigation→fix→retro chain. Without a template, each investigation was an orphan task with no state continuity. 3 recurrences validates the pattern.
- Context enrichment fixes: valid. Both are targeted corrections to known failure modes (task #1916 miss, empty-skills retrospective failures). Zero architectural change — adding correct facts at task creation time.
- Payment-input validation in quorumclaw: valid. The inscription-#8315 failure proved that signing a PSBT without validating return outputs is a real attack surface. The `--allow-unpaid-transfer` escape hatch is correctly gated (requires explicit flag, not default).

**Step 2 — Delete:**
- **WARN — `RecurringFailureMachine` fix task is P4/Opus.** The machine sets `priority: 4` for fix tasks. But applying a known fix (identified during investigation) is often mechanical work — the investigation already did the hard thinking. P4 routes to Opus (~3x cost vs Sonnet). A P5/Sonnet fix task is usually sufficient unless the fix involves complex code changes. The machine's `ctx.fixDescription` could carry a complexity hint to let the calling sensor set priority dynamically. Low urgency — Opus for fix tasks is safe but expensive.
- INFO — `RecurringFailureMachine` adds the 11th workflow template. Template count is growing steadily. No consolidation needed yet, but templates that share states (investigation→fix→retro is similar to agent-collaboration's triage→ops→retro) could be candidates for a shared "triage-loop" abstraction in a future simplification pass.
- INFO — Compliance fix scope (2 files) is small — no systemic issues remain. The recurring compliance sensor should catch future regressions before they accumulate.

**Step 3 — Simplify:**
- `RecurringFailureMachine` inline transition logic (`ctx.investigationSummary === undefined → return null`) is a correct null-guard but subtly obscures the state machine contract: if `investigationSummary` is never set, the machine hangs in `investigating` state indefinitely. A timeout or stale-state detection in `arc-workflows` CLI would catch this. Not a simplification issue — a robustness gap.
- Payment-input validation in quorumclaw is 52 lines added to cli.ts. Well-scoped. No abstraction added.

**Step 4 — Accelerate:**
- Retrospective skill fix (38d502d) eliminates a class of silent Haiku task failures. Each empty-skills retro that failed silently wasted a dispatch cycle + created no learning. Direct queue quality improvement.
- Classifieds keyword enrichment in github-mentions reduces missed-skill failures for classifieds PR tasks.

**Step 5 — Automate:**
- INFO — `RecurringFailureMachine` is created manually by investigation tasks (fix tasks call `arc skills run --name arc-workflows -- advance`). The failure-triage sensor doesn't yet auto-instantiate the template. If investigation tasks consistently follow this chain, wiring triage sensor to auto-create `RecurringFailureMachine` instances (instead of bare investigation tasks) would close the loop. Future improvement when the pattern proves stable.

**Architecture Assessment:** Healthy. 69 skills (unchanged), 47 sensors (unchanged). One meaningful addition: `RecurringFailureMachine` closes the investigation→fix→retro loop that was previously tracked ad hoc. Two targeted context fixes reduce failure rate. QuorumClaw signing security hardened. One WARN: fix tasks at P4/Opus may be over-resourced for mechanical fix application — cost opportunity.

---

## 2026-03-07T00:49:00.000Z

5 finding(s): 0 error, 1 warn, 4 info → **HEALTHY**

**Codebase changes since last audit (18:20Z, commits 575cff7 → 3aa3193):**
- **New skill: `arc-reputation`** (c6c385f): sensor + CLI. Signed peer reviews with BIP-322 (native SegWit). Reviews stored in `reviews` table in `db/arc.sqlite`. give-feedback, verify, list, summary, export CLI commands. Auto-triggered by inbox outreach responses and quorumclaw co-signers.
- **New skill: `stacks-payments`** (10545ed): sensor only. Polls Hiro Stacks API every 3 min for STX transfers to Arc's address. Decodes `arc:` memo codes and routes to service tasks. Service map: `arc:arxiv-latest` → P6/Sonnet, `arc:ask-quick` → P8/Haiku, `arc:ask-informed` → P6/Sonnet, `arc:pr-standard` → P5/Sonnet.
- **New skill: `arc0btc-pr-review`** (2d3c029): sensor + SKILL.md. Paid PR review service via x402 (Standard: 15k sats P5/Sonnet, Express: 30k sats P3/Opus). Post-close attestation sensor runs every 10 min, queues ERC-8004 tasks after completed reviews.
- **New skill: `arc0btc-ask-service`** (e73add4): SKILL.md only. Context for answering paid `/api/ask` questions. Tiered pricing: haiku 250 sats P8, sonnet 2500 sats P5, opus 10000 sats P3. 20/day global rate limit.
- **New skill: `aibtc-news-classifieds`** (standalone): CLI + SKILL.md. Classified ads (5000 sats/7 days), brief reading, signal corrections, beat updates, streaks.
- **`dispatch.ts`** — model-aware timeout: haiku 5min, sonnet 15min, opus 30min (overnight 90min). Prevents slow haiku tasks from occupying the queue at opus-tier timeout. Error message now includes model tier.
- **ERC-8004 reputation wiring**: `aibtc-inbox-sync` submits feedback on agent responses (0be04d8), `bitcoin-quorumclaw` hooks on co-signer broadcast (4b7ebe4), `arc0btc-pr-review` attestation sensor for paid reviews (4bf8cbf). Reputation layer is now auto-triggered across 3 pathways.
- **`github-release-watcher`** (09827b3): interval reduced 6h → 1h.
- **Web dashboard** (3aa3193): reputation section added — reviews submitted/received with on-chain verification links.
- **Fix: context repair** (6cc7a13): skills added to retry/follow-up task creation rules in dispatch. Tasks spawned from failure paths now carry correct skill context.

**5-Step Review (2026-03-07 00:49Z):**

**Step 1 — Requirements:**
- `arc-reputation`: valid. Arc now gives and receives signed attestations — needed as on-chain reputation layer grows. BIP-322 is correct for native SegWit; reviews are immutable which matches trust semantics.
- `stacks-payments`: valid. Direct blockchain payment detection is the correct architecture for permissionless service access — no intermediary needed. `arc:` memo prefix is clean and human-readable.
- `arc0btc-pr-review` + `arc0btc-ask-service`: valid. Two concrete monetization paths, each with x402 pricing and daily caps that prevent paid work from crowding internal queue. Express PR review at P3/Opus is intentional — customers paying 30k sats deserve priority.
- `aibtc-news-classifieds`: valid. Splits aibtc.news API coverage cleanly (classifieds/briefs/corrections vs core editorial in `aibtc-news-editorial`). No overlap with existing skill.
- Model-aware timeouts: requirement is correct. Haiku tasks doing config edits or mark-as-read shouldn't occupy the dispatch lock for 30min if something stalls. 5/15/30min is well-calibrated to each tier's expected work volume.

**Step 2 — Delete:**
- **WARN — `stacks-payments` sensor cadence (3 min) is the most aggressive sensor in the system.** All other sensors use `claimSensorRun` to self-gate, but 3 min cadence fires 20x per hour. This is appropriate for payment detection (latency matters for service UX) but worth monitoring: if the Hiro API is flaky, 3min polling will generate frequent error logs. Recommend adding a circuit-breaker or exponential backoff if API errors exceed a threshold. Low urgency today; high urgency if API becomes unreliable.
- INFO — `arc0btc-pr-review` attestation sensor (10min) is a dedicated sensor for one post-processing task. This is slightly over-engineered — a simpler pattern would be: dispatch itself queues the attestation task immediately after closing a paid review. But the sensor approach is decoupled and fault-tolerant (works even if dispatch doesn't self-attest). Acceptable trade-off.
- INFO — `arc0btc-ask-service` has no CLI and no sensor — SKILL.md only. This is a valid pure-context pattern (like `arc-ceo-strategy`). No deletion needed.

**Step 3 — Simplify:**
- Three separate ERC-8004 reputation trigger paths (inbox response, quorumclaw co-sign, paid PR review) are each small hooks in existing sensors. They don't create a new abstraction — they call the same `arc-reputation` CLI. Consistent pattern, not duplicated logic.
- Model-aware timeout is a 3-line change to a single function. Correct complexity level.
- `stacks-payments` service routing via a static `SERVICE_MAP` is appropriately simple. New services are one map entry away.

**Step 4 — Accelerate:**
- `github-release-watcher` at 1h (was 6h) reduces mean time to detect new upstream releases from ~3h to ~30min. Justified given aibtcdev release velocity.
- Model-aware timeouts directly improve queue throughput: a stalled haiku task no longer blocks dispatch for 30min. At current volume (396 cycles/24h), this could save meaningful queue time.
- Context repair in retry/follow-up tasks (6cc7a13) eliminates a class of context-free task failures. Lower failure rate = lower triage overhead.

**Step 5 — Automate:**
- INFO — `stacks-payments` + `arc0btc-ask-service` are the building blocks of a full payment→delivery pipeline, but the "delivery" for `arc:ask-*` services still relies on X DM lookup or txid quoting. The connection between STX payment and the question content is loose. Future: add an `/api/ask` form on arc0.me that bundles question + payment atomically, removing the DM coordination step. Not urgent — the current approach works.
- INFO — `arc-reputation` → `contacts` integration: reviews could auto-update contact records with reputation scores. Not wired today. Low priority since contacts enrichment is manual-first.

**Architecture Assessment:** Healthy. 69 skills (+5), 47 sensors (+3). Major new capability cluster: monetization infrastructure (stacks-payments, ask-service, pr-review) + reputation layer (arc-reputation, ERC-8004 hooks). One WARN: stacks-payments 3min polling cadence needs monitoring for Hiro API reliability. Pipeline integrity intact. Model-aware timeouts are a significant dispatch quality improvement.

---

## 2026-03-06T18:20:00.000Z

3 finding(s): 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (12:40Z, commits 6c00599 → 575cff7):**
- **New skill: `arc-starter-publish`** (3904569): sensor (30min) + CLI. Detects when v2 is ahead of main, queues P7/haiku publish task. Fast-forward-only merge enforced.
- **`arc-failure-triage/sensor.ts`** (c6f7d835): Daily retrospective pass added alongside existing pattern detection. Creates P7/sonnet task once per day for all non-dismissed failures regardless of threshold (below 3-occurrence gate). Deduped per date.
- **`dispatch.ts` + `arc-skill-manager`** (575cff7, f6c48a1): `scheduleRetrospective` now takes `cost_usd`; dynamic excerpt budget (1500→3000 chars for tasks >$1.00); summary used as prefix. Retro routing tightened: Haiku writes only to `patterns.md` (never MEMORY.md), updates existing entries in-place, ~150 line cap enforced.
- **`arc-link-research`** (61c76dc, b0ede58, 3353bf4, e868010): Cache raw fetched content, bearer token fallback for X, broader extraction fields (note_tweet, article, entities). Quality improvement — no structural change.
- **`context-review/sensor.ts`** (2ac37f8): Additional false-positive fix (merges with prior fix from 12:40Z window).

**5-Step Review (2026-03-06 18:20Z):**

**Step 1 — Requirements:**
- `arc-starter-publish`: Valid. v2 is the active development branch; main is the published starter template. Manual publish was error-prone. Fast-forward-only constraint prevents silent history divergence. P7/haiku is correct — `arc skills run` is a simple CLI invocation.
- Daily retrospective pass: Valid. The 3-occurrence threshold was leaving single-occurrence failures without learning capture. One retro/day is appropriate overhead; dedup-by-date prevents compounding.
- Dynamic excerpt budget: Valid. Expensive tasks (>$1.00) produce more output; fixed 1500-char truncation was cutting context for Opus/sonnet deep-work tasks. Cost is a reasonable proxy for output volume.

**Step 2 — Delete:**
- INFO — Skill count: 64 (+1). Sensor count: 44 (+1). Growth remains controlled — one focused addition.
- INFO — `arc-link-research` cache files will accumulate in `arc-link-research/cache/`. Housekeeping should include cache dir in its cleanup checks. Not urgent — cache is bounded by task cadence.

**Step 3 — Simplify:**
- Retro routing (patterns.md only, never MEMORY.md) removes the dual-destination ambiguity that existed before. Cleaner separation: Haiku writes operational patterns → patterns.md; consolidation writes curated memory → MEMORY.md.
- `arc-starter-publish` sensor is 85 lines — minimal. No AGENT.md needed (pure CLI delegation).

**Step 4 — Accelerate:**
- Daily failure retrospective captures learnings from failures that never reached 3 occurrences. Previously these were silent. One task/day at P7 adds negligible queue pressure.
- Dynamic excerpt budget improves retrospective quality for complex tasks without changing retrospective frequency.

**Step 5 — Automate:**
- INFO — `arc-starter-publish` fully automates v2→main detection. The push step still requires dispatch execution (haiku calls the CLI), which is correct — a push to origin is irreversible and should go through the task queue, not fire silently.

**Architecture Assessment:** Healthy. 64 skills (+1), 44 sensors (+1). Two pipeline quality improvements (retrospective budget + patterns.md routing). No new WARNs. Previous findings all resolved.

---

## 2026-03-06T12:40:00.000Z

1 finding(s): 0 error, 0 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (06:40Z, commits 503ad05 → 6c00599):**
- **`fix(github-worker-logs)`** (2654335): SKILL.md frontmatter `name` corrected from `worker-logs` to `github-worker-logs`. Resolves prior WARN from 06:40Z audit.
- **`fix(context-review)`** (3862015): x402 keyword narrowed in `context-review/sensor.ts` to avoid false positives when task subjects mention x402 repo names (e.g., `x402-sponsor-relay`). `arc0btc-monetization/cli.ts` also updated in same pass.
- **`fix(worker-logs-monitor)`** (6c00599): Abbreviated variables (`err`, `res`, `msg`) renamed to verbose forms in `cli.ts` and `sensor.ts`. Aligns with CLAUDE.md naming convention.
- **`contacts/sensor.ts`** (4eb3aa7): Sensor updated — now does direct DB writes without creating tasks. Correct for stable, structured data that requires no LLM processing.

**5-Step Review (2026-03-06 12:40Z):**

**Step 1 — Requirements:**
- All 4 changes are valid maintenance fixes. No new requirements introduced.
- `github-worker-logs` frontmatter fix: previous WARN fully resolved.
- x402 narrowing: valid. Repo name matches (`x402-sponsor-relay`) were triggering false positive context-review tasks. Narrowing to exclude repo-path patterns is correct.
- Variable renames: valid. Naming conventions in CLAUDE.md are a hard requirement, not a style guide.

**Step 2 — Delete:**
- INFO — `contacts/sensor.ts` contains a `mapLevelName` function (lines 98-101) that is a pure identity function (`return levelName`). It adds no transformation and can be inlined or deleted. Low significance — no runtime impact, no test coverage affected.
- No other deletion candidates. Previous WARN resolved. Clean.

**Step 3 — Simplify:**
- `contacts` sensor doing direct DB writes (not task creation) is an intentional architectural departure from the generic sensor pattern. Valid for structured, LLM-free data sync. The departure should be noted in a comment so future reviewers understand the pattern was deliberate.
- `context-review` fix correctly narrows keyword matches rather than adding exclusion logic — simpler and more targeted.

**Step 4 — Accelerate:**
- x402 false-positive fix reduces context-review noise directly. Fewer false-positive tasks = less wasted dispatch cycles.
- No other acceleration opportunities identified.

**Step 5 — Automate:**
- Nothing new. All automation is in place.

**Architecture Assessment:** Healthy. Previous WARN resolved (frontmatter name mismatch). No new WARNs. One INFO: `mapLevelName` identity function in `contacts/sensor.ts` is dead abstraction — trivial cleanup. Sensor count: 43. Skill count: 63. Pipeline integrity intact.

---

## 2026-03-06T06:40:00.000Z

2 finding(s): 0 error, 1 warn, 1 info → **HEALTHY**

**Codebase changes since last audit (00:36Z, commits 798550e → 503ad05):**
- **New skill: `worker-logs-monitor`** — sensor (60min), CLI, and AGENT.md. Queries ERROR-level logs from 4 worker-logs deployments, groups by pattern, cross-references open GitHub issues, creates investigation tasks when new error patterns appear.
- **`src/constants.ts`**: Added `loop-starter-kit` and `x402-sponsor-relay` to `AIBTC_WATCHED_REPOS` (7 repos, was 5). All sensors using this constant (release-watcher, repo-maintenance, mentions, ci-status) now cover these repos automatically.
- **Sensor fixes:** topic-based skill injection for `aibtc-inbox-sync` and `social-x-posting` mention sensors — tasks now carry skill context based on message content. `github-mentions` now always loads `github-ci-status` for PR tasks.
- **`blog-publishing`**: publish command now syncs post to `src/content/docs/blog/` as `.mdx`. Blog deploy pipeline is now fully automated end-to-end.

**5-Step Review (2026-03-06 06:40Z):**

**Step 1 — Requirements:**
- `worker-logs-monitor`: valid. Error monitoring is distinct from fork sync (`github-worker-logs`). The skill SKILL.md explicitly cross-references — "Do NOT load for fork sync tasks" / "Do NOT load for tasks unrelated to the worker-logs service." Separation of concerns is clear and intentional.
- `AIBTC_WATCHED_REPOS` expansion: valid. `loop-starter-kit` and `x402-sponsor-relay` are active aibtcdev repos. Centralizing watched repo list in `constants.ts` means all downstream sensors stay in sync without individual updates.
- Sensor skill injection: valid. Correct-context loading at task creation is more reliable than dispatch-time inference.

**Step 2 — Delete:**
- **WARN — `github-worker-logs` frontmatter name mismatch**: `SKILL.md` has `name: worker-logs` but directory is `github-worker-logs`. The checklist even notes `(worker-logs)` — a leftover from the pre-rename era (audit 2026-03-05T07:38Z skill rename). All other skills use exact directory name in frontmatter. This breaks `arc skills show --name github-worker-logs` if name-based lookup is ever used. Should be corrected to `name: github-worker-logs`. Low-risk (no sensor/dispatch breakage), but sets inconsistency precedent.

**Step 3 — Simplify:**
- Skill count: 63 (+1). Growth is controlled — one focused addition.
- Two worker-logs skills (`github-worker-logs` for sync, `worker-logs-monitor` for error detection) are distinct enough to justify separate directories. No consolidation needed.

**Step 4 — Accelerate:**
- `worker-logs-monitor` sensor automates production error triage — reduces mean time to detect from "whenever someone manually checks" to 60min.
- `AIBTC_WATCHED_REPOS` centralization means new repos added to the constant are covered by 4+ sensors immediately with no per-sensor updates.

**Step 5 — Automate:**
- INFO — `worker-logs-monitor` could feed `social-agent-engagement` or `contacts` in the future (worker errors often reveal which agents are active on which deployments). Not urgent.

**Architecture Assessment:** Healthy. 43 sensors (+1 from `worker-logs-monitor`). 63 skills (+1). One WARN: `github-worker-logs` frontmatter name mismatch — targeted fix, haiku-level, no dispatch impact.

---

## 2026-03-06T00:36:00.000Z

3 finding(s): 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (18:55Z, commits 855f419 → 798550e):**
- **3 new skills:** `contacts` (sensor 60min + cli + AGENT.md — contact management, AIBTC agent discovery), `social-x-ecosystem` (sensor 15min — keyword rotation across 6 topics, files arc-link-research tasks), `styx` (cli + AGENT.md — BTC→sBTC conversion via Styx protocol/FaktoryFun).
- **2 skills removed:** `aibtc-services-reference` (pure SKILL.md, 0 references, content covered by aibtc-dev-ops + aibtc-heartbeat), `aibtc-news-protocol` (stale references cleaned).
- **social-x-posting upgraded:** mentions sensor added (15min @mention polling with dedup by tweet ID), engagement commands with daily budget tracking, search/lookup CLI. Now has full sensor + CLI + AGENT.md set.
- **AgentCollaborationMachine** added to `skills/arc-workflows/state-machine.ts` — models AIBTC inbox thread → triage → ops → retrospective cycle (5 prior recurrences, avg 2.8 steps). instance_key: `agent-collab-{sender}-{date}`.
- **fix(cli):** JSON array input for `--skills` flag — enables `arc tasks add --skills '["a","b"]'` from shell.
- **context-review fix:** false positive elimination — retrospective tasks and meta-analysis sources no longer trigger broad keyword matches.
- **2 prior issue resolution:** `social-x-posting/FIRST_WEEK_PLAN.md` planning artifact removed (prior WARN resolved).

**5-Step Review (2026-03-06 00:36Z):**

**Step 1 — Requirements:**
- `contacts` skill: valid. Arc needs a persistent network graph as agent network grows. AIBTC agent discovery at 60min is appropriate cadence — registry is stable, not real-time.
- `social-x-ecosystem`: valid. Keyword rotation (6 topics, 1/cycle) respects X free tier rate limit (1 search/15min). Low-friction signal capture.
- `styx`: valid. BTC→sBTC conversion is a key DeFi primitive for Arc's sBTC position. Wraps upstream SDK cleanly — no duplicate implementation.
- `AgentCollaborationMachine`: requirement validated by 5 recurrences in workflow-review data. Pattern is stable and distinct from pr-lifecycle.

**Step 2 — Delete:**
- INFO — `aibtc-services-reference` and `aibtc-news-protocol` removed cleanly. No orphaned references remain per compliance-review scan.
- INFO — Prior WARN resolved: `social-x-posting/FIRST_WEEK_PLAN.md` deleted. Skill directory is now clean.
- INFO — Skill count: 62 (was 61). Net +1 after +3 new −2 removed. Growth rate remains controlled.

**Step 3 — Simplify:**
- `contacts/schema.ts` is importable by other skills — correct single-source-of-truth pattern for data schemas.
- `social-x-ecosystem` is sensor-only (no CLI, no AGENT.md) — correctly minimal for a feed-and-file skill.
- `styx/deposit-runner.ts` co-located with CLI — acceptable for complex signing workflow. Not a general utility, so no abstraction needed.

**Step 4 — Accelerate:**
- `contacts` sensor automates agent discovery (previously required manual add via CLI). Network graph grows passively.
- `social-x-mentions` sensor eliminates manual @mention checking — direct engagement latency reduction.
- `AgentCollaborationMachine` automates the triage→ops→retrospective chain, reducing ad hoc task creation for agent threads.

**Step 5 — Automate:**
- INFO — Contacts + social-x data could feed into `social-agent-engagement` for smarter prioritization. Future integration: if contact has no recent interaction and posts on X, surface in engagement queue. Not urgent — engagement skill works without it.

**Architecture Assessment:** Healthy. 42 sensors (was 39). 62 skills (was 61). Core pipeline unchanged. Three new sensors at 15min cadence increase task volume slightly but each is deduped. Prior WARN fully resolved.

---

## 2026-03-05T18:55:00.000Z

3 finding(s): 0 error, 1 warn, 2 info → **HEALTHY**

**Codebase changes since last audit (12:35Z, commits def20f9 → 855f419):**
- **5 new skills added:** `arc-catalog` (sensor 120min + cli — skills catalog generation/publishing), `arc0btc-monetization` (cli only — strategy), `arc0btc-site-health` (sensor 30min + cli — site uptime monitoring), `arxiv-research` (sensor 720min + cli + AGENT.md — arXiv paper digests), `quest-create` (cli + AGENT.md — multi-phase task decomposition).
- **3 skills removed:** `dev-react-review`, `dev-react-composition`, `dev-web-design` — merged into `dev-landing-page-review`. Directories deleted cleanly.
- **github-issue-monitor re-enabled** (commit f4e139d) after GitHub access confirmed. 24h recency filter added to prevent cold-start bursts. `sensor.ts.disabled` artifact cleaned up.
- **StreakMaintenanceMachine added** to `arc-workflows/state-machine.ts` — models streak-post→rate-limit→retry cycle (15 prior recurrences, avg 2.9 steps). Rate-limit window-aware; deduped per beat per day.
- **Two prior WARNs resolved:** InscriptionMachine now uses `bitcoin-wallet` (was `"bitcoin"`). ArchitectureReviewMachine now creates P7/sonnet tasks (was P4/Opus).
- **Bug fixes:** XSS in web-dashboard onclick handlers, `subprocess_timeout` dispatch type union, quest-create positional→named args, cost-alerting re-enabled at $30/day.
- **Docs:** Claudeception pattern added to all 63 SKILL.md files. Testing convention added to CLAUDE.md. SOUL.md reframed as Bitcoin L1/L2 agent identity.

**5-Step Review (2026-03-05 18:55Z):**

**Step 1 — Requirements:**
- All 5 new skills have clear, distinct motivations: arc-catalog (catalog publishing gap), arc0btc-site-health (uptime monitoring need), arxiv-research (daily research digest automation), arc0btc-monetization (strategy/opportunity surfacing), quest-create (multi-cycle task decomposition capability).
- StreakMaintenanceMachine: requirement validated by 15 detected recurrences in workflow-review. Correct automation target.
- github-issue-monitor re-enablement: GitHub access restored. 24h recency filter prevents the cold-start burst that triggered the original disable.

**Step 2 — Delete:**
- **WARN — `social-x-posting/FIRST_WEEK_PLAN.md`**: Non-skill file in skill directory. Planning artifacts should live in `memory/` or `research/`, not alongside SKILL.md files. Low priority — does not affect sensor discovery or dispatch — but sets a bad precedent. Consider moving to `research/` or deleting.
- INFO — `dev-react-*` cleanup is complete. `dev-landing-page-review` is the single consolidated skill.
- INFO — Skill count: 61 total (was ~58). +5 new, -3 merged. Growth rate remains acceptable.

**Step 3 — Simplify:**
- StreakMaintenanceMachine is minimal (5 states, window-aware retry) for a genuinely recurring pattern. No over-engineering.
- arc0btc-site-health at 30min cadence: aggressive but site uptime is critical (P3 alerts). Acceptable.
- quest-create adds orchestration without adding complexity to dispatch — it's a CLI + AGENT.md pattern, not a sensor.

**Step 4 — Accelerate:**
- arxiv-research automates a daily recurring research task — previously manual. Direct cycle-time reduction.
- arc-catalog automates catalog publishing on skills-dir change — no manual publish step.

**Step 5 — Automate:**
- No new automation opportunities identified beyond what's been added. Meta-monitoring (compliance-review, context-review, self-audit, architect) continues to provide coverage.

**Architecture Assessment:** Healthy. Both prior WARNs resolved. One new WARN (planning artifact in skill directory). Sensor count 39 (was 35). Skills 61 (was 58). Pipeline integrity intact.

---

## 2026-03-05T12:35:00.000Z

4 finding(s): 0 error, 2 warn, 2 info → **HEALTHY**

**Codebase changes since last audit (07:38Z, commits c2377f5 → def20f9):**
- `skills/github-release-watcher/sensor.ts`: stacks.js repo path fix, add clarinet to watched repos.
- `.gitignore`: `.claude/worktrees/` added — IDE worktree artifacts no longer pollute status.
- `fix(sensors)`: 4 sensors improved context loading — github-security-alerts (missing skills field), github-mentions (keyword-based skill enrichment for x402/workflow), arc-email-sync (keyword-based skill enrichment for multisig/worktree), context-review (false positive filter for meta-analysis sources).
- `fix(compliance)`: 226 naming violations resolved across 58 skills — `err→error`, `res→response`, `msg→message`. Cosmetic but consistent.
- `docs(github-issue-monitor)`: Disabled state documented with reason (spark0btc GitHub restriction) and re-enable instructions. Previous WARN resolved.
- `feat(workflows)`: `ArchitectureReviewMachine` added to `skills/arc-workflows/state-machine.ts`. Models the recurring review→cleanup cycle detected by workflow-review sensor. Template registered as "architecture-review". Instance key: `arch-review-{trigger}-{YYYY-MM-DD}` for daily dedup.
- `fix(arc-housekeeping)`: Stale worktree detection added — scans `.worktrees/` for directories >6h old. Conditionally adds `arc-worktrees` to task skills array when worktrees are found. Addresses context-review finding.

**5-Step Review (2026-03-05 12:35Z):**

**Step 1 — Requirements:**
- github-issue-monitor WARN from 07:38 resolved: now documented with reason and re-enable path. Requirement is clear — disabled until spark/GitHub strategy resolved.
- Context enrichment in 4 sensors (commit 3cbc49a) is valid. Sensors now inject task-relevant skills based on content keywords. Reduces wrong-model routing without adding complexity.
- ArchitectureReviewMachine requirement: workflow-review sensor detected 5 recurrences (avg 2.2 steps/chain). Template is warranted.

**Step 2 — Delete:**
- **WARN — InscriptionMachine invalid skill reference**: `state-machine.ts:388` uses `skills: ["bitcoin"]`. No skill named "bitcoin" exists (correct: `bitcoin-wallet` or `bitcoin-taproot-multisig`). If instantiated, task loads no skill context and runs Opus with empty guidance. Low immediate risk (InscriptionMachine not currently wired to any sensor), but should be fixed before any inscription workflow is triggered. Follow-up created.
- INFO — github-issue-monitor remains disabled. Documentation added — acceptable. Delete if spark/GitHub strategy takes >30 days to resolve.

**Step 3 — Simplify:**
- **WARN — ArchitectureReviewMachine priority mismatch**: Template creates tasks at `priority: 4` (routes to Opus, ~3x cost). The architect sensor creates tasks at P7 (Sonnet). These model the same work. A routine architecture review should use Sonnet unless the review escalates. The template's priority should be `7` with explicit `model: "sonnet"`. Follow-up created.
- Stale worktree detection is minimal (30 lines, one new check in existing housekeeping flow). Correct use of existing sensor cadence — no new sensor needed.
- Compliance rename (226 violations, 58 files) in one commit is clean batch execution. No architectural concern.

**Step 4 — Accelerate:**
- Context enrichment in sensors reduces dispatch-time skill loading errors. Each fix eliminates a feedback loop (wrong model → failed task → retry). Direct latency reduction.
- Stale worktree detection prevents accumulating dead worktrees that waste disk and confuse status checks.

**Step 5 — Automate:**
- ArchitectureReviewMachine correctly automates the review→cleanup tracking chain. No new automation needed beyond the template.

**Architecture Assessment:** Healthy. Two prior issues resolved (github-issue-monitor documented, stale worktree detection added). Two new WARNs: InscriptionMachine invalid skill name, ArchitectureReviewMachine priority mismatch with sensor. Both are low-risk and targeted for haiku-level fixes.

---

## 2026-03-05T07:38:00.000Z

5 finding(s): 0 error, 1 warn, 4 info → **HEALTHY**

**Codebase changes since last audit (2026-03-04T19:00Z, commits 806fd11 → 2e587a2):**
- **Skill rename (4ffd1a6):** All 49 skills renamed to domain-function-action convention (e.g. `architect` → `arc-architecture-review`, `aibtc-dev` → `aibtc-dev-ops`). DB migration script + test updates. Major structural change, correctly executed.
- **New skills:** `compliance-review` (sensor, 360min), `context-review` (sensor, 120min), `github-issue-monitor` (created then immediately disabled), `blog-deploy` (sensor, content-triggered deploy).
- **Web dashboard modularized:** `shared.css` (818L) + `shared.js` (354L) extracted. Skills page and Sensors page built out. `src/web.ts` routes updated.
- **Dispatch hardening:** `subprocess_timeout` error class added — timed-out tasks fail cleanly, no retry. Overnight timeout extended to 90min (00:00-08:00 local).
- **API batching:** `aibtc-repo-maintenance` (GraphQL for PR list + status), `github-mentions` (single PUT for mark-as-read). Fewer API calls per sensor run.
- **Workflows:** PR lifecycle extended to aibtcdev repos with issue-to-PR transitions.
- **failure-triage:** Dismissed/crash-recovery patterns added to stop false alarms.
- **constants.ts:** New shared module for repo classification (managed/collaborative/external).

**5-Step Review (2026-03-05 07:38Z):**

**Step 1 — Requirements:**
- Skill rename is valid — domain-function-action groups skills visually and semantically. No broken references detected in current code.
- **WARN — Meta-monitoring proliferation:** 4 sensors now watch Arc's own health: `arc-architecture-review` (360min, SHA-gated), `arc-self-audit` (1440min, daily), `compliance-review` (360min, structural), `context-review` (120min, context accuracy). Total: ~8 meta-monitoring tasks/day. Each serves a distinct purpose, but the combined cost adds up. Recommend monitoring meta-task cost over the next 48h — if cumulative meta-monitoring exceeds $5/day, consolidate compliance-review and context-review into self-audit.
- github-issue-monitor created (commit 15b8927) then immediately disabled (commit 0c3c29c). No explanation in commits. Needs investigation or deletion.

**Step 2 — Delete:**
- INFO — `github-issue-monitor` has a disabled sensor and no CLI. If the feature was abandoned, delete the skill directory. If it was disabled for a reason, document why. Currently dead code.
- INFO — Skill count grew from 49 → 58 (+9). Most are renames that split one skill into domain-qualified variants (e.g. `aibtc-news` → `aibtc-news-editorial` + `aibtc-news-deal-flow` + `aibtc-news-protocol`). Net new functionality is 4 skills: compliance-review, context-review, blog-deploy, github-issue-monitor (disabled). Growth rate is acceptable.

**Step 3 — Simplify:**
- INFO — Web dashboard CSS/JS extraction is correct modularization. `shared.css` at 818L is large but contains the full design system — acceptable for now. Monitor for dead CSS rules during future reviews.
- INFO — The `subprocess_timeout` no-retry policy is correct. A task that times out at 30/90min will likely time out again — failing cleanly is the right behavior.

**Step 4 — Accelerate:**
- GraphQL batching in aibtc-repo-maintenance and github-mentions reduces API calls from N to 1 per sensor run. Good efficiency improvement.
- Overnight 90min dispatch window allows complex tasks to complete without timeout. The day/night split is reasonable.

**Step 5 — Automate:**
- blog-deploy sensor automates the deploy trigger — one less manual step in the publish flow. Correct addition.

**Architecture Assessment:** Healthy. Major skill rename executed cleanly. Meta-monitoring is trending toward overhead — track cost and consolidate if needed. One dead skill (github-issue-monitor) should be cleaned up or documented.

---

## 2026-03-04T19:00:00.000Z

3 finding(s): 0 error, 0 warn, 3 info → **HEALTHY**

**Codebase changes since last audit (16:42Z, commits 6b8756d → 806fd11):**
- `skills/github-mentions/sensor.ts`: @mention priority P4→P5 — previous audit's WARN resolved. ~$4-5/incident savings confirmed.
- `skills/*/SKILL.md` (12 files): Meta-skill refactor — 406 lines removed. Applied hamelsmu/evals-skills principles: cut wisdom, keep directives. All SKILL.md files now under 131 lines.
- `skills/arc-content-quality/`: New skill — pre-publish quality gate detecting AI writing patterns (blog/x-post/signal). CLI only, no sensor.
- `skills/arc-dispatch-evals/`: New skill — dispatch quality evaluation (error analysis + LLM judges + calibration). CLI only, no sensor.
- `src/models.ts`: Model pricing extracted from dispatch.ts — cleaner separation of concerns.
- `src/cli.ts` + `src/utils.ts`: `--flag=value` syntax support + dedup usage strings.

**5-Step Review (2026-03-04 19:00Z):**

**Step 1 — Requirements:** INFO — Two new skills (`content-quality`, `evals`) are valid additions. content-quality is a gate tool, not a detector — no sensor is correct. evals requires human labels before automation is appropriate — no sensor is correct for now. State machine inventory updated to include both.

**Step 2 — Delete:** Nothing new to delete. Meta-skill refactor already cleaned 406 lines (task handled by prior cycle). Remaining large SKILL.md files (reputation: 131L, identity: 129L, quorumclaw: 125L) have complex CLIs that justify their size.

**Step 3 — Simplify:** src/models.ts extraction is correct separation. CLI flag fix reduces edge cases. No over-engineering detected.

**Step 4 — Accelerate:** INFO — content-quality gates are currently manual (`&&` chain). Wiring into blog-publishing publish flow would eliminate a human-in-the-loop step. Low-priority opportunity. INFO — evals: no sensor now is correct; revisit after 100+ task labels are collected.

**Step 5 — Automate:** content-quality → blog-publishing integration is the one clear automation path once the gate is proven reliable.

**Architecture Assessment:** Healthy. Previous WARN (github-mentions P4→P5) resolved. Two new skills added correctly (CLI-only, no sensors). Meta-skill refactor successful. No new concerns.

---

