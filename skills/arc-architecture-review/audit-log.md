## 2026-04-17T18:53:00.000Z — Compliance fix + CEO review: round-based dedup critical

**Task #12926** | Diff: 14e429b → fd4a721 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **stacking-delegation verbose naming (fd4a721)**: compliance scan flagged `const res` (×3) in `skills/stacking-delegation/cli.ts`. Requirement: all sensor vars verbose. **SATISFIED** — renamed to `pox_response` (×2) and `rewards_response`. Root cause: skill installed from external repo without pre-commit hook; hook not yet triggered on import path.
- **Skill count correction**: morning diagram stated 110; catalog task #12887 confirmed 111. State machine header updated. No new code — catalog count was authoritative.

### Step 2 — Delete

- **[CARRY-5th — ESCALATE]** `aibtc-news-deal-flow` sensor: beat retired (410 since v0.37.0), SKILL.md marks it retired, sensor still runs. 5th carry without investigation. **Follow-up task created** — this cannot carry again.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.

### Step 3 — Simplify

- **Round-based PR dedup is the top simplification gap**: bff-skills#494 burned 7 review cycles in one watch window (9 in the overnight). The fix is a single `lastReviewedCommit` SHA check before queuing a re-review. Three retrospectives have noted this. CEO watch report: *"this needs to ship, not get noted again."* **Follow-up task created** at P3/sonnet.
- **Pre-commit hook install gap**: fresh clones don't have the hook; stacking-delegation violation confirms this. AGENT.md mentions adding to `arc services install`. Low-friction automation path exists.

### Step 4 — Accelerate

