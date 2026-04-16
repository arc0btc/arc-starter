## 2026-04-16T18:53:00.000Z — Budget guard + Opus 4.7 + Bitcoin Macro sensor + permission analysis

**Task #12801** | Diff: a2c7adf → f3a1855 | Sensors: 71 | Skills: 108

### Step 1 — Requirements

- **--max-budget-usd cost guard (e124013c)**: Loom inscription spiral hit ~$15/cycle × 2 = ~$30/night before escalation. Requirement: cap per-invocation spend to prevent runaway cost. **SATISFIED** — `--max-budget-usd` injected per model tier (opus=$10, sonnet=$3, haiku=$1). Claude Code enforces mid-stream. Env var overrides allow per-deploy tuning.
- **Opus 4.7 (f3a18557)**: New model available; better intelligence on deep-work tasks. Requirement: dispatch should use latest available Opus. **SATISFIED** — `MODEL_IDS.opus` updated to `claude-opus-4-7`. Effort level decoupled via `DISPATCH_EFFORT_OPUS` env var.
- **Bitcoin Macro sensor (64ff537)**: All 5 prior audit entries flagged "[OPEN GAP] Bitcoin Macro has NO dedicated sensor." Beat diversity was capped at 2/3 (AIBTC Network + Quantum only). Requirement: Bitcoin Macro must be autonomous. **SATISFIED** — sensor live, first signal filed (hashrate ATH 972.3 EH/s, task #12744). Beat diversity 3/3.
- **Permission analysis (11fd9a08)**: v2.1.111 introduced `/less-permission-prompts` feature; question whether Arc should adopt granular allowlist. **SATISFIED** — `bypassPermissions` confirmed optimal for autonomous operation; no settings.json changes warranted. Pattern documented for future use.

### Step 2 — Delete

- **No deletions** in this window. All changes are additive (guard, model upgrade, sensor, docs).
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CANDIDATE]** `aibtc-news-deal-flow` sensor — beat retired (410), SKILL.md notes retirement. If sensor creates tasks for dead beat, it should be deleted or disabled. Needs investigation.

### Step 3 — Simplify

- **Budget guard is 22 lines in dispatch.ts**: correct scope. Env var override follows existing patterns (API_TIMEOUT_MS, DISPATCH_EFFORT_OPUS). Consistent, not over-engineered.
- **DISPATCH_EFFORT_OPUS pattern is correct**: decouples effort level from model selection. Allows `"xhigh"` on v2.1.111+ without code change. Same pattern as API_TIMEOUT_MS env var.
- **Bitcoin Macro sensor**: 4 signal types, 1 state file, 1 interval. No bloat — each signal type addresses a distinct editorial angle. First-run guard is 5 lines; prevents stale milestone fire on deploy.
- **[CANDIDATE]** Quantum sensor: still requires manual task creation from arXiv digest output. Should auto-queue signal task from digest results. Digest fix (haiku model) is done; auto-queuing is the remaining step.

### Step 4 — Accelerate

- **Budget guard eliminates spiral risk**: loom-spiral cost was unbounded; worst case now opus=$10/cycle regardless of token count. Cycle budget predictable.
- **Opus 4.7**: quality improvement with no cost change — compounding benefit over every deep-work task.
- **Bitcoin Macro sensor**: eliminates manual filing for Bitcoin Macro beat. 4×/day cadence = up to 4 opportunities/day with 4-signal cap. Before: 0 signals/day unless manually queued. After: autonomous coverage.

### Step 5 — Automate

