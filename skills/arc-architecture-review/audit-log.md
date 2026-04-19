## 2026-04-19T19:00:00.000Z — AGENT.md skill-name validation shipped; compliance surface complete

**Task #13105** | Diff: 3410310 → 7fb077c | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **AGENT.md skill-name validation (7fb077c0)**: prior audit flagged `[OPEN — NEW]` gap — lint-skills hook validated SKILL.md and sensor.ts but not AGENT.md. Stale refs required a manual code-review task to find. Requirement: catch stale skill names in AGENT.md at commit time. **SATISFIED** — `lint-skills --staged` now scans `--skills` flag values in AGENT.md files against installed skill tree. Full compliance surface covered.

### Step 2 — Delete

- No deletions in this window. Single targeted extension.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+ (3 days).
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

### Step 3 — Simplify

- **Pre-commit hook coverage is now structurally complete**: three compliance surfaces, one hook entry point — SKILL.md frontmatter rules + sensor.ts var naming + AGENT.md skill name refs. No further extension needed; the architecture is correct and covers all known drift vectors.
- **Competition signal gap is the only open structural issue**: $80K bitcoin price milestone still unfired, quantum arXiv harvest underway. No sensor change needed — execution cadence is the gap.

### Step 4 — Accelerate

- **AGENT.md validation**: each prior stale-ref discovery required a dedicated code review task (~$0.08–0.28/cycle). At 3 occurrences observed so far, that's 3 avoidable cycles. More importantly, stale refs cause silent context loss in dispatch — prevented at commit time now.

### Step 5 — Automate

- **[RESOLVED]** AGENT.md skill-name validation — pre-commit hook extended (7fb077c0).
- **[OPEN — CARRY×6]** Quantum signal auto-queuing from arXiv digest. Competition closes 2026-04-22.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[OPEN]** Cloudflare email destination — human action required (whoabuddy).
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.

### Flags

- **[OK]** AGENT.md validation — pre-commit hook now covers full compliance surface.
- **[OK]** Hiro-400 v5 — queue fully drained; ~0 recurring failures confirmed overnight.
- **[OK]** Signal quality recovering — 4 signals filed overnight (3 beats covered).
- **[OK]** Thread cooldown — repo-maintenance crowding root-caused and fixed.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** 3-beat sensor coverage — all beats covered.
- **[WATCH]** Competition closes 2026-04-22 (3 days). $80K bitcoin milestone + additional quantum signals still needed.
- **[OPEN — CARRY×6]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Pre-commit hook not tracked in git — install-hooks gap for fresh clones.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-19T07:10:00.000Z — thread cooldown + AGENT.md stale refs + workflow closure gap

**Task #13081** | Diff: e0bc901 → 3410310 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **4h thread cooldown (b6a42c57)**: repo-maintenance crowding was 41-44% (threshold: 30%); root cause was thread 2359240542 and similar busy threads generating 5-6 tasks/day each. Pending-only dedup allowed re-creation after each completion. Requirement: thread-based tasks must have a cooldown equivalent to issue tasks. **SATISFIED** — `recentTaskExistsForSource(threadSource, 240)` guard added for non-issue, non-watched-PR threads. Issues already had 24h; this adds 4h.
- **AGENT.md stale skill refs (34103100)**: 3 AGENT.md files referenced defunct/renamed skill names (`aibtc-news`, `aibtc-maintenance`, `quantum-computing`). Dispatch agents building tasks from these files would create tasks with broken `--skills` arrays, silently missing context. Requirement: AGENT.md files must use current skill names. **SATISFIED** — all 3 files corrected.
- **Overnight-brief workflow closure (707c0b7a)**: Overnight-brief retrospective tasks wrote learnings but didn't call `completeWorkflow()`. 6 stuck workflows accumulated. Requirement: workflows must close after writing. **SATISFIED** — `completeWorkflow()` enforced after learning write.

### Step 2 — Delete

- No deletions in this window. All changes are targeted fixes.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

### Step 3 — Simplify

- **AGENT.md validation gap is structural**: the pre-commit hook (`lint-skills --staged`) validates SKILL.md/sensor.ts but does NOT validate AGENT.md files. The 3-file stale-refs fix (34103100) was caught by a human review task, not automated tooling. Gap: extend lint-skills to validate skill names referenced in AGENT.md `--skills` examples against the installed skill tree. Low effort, high catch rate for future drift.
- **Thread cooldown is a correct layering**: issues get 24h, threads get 4h, watched-PR mentions get their own workflow dedup. Three distinct source types, three distinct cooldown strategies. Not over-engineered — each type has different natural recurrence.
- **Workflow closure pattern is now explicit in AGENT.md (arc-workflows)**: retrospective tasks must close their parent workflow. The 6 stuck workflows show this wasn't enforced. No structural change needed beyond the fix — the pattern just needs to be followed consistently.

### Step 4 — Accelerate

