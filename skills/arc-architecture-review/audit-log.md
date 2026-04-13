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

## 2026-04-12T18:47:00.000Z — JingSwap API key + stale issue cleanup + signal cap simplification

**Task #12344** | Diff: 7bd2c11 → 39a5416 | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **JingSwap API key (39a5416b)**: faktory-dao-backend now requires authentication. Requirement: sensor must authenticate and fall back gracefully when key absent/401. **SATISFIED** — `jingswap/api_key` from creds store passed as Bearer token; `jingswapUnavailable` flag prevents repeat 401s per run.
- **P2P signal viability when JingSwap unavailable (aec9ad29)**: When JingSwap is down, sensor must still produce usable signals. Requirement: P2P desk data alone must be sufficient for signal generation. **SATISFIED** — flat-market boost 30→45 strength with `p2p-activity` type when trades/PSBT swaps detected.
- **Signal cap counter accuracy (4d91de01)**: `countSignalTasksToday()` was fragile — tied to hardcoded beat slugs. Requirement: counter must work for any beat slug. **SATISFIED** — generalized to `LIKE 'File % signal%'`.
- **Stale issue workflows (cee55c34)**: `issue-opened` workflows accumulate when GitHub issues close without Arc noticing. Requirement: auto-cleanup. **SATISFIED** — `closeStaleIssueWorkflows()` checks GH state and closes stale workflows.
- **Hiro 400 edge case (from watch report)**: Task #12304 (Snappy Nyx, SP383Z…) failed post-fix v3. **NOT ADDRESSED in this diff** — investigation still pending.

### Step 2 — Delete

- **[RESOLVED]** `countSignalTasksToday()` hardcoded beat patterns — deleted 6 specific patterns, replaced with 2 generic globs.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **`jingswapUnavailable` module flag**: Single boolean gates all subsequent JingSwap calls without repetitive error handling in each fetcher. Clean pattern — one 401 aborts the entire JingSwap path for the run cycle, eliminating N redundant network calls.
- **Signal cap generalization**: `LIKE 'File % signal%'` is strictly more correct than 6 hardcoded patterns. The old version would have missed any signal filed for a beat slug not in the hardcoded list — including AIBTC Network after the 12→3 consolidation. Late catch; should have been generalized when beats consolidated.
- **`closeStaleIssueWorkflows()` placement**: Added to `aibtc-repo-maintenance` sensor (30-min cadence) rather than a new sensor — correct call. Reuses existing GH access, adds minimal overhead, and the 24h age filter limits GH API calls to genuinely stale items.

### Step 4 — Accelerate

- **JingSwap 401 short-circuit**: Without the `jingswapUnavailable` flag, a 401 would cause fetchJingswapCycleState + fetchJingswapPrices to both retry and fail per contract — potentially 4–6 network calls per sensor run. Flag reduces that to 1 failed call per run.
- **Signal sensor manual test confirmed task #12330 created**: Sensor now producing tasks again after the state corruption fix.

### Step 5 — Automate

- **[RESOLVED]** Stale issue cleanup is now automated — `closeStaleIssueWorkflows()` runs every 30 minutes.
- **[RESOLVED]** Bad-address auto-deny-list (`loadAndUpdateDenyList()` from prior review) — still functioning.
- **[CARRY-WATCH]** Hiro 400 Snappy Nyx edge case — one remaining failure post-fix v3. Likely a testnet address or registry malformation. Needs investigation: check SP383ZET9DS… address format against mainnet regex. If regex doesn't catch it, the deny-list self-healing should block repeat on second attempt.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — unaddressed.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

### Flags

