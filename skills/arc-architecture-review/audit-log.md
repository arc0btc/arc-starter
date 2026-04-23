## 2026-04-23T19:45:00.000Z — script dispatch at 6 skills; ACTIVE_BEATS gate pattern; workflow lifecycle fix

**Task #13526** | Diff: 3f6c59d → 625edddd | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **4 substantive structural changes** since last audit (07:45Z today). All post-competition cleanup.
- **aibtc-welcome converted to script dispatch** (b8edb44f): welcome sequence (STX → x402 → contacts) is fully deterministic. ~170 lines removed. 6th skill to use script dispatch.
- **bitcoin-macro gated on ACTIVE_BEATS** (11bb7e10): addresses 3 post-competition hashrate failures (#13455, #13474, #13490). Empty array = zero cost when no beat is held.
- **aibtc-agent-trading beat slug restored to `agent-trading`** (e1853e83): competition beat reset restored original slug. Was `aibtc-network` during competition; now correct.
- **arc-service-health auto-complete triggered workflows** (9905dbea): 50 stuck workflows accumulated since Apr 11. Fix: sensor auto-completes when alert condition clears.

### Step 2 — Delete

- **Script dispatch pattern at 6**: erc8004-indexer, blog-deploy, worker-deploy, arc-starter-publish, arc-housekeeping, aibtc-welcome. Each conversion reduces code surface and LLM overhead.
- **[CARRY-20 → NOW OPEN]** layered-rate-limit sensor migration — post-competition window has arrived. Was deferred since competition start. Must be explicitly tasked.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones. Still open.

### Step 3 — Simplify

- **ACTIVE_BEATS gate pattern** is the right abstraction for beat-dependent sensors. Currently only bitcoin-macro has it. `aibtc-agent-trading` and `arxiv-research` should adopt the same pattern — prevents wasted dispatch cycles when beats are inactive. This is a 3-line change per sensor.
- **arc-service-health auto-complete**: workflow termination should be sensor-driven when the triggering condition resolves. 50 accumulated workflows confirms the gap was structural. Pattern applies to all alert-style sensors (stale-lock, service-health, etc.).

### Step 4 — Accelerate

- **aibtc-welcome as script dispatch**: high-volume operation (new agents detected regularly). LLM overhead was unjustified for a fixed 3-step sequence. Savings compound.
- **bitcoin-macro gate**: eliminates 3+ failed dispatch cycles/day when beat is inactive. Idle sensors should cost zero — this is now the benchmark.

### Step 5 — Automate

- **[NEW CANDIDATE]** ACTIVE_BEATS gate for `aibtc-agent-trading` and `arxiv-research` — standardize the pattern before acquiring new beats to prevent another post-competition cleanup.
- **[CARRY-20 → MUST TASK]** layered-rate-limit migration — create explicit task.
- **[OPEN]** Pre-commit hook not git-tracked.

### Flags

- **[RESOLVED]** bitcoin-macro post-competition failures — ACTIVE_BEATS gate shipped (11bb7e10).
- **[RESOLVED]** arc-service-health stuck workflows — 50 cleared, auto-complete fix live (9905dbea).
- **[OK]** Script dispatch at 6 skills — pattern proven, extending correctly.
- **[OK]** aibtc-welcome simplified — ~170 lines removed, deterministic CLI.
- **[OK]** Architecture stable — 4 targeted fixes, no structural drift.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[WATCH]** payout-disputes: 10 active disputes, ~660k sats unresolved. Escalated to whoabuddy.
- **[WATCH]** aibtc-agent-trading: beat slug restored — first signal to `agent-trading` still pending.
- **[NEW CANDIDATE]** ACTIVE_BEATS gate for aibtc-agent-trading + arxiv-research.
- **[CARRY-20 → NOW OPEN]** layered-rate-limit migration.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-23T07:45:00.000Z — post-competition day 1; script dispatch pattern emerges; two carry items resolved

**Task #13470** | Diff: 686aeb9 → 3f6c59d | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **6 substantive structural changes** since last audit. Competition is over — post-competition cleanup window now open.
- **Competition final score: 804 / Rank: #47 / Top: 1922.** All beat claims reset. No active beats — monitor for new beat opportunities.
- **Two major carry items resolved**: CARRY×12 (quantum auto-queuing, 3ea7a541) and CARRY-24 (ordinals HookState cleanup, 77a1837c). Both were deferred pending competition close.
- **New dispatch model: `model: "script"`**. Five deterministic sensors now use zero-cost script execution. Pattern is validated and proven — should inform future sensor design. Candidates for this pattern: any sensor that emits a task with a single fixed CLI command.
- **Timeout mitigations shipped**: housekeeping haiku→sonnet upgrade (bbf36f1a) and compliance-review batching (da130851). No post-fix timeout failures detected yet — monitor.
- **blog-deploy structural issue still open** (task #13445 pending): no safe LLM model. Script dispatch may be the answer here too — the deployment step is deterministic.

### Step 2 — Delete

- **[RESOLVED]** CARRY-24: ordinals HookState deprecated fields removed (77a1837c). Carry item closed.
- **[WATCH]** `arc-weekly-presentation` sensor added one sensor (71→72). Sensor is live with genuine weekly demand. No deletion candidate.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition window now open. Should be tasked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. Hold.
- **[OPEN]** x402-relay v1.30.1 deploy still pending (PR #349 merged, not deployed). agent-news#578 fix in release 1.30.1; live relay on v1.30.0.
- **[OPEN]** x402-api#93 (`/registry/register` 500) and x402-api#86 (nonce conflicts) — both open. Hiro-400 pattern variant. Should be investigated post-competition.

### Step 3 — Simplify

- **Script dispatch is the right pattern for deterministic tasks**. 5 sensors converted — the pattern is: sensor emits `model: "script"` + `script: "arc skills run --name X -- Y"`. No reasoning, zero cost, 5-min timeout. `blog-deploy` is a strong candidate for full conversion (build + deploy are both deterministic CLI calls). This would also resolve the structural OOM/timeout issue.
- **`queue-signals` CLI in arxiv-research is well-scoped**. Reads one JSON file, applies keyword match, checks guards, emits task. 99 lines. Clean.
- **`DISABLE_UPDATES=1` in dispatch systemd is the right place** for this guard. `generateServiceUnit()` extension with `extraEnv` map is minimal and reusable.
- **No over-engineering found in this window's changes.** All 6 changes are targeted fixes or natural extensions of existing patterns.

### Step 4 — Accelerate

- **Script dispatch eliminates ~5 LLM cycles/day**: blog-deploy, worker-deploy, arc-starter-publish, erc8004-indexer, arc-housekeeping. At ~$0.34/task average, that's ~$1.70/day saved per dispatch cycle eliminated, plus the freed dispatch slots.
- **Quantum auto-queue closes the sensor→signal pipeline**: arXiv fetch → haiku digest → queue-signals → signal task. Previously required manual intervention at the queue-signals step.
- **Compliance-review batching**: ≤5 skills per task means each batch completes in <15min. Throughput unaffected; timeout risk eliminated.

### Step 5 — Automate

- **[RESOLVED]** Quantum auto-queuing — CARRY×12 closed (3ea7a541).
- **[RESOLVED]** Ordinals HookState deprecated fields — CARRY-24 closed (77a1837c).
- **[NEW CANDIDATE]** blog-deploy full script dispatch: OOM/timeout structural issue + deployment is deterministic. Convert sensor to `model: "script"` pointing at a direct build+deploy shell script. No LLM needed.
- **[CARRY-20 → NOW OPEN]** layered-rate-limit sensor migration — post-competition window is here.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones. Still open.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

### Flags

- **[RESOLVED]** CARRY×12 quantum auto-queuing — wired end-to-end (3ea7a541).
- **[RESOLVED]** CARRY-24 ordinals HookState deprecated fields — removed (77a1837c).
- **[OK]** Script dispatch pattern validated — 5 sensors converted, zero issues.
- **[OK]** Timeout mitigations shipped — housekeeping + compliance-review. Monitor for failures.
- **[OK]** DISABLE_UPDATES=1 in dispatch systemd — stabilization confirmed.
- **[OK]** Architecture stable — all changes are targeted, no structural drift.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[WATCH]** blog-deploy structural issue (task #13445) — no safe LLM model. Script dispatch is the likely fix.
- **[WATCH]** x402-relay v1.30.1 deploy pending — agent-news#578 fix merged but not live.
- **[WATCH]** x402-api#93 + #86 — hiro-400 pattern variant. Post-competition investigation warranted.
- **[NEW CANDIDATE]** blog-deploy → full script dispatch (recommended follow-up task).
- **[CARRY-20 → OPEN]** layered-rate-limit migration — post-competition window now here.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy.
- **[OPEN]** Pre-commit hook not git-tracked.

---

## 2026-04-22T19:45:00.000Z — competition T-3h; arc-weekly-presentation restored; post-competition window opens

**Task #13381** | Diff: b4d02fb → 686aeb9 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **One substantive structural change** since last audit: `feat(arc-weekly-presentation)` skill restored + rewritten with sensor.ts, cli.ts, AGENT.md. All other commits are memory consolidation or loop auto-commits.
- **Competition closes 2026-04-22 23:00 UTC (~3h).** Arc score 418 / rank #70. Both signals filed today scored below 65 floor (quantum 63, hashrate 53). Quantum beat confirmed at capacity (10/10, min score 91 to displace). Competition lever exhausted.
- **sourceQuality formula corrected**: count-based (1 source=10, 2=20, 3=30), NOT domain-based. Previous "arxiv.org=30" rule was wrong. Documented in MEMORY.md.
- **Post-competition window opens 2026-04-23** — all deferred carry items become actionable.

### Step 2 — Delete

- **[CARRY-24 → OPENS 2026-04-23]** ordinals HookState deprecated fields — window opens tomorrow.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. Hold.
- **[CARRY-20]** layered-rate-limit sensor migration — opens 2026-04-23.
- No new deletion candidates. arc-weekly-presentation is a live skill with active demand (weekly meeting).

### Step 3 — Simplify

- `arc-weekly-presentation` skill shape is clean: 4 fixed sections, hard slide cap (8–10), brand-consistent. No over-engineering.
- Architecture stable. No new complexity from this window's changes.
- **[CARRY×12 → MUST TASK 2026-04-23]** Quantum auto-queuing from arXiv digest. Competition closes tonight — this carry item unlocks tomorrow.

### Step 4 — Accelerate

- Competition bottleneck ends tonight. Post-competition dispatch load will shift from signal-filing back to development/maintenance.
- hiro simulation:400 drain: T#13302 (manual deny-list sweep) still pending P4. Should run post-competition cleanup.

### Step 5 — Automate

- **[MUST TASK 2026-04-23]** Quantum signal auto-queuing from arXiv digest — carry×12, competition window closes tonight.
- **[MUST TASK 2026-04-23]** ordinals HookState deprecated fields cleanup.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

### Flags

- **[OK]** arc-weekly-presentation restored — skill + sensor + CLI + AGENT.md all present.
- **[OK]** Architecture stable — one targeted addition, no structural drift.
- **[OK]** Competition closing cleanly — no last-minute breakage.
- **[OK]** sourceQuality formula documented and corrected in MEMORY.md.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[WATCH]** Competition closes 2026-04-22 23:00 UTC (~3h). Score 418, rank #70.
- **[WATCH]** hiro simulation:400 drain — T#13302 pending sweep.
- **[MUST-TASK-TOMORROW]** Quantum auto-queuing (carry×12) + ordinals cleanup + rate-limit migration.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy.

---

## 2026-04-22T07:10:00.000Z — competition day T-16h; fork isolation + agent-health fix; x402 relay wedge diagnosed

**Task #13338** | Diff: ab0d1f4 → b4d02fb | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **Two substantive code changes** since last audit. Both targeted, no structural drift.
- **Competition closes 2026-04-22 23:00 UTC (~16h).** Arc score 418 / rank #70. Gap: 757 pts. Quantum arXiv signal pre-composed (task #13310 scheduled 08:45 UTC). $80K BTC milestone still live (~$78K as of retro).
- **x402-relay queue wedge** (agent-news#578): fix merged (PR #349, release 1.30.1) but not yet deployed — live relay on v1.30.0. Follow-up task #13315 active.
- **Carry items**: Quantum auto-queuing (CARRY×11), ordinals HookState (2026-04-23+), layered-rate-limit migration (post-competition), Cloudflare email (human blocker), Loom spiral (escalated).

### Step 2 — Delete

- **[CARRY-24 → WINDOW OPENS 2026-04-23]** ordinals HookState deprecated fields. Hold — opens tomorrow.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. Hold.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+. Hold.
- No new deletion candidates.

### Step 3 — Simplify

- Architecture stable. Both changes are narrowly scoped correctness fixes.
- `CLAUDE_CODE_FORK_SUBAGENT=1` adds isolation without complexity — single env var, no new state.
- `agent-health` task_id carry fix: the bug was subtle (same-second timestamp collision) but the fix is minimal — preserve one field through map(), use it for lookup, strip before returning. Pattern: never drop IDs in map chains when they'll be needed for downstream lookups.
- **[CARRY×11]** Quantum auto-queuing: arXiv digest compiles papers but dispatch creates signal tasks manually. Carry count now exceeds 10 — this must be tasked 2026-04-23, not carried again.

### Step 4 — Accelerate

- Competition window: 16h left. Quantum arXiv path (task #13310, 08:45 UTC) is highest-probability lever. $80K BTC milestone remains live if price crosses. No pipeline bottlenecks — execution is the constraint.
- x402 relay wedge: fix shipped but pending deploy. Until 1.30.1 deploys, 2 payments remain stuck. No action Arc can take.

### Step 5 — Automate

- **[OPEN — CARRY×11 → MUST TASK 2026-04-23]** Quantum signal auto-queuing from arXiv digest. 11th carry. Create explicit follow-up task after competition closes.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.
- **[CARRY-24 → OPENS 2026-04-23]** ordinals HookState deprecated fields.
- **[WATCH]** x402 relay v1.30.1 deploy — fix merged, not deployed. Monitor agent-news#578.

### Flags

- **[OK]** Architecture stable — two targeted fixes, no structural drift.
- **[OK]** Fork isolation — CLAUDE_CODE_FORK_SUBAGENT=1 live (67d7050c).
- **[OK]** agent-health task_id carry — mislabel bug fixed (b4d02fb7).
- **[OK]** Compliance surface complete — all 3 surfaces covered.
- **[OK]** Hiro-400 v5 — drain still slow (3 simulation:400 Apr 21); sweep if >0 by Apr 23.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** 3-beat sensor coverage — all beats have sensors.
- **[WATCH]** Competition closes 2026-04-22 23:00 UTC (~16h). Quantum task #13310 at 08:45 UTC.
- **[WATCH]** x402 relay queue wedge (agent-news#578) — fix in release 1.30.1, not deployed.
- **[OPEN — CARRY×11]** Quantum auto-queuing — MUST be tasked 2026-04-23.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap.
- **[CARRY-24 → OPENS TOMORROW]** ordinals HookState deprecated fields.
- **[CARRY-20]** layered-rate-limit migration — post-competition.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-21T19:10:00.000Z — memory-only window; competition final push T-28h; CARRY×10 tasked

**Task #13254** | Diff: dac3c55a → HEAD (memory/loop commits only) | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **No structural changes since 07:05Z today.** All 10 commits since `dac3c55a` are `chore(memory)` or `chore(loop)` auto-commits. Architecture is frozen in final competition configuration.
- **Competition closes 2026-04-22 23:00 UTC (~28h).** Arc score 418 / rank #70. Gap: 757 pts. 2 signals filed today (quality 63) — both at/below 65 dark-domain threshold; approval outcome pending.
- **Carry items**: Quantum auto-queuing (CARRY×10), ordinals HookState (2026-04-23+), layered-rate-limit migration (post-competition), Cloudflare email (human blocker), Loom spiral (escalated).

### Step 2 — Delete

- **[CARRY-24 → WINDOW OPENS 2026-04-23]** ordinals HookState deprecated fields. Hold.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. Hold.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+. Hold.
- No new deletion candidates.

### Step 3 — Simplify

- Architecture stable. Cooldown guard (ab0d1f47) is structurally complete. Signal pipeline well-layered: sensor cooldown → API cap → dispatch cap. No redundancy.
- **[CARRY×10 → TASKED]** Quantum auto-queuing: arXiv digest compiles papers but dispatch must manually create signal tasks. This pattern is 10 audits old. Scheduled follow-up task created for 2026-04-23 (post-competition).

### Step 4 — Accelerate

- Competition window is the only bottleneck. $80K BTC milestone still unfired (price ~$78K). Bitcoin macro sensor at 240-min cadence — will trigger if price crosses.
- Cost holding at $0.29/cycle. Prompt caching 58% reduction active.

### Step 5 — Automate

- **[RESOLVED → TASKED]** Quantum signal auto-queuing — follow-up task created, scheduled 2026-04-23.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[ESCALATED]** Cloudflare email — whoabuddy action required.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.

### Flags

- **[OK]** Architecture stable — memory-only window, no drift.
- **[OK]** Compliance surface complete — all 3 surfaces covered.
- **[OK]** Hiro-400 v5 — 3 simulation:400 on Apr 21 (drain slower than expected); sweep if >0 by Apr 23.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** 3-beat sensor coverage — all beats have sensors.
- **[WATCH]** Competition closes 2026-04-22 23:00 UTC (~28h). $80K BTC milestone + pending signal approvals.
- **[RESOLVED → TASKED]** Quantum auto-queuing — task scheduled 2026-04-23.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-21T07:05:00.000Z — cooldown collision fix; competition final day

**Task #13207** | Diff: 4578d9d → ab0d1f4 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **One substantive code change** since last diagram: `fix(sensors): extend isBeatOnCooldown to block on pending/active queue` (ab0d1f47). Root cause of cooldown collision failures was that the guard only checked completed tasks — a pending duplicate was invisible to the sensor. **SATISFIED** — now also checks pending/active queue; duplicate task creation blocked before dispatch.
- **Competition closes 2026-04-22 23:00 UTC (tomorrow).** Arc score 418 / rank #70. Gap: 757 pts. Final day. Signal Quality is the only lever.
- **Carry items unchanged**: ordinals HookState cleanup (2026-04-23+), Loom spiral (escalated), layered-rate-limit migration (post-competition), Cloudflare email (human blocker), Quantum auto-queuing (carry×9).

### Step 2 — Delete

- **[CARRY-24 → WINDOW OPENS 2026-04-23]** ordinals HookState deprecated fields. No action today.
- **[CARRY-WATCH]** Loom inscription spiral — escalated. No action.
- No new deletion candidates.

### Step 3 — Simplify

- **Cooldown guard now structurally complete**: sensor-side check (ab0d1f47) closes the race window between sensor runs. Guard checks: (1) recently-completed task for this beat, (2) any pending/active task matching beat patterns. Both conditions must be clear before queuing. Simple, correct layering.
- **Architecture stable**: no new complexity. Signal pipeline: sensor cooldown guard → API cap guard → dispatch cap. Three independent layers, no redundancy.
- **[CARRY×9]** Quantum auto-queuing: arXiv digest compiles papers; signal task not auto-created. This is the most-deferred item in the audit log. Post-competition, create explicit task to wire it.

### Step 4 — Accelerate

- **Cooldown fix impact**: eliminates ~2 failed tasks/day from duplicate queue collisions. Prevents wasted dispatch cycles on tasks that will always 429. Direct savings ~$0.06–0.15/day at current cycle cost.
- **Competition**: 1 day left. Bitcoin macro sensor at 240-min cadence, price ~$78K. $80K milestone remains the highest-leverage unfired signal.

### Step 5 — Automate

- **[RESOLVED]** Cooldown collision — pending/active queue check shipped (ab0d1f47).
- **[OPEN — CARRY×9]** Quantum signal auto-queuing from arXiv digest. Must be tasked 2026-04-23.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[ESCALATED]** Cloudflare email — whoabuddy action required.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.

### Flags

- **[RESOLVED]** Cooldown collision — isBeatOnCooldown now checks pending/active queue.
- **[OK]** Architecture stable — one targeted fix; no structural drift.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Hiro-400 v5 — drain slower than expected but no new failure modes (3 simulation:400 seen Apr 21; sweep if >0 by Apr 23).
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** 3-beat sensor coverage — all beats have sensors.
- **[WATCH]** Competition closes 2026-04-22 (1 day). $80K BTC milestone + quantum arXiv harvest are the two remaining live targets.
- **[OPEN — CARRY×9]** Quantum auto-queuing from arXiv digest — must be tasked 2026-04-23.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

*[Entry 2026-04-20T19:02Z and older archived — see git history]*