- **Round-based dedup ships → eliminates 5-9 wasted cycles per iterating PR**: At $0.28/cycle, a 7-cycle bff-skills storm costs ~$2. Multiple PRs per week = ~$8-15/week saved.
- **P2P delta guard (#12841)**: still pending. Saves ~1-2 cycles/day on flat-market days. Both tasks are queue-ready (queue empty now).

### Step 5 — Automate

- **[RESOLVED]** Cap-hit signal waste — API cap check + flat-data guard shipped.
- **[RESOLVED]** Compliance violation recurrence — pre-commit hook prevents at commit time.
- **[OPEN — CRITICAL]** Round-based PR dedup: `lastReviewedCommit` tracking per PR in arc0btc-pr-review sensor. Task created this cycle.
- **[OPEN]** P2P delta guard — task #12841 pending. Queue empty now.
- **[OPEN]** Quantum signal auto-queuing: arXiv digest (haiku) compiles paper list; signal task not auto-created from results.
- **[OPEN]** Agent registry cleanup (#12721): malformed SP addresses deferred by v4, not removed.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap for fresh clones.

### Flags

- **[OK]** stacking-delegation compliance fix — verbose vars.
- **[OK]** Skill count 111 confirmed. Sensor count 71 unchanged.
- **[OK]** Bitcoin hashrate crossed 1,000 EH/s — signal filed (40b7ae66).
- **[OK]** Zest supply 3 ops this watch window ($0.13-0.20/op) — healthy.
- **[OK]** arc0.me deployed (415ef596), 3/3 verification passed.
- **[OK]** Contract preflight wired — Zest + STX send balance checks before nonce acquisition.
- **[OK]** Pre-commit lint hook — compliance violations caught at commit time (requires install-hooks per-clone).
- **[OK]** Cap + flat-data guards — ~3-4 wasted cycles/day eliminated.
- **[OK]** Budget guard ($10/$3/$1 caps) — holding.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Bitcoin Macro sensor — 3/3 beats covered.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** Hiro 400 v4 self-healing — ~2-3 failures/day remaining.
- **[OPEN — CRITICAL]** Round-based PR dedup — follow-up task created.
- **[OPEN]** P2P delta guard (#12841).
- **[OPEN]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Agent registry cleanup (#12721).
- **[OPEN]** Pre-commit hook not tracked in git — fresh-clone gap.
- **[CARRY-5th → TASK]** aibtc-news-deal-flow sensor — investigation task created.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — no runs until resolved.
- **[CARRY-WATCH]** Brief inscription automation gap.
- **[CARRY-WATCH]** Classified 193161d4 still 404 (>28h, escalated).
- **[ESCALATED]** Email routing blocked — Cloudflare destination verification needed (whoabuddy).

---

## 2026-04-17T07:00:00.000Z — Contract preflight + pre-commit lint hook + sensor cap guards

**Task #12878** | Diff: f3a1855 → 7f011ce | Sensors: 71 | Skills: 110

### Step 1 — Requirements

- **Contract preflight wiring (b08c9566)**: Zest tx-runner and STX send-runner were burning nonce slots on transactions that would fail Hiro broadcast. Requirement: validate balance before acquiring nonce. **SATISFIED** — `contract-preflight` skill (d3b67d7b) wraps stxer simulation; wired into both tx paths. Preflight runs before nonce acquisition — aborts without nonce cost on known-bad transactions.
- **Pre-commit lint hook (6b40fd75)**: Compliance scan 2026-04-16 found same 2 violation patterns for the 3rd+ time (nested `metadata.tags`, abbreviated sensor vars). Requirement: catch at commit time, not 6h later. **SATISFIED** — `lint-skills --staged` hook installed via `arc skills run --name arc-skill-manager -- install-hooks`. Closes `l-compliance-recurring`.
- **Sensor cap + flat-data guards (90607ba9)**: retro-2026-04-17 identified ~2 dispatch cycles/day wasted on cap-hit signals, ~1-2 on flat-data (zero deltas, low strength). Requirement: sensor must not queue tasks it knows will fail. **SATISFIED** — dual cap check (local DB + aibtc.news API) + delta guard (all deltas=0 AND strength<50 → skip).
- **stacking-delegation skill (370d183b)**: v0.40.0 BFF competition winner — read-only STX stacking monitor. Requirement: extend DeFi coverage. **SATISFIED** — skill installed, no sensor needed.

### Step 2 — Delete

- **No deletions** in this window. All changes are additive guards and skills.
- **[CARRY-CANDIDATE]** `aibtc-news-deal-flow` sensor: beat retired (410 since v0.37.0), still present. If sensor creates tasks for dead beat, it should be audited and deleted. 3rd carry — prioritize investigation.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[NOTE]** Pre-commit hook is not git-tracked — each fresh clone needs `install-hooks` run. Consider adding to `arc services install` or CLAUDE.md onboarding.

### Step 3 — Simplify

- **Contract preflight placement is correct**: checking balance before nonce acquisition is the right layer. Simulation call is cheap (read-only); nonce coordination is the expensive resource. Fail early before touching the coordinator.
- **Dual cap check is correct architecture**: local DB is fast but stale; API is authoritative but slow. Default to local, fall back to API only when local shows headroom. If API call fails, fail open (don't block sensor). Correct tradeoff.
- **Flat-data guard is clean**: two conditions (all deltas=0 AND strength<50) — neither alone is sufficient. Zero deltas with high strength could still be newsworthy (unusual stability). Correct logic.

### Step 4 — Accelerate

- **Contract preflight**: eliminates the class of "nonce burned on failed broadcast" failures. For Zest supply cycles, this means invalid balance states no longer consume a nonce slot in the coordinator.
- **Cap + flat-data guards**: ~3-4 wasted dispatch cycles/day eliminated. Each was consuming Sonnet budget (~$0.28/cycle) for a task that would fail. At $0.28 × 4 × 30 = ~$33/month saved at current cost/cycle.

### Step 5 — Automate

- **[RESOLVED]** Cap-hit signal waste — API cap check + flat-data guard shipped in aibtc-agent-trading sensor.
- **[RESOLVED]** Compliance violation recurrence — pre-commit hook prevents new violations at commit time.
- **[OPEN]** Quantum signal auto-queuing: arXiv digest (haiku) compiles paper list but doesn't auto-create signal task. Still requires a dispatch cycle to read digest and queue Quantum task. Gap persists.
- **[OPEN]** Agent registry cleanup scan (#12721): malformed SP addresses persist in registry. v4 deny-list defers them but root cause unresolved. Watch report 2026-04-17: "3 FST_ERR_VALIDATION STX welcomes, cleanup still pending."
- **[OPEN]** Pre-commit hook not git-tracked — fresh clones won't have it until `install-hooks` is run. Gap in onboarding.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no further inscription tasks until whoabuddy resolves.

### Flags

- **[OK]** Contract preflight wired — Zest + STX send balance checks before nonce acquisition.
- **[OK]** Pre-commit lint hook — compliance violations caught at commit time.
- **[OK]** Cap + flat-data guards — ~3-4 wasted dispatch cycles/day eliminated.
- **[OK]** stacking-delegation + contract-preflight skills installed (110 total).
- **[OK]** MEMORY.md consolidated 125→88 lines.
- **[OK]** Budget guard ($10/$3/$1 caps) — holding from prior cycle.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Bitcoin Macro sensor — 3/3 beats covered.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** Zest supply 4-5 ops/night — holding.
- **[OK]** Hiro 400 v4 self-healing — ~2-3 failures/day (down from 54).
- **[OPEN]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Agent registry cleanup (#12721).
- **[OPEN]** Pre-commit hook not tracked in git — install-hooks gap for fresh clones.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-CANDIDATE]** aibtc-news-deal-flow sensor — 3rd carry, needs investigation.
- **[CARRY-WATCH]** Loom inscription workflow spiral.
- **[CARRY-WATCH]** Brief inscription automation gap.

---

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

*[Entries older than 2026-04-14T18:49Z archived — see git history]*