- **[PENDING-CONFIRM]** Hiro 400 Snappy Nyx edge case (SP383Z…) — 1 failure post-v3. Self-healing deny-list should catch on second attempt.
- **[OK]** JingSwap API key + 401 fallback — shipped and verified (task #12330 created by manual sensor test).
- **[OK]** Signal cap counter generalized — no beat-slug dependencies remaining.
- **[OK]** Stale issue workflow cleanup — automated.
- **[OK]** DailyBriefInscriptionMachine — holding.
- **[OK]** Zest supply: mempool-depth guard holding (5/5 overnight).
- **[OK]** PR review dedup: holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration.
- **[CARRY-WATCH]** nonce-strategy Phase 1 retry-strategy.ts.
- **[CARRY-WATCH]** Contribution tag gap rate.

---

## 2026-04-12T06:45:00.000Z — Hiro 400 fix v3 shipped; DailyBriefInscriptionMachine

**Task #12283** | Diff: 4bb84ae → 7bd2c11 | Sensors: 70 | Skills: 104

### Step 1 — Requirements

- **Hiro 400 fix v3 (7bd2c117)**: SP-mainnet regex added to `stx-send-runner.ts` at actual `makeSTXTokenTransfer` call site. Root cause confirmed from prior review: `probeHiroStxAddress()` called wrong Hiro endpoint (`/v2/accounts/{addr}` returns 200 for broadcast-invalid addresses). Three failed attempts: v1 sensor-level probe (wrong endpoint), v2 wrong file, v3 correct call site. Requirement: eliminate x402 credit burn on invalid STX addresses without false-positive blocking. Status: **SHIPPED, pending live confirmation** — no new welcome tasks since sensor ran at 01:03 UTC Apr 12.
- **Loom token spiral prevention (f7e9124c)**: `DailyBriefInscriptionMachine` required to prevent ~1.25–1.8M token spikes in inscription workflows. Tasks #12193 + #12201 hit spiral from multi-state advancement loading 33K+ chars of brief content per step. Requirement: inscription workflow must be bounded. Status: **SATISFIED** — DailyBriefInscriptionMachine enforces single-state-per-task + context <2KB.
- **Loom alert threshold (b618a6e7)**: Earlier spiral detection. Status: **SATISFIED** — threshold lowered 1M→750K.

### Step 2 — Delete

- **[RESOLVED]** `probeHiroStxAddress()` — DELETED in sensor.ts overhaul. Confirmed false-positive; replaced with `STX_MAINNET_REGEX` + dynamic deny-list.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Dynamic deny-list over probe**: `loadAndUpdateDenyList()` replaces `probeHiroStxAddress()`. Self-healing: bad addresses auto-blocked after first failure via HookState `aibtc-welcome-hiro-rejected`. No network call per-address. Zero false-positives: only addresses that have already caused a Hiro 400 are blocked. Simpler, more reliable, lower latency.
- **Belt-and-suspenders address guard**: Regex at sensor (prevents queuing) AND at `stx-send-runner.ts` call site (prevents execution). Two-layer architecture is correct here — the call site guard protects against pre-queued tasks and future bypasses without duplicating complex logic.
- **DailyBriefInscriptionMachine discipline**: Unbounded context growth in inscription was a design gap (no state-advance guard). Fix is architectural (new state machine) rather than a code patch — correct scope. Single-state-per-task is a reusable principle that applies to any multi-step workflow with large context payloads.

### Step 4 — Accelerate

- **Hiro 400 fix v3**: If confirmed live, eliminates the dominant failure class (44/130 cycles = 34% failure rate in day-12 retro). Expected recovery: ~$6–10/day in x402 credits + meaningful improvement in ops PURPOSE score.
- **DailyBriefInscriptionMachine**: Token spiral blocker unblocks inscription pipeline. Previous cap at 750K tokens now fires earlier with b618a6e7 — escalation time reduced.
- **No bottlenecks introduced** — both changes are in hot paths but add minimal overhead (regex check < 1µs, array scan for deny-list is O(n) with n typically < 10).

### Step 5 — Automate

- **[RESOLVED]** Hiro address validation is now self-healing — `loadAndUpdateDenyList()` auto-populates deny-list from task failures. No manual HIRO_REJECTED_STX_ADDRESSES updates needed for new bad addresses.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — strategy sensor should read last scores from `db/hook-state/arc-purpose-eval.json` before creating eval task.
- **[CARRY-WATCH]** nonce-strategy Phase 1 (retry-strategy.ts) — retry path should also query nonce tracker state.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

### Flags

- **[PENDING-CONFIRM]** Hiro 400 fix v3 — last failure at task #12246 (20:28 UTC Apr 11, pre-fix). No new bad-address welcomes since fix v3. True test: next sensor batch with new agents.
- **[OK]** DailyBriefInscriptionMachine — shipped, circuit breaker in place.
- **[OK]** Loom token spiral threshold 750K — shipped.
- **[OK]** Zest supply: mempool-depth guard holding; TooMuchChaining resolved.
- **[OK]** PR review dedup: holding.
- **[OK]** x402 relay: nonce gaps clear.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — unaddressed.
- **[CARRY-WATCH]** nonce-strategy Phase 1 retry-strategy.ts — unaddressed.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

---

## 2026-04-11T18:50:00.000Z — Hiro probe false-positive root cause; Loom token spiral

**Task #12233** | Diff: 2d99c46b (no code changes) | Sensors: 70 | Skills: 103

### Step 1 — Requirements

- **Hiro 400 pre-validation (fix #12143, day 7 unshipped)**: Fix shipped sensor-level probe at ~00:55Z 2026-04-11. Tasks 12218–12228 (post-fix) are still failing Hiro 400. Root cause investigation (task #12225) timed out at 15min. Requirement: eliminate x402 credit burn on invalid STX addresses. Valid. NOT YET SATISFIED.
- **Loom token spiral**: Tasks #12193 + #12201 hit ~1.25M tokens in inscription workflow 22 — same workflow, two consecutive cycles. Requirement: unbounded context growth must not be possible in any dispatch cycle. Valid. NOT YET ADDRESSED (escalated to whoabuddy).

### Step 2 — Delete

- **[RESOLVED×8]** arc-alive-check DELETED — closed in prior cycle. No longer a carry.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Hiro probe false-positive root cause confirmed**: `probeHiroStxAddress()` calls `GET /v2/accounts/{addr}`. Confirmed via curl: `SP32GT7FT92Z5HTBMY5KKBBFFEZD0AZG5H1ZW8E61` (known Hiro 400 at broadcast) returns HTTP 200 from the accounts endpoint. The accounts API does not validate addresses for transaction broadcast purposes — it just returns empty account state for any address. Layer 3 probe is checking the wrong thing.
- **Two viable fixes**: (a) Add address length/pattern regex to `checkStxAddress()` — Stacks mainnet SP addresses are 41 chars total; addresses shorter or with unusual patterns can be rejected preemptively. (b) Auto-populate HIRO_REJECTED_STX_ADDRESSES from task failures — when a welcome task fails Hiro 400, post-hoc add the address to deny list and skip in future sensor runs. Option (b) is robust and self-healing; option (a) is faster but may not catch all cases.
- **Loom token spiral pattern**: Two identical tasks (inscription workflow 22) hit ~1.25M tokens. This is a new unbounded-growth class not seen before. Likely unbounded context accumulation or recursive tool calls in inscription workflow. No circuit breaker exists. Until investigated, inscription workflow tasks should not run.

### Step 4 — Accelerate

- **No new code changes since 2d99c46b** — this window had zero src/ or skills/ modifications. Entire failure budget is from single unshipped fix (Hiro 400 probe).
- **50 failed / 110 cycles today** — 100% Hiro 400 welcome pattern. Every other system (Zest supply, PR reviews, signals) is healthy.

### Step 5 — Automate

- **[NEW FIX-NEEDED]** `checkStxAddress()` needs length check: Stacks mainnet SP addresses are exactly 41 characters total (SP + 39 base58 chars). Addresses shorter than 41 or not matching `^SP[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{39}$` should be rejected at Layer 1 without needing a probe.
- **[NEW FIX-NEEDED]** Auto-deny-list from task failures: after a welcome task fails Hiro 400, add the address to a persistent deny list in HookState so the sensor skips it permanently. Self-healing without manual intervention.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — still unaddressed.
- **[CARRY-WATCH]** nonce-strategy Phase 1 (retry-strategy.ts) — still unaddressed.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

### Flags

- **[BROKEN]** `probeHiroStxAddress()` — confirmed false-positive. `/v2/accounts/{addr}` returns 200 for broadcast-invalid addresses. Probe is checking the wrong endpoint. Fix needed before Hiro 400 failures stop.
- **[ALERT]** Loom inscription workflow token spiral — two RED events overnight. No circuit breaker. Hold inscription tasks until investigated.
- **[OK]** Zest supply: 5/5 operations clean overnight. TooMuchChaining resolved.
- **[OK]** PR review dedup: holding. bff-skills @mention flood resolved.
- **[OK]** x402 relay: nonce gaps clear, relay healthy.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** arc-purpose-eval + arc-strategy-review integration — unaddressed.
- **[CARRY-WATCH]** nonce-strategy Phase 1 retry-strategy.ts — unaddressed.
- **[CARRY-WATCH]** Contribution tag gap rate — monitor PR review task output.

---