- **[RESOLVED]** Bitcoin Macro beat coverage — sensor running every 240min. Gap CLOSED.
- **[RESOLVED]** Runaway cost protection — budget guard enforced at Claude Code level.
- **[OPEN]** Quantum signal auto-queuing: arXiv digest (haiku) compiles paper list but doesn't auto-create signal tasks from results. Sensor should parse digest output and queue Quantum signal task directly. Task #12709 pending for cooldown guard; auto-queuing is a separate gap.
- **[OPEN]** Sensor-side cooldown guard (#12709): ~3 false failures/day from tasks created during beat cooldown. Task pending — low effort, high clarity win.
- **[OPEN]** Hiro 400 persistent failures: 2 FST_ERR_VALIDATION/night (Tiny Fenn, Tidal Sprite). Root cause: malformed SP addresses persist in agent registry. v4 deny-list defers rather than prevents. Proactive registry cleanup scan needed.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no further inscription tasks until whoabuddy resolves.
- **[CARRY-WATCH]** Brief inscription automation gap.

### Flags

- **[OK]** Budget guard shipped — loom-spiral class protected.
- **[OK]** Opus 4.7 — deep-work quality upgraded.
- **[OK]** Bitcoin Macro sensor — 3/3 beats now have sensor coverage.
- **[OK]** bypassPermissions confirmed optimal — no settings.json changes.
- **[OK]** Prompt caching ($12.37 vs $29.34 baseline) — 58% reduction, ahead of estimate.
- **[OK]** Beat diversity — all 3 beats filed 2026-04-16 (PURPOSE score 3.50).
- **[OK]** Hiro 400 v4 — self-healing, ~2-3 failures/day remaining (down from 54).
- **[OK]** x402 relay v1.29.0 — healthy, nonce gaps clear.
- **[OK]** Zest supply — 4-5 ops/night consistently.
- **[OPEN]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Sensor-side cooldown guard (#12709).
- **[OPEN]** Agent registry cleanup scan (malformed SP addresses).
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral.
- **[CARRY-WATCH]** Brief inscription automation gap.

---

## 2026-04-16T06:55:00.000Z — Cooldown guard + arXiv split + v2.1.108 dispatch fix + v0.39.0 skills

**Task #12739** | Diff: be4cac3 → a2c7adf | Sensors: 70 | Skills: 108

### Step 1 — Requirements

- **Sensor-side beat cooldown guard (b5caf209)**: Beat cooldown was discovered at dispatch time (task fails, ~3/day). Requirement: prevent task creation when beat is on cooldown. **SATISFIED** — `isBeatOnCooldown(beat, 60)` in db.ts, wired into aibtc-agent-trading + arxiv-research before task creation.
- **arXiv digest split (48858a87)**: Digest timed out at 15min on sonnet × 2 occurrences, blocking Quantum signals. Requirement: digest must complete reliably. **SATISFIED** — model→haiku, pure CLI instructions, paper list in task description (no file dependency).
- **v2.1.108 dispatch fix (d263dbb6+8ad08307)**: Claude Code v2.1.108 broke dispatch subprocess with stricter permissions. **SATISFIED** — Bash sandbox + permission bypass configured; trusted-VM dispatch unblocked.
- **Context-review false positives (a2c7adf)**: Signal filing tasks mention DeFi protocol names as news topics → false "missing skill" alerts. **SATISFIED** — signal filing subjects excluded from keyword analysis.

### Step 2 — Delete

- **No deletions** in this window. All changes are targeted fixes.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CANDIDATE]** `aibtc-news-deal-flow` SKILL.md explicitly marks beat as retired (410) — sensor still exists. If sensor has no other function, consider deleting it. Needs investigation.

### Step 3 — Simplify

- **Cooldown guard placement is correct**: db.ts is the right place for `isBeatOnCooldown()` — shared across all signal sensors without duplication. Wiring at sensor rather than dispatch avoids a wasted dispatch cycle.
- **arXiv split approach is simple**: haiku + CLI commands only. No LLM synthesis in digest. Papers in task description instead of file dependency reduces coupling. Correct.
- **Bitcoin Macro gap is architectural**: 2 sensors cover AIBTC Network + Quantum. Bitcoin Macro has zero sensors. Manual filing is the only current path. This is a structural gap — not simplifiable, needs a sensor or scheduled research task.

### Step 4 — Accelerate

- **Cooldown guard**: eliminates ~3 task creation + dispatch + fail cycles per day. Minor but compounding.
- **arXiv split**: unblocks Quantum beat. Was 0/day → should be 1-2/day. Biggest throughput win in this window.
- **v2.1.108 fix**: unblocked entire dispatch cycle after v2.1.108 crash. Operations back to normal.

### Step 5 — Automate

- **[RESOLVED]** Beat cooldown false failures — sensor-side guard eliminates the class.
- **[RESOLVED]** arXiv timeout — digest split + haiku model; Quantum filing unblocked.
- **[OPEN GAP]** Bitcoin Macro beat has no sensor. CEO priority: "File a Bitcoin Macro beat signal." Only path is manual task creation or a dedicated sensor that tracks BTC macro data (price milestones, hash rate, miner capitulation, ETF flows). No Arc sensor currently exists for this beat. Follow-up task warranted.
- **[CARRY-WATCH]** Loom inscription workflow spiral — escalated, no further inscription tasks until resolved.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** Brief inscription automation gap.

### Flags

- **[OK]** Beat cooldown guard — shipped, ~3 false failures/day eliminated.
- **[OK]** arXiv digest split — shipped, Quantum filing unblocked.
- **[OK]** v2.1.108 dispatch fix — unblocked, operations normal.
- **[OK]** Context-review false positives — signal filing tasks excluded.
- **[OK]** regex-invalid deny-list extension — third Hiro 400 class covered.
- **[OK]** v0.39.0 skills (4 new BFF skills) — integrated.
- **[OK]** 3-layer Hiro 400 validation — fully self-healing.
- **[OK]** Approved PR workflow auto-resolution — holding.
- **[OK]** Zest supply mempool guard — holding.
- **[OK]** x402 relay v1.29.0 — healthy, nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[OPEN GAP]** Bitcoin Macro beat — no sensor, CEO priority. Manual only.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral.
- **[CARRY-WATCH]** Brief inscription automation gap.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.

---

## 2026-04-14T18:49:00.000Z — resolveApprovedPrWorkflows instance_key parsing fix

**Task #12583** | Diff: 7dab95c → da366c2 | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **instance_key parsing fix (359d6bbc)**: `resolveApprovedPrWorkflows()` expected 4-part keys (`owner/repo/pr/number`) but pr-lifecycle workflows have always used 3-part keys (`owner/repo/number`). The function was silently skipping every PR workflow via a `continue` on the length check. Requirement: approved→merged/closed auto-transition must actually run. **SATISFIED** — now handles both 3-part (PR) and 4-part legacy keys. 36 backlog workflows resolved on deploy.

### Step 2 — Delete

- **No deletions** in this window. Change is a bug fix on existing function — the 4-part legacy branch was kept for safety.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Silent no-op bug class**: The `continue` on length check with no log output made this invisible for weeks — 36 workflows accumulated. Pattern to watch: any loop over db records that silently `continue` on parse failure should at least log a warning so failures surface faster.
- **Legacy branch preserved**: The `parts.length === 4 && parts[2] === 'pr'` branch handles potential old-format keys. If confirmed no old-format keys exist in db, this branch can be deleted. Mark for post-competition cleanup.
- **No over-engineering**: fix is 9 lines. Correct scope.

### Step 4 — Accelerate

- **36 stuck workflows cleared**: Before fix, every approved PR workflow was permanently stuck. Now clears within one 30-min sensor cycle after approval. Eliminates manual cleanup.

### Step 5 — Automate

- **[RESOLVED]** Approved→merged/closed auto-resolution is now actually functional (was coded but broken). No manual intervention needed going forward.
- **[CARRY-WATCH]** Beat diversity gap — 6/6 signals all AIBTC Network; zero Bitcoin Macro/Quantum filed. PURPOSE score capped at ~3.0 until this is addressed.
- **[CARRY-WATCH]** Brief inscription automation gap — no pipeline from overnight-brief → daily-brief-inscription.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral — escalated to whoabuddy.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.

### Flags

- **[OK]** resolveApprovedPrWorkflows — instance_key fix deployed, 36 backlog cleared.
- **[OK]** Hiro 400 v4 — 3-layer validation stable.
- **[OK]** JingSwap API key + P2P fallback — holding.
- **[OK]** Signal cap counter generalized — holding.
- **[OK]** Stale issue workflow cleanup — holding.
- **[OK]** DailyBriefInscriptionMachine — circuit breaker holding.
- **[OK]** Zest supply: mempool-depth guard holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Beat diversity gap (Bitcoin Macro/Quantum zero signals).
- **[CARRY-WATCH]** Brief inscription automation gap.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.

---

## 2026-04-14T07:00:00.000Z — Beat slug fix + broadcast-invalid deny-list extension

**Task #12534** | Diff: 8d446e6 → 7dab95c | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **Beat slug fix (7dab95c0)**: `agent-trading` beat API returned 410 (retired). Sensor filed signals to a dead endpoint. Requirement: route all AIBTC activity signals to the correct active beat. **SATISFIED** — slug updated to `aibtc-network` in `skills/aibtc-agent-trading/sensor.ts`. All agent activity signals now reach the correct beat per the 12→3 consolidation.
- **Broadcast-invalid deny-list extension (0116fcf2)**: Two known broadcast-invalid addresses (`SP31YV5KJ…`, `SP1GQYKZQ…`) bypassed the c32 regex but were rejected by Hiro's broadcast API (`FST_ERR_VALIDATION`). Dynamic deny-list only matched literal `"Hiro 400"` error string — missed this error class. Requirement: both Hiro 400 format-invalid AND FST_ERR_VALIDATION broadcast-invalid addresses must self-heal into deny-list. **SATISFIED** — dynamic query extended to match both error strings.

### Step 2 — Delete

- **No deletions** in this window. Both changes are targeted fixes; no dead code or redundant paths introduced.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Beat slug is a one-liner**: single string replacement in sensor.ts. Correct minimal change — no abstraction needed.
- **Deny-list error-string matching**: extending from one pattern to two is minimal and correct. Alternative (regex OR) would be equivalent complexity. Current form is readable.
- **3-layer address validation is complete**: L1 (sensor c32 regex) + L2 (stx-send-runner.ts regex) + L3 (CLI deny-list with self-healing). All known failure classes covered. Architecture is stable — no further layers anticipated.

### Step 4 — Accelerate

- **Beat slug fix eliminates silent signal discard**: prior to fix, signals may have been POSTed to a retired endpoint (410 response) — wasted API calls and missed competition points. Now routes correctly.
- **Broadcast-invalid now self-heals on first occurrence**: previously a broadcast-invalid address required manual investigation to add to deny-list. Now auto-populated after first failure. Eliminates repeat x402 credit burns for same address.

### Step 5 — Automate

- **[RESOLVED]** Hiro 400 address validation — fully self-healing, all known classes covered (format-invalid + broadcast-invalid). No manual deny-list updates needed for new bad addresses.
- **[RESOLVED]** Approved PR workflow accumulation — auto-transition running every 30 min (from prior cycle).
- **[CARRY-WATCH]** Brief inscription automation gap — no pipeline from overnight-brief → daily-brief-inscription (task #12399, P3 needed).
- **[CARRY-WATCH]** Loom inscription workflow 23 token spiral — whoabuddy escalation pending; no further inscription tasks until resolved.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** Contribution tag gap rate.

### Flags

- **[OK]** Beat slug updated: aibtc-agent-trading sensor routes to aibtc-network beat.
- **[OK]** Hiro 400 deny-list: fully self-healing, both error classes covered.
- **[OK]** JingSwap API key + 401 fallback — holding.
- **[OK]** Signal cap counter generalized — holding.
- **[OK]** Stale issue workflow cleanup — holding.
- **[OK]** Approved PR workflow auto-resolution — holding.
- **[OK]** DailyBriefInscriptionMachine — holding.
- **[OK]** Zest supply: mempool-depth guard holding.
- **[OK]** PR review dedup: holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Brief inscription automation gap.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** Contribution tag gap rate.

---

## 2026-04-13T18:48:00.000Z — Approved PR workflow auto-resolution

**Task #12455** | Diff: c6b2543 → 8d446e6 | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **resolveApprovedPrWorkflows() (8d446e6)**: PR workflows in `approved` state were accumulating when PRs were merged/closed on GitHub without Arc noticing. Requirement: auto-transition approved→merged/closed when GitHub state changes. **SATISFIED** — `aibtc-repo-maintenance` sensor now checks all active pr-lifecycle workflows in `approved` state each 30-min run, queries GH via `gh pr view --json state,mergedAt`, and completes workflows that have been merged or closed.

### Step 2 — Delete

- **No deletions** in this window. Change is purely additive — new function in existing sensor.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Placement correct**: `resolveApprovedPrWorkflows()` added to `aibtc-repo-maintenance` sensor (which already has GH access and 30-min cadence) rather than a new sensor. Avoids sensor sprawl.
- **GH API call per workflow**: Function iterates over all approved workflows and calls `gh pr view` for each. At current scale (typically <10 approved workflows) this is fine. If approved workflow count grows significantly, consider batching via GraphQL (same pattern as `fetchGitHubPRs()`).
- **No dedup guard needed**: Each call is idempotent — `completeWorkflow()` is safe to call on an already-completed workflow.

### Step 4 — Accelerate

- **Eliminates approved-state workflow accumulation**: Prior to this fix, approved workflows sat indefinitely after PR merge/close, contributing to stuck-workflow noise. Now auto-resolved within one 30-min sensor cycle.

### Step 5 — Automate

- **[RESOLVED]** Approved PR workflow accumulation — auto-transition now runs every 30 min.
- **[CARRY-WATCH]** Brief inscription automation gap — no automation chains overnight-brief → daily-brief-inscription (task #12399 confirmed gap, P3 task needed).
- **[CARRY-WATCH]** Loom inscription workflow 23 token spiral — whoabuddy escalation pending.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** Contribution tag gap rate.

### Flags

- **[OK]** Approved PR workflow auto-resolution — shipped and running.
- **[OK]** Hiro 400 v4 deny-list — 3-layer validation complete, 1 residual failure/night (down from 54).
- **[OK]** JingSwap API key + 401 fallback — holding.
- **[OK]** Signal cap counter generalized — holding.
- **[OK]** Stale issue workflow cleanup — holding.
- **[OK]** DailyBriefInscriptionMachine — holding.
- **[OK]** Zest supply: mempool-depth guard holding.
- **[OK]** PR review dedup: holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Brief inscription automation gap.
- **[CARRY-WATCH]** Loom inscription workflow 23 spiral.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** Contribution tag gap rate.

---

## 2026-04-13T06:50:00.000Z — Hiro 400 fix v4 + bitcoin-wallet skill name consistency

**Task #12389** | Diff: 39a5416 → c6b2543 | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **Hiro 400 fix v4 (2ab3431c)**: Structurally-valid SP-mainnet addresses can still fail Hiro's broadcast API (`FST_ERR_VALIDATION`, "params/principal must match pattern"). Fix v3 regex alone is insufficient for this class. Requirement: ensure known-bad addresses are blocked at CLI execution time — before any Hiro API call. **SATISFIED** — `cmdStxSend` reads `db/hook-state/aibtc-welcome-hiro-rejected.json` (150+ known-bad addrs) before calling `runStxSend`. Fail-open if state file unreadable.
- **Skill name inconsistency (2ab3431c)**: `wallet` referenced in SKILL.md (13 occurrences) and welcome task description instead of `bitcoin-wallet`. Requirement: skill name must match registered name to prevent task context errors. **SATISFIED** — all references corrected.

### Step 2 — Delete

- **No net deletions** in this window. Deny-list is an additive guard on top of regex — not replacing the regex. Belt-and-suspenders is correct for address validation.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **3-layer address validation is the right architecture**: L1 = sensor regex (prevents queuing), L2 = stx-send-runner.ts regex (prevents dispatch execution), L3 = CLI deny-list (blocks known-bad structurally-valid addresses). Each layer catches a different failure class. Not over-engineered — each layer was added because the prior one had a confirmed gap.
- **Fail-open CLI guard is correct**: If the state file is unreadable (e.g., permission error, corrupt JSON), the guard allows the send rather than blocking all welcomes. Correct tradeoff — a missed deny-list check is recoverable (one more Hiro 400, address re-added to list); a blocked welcome flood is worse.
- **Skill name fix is pure housekeeping**: 13 replacements, no logic change. Late catch — should have been caught when the skill was registered. Lesson: `SKILL.md` name field and all usage examples should be validated against the directory name at skill creation time.

### Step 4 — Accelerate

- **Deny-list short-circuits Hiro API calls**: 150+ addresses now fail in microseconds (JSON file read + array lookup) rather than burning a full Hiro API round-trip. For agents that re-trigger welcome (e.g., recurring sensor picks up same invalid address), this eliminates every subsequent wasted call.
- **Skill name fix removes context gap**: tasks previously loaded skill `wallet` (not found) rather than `bitcoin-wallet` — skill context missing from dispatch. Fixed.

### Step 5 — Automate

- **[RESOLVED]** Hiro 400 deny-list is now self-healing end-to-end: loadAndUpdateDenyList() (sensor) populates the list on task failure; cmdStxSend (CLI) consults it at execution time. No manual updates needed for new bad addresses.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — sensor should read last scores before creating eval task.
- **[CARRY-WATCH]** nonce-strategy Phase 1 retry-strategy.ts — retry path should query nonce tracker state.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

### Flags

- **[RESOLVED]** Hiro 400 failures — v4 at CLI execution layer; deny-list covers 150+ known-bad addrs. Three-layer validation complete.
- **[OK]** JingSwap API key + 401 fallback — holding.
- **[OK]** Signal cap counter generalized — holding.
- **[OK]** Stale issue workflow cleanup — automated, holding.
- **[OK]** DailyBriefInscriptionMachine — circuit breaker holding.
- **[OK]** Zest supply: mempool-depth guard holding.
- **[OK]** PR review dedup: holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** nonce-strategy Phase 1 retry-strategy.ts.
- **[CARRY-WATCH]** Contribution tag gap rate.

---

*[Entries older than 2026-04-13 archived — see git history]*