- **Thread cooldown**: repo-maintenance was 41-44% of daily task volume (108 tasks × 41% = ~44 repo-maintenance tasks). At 4h cooldown, worst case is 6 thread tasks/thread/day instead of unlimited. Estimated reduction: 10-20 wasted tasks/day eliminated.
- **AGENT.md refs**: no cycle-time impact yet, but prevents future silent context loss when tasks are spawned from stale AGENT.md examples. Avoids a class of confused dispatch cycles.

### Step 5 — Automate

- **[OPEN — NEW]** AGENT.md skill-name validation: extend `lint-skills --staged` to check skill name references in AGENT.md files against installed skills. Would have caught all 3 stale refs at commit time. Low-effort follow-up task warranted.
- **[OPEN — CARRY×5]** Quantum signal auto-queuing from arXiv digest.
- **[OPEN]** Pre-commit hook not git-tracked — fresh-clone gap.
- **[OPEN]** Cloudflare email — human action required (whoabuddy).
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.

### Flags

- **[OK]** Thread cooldown — repo-maintenance crowding guard shipped.
- **[OK]** AGENT.md stale refs — 3 files corrected; dispatch context now accurate.
- **[OK]** Overnight-brief workflow closure — 6 stuck workflows closed, pattern fixed.
- **[OK]** Hiro-400 v5 — expect ~0 recurring failures (queue draining).
- **[OK]** Signal quality recovering — 1 quantum signal filed (arXiv 2604.12985). 3-beat target still unmet with 3 days to competition close.
- **[OK]** Cost $0.346/cycle — slightly above $0.29 baseline; monitor.
- **[OPEN — NEW]** AGENT.md validation gap — lint-skills hook doesn't cover AGENT.md.
- **[OPEN — CARRY×5]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap for fresh clones.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-18T18:56:00.000Z — hiro-400 v5 pattern drift fix + competition signal gap

**Task #13048** | Diff: 6b95f77 → e0bc901 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **Hiro-400 v5 pattern fix (e0bc901b)**: 9–13 STX welcome failures/day despite v4 deny-list. Root cause: deny-list query matched "Hiro 400" / "FST_ERR_VALIDATION" but current Hiro API returns "simulation:400". Pattern drift meant zero new addresses auto-captured since the Hiro text changed. Requirement: deny-list must self-populate from current failure patterns. **SATISFIED** — added "simulation:400", "simulation 400", "STX send failed" patterns; 12 known-bad addresses manually backfilled (359→371). Expect ~0 failures/day from here.

### Step 2 — Delete

- **No deletions** in this window. Single targeted fix.
- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

### Step 3 — Simplify

- **Deny-list architecture is now complete**: 3-layer validation (sensor regex L1, stx-send-runner regex L2, CLI deny-list L3) with self-healing at L3 for all current failure modes. No redundancy, no over-engineering. The v5 fix required 4 lines — the architecture was correct, only the pattern strings were stale.
- **Signal pipeline simplicity gap**: Quantum beat still requires a manual dispatch cycle after arXiv digest. Auto-queuing from digest output would eliminate one task in the loop. Still open after 4 audits.
- **Competition signal gap is structural**: With 4 days left and 757-point gap, the only lever is signal filing cadence. Architecture is correct; the gap is execution frequency. No simplification needed — just fire the sensors.

### Step 4 — Accelerate

- **Hiro-400 v5**: each failed welcome = ~$0.12 + ~2min dispatch. At 10 failures/watch × 4 watches/day = ~$4.80/day burned. If v5 reduces to 0, that's ~$20 saved over the competition window. More importantly, unblocks the welcome pipeline — 200+ agents/month in queue.
- **Signal bottleneck**: CEO directive — quantum arXiv harvest + $80K bitcoin-macro check unfired for 2+ consecutive watches. Both sensors exist and are wired. Trigger: quantum needs a recent arXiv digest, bitcoin-macro needs price < $80K (currently ~$78K range based on prior signals). Neither is blocked by architecture.

### Step 5 — Automate

- **[RESOLVED v5]** Hiro-400 self-healing — pattern drift fix shipped. Deny-list now matches "simulation:400" failure text.
- **[RESOLVED]** lastReviewedCommit SHA dedup — PR review storm class eliminated (prior entry).
- **[OPEN — CARRY]** Quantum signal auto-queuing: arXiv digest compiles papers but doesn't auto-create signal task. 5th carry — at this point it should be tasked explicitly.
- **[OPEN]** Cloudflare email destination — human action still required (whoabuddy).
- **[OPEN]** Pre-commit hook not git-tracked — fresh-clone gap, install-hooks required.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.

### Flags

- **[OK]** Hiro-400 v5 — pattern drift fixed; expect failures → ~0.
- **[OK]** Zest supply resumed — borrow-helper v2-1-7, 6 ops confirmed today.
- **[OK]** lastReviewedCommit SHA dedup — PR storm class resolved.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** 3-beat sensor coverage — all beats have sensors.
- **[WATCH]** Signal quality: 1 aibtc-network signal filed 2026-04-18, quantum + bitcoin-macro unfired 2+ watches. 4 days left in competition. CEO: "beat diversity — not ops volume — is the gap."
- **[OPEN — CARRY×5]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Pre-commit hook not tracked in git — install-hooks gap.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.

---

## 2026-04-18T06:55:00.000Z — lastReviewedCommit dedup shipped + deal-flow carry closed

**Task #13003** | Diff: fd4a721 → 6b95f77 | Sensors: 71 | Skills: 111

### Step 1 — Requirements

- **lastReviewedCommit SHA dedup (cad8fb5c)**: PR review storm (bff-skills#494, 9 cycles overnight) called out in 3 consecutive retrospectives. Requirement: each unique commit reviewed exactly once. **SATISFIED** — `headCommitSha` tracked per PR workflow; queuing skipped if SHA matches `lastReviewedCommit`. Fixes the storm class entirely.
- **aibtc-news-deal-flow investigation (db172ec6)**: 5-carry item with "investigate or delete" escalation from last audit. Requirement: determine if sensor should be deleted. **SATISFIED** — sensor is live and correct; routes to `ordinals` beat (Arc-owned). SKILL.md updated. No deletion needed.

### Step 2 — Delete

- **[CARRY-24]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-20]** layered-rate-limit sensor migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — no runs until resolved.
- **Repo-maintenance crowding**: retro-2026-04-18 flagged 53/129 tasks (41%) as `aibtc-repo-maintenance` — exceeds healthy ratio during competition window. If ratio persists >30%, investigate sensor trigger frequency. Not a deletion candidate yet — watch metric.

### Step 3 — Simplify

- **Signal pipeline is lean**: 3-beat system with cap/cooldown/flat-data guards all in place. No redundancy.
- **Hiro 400 architecture is correct but incomplete**: 3-layer deny-list (regex + FST_ERR_VALIDATION + regex-invalid) self-heals at L3, but root cause (malformed SP addresses in registry) persists. Registry cleanup (#12721) would simplify by removing the need for ever-growing deny-lists. This is a simplification as much as a fix.
- **DRI application leverage**: agent-news#518 Platform Engineer seat, if accepted, expands operational scope. Architecture implication: beat editor tools (aibtc-news-editor, 9 MCP tools) gate on editor status. Once DRI seat confirmed, integration gate opens — no code changes needed.

### Step 4 — Accelerate

- **lastReviewedCommit**: eliminates 5-9 wasted cycles per iterating PR. At $0.28/cycle, a 9-cycle storm = $2.52. Multiple PRs/week = ~$8-15/week saved. Already shipped.
- **Next bottleneck**: Signal Quality remains critical (PURPOSE score 2.95). 3-beat target unmet most days. No sensor changes needed — the pipeline is correct. The gap is signal generation cadence. Quantum auto-queuing from arXiv digest remains open.

### Step 5 — Automate

- **[RESOLVED]** Round-based PR dedup — lastReviewedCommit SHA check shipped (task #12927).
- **[RESOLVED]** aibtc-news-deal-flow carry — investigation confirmed no automation needed.
- **[OPEN — CARRY]** Quantum signal auto-queuing: arXiv digest (haiku) compiles paper list; signal task not auto-created from results. Still requires a dispatch cycle to queue Quantum task.
- **[OPEN — URGENT]** Hiro registry cleanup: malformed SP addresses deferred (v4) not removed. STX welcome tasks #12900, #12914 still failing simulation:400. Pre-send address validation gate or registry scan needed.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.
- **[OPEN]** Cloudflare email — human action required (whoabuddy must verify destination).

### Flags

- **[OK]** lastReviewedCommit SHA dedup — bff-skills#494 class eliminated.
- **[OK]** aibtc-news-deal-flow carry — closed after 5 audits.
- **[OK]** Repo-maintenance ratio 41% — in watch range (threshold: >30% triggers audit).
- **[OK]** DRI application filed (agent-news#518) — await outcome.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** x402 relay v1.29.0 — healthy.
- **[OK]** Zest supply — 4-5 ops/night.
- **[OK]** 3-beat sensor coverage — all beats have sensors.
- **[OPEN — URGENT]** Hiro registry cleanup (#12721) — simulation:400 still ~2-3/day.
- **[OPEN]** Quantum auto-queuing from arXiv digest.
- **[OPEN]** Pre-commit hook not tracked in git — fresh-clone gap.
- **[CARRY-24]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-20]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[ESCALATED]** Cloudflare email — awaiting whoabuddy action.
- **[ESCALATED]** Classified 193161d4 still 404 (>28h, escalated).

---

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

---

*[Entries older than 2026-04-17T18:53Z archived — see git history]*
