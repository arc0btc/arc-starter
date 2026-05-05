## 2026-05-05T08:15:00.000Z — 5 targeted fixes: retro-dedup, PR state check hardened, cap-dequeue cleanup, x402 auth

**Task #15781** | Diff: ffb73208 → 0d9f5f7c | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **5 structural changes** since last audit (2026-05-04T20:15Z).
- **fix(arc-service-health): deduplicate retrospective creation per budget-gate event** (48879732): `lastHealthAlertWorkflowAt` added to state file. 4-hour gate on health-alert workflow creation. Closes the `[OPEN]` from prior audit — a single budget-gate outage was producing 30+ retrospective tasks (one per hourly sensor fire). Pattern: alert sensors must rate-limit workflow creation per incident, not just per alert condition.
- **fix(arc-workflows): checkPrExists now returns false for merged/closed PRs** (486691cb): `checkPrExists()` now fetches `state` field and validates `state === 'OPEN'`. Prior fix (4ea89d0e) only checked exit code — `gh pr view` exits 0 for merged/closed PRs, so those were still queuing review tasks. This closes that gap.
- **fix(arc-workflows): close cap-dequeued PR review tasks as completed not failed** (9aec6798): `getPendingPrReviewTaskIdsToday()` added to `src/db.ts`. Sensor auto-closes excess pending PR review tasks as `completed` when the 20/day cap is hit. Prevents failure metric inflation from tasks that were intentionally not executed.
- **fix(arc-workflows): add blog-publishing to site-health-alert task skills** (0d9f5f7c): `SiteHealthAlertMachine` freshness-fix tasks now include `blog-publishing` skill. `blog-deploy` alone lacked the content creation CLI context needed to clear a freshness failure.
- **fix(aibtc-news): pass BTC auth headers through x402 payment retry flow** (25622279): BTC auth headers lost in x402 payment retry path. `execute-endpoint` probe step also missing auth, getting 401 before 402 visible. Both fixed. Pattern: x402 retry paths must propagate all upstream auth headers.
- **Reports reviewed**: recent cycle log shows 5 cycles in this window costing $0.07–$0.45 each. Task #15779 ($0.35) was the prior overnight dispatch. Budget holding.

### Step 2 — Delete

- **[RESOLVED]** Budget-gate retrospective dedup gap (48879732) — closes the [OPEN] from 2026-05-04T20:15Z. 30 FP tasks per event → at most 1 per 4h window. Correct fix.
- **[WATCH]** aibtc-agent-trading `ACTIVE_BEATS=['agent-trading']` — beat retired (410). Sensor is gated so it won't fire, but array is wrong. Carry from every prior audit — low risk while gated, but should be corrected before re-enabling.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry (every audit since 2026-04-23). Install: `arc skills run --name arc-skill-manager -- install-hooks`.

### Step 3 — Simplify

- **checkPrExists state-check is the right completion**: the exit-code-only check was a half-fix. State validation is one extra field in the JSON fetch — no additional API call, same performance.
- **Cap-dequeue cleanup is correct**: closing as `completed` (not `failed`) matches the intent — these tasks were intentionally not executed, not errored. The metric hygiene improvement is real.
- **Retro-dedup 4h window matches alert cadence**: the sensor fires hourly; 4h = 4 potential alert windows per outage. One workflow per outage incident is the right semantic.
- **[CONSIDER]** `checkPrExists` is called per-PR via Bun.spawnSync (blocking). With many workflow instances, sensor runtime could grow. If sensor P99 latency exceeds 30s, evaluate async batching. Low risk today; monitor as workflow count scales.
- **[CARRY-CONSIDER]** ACTIVE_BEATS constants in arxiv-research + aibtc-agent-trading remain manually maintained. `/api/beats` live cross-reference (as in aibtc-news-editorial) would auto-enable beats without code changes. Carry from multiple prior audits.

### Step 4 — Accelerate

- **PR review failure metrics now accurate**: cap-dequeue tasks closed as completed means retrospective tools no longer see false failures from intentionally-dequeued tasks. Daily eval PURPOSE score should lift as success rate denominator is corrected.
- **x402 auth fix unblocks signal pipeline path**: signals that required x402 payment were failing silently at the auth-before-402 stage. This restores the x402 payment retry path end-to-end.
- **checkPrExists hardening** eliminates the narrow residual class of merged/closed PRs that slipped past the prior exit-code check.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-CONSIDER]** ACTIVE_BEATS → /api/beats cross-reference for arxiv-research + aibtc-agent-trading.

### Flags

- **[RESOLVED]** Budget-gate retrospective dedup — 1 workflow per 4h outage window (48879732).
- **[RESOLVED]** checkPrExists exit-code gap — state validation added (486691cb).
- **[RESOLVED]** Cap-dequeued PR tasks inflating failure metrics — auto-closed as completed (9aec6798).
- **[RESOLVED]** Site-health freshness fix missing blog-publishing context (0d9f5f7c).
- **[RESOLVED]** x402 payment retry auth header loss (25622279).
- **[OK]** Architecture stable — 5 targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[OK]** PR review pipeline: cap + haiku + dequeue cleanup now all consistent.
- **[WATCH]** Resend credentials not set — arc-email-sync and arc-report-email both blocked until whoabuddy completes DNS setup. Escalate.
- **[WATCH]** Signal diversity — monitor for quantum/aibtc-network signals in next cycles.
- **[WATCH]** aibtc-agent-trading ACTIVE_BEATS=['agent-trading'] — beat retired (410); fix before re-enabling.
- **[WATCH]** Payout disputes (11 active) — no whoabuddy response.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** ACTIVE_BEATS constants → /api/beats cross-reference not yet evaluated.

---

## 2026-05-04T20:15:00.000Z — credentials namespace fix; signal pipeline recovering; cost normalized

**Task #15698** | Diff: 4ea89d0e → ffb73208 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **One structural change** since last audit (2026-05-04T08:14Z): arc-report-email credentials namespace fix.
- **fix(arc-report-email): read credentials from correct email/* namespace** (a182c600): Sensor was reading credentials from a mismatched key namespace. Fix aligns reads with the `arc creds set --service email` convention. Sensor remains blocked on whoabuddy Resend DNS setup (task #14771) — fix is necessary but not sufficient.
- **Reports reviewed**: 2026-05-04T13:00Z overnight brief. 436 completed / 18 failed (all pre-fix stale PRs) / $96.24. Three arc-workflows fixes from prior window holding cleanly. bitcoin-macro signal `f2e72a1a` filed (Q=93, SQ=30). arxiv routing restored; quantum + aibtc-network unblocked. Budget-gate FP flood (~30 retrospective tasks from one event) — all correctly handled but dedup gap documented.

### Step 2 — Delete

- **[OPEN]** Pre-commit hook not git-tracked — persistent carry (every audit since 2026-04-23).
- **[WATCH]** aibtc-agent-trading `ACTIVE_BEATS=['agent-trading']` — beat is retired (410). Sensor is gated, so it won't fire, but the array value is wrong and would 410 if re-enabled. Carry from prior audit.
- No new deletion candidates.

### Step 3 — Simplify

- **Credential namespace fix is minimal and correct**: 3-line change, no logic change. The gap was a mismatch between how credentials were stored (`arc creds set --service email`) and how they were read. Pattern now consistent.
- **[CONSIDER]** ACTIVE_BEATS constants in arxiv-research + aibtc-agent-trading remain manually maintained. The `/api/beats` live cross-reference (as in aibtc-news-editorial) would auto-enable beats without code changes. This carry has appeared in every audit since 2026-04-28 — evaluate concretely when next beat is acquired.
- **[CONSIDER]** Budget-gate retrospective dedup: a single budget-gate event can queue 30 separate retrospective tasks. Arc-service-health sensor creates one per dispatch-stale alert, not one per incident. Fix: add a `lastRetroCreatedAt` dedup field in hook state, rate-limit retrospective creation to 1 per 4h.

### Step 4 — Accelerate

- **Cost normalized to $96.24** (down from $201.15 prior day) — PR review cap (20/day haiku) is working. Model switch alone cuts per-review cost by ~60%.
- **PR review failures at zero**: existence check (4ea89d0e) + cap (99779912) working together. No stale PRs queuing, no cap overflow.
- **Signal pipeline recovering**: arxiv routing restored, bitcoin-macro firing cleanly. Next sensor cycles should show quantum + aibtc-network signals materializing.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[NEW CANDIDATE]** Budget-gate retrospective dedup: add rate-limit on retrospective task creation per incident in arc-service-health. One retrospective per outage event, not one per stale alert.

### Flags

- **[RESOLVED]** arc-report-email credential namespace — email/* reads now correct (a182c600).
- **[OK]** Architecture stable — one targeted fix, no structural drift.
- **[OK]** PR review failure rate → 0 (existence check + cap working together).
- **[OK]** arxiv routing restored — quantum + aibtc-network unblocked (fe615b45).
- **[OK]** Cost normalized — $96.24 vs $201.15 prior day. PR review cap holding.
- **[OK]** bitcoin-macro signal pipeline clean — Q=93, SQ=30, three Tier-0/1 sources confirmed.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** Resend credentials not set — arc-email-sync and arc-report-email both blocked until whoabuddy completes signup + DNS. Escalate.
- **[WATCH]** Signal diversity — arxiv routing restored but no quantum/aibtc-network signals confirmed yet. Monitor next 2 sensor cycles.
- **[WATCH]** aibtc-agent-trading ACTIVE_BEATS=['agent-trading'] — beat retired (410); fix before re-enabling.
- **[WATCH]** Payout disputes (11 active) — no whoabuddy response.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[OPEN]** Budget-gate retrospective dedup gap — 30 FP tasks per event unresolved.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.
- **[CARRY-WATCH]** ACTIVE_BEATS constants → /api/beats cross-reference not yet evaluated.

---

## 2026-05-04T08:14:00.000Z — stale-PR existence check shipped; one structural change

**Task #15616** | Diff: 5850cb32 → 4ea89d0e | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **One structural change** since last audit (2026-05-04T07:53Z): stale-PR queue contamination fix.
- **fix(arc-workflows): PR existence check before queuing review tasks** (4ea89d0e): `checkPrExists()` calls `gh pr view` before `insertTask()` for pr-review workflows. If the PR is gone, workflow transitions to `closed` and task creation is skipped. Per-run Map caches results within a sensor cycle. Resolves the pattern where #267, #291, #561 and other invalid PRs re-failed daily. Root was documented in MEMORY.md yesterday: "stale-PR-queue contamination — sensor generates tasks for PRs that were merged, never existed, or have gaps in numbering."
- **Reports reviewed**: 2026-05-04T01:02Z watch report (period: 2026-05-03T13:00Z → 2026-05-04T01:02Z). 60 completed, 98 failed, $92.08. Of 98 failures: 77 explicitly superseded by the PR review cap task; 21 stale PR 404s. The 4ea89d0e fix directly addresses those 21 stale-PR failures.
- **Daily eval 2026-05-04** [#15275]: 803/828 tasks (97%), 0 signals, $201.15/day (over $200 cap). PR review monoculture: 787/828 tasks. 22/25 failures = stale/invalid PR numbers re-queuing. 4ea89d0e closes this class.

### Step 2 — Delete

- No new deletion candidates. Single targeted fix.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- **`checkPrExists()` is minimal and correct**: 16 lines. Bun.spawnSync + exit code check + Map cache. The right abstraction — treat GitHub API as the authority on PR existence.
- **Cache pattern is correct**: per-run Map prevents redundant API calls when multiple workflows reference the same PR within one sensor cycle. No cross-run caching needed (state is refreshed per cycle).
- **[CONSIDER]** The existence check runs synchronously (Bun.spawnSync) which blocks the sensor during each uncached API call. With many stale PRs this could add latency. If sensor runtime grows, evaluate moving to async checks or pre-batching the existence lookups.
- **[CARRY-WATCH]** aibtc-agent-trading `ACTIVE_BEATS=['agent-trading']` — beat was retired per MEMORY.md `active-beat-slugs`. Sensor will still short-circuit (ACTIVE_BEATS gate), but the array value is wrong and would fire a 410 if re-enabled.

### Step 4 — Accelerate

- Stale-PR existence check eliminates a class of failures that was inflating the failure count across every daily retrospective. At 21 stale-PR failures/reporting window, this removes ~3-5 ghost failures/day from the queue.
- Daily cost $201.15 is over the $200 cap. PR review cap (20/day + haiku) is the right lever — already shipped. Monitor for further reduction.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** Validate ACTIVE_BEATS arrays against `/api/beats` at sensor startup rather than hardcoding — closes the drift risk permanently.

### Flags

- **[RESOLVED]** Stale-PR-queue contamination — existence check live (4ea89d0e). Pattern closed.
- **[OK]** Architecture stable — one targeted fix, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** Signal diversity: 0 signals 2026-05-04. arxiv-research + bitcoin-macro re-enabled but no successful filing cycle yet today.
- **[WATCH]** Daily cost $201.15 over $200 cap — PR review cap (20/day haiku) already shipped; monitor for normalization.
- **[WATCH]** aibtc-agent-trading ACTIVE_BEATS=['agent-trading'] — beat is retired (410). Needs correction when beat is reacquired.
- **[WATCH]** task #14771 (Resend DNS) — blocked on whoabuddy.
- **[WATCH]** Payout disputes (11 active) — no whoabuddy response.
- **[WATCH]** arc0me-site deploy (#14426) — still pending.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-05-04T07:53:00.000Z — PR review cost crisis resolved; signal pipeline restored; 7 structural changes

**Task #14684** | Diff: 08ec7eb1 → 5850cb32 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **7 structural changes** since last audit (2026-05-02T20:11Z). Two major incidents resolved: PR review cost crisis + signal pipeline silence.
- **feat(arc-workflows): daily PR review cap 20/day + haiku model** (99779912): PR review sensor was queuing 600+/day tasks at sonnet rates, driving cost above $200/day cap. `countPrReviewTasksToday()` added to `src/db.ts`; cap gates sensor task creation. PrLifecycleMachine downgraded to haiku. 76 excess tasks manually closed. Root: no rate limiting existed on PR review dispatch at all.
- **fix(arxiv-research): re-enable ACTIVE_BEATS** (fe615b45): `ACTIVE_BEATS=[]` post-competition caused silent early-exit — sensor fetched nothing, filed nothing. aibtc-network + quantum both added back. Signal silence for these beats traced to this single-line omission.
- **fix(arc-workflows): pendingTaskExistsForSource** (2482db11): `taskExistsForSource` checked ALL statuses. Bulk-cleaned completed/failed tasks permanently blocked workflow re-creation. Fix: `pendingTaskExistsForSource` deduplicates only in-flight tasks. Unblocks 4 stuck workflows (1923/2038/2077/2127). Pattern in MEMORY.md.
- **fix(review): gh pr view --json reviews** (f6174d2f): `gh pr reviews` silently exits 1 (no output) on some PRs. Was used for duplicate-review check — silent failure = missed dedup. Switched to `gh pr view --json reviews` which reliably returns reviews. CRITICAL note added to MEMORY.md [L].
- **fix(arc-workflows): keyword skill detection** (66aefa05): `prReviewSkills()` scans PR title for domain keywords (bitflow, zest, hodlmm/dlmm). Adds matching skill to task. Fixes missing defi context on domain-specific PR reviews.
- **feat(email): Resend backend** (cc22eb86): `arc-email-sync` CLI gains `--via resend` flag. Routes through Resend API for external addresses CF worker can't reach. DNS setup blocked on whoabuddy action (task #14771).
- **fix(arc-ceo-review): workflow transition fix** (3cd6cd79): AGENT.md step 7.5 added. CEO reviews completed without transitioning ceo-review workflows. Fix: subagent explicitly transitions to reviewing with reviewSummary.
- **Reports reviewed**: 2026-05-04T01:02Z watch report. PR review flood: 76 tasks superseded, haiku cap shipped. arxiv-research ACTIVE_BEATS fix. Resend DNS blocked. PURPOSE 2.55 (0 signals, cost over cap).

### Step 2 — Delete

- **[WATCH]** aibtc-agent-trading `ACTIVE_BEATS` still `['agent-trading']` with that beat likely retired (410). Verify active beat list before next sensor run or it will queue tasks that 410.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry (every audit since 2026-04-23).
- No new deletion candidates in this window's changes.

### Step 3 — Simplify

- **PR review cap is correct architecture**: 20/day is a tunable constant; the pattern (count today's tasks + gate on cap) is reusable for any high-volume sensor. haiku is appropriate for mechanical PR review work.
- **`pendingTaskExistsForSource` is the right default**: `taskExistsForSource` (all statuses) was always a footgun for any sensor that re-creates tasks after failure. The fix should be evaluated for other high-dedup sensors.
- **[CONSIDER]** `prReviewSkills()` keyword scan: PR title matching for skill inference is fragile — a PR mentioning "zest" for non-code reasons would load defi-zest unnecessarily. Low risk now, worth monitoring as PR volume grows.
- **[CONSIDER]** ACTIVE_BEATS in arxiv-research + aibtc-agent-trading are still manually maintained code constants. `/api/beats` live cross-reference (as in aibtc-news-editorial) would auto-enable beats without code changes. Priority rises now that aibtc-network + quantum are re-enabled.

### Step 4 — Accelerate

- PR review cap eliminates cost runaway: 20 haiku tasks/day ≈ $0.80/day vs. 600 sonnet tasks ≈ $180/day. 225× cost reduction for this sensor class.
- arxiv-research re-enablement: both aibtc-network and quantum signals can now flow again. Was completely blocked.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** ACTIVE_BEATS constants → `/api/beats` live cross-reference for arxiv-research + aibtc-agent-trading.

### Flags

- **[RESOLVED]** PR review cost crisis — 20/day cap + haiku (99779912). 76 excess tasks closed.
- **[RESOLVED]** arxiv-research signal silence — ACTIVE_BEATS re-enabled (fe615b45).
- **[RESOLVED]** Workflow-dedup ghost rows — pendingTaskExistsForSource (2482db11).
- **[RESOLVED]** gh pr reviews silent failure — gh pr view --json reviews (f6174d2f).
- **[RESOLVED]** arc-ceo-review workflow lifecycle — step 7.5 added (3cd6cd79).
- **[OK]** Architecture stable — 7 targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** Signal diversity: 0 signals today (PURPOSE S=1). arxiv-research + bitcoin-macro re-enabled; need successful filing cycle.
- **[WATCH]** aibtc-agent-trading ACTIVE_BEATS=['agent-trading'] — verify this beat is still active (not 410).
- **[WATCH]** task #14771 (Resend DNS) — blocked on whoabuddy.
- **[WATCH]** Payout disputes (11 active) — still no whoabuddy response.
- **[WATCH]** arc0me-site deploy (#14426) — still pending.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-05-02T20:11:00.000Z — dispatch-stale suppression live; 4-fix batch: error plumbing + nonce serialization complete

**Task #14291** | Diff: ff24d963 → 08ec7eb1 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **4 structural changes** since last audit (2026-05-02T08:09Z).
- **feat(arc-service-health): dispatch-stale suppression window** (96f2290e): `wasStaleLastRun` + `lastRecoveryAt` tracked in `db/hook-state/arc-service-health.json`. Suppresses new stale-cycle alert tasks for 60min post-recovery. Closes the [WATCH] from last audit — "dispatch-stale suppression still unimplemented." Note: the prior audit documented this commit as `1396b36e` (incorrect) — corrected to `96f2290e` in this entry and state machine diagram.
- **fix(dispatch): script-dispatch summary prefers last JSON error line** (08ec7eb1): Fixes multi-step script failures where stderr progress messages were overwriting the real JSON error at 500-char truncation. Root cause of 3 consecutive welcome-failure misdiagnoses.
- **fix(db): markTaskFailed persists result_detail** (08ec7eb1): Was silently dropping on failure path. Full error detail now stored. Closes the last gap in the failure-diagnosis chain.
- **fix(hodlmm-move-liquidity): nonce serialization** (08ec7eb1): Last STX send path that bypassed the shared nonce coordinator. Now uses `acquireNonce`/`releaseNonce` via `broadcastMove` wrapper. Nonce serialization complete across all send paths.
- **Reports reviewed**: overnight brief 2026-05-02T13:09Z (12 completed / 1 failed). Watch report 2026-05-02T13:00Z. CEO context from MEMORY.md: "Signal sourcing breadth is the main ceiling." Note: overnight brief stated dispatch-stale suppression "still unimplemented" — this was stale; 96f2290e shipped at 07:17 MDT, before the brief was generated.

### Step 2 — Delete

- No new deletion candidates. All 4 changes are targeted fixes.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry (every audit since 2026-04-23). Install: `arc skills run --name arc-skill-manager -- install-hooks`.

### Step 3 — Simplify

- **Error plumbing fixes are minimal and correct**: `markTaskFailed` result_detail persistence + script-dispatch JSON-last heuristic together close the layered-failure-masking pattern documented after the welcome misdiagnosis. Two small changes that eliminate a class of silent misdiagnoses.
- **Nonce serialization complete**: all 3 STX send paths (bitcoin-wallet, defi-zest, hodlmm) now coordinate through the shared nonce tracker. Audit any future path that calls `broadcastTransaction` directly — it must go through `acquireNonce`/`releaseNonce`.
- **[CONSIDER]** ACTIVE_BEATS constants in arxiv-research + aibtc-agent-trading remain manually maintained. `/api/beats` cross-reference (as used in aibtc-news-editorial) is more robust — re-enabling beats would be automatic. Carry from multiple prior audits. Evaluate when next beat is acquired.

### Step 4 — Accelerate

- Dispatch-stale suppression: no more queue cleanup cycles after payment blocks. 60min window matches typical recovery drain time.
- markTaskFailed + script-dispatch improvements reduce time-to-diagnosis for all future failures — structural improvement, not just welcome.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** ACTIVE_BEATS → /api/beats cross-reference for arxiv-research + aibtc-agent-trading.

### Flags

- **[RESOLVED]** Dispatch-stale suppression — 96f2290e live, 60min post-recovery window active.
- **[RESOLVED]** Script-dispatch error masking — last JSON line heuristic in dispatch.ts.
- **[RESOLVED]** markTaskFailed drops result_detail — now persisted.
- **[RESOLVED]** Nonce serialization gap (hodlmm) — broadcastMove wrapper closes all STX send paths.
- **[RESOLVED]** Welcome-failure misdiagnosis class — full error chain now visible in result_summary + result_detail.
- **[OK]** Architecture stable — 4 targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[OK]** Signal pipeline: bitcoin-macro signal f691def3 Q=93 SQ=30 confirmed overnight.
- **[WATCH]** Signal diversity — only bitcoin-macro filing. aibtc-network + quantum sensors gated on empty ACTIVE_BEATS.
- **[WATCH]** Payout disputes (11 active) — escalated since 2026-04-24, still no whoabuddy response.
- **[WATCH]** Ruby Elan welcome failed (task #14263) — wallet/nonce state. Re-queue after checking relay health.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-05-02T08:09:00.000Z — payment-block watchdog; dispatch-stale suppression; compile-brief disabled; CI fix

**Task #14259** | Diff: e4370d04 → ff24d963 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **5 structural changes** since last audit (2026-04-29T08:05Z): 3 in local git + 2 documented in MEMORY.md from remote commits.
- **feat(arc-service-health): payment-block watchdog** (60372cb9): `checkPaymentBlock()` added. Root trigger: 25h dispatch gap 2026-04-30 to 2026-05-01. No watchdog existed for this failure class — dispatch stalled silently while sensors queued work normally.
- **fix(arc-service-health): dispatch-stale suppression window** (1396b36e): 60min post-recovery gate. Prevents the FP flood (19+ stale alerts) that previously followed every payment block. Closes pattern documented in 2026-05-02 retrospective.
- **fix(aibtc-news-editorial): compile-brief endpoint + sensor disabled** (b102c52b): `POST /api/brief/compile` is publisher-only. Arc is a correspondent — always 403. Sensor permanently disabled. Architectural clarification: compile-brief is not Arc's role.
- **feat(bitcoin-macro): 3rd source via blockstream.info** (9781c64b / PR #22): SQ=30 confirmed with signal cf686209 at Q=93. Closes 6-day SQ=1 streak root cause.
- **fix(ci): TypeScript devDependency** (e22a79f2 / PR #24): CI pipeline fix only. No sensor/dispatch impact.
- **Reports reviewed**: 2026-05-02T01:01Z watch report. CEO: "On track. Full recovery from 25h payment-block gap. Signal sourcing breadth is the main ceiling."

### Step 2 — Delete

- **compile-brief sensor permanently disabled**: no more queuing. CLI and AGENT.md still intact — those can remain for any future publisher-role Arc instance. No deletion candidate yet; skill is lean.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- Payment-block watchdog + suppression window is correct architecture: both live in `arc-service-health`, self-contained. No cross-sensor communication required.
- **[CONSIDER]** ACTIVE_BEATS constants (arxiv-research + aibtc-agent-trading) still manually maintained. The `/api/beats` cross-reference pattern from aibtc-news-editorial remains more robust. Evaluate when next beat acquired.

### Step 4 — Accelerate

- Dispatch-stale suppression prevents future FP floods — no more queue cleanup cycles after payment blocks.
- Signal sourcing breadth remains the constraint identified by CEO: aibtc-network needs multi-source research investment. Bitcoin-macro has 3 confirmed sources now; aibtc-network needs equivalent depth for consistent SQ=30.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** ACTIVE_BEATS → /api/beats cross-reference (arxiv-research + aibtc-agent-trading).

### Flags

- **[RESOLVED]** bitcoin-macro SQ floor — 3rd source live, SQ=30 confirmed (cf686209 Q=93).
- **[RESOLVED]** dispatch-stale FP flood after payment block — 60min suppression window (1396b36e).
- **[RESOLVED]** payment-block detection gap — watchdog added (60372cb9).
- **[RESOLVED]** compile-brief publisher-gate — endpoint renamed + sensor disabled (b102c52b). Permanent.
- **[RESOLVED]** CI TypeScript devdep — e22a79f2 merged on main.
- **[OK]** Architecture stable — targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** Signal sourcing breadth — aibtc-network needs multi-source research investment for consistent SQ=30.
- **[WATCH]** Payout disputes (11 active) — still no whoabuddy response.
- **[WATCH]** Cooldown tasks closed as `failed` — signal-filing cooldown flow uses wrong close status. Pattern documented. Fix pending.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. Budget guard holds.

---

## 2026-04-29T08:05:00.000Z — camelCase compliance fix; architecture stable; dispatch gate self-recovered

**Task #13962** | Diff: 29e3d20 → e4370d04 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **Two substantive commits** since last audit (2026-04-28T20:00Z).
- **fix(bitcoin-macro): rename height_response to heightResponse** (e4370d04): Compliance rename only — no behavioral change. `fetchBlockHeight()` function had a snake_case local variable. Renamed to camelCase per TypeScript convention. Pre-commit lint hook would catch this going forward.
- **feat(claude-code-releases): applicability report for v2.1.122** (4a221a5f): Research doc added at `research/claude-code-releases/v2.1.122.md`. No operational impact.
- **Reports reviewed**: watch report 2026-04-29T01:01Z. No architectural issues flagged.
- **Dispatch gate RESOLVED**: Self-recovered as of 2026-04-29T02:02Z — status=running, consecutive_failures=0. Was STOPPED from 2026-04-28. No manual intervention needed.
- **Welcome failures**: Two consecutive STX-send failures (Patient Ledger + Flying Wasp, 2026-04-29) flagged as systemic in MEMORY.md. Pattern: consecutive same-day welcome failures = shared root cause (nonce collision, wallet state, STX balance). Sensor-level gate exists but execution-time failures still possible.
- **Signal pipeline**: SQ=1 streak broken — two signals approved (d2237ab7 Q=93, 3573344b Q=73). Pipeline confirmed end-to-end healthy.

### Step 2 — Delete

- No new deletion candidates. Both commits are targeted fixes/docs.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry. Install: `arc skills run --name arc-skill-manager -- install-hooks`.

### Step 3 — Simplify

- camelCase fix is minimal and correct: pure rename, zero logic change. Pre-commit hook should have caught this at commit; confirms hook must be installed on every fresh clone.
- **[CONSIDER]** ACTIVE_BEATS constants in arxiv-research + aibtc-agent-trading sensors remain manually maintained. The aibtc-news-editorial `/api/beats` cross-reference pattern is more robust — re-enabling beats would be automatic rather than requiring a code change. Tradeoff: live API call on every sensor run vs. a constant. Evaluation deferred pending next beat acquisition.

### Step 4 — Accelerate

- No pipeline bottlenecks. Signal pipeline healthy. Dispatch gate running. Architecture stable.
- bitcoin-macro third-source branch (current branch `feat/bitcoin-macro-third-source`) appears to track the blockstream.info 3rd source work already landed in 94938b4. Branch may be ready for merge or already superseded.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked — camelCase fix would have been caught at commit time if hook was installed.
- **[CONSIDER]** ACTIVE_BEATS constants → /api/beats live cross-reference. Evaluate when next beat acquired.

### Flags

- **[RESOLVED]** Dispatch gate STOPPED — self-recovered 2026-04-29T02:02Z.
- **[OK]** Architecture stable — two targeted changes (one compliance, one docs), no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[OK]** Signal pipeline healthy — 2 approved signals, SQ=1 streak broken.
- **[WATCH]** Consecutive welcome STX-send failures (Patient Ledger + Flying Wasp) — investigate wallet/nonce state before next welcome run. Pattern: systemic not isolated.
- **[WATCH]** Payout disputes (11 active) — still no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no confirmed stalls.
- **[WATCH]** `feat/bitcoin-macro-third-source` branch active — verify if work is merged or still pending.
- **[CONSIDER]** ACTIVE_BEATS constants → /api/beats cross-reference for arxiv-research + aibtc-agent-trading.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-28T20:00:00.000Z — retired-beat inactivity fix; second signal filed; dispatch gate stopped

**Task #13919** | Diff: 94938b4 → 29e3d20 | Sensors: ~72 | Skills: ~113

### Step 1 — Requirements

- **Two structural commits** since last audit (2026-04-28T08:00Z).
- **fix(aibtc-news-editorial): skip retired beats in inactivity check** (d7152b93): Sensor was alerting on all beats including the 9 post-competition retired ones. Fix: sensor skips beats not in the active beat list. Beat `infrastructure` had triggered an inactivity alert (14d inactive) because the retired-beat filter was missing.
- **fix(aibtc-news-editorial): cross-reference /api/beats** (29e3d208): Strengthened detection by fetching the active list from `/api/beats` (authoritative) rather than relying on a hardcoded retired set. Correct long-term approach — API is the source of truth.
- **Reports reviewed**: overnight brief 2026-04-28T13:06Z, watch report 2026-04-28T13:00Z.
- **Second signal filed**: difficulty decline signal `3573344b`, quality 73 (task #13853). SQ floor confirmed broken after the 3-layer fix stack.
- **Dispatch gate STOPPED**: 3 consecutive failures → escalated to whoabuddy. Do not reset without review.
- **Claude Code upgraded to v2.1.121** (task #13857): memory leak fixes + PostToolUse hook expansion.

### Step 2 — Delete

- No new deletion candidates. Both commits are targeted sensor fixes.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- **Two-commit approach is correct**: first patch (d7152b93) was minimal — skip retired beats. Second patch (29e3d208) replaced the hardcoded list with an API call. This is the right sequence: ship fast, then harden the data source.
- The `/api/beats` cross-reference is the right abstraction: any beat-aware sensor that needs "what beats are active?" should call this endpoint, not maintain its own list.
- **[CONSIDER]** Other sensors that reference beat names (arxiv-research, aibtc-agent-trading) use `ACTIVE_BEATS` constants — those are manually maintained. The editorial sensor's `/api/beats` approach is more robust. Evaluate whether the `ACTIVE_BEATS` pattern should also cross-reference the API rather than using a hardcoded constant. The tradeoff: API calls on every sensor run vs. a constant that must be manually updated.

### Step 4 — Accelerate

- Retired-beat inactivity fix eliminates false-positive alert tasks for 9 retired beats. Without this fix, each sensor run (every N minutes) would generate an inactivity alert task for each retired beat — significant noise accumulation over time.
- Second signal filed confirms the 3-layer fix stack (ACTIVE_BEATS gate + beat tag + 3rd source) is end-to-end working. SQ floor is broken; pipeline is healthy.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** ACTIVE_BEATS constants in arxiv-research and aibtc-agent-trading sensors could be replaced with a `/api/beats` cross-reference, bringing them in line with the aibtc-news-editorial pattern. This would make re-enabling beats automatic rather than requiring a code change.

### Flags

- **[RESOLVED]** Retired-beat inactivity false positives — sensor now cross-references `/api/beats` (29e3d208).
- **[RESOLVED]** SQ=1 floor — two signals filed and approved (d2237ab7 Q=93, 3573344b Q=73). Pipeline confirmed end-to-end healthy.
- **[OK]** Architecture stable — two targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** Dispatch gate STOPPED — escalated to whoabuddy. Do not reset without reviewing 3 failure log entries.
- **[WATCH]** Payout disputes (11 active) — still no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no confirmed stalls.
- **[CONSIDER]** ACTIVE_BEATS constants vs. live /api/beats cross-reference — evaluate for arxiv-research + aibtc-agent-trading.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-28T08:00:00.000Z — bitcoin-macro unblocked: re-enabled + 3rd source + beat tag fix; haiku→sonnet dispatch guard

**Task #13881** | Diff: e760b47 → 94938b4 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **4 structural commits** since last audit (2026-04-27T19:55Z). Three directly remediate the 6-day SQ=1 floor.
- **fix(bitcoin-macro): re-enable sensor** (f28aeafb): `ACTIVE_BEATS` re-populated with `'bitcoin-macro'`. Filing instructions updated to require beat slug as first tag — root cause of `beatRelevance=0` on all prior signals was the tag was simply never included. Other correspondents scoring 20+ always include the beat slug.
- **feat(bitcoin-macro): 3rd source via blockstream.info** (94938b4): `sourceQuality` formula is count-based (1=10, 2=20, 3+=30). mempool.space alone = 53, below the 65 floor. Adding blockstream.info as a 3rd source pushes sourceQuality to 30, clearing the floor.
- **fix(dispatch): haiku→sonnet auto-upgrade for signal-filing tasks** (221e2341): Task subjects matching `'File *-signal:*'` now force model=sonnet at dispatch time. Addresses task #13847 where a haiku-spawned subtask timed out in 5 min before aibtc-news-editorial could compose.
- **docs(arc-mcp-server)** (2f0d151c): `alwaysLoad:true` recommended for external MCP clients; dispatch boundary clarified. Documentation only — no structural impact.

### Step 2 — Delete

- No new deletion candidates. All 4 commits are targeted fixes.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- **beatRelevance=0 fix is minimal and correct**: the beat slug was always required by the platform but never enforced in filing instructions. 1-line fix closes 6+ days of silent failures.
- **3rd source addition**: `blockstream.info` adds a second independent confirmation for price data. Lightweight — same pattern as existing blockchain.info source.
- **haiku→sonnet dispatch guard**: centralized check at dispatch time (not sensor time) is architecturally correct — ensures all signal-filing paths are covered regardless of which sensor created the task.
- **[CONSIDER]** The beat tag requirement should be enforced in the sensor itself (fail-fast before a task is created) rather than relying on filing instructions. Currently the filing LLM must remember to include the tag. A sensor-side validation step would catch it earlier.

### Step 4 — Accelerate

- SQ=1 floor persisted 6+ days due to two compounding failures: (1) beat sensor gated by empty ACTIVE_BEATS, and (2) signals filed without the beat tag. Both now fixed. Expect SQ to recover within one 240-min sensor cycle.
- haiku→sonnet guard eliminates the signal-filing timeout class entirely — previously 1 missed signal per timeout.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** Add beat-slug-in-tags validation to `aibtc-news-editorial` sensor or signal-filing CLI to catch missing tags before dispatch rather than relying on LLM instruction compliance.

### Flags

- **[RESOLVED]** bitcoin-macro ACTIVE_BEATS gate — re-enabled (f28aeafb).
- **[RESOLVED]** beatRelevance=0 — beat tag now required in filing instructions (f28aeafb).
- **[RESOLVED]** sourceQuality floor — 3rd source added (94938b4), sourceQuality now 30.
- **[RESOLVED]** signal-filing haiku timeout — dispatch guard forces sonnet (221e2341).
- **[OK]** Architecture stable — targeted fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** SQ=1 floor root causes fixed — monitor for first approved signal in next sensor cycle.
- **[WATCH]** Payout disputes (11 active) — no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no confirmed payment stalls.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-27T19:55:00.000Z — two defensive fixes; workflow autoAdvanceState + blog-deploy SHA guard

**Task #13831** | Diff: d62274d → e760b47 | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **Two structural commits** since last audit (2026-04-27T18:55Z).
- **fix(arc-workflows): autoAdvanceState** (e760b47e): `WorkflowAction` gains `autoAdvanceState` field. Sensor transitions the workflow immediately after inserting a create-task action. Prevents stuck-in-state loop where the spawned task forgets to call `transition()` and the dedup gate blocks all subsequent fix tasks. Applied to `SiteHealthAlertMachine` (`alert → fixing`).
- **fix(blog-deploy): SHA guard** (7888632f): `last_failed_sha` written to hook state on build failure. Sensor skips re-queue when `currentSha === last_failed_sha`. Fixes the 9-attempt retry storm for commit 694ac4f9 (arc0me-site js-yaml error, tasks #13753-13755).
- **Reports reviewed**: overnight brief 2026-04-27T17:32Z, watch report 2026-04-27T13:00Z.
- **Overnight brief**: 6 completed, 3 failed (arc0me-site retry storm — root cause now fixed by 7888632f). arc0me-site investigation task #13820 queued. x402 sponsor key still expired.
- **SQ=1 (Day 3+)**: bitcoin-macro sensor gated correctly; no signals filed. Market conditions, not architecture.

### Step 2 — Delete

- No new deletion candidates. Architecture lean and stable.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- **autoAdvanceState is minimal and correct**: 8 lines across sensor.ts + state-machine.ts. The right fix — task-side transition was fragile by design (dedup blocks re-entry). Sensor ownership of the transition is structurally cleaner.
- **SHA guard is minimal and correct**: 11 lines across cli.ts + sensor.ts. Pattern generalizes: any sensor that re-queues on content change should gate on content hash, not just task status.
- Both fixes address the same class of bug: "dedup logic that only blocks on active/pending status fails when the triggering condition changes" — SHA guard solves the content-change case; autoAdvanceState solves the workflow-state case.

### Step 4 — Accelerate

- SHA guard eliminates retry storms: previously a broken build SHA would generate 9 attempts (3 tasks × 3 retries) before a human noticed. Now: 3 attempts, then gates until a new commit lands. Ops noise reduced significantly.
- autoAdvanceState eliminates manual transition calls in spawned tasks — reduces failure surface for future workflow additions.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- **[CONSIDER]** SHA guard pattern should be applied to any other build-failure sensors that re-queue on new content. Check: arc-starter-publish, worker-deploy.

### Flags

- **[RESOLVED]** blog-deploy retry storm (694ac4f9) — SHA guard live (7888632f).
- **[RESOLVED]** SiteHealthAlertMachine stuck-in-alert loop — autoAdvanceState live (e760b47e).
- **[OK]** Architecture stable — two defensive fixes, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** arc0me-site YAML parse error — js-yaml error in commit 694ac4f9, SHA gate now blocking re-queue. Fix requires content correction in arc0me-site repo.
- **[WATCH]** x402 sponsor key expired — agent payments blocked, pending whoabuddy renewal.
- **[WATCH]** SQ=1 (Day 3+) — active beats exist, thresholds not breaching. Market conditions.
- **[WATCH]** Payout disputes (11 active) — 48h+ no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no confirmed payment stalls.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-27T18:55:00.000Z — deny-list stderr fix closes 5-day recurrence; stable architecture

**Task #13787** | Diff: 5e1cdf1 → d62274d | Sensors: ~74 | Skills: ~115

### Step 1 — Requirements

- **One structural commit** since last audit (2026-04-26T19:53Z): `fix(aibtc-welcome): write fail() errors to stderr for deny-list detection` (d62274d4).
- **Reports reviewed**: watch report 2026-04-27T13:00Z + overnight brief 2026-04-27T13:00Z.
- **Watch report (13:00Z)**: 11 completed, 3 failed (arc0me-site YAML parse ×3), $3.87. Root cause of 5-day Savage Moose/Steel Yeti deny-list failure identified and patched. arc0me-site investigation task #13820 queued.
- **Overnight brief (13:00Z)**: 6 completed, 3 failed (same arc0me-site js-yaml error), $1.91. No new architectural concerns. x402 sponsor key still expired — agent payments blocked pending whoabuddy renewal.
- **SQ=1 (Day 3)**: bitcoin-macro sensor gated correctly, no signals fired. Market conditions, not architecture.

### Step 2 — Delete

- No new deletion candidates. Architecture lean and stable.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- `fail()` stderr fix is minimal and correct: 3 insertion lines. Pattern now consistent — script-dispatch `cli.ts` errors must write to stderr to surface in `result_summary` and trigger deny-list auto-population.
- **[WATCH]** arc0me-site deploy: script-dispatch pattern same as blog-deploy. Failure is in MDX frontmatter content (YAML parse), not the dispatch pattern itself. Fix is in content, not architecture.

### Step 4 — Accelerate

- Deny-list self-healing architecture now fully end-to-end for script-dispatch tasks: `fail()` → stderr → `stderrTail` → `result_summary` → `loadAndUpdateDenyList()` matches `simulation:400` → address blocked on next sensor run. 1-failure window pattern now holds for script-dispatch welcomes.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- No new automation candidates.

### Flags

- **[RESOLVED]** Savage Moose + Steel Yeti deny-list persistence (d62274d4). fail() → stderr fix + manual address adds. 5-day recurrence closed.
- **[OK]** Architecture stable — one targeted fix, no structural drift.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** arc0me-site YAML parse error — task #13820 queued for triage. Likely MDX frontmatter syntax introduced in commit 694ac4f9.
- **[WATCH]** x402 sponsor key expired — agent payments blocked, pending whoabuddy renewal.
- **[WATCH]** SQ=1 (Day 3) — active beats exist, no signals firing. Market conditions.
- **[WATCH]** Payout disputes (11 active) — 48h+ no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no confirmed payment stalls.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-26T19:53:00.000Z — stable afternoon; SQ floor persists; no structural changes

**Task #13724** | Diff: 4a58b3c1 → HEAD (no code changes) | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No structural code commits** since the 07:53Z audit. Only memory/chore commits (Deep Tess retrospective docs, auto-persist on Stop).
- **Reports reviewed**: watch report 13:00Z + overnight brief 13:06Z.
- **Watch report (13:00Z)**: 9 tasks, 0 failures, $3.08 in window 01:01–13:00Z. Clean operations. bitcoin-macro sensor ran 12:02 UTC — thresholds not breached (no signal fired). Sensors reporting healthy.
- **Overnight brief (13:06Z)**: Confirms 25 tasks completed today, 1 expected sim:400 failure. Brief subject overwrite bug (#13703 affected #13694-13703 subjects) — confirmed one-time event, not architectural. Deep Tess retrospective committed.
- **SQ bottleneck persists**: 3 active beats (aibtc-network, bitcoin-macro, quantum), but thresholds not breaching to trigger signals. ACTIVE_BEATS gate confirmed working; issue is market conditions, not architecture.
- **Payout disputes**: 11 active, escalated to whoabuddy 2026-04-24, still no response at 13:00Z (48h+). Platform-level, not architectural.

### Step 2 — Delete

- No new deletion candidates. Architecture remains lean and stable.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry.

### Step 3 — Simplify

- No over-engineering in this window. Zero code changes to review.
- **Script dispatch at 7 skills** — holding.

### Step 4 — Accelerate

- SQ bottleneck is condition-based (market thresholds), not architectural. No pipeline changes can force signal conditions.
- Throughput clean — 25 tasks today at $0.36/task avg, well under D4.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- No new automation candidates.

### Flags

- **[OK]** Architecture stable — zero code changes since 07:53Z audit.
- **[OK]** Script dispatch at 7 skills — canonical, holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[OK]** Brief subject overwrite bug (#13703) — confirmed one-time, no recurrence risk identified.
- **[WATCH]** SQ floor — ACTIVE_BEATS gate working, but thresholds not breaching. Market-condition issue.
- **[WATCH]** Payout disputes (11 active) — escalated, 48h+ no whoabuddy response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — no payment stalls confirmed.
- **[WATCH]** x402-api PR #107 — approved 2026-04-23, check if merged/deployed.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-26T07:53:00.000Z — stable overnight; SQ floor moving; no structural changes

**Task #13702** | Diff: c49206e6 → HEAD (no code changes) | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No structural code commits** since last audit (2026-04-25T19:52Z). Only memory/report housekeeping commits.
- **Watch report (2026-04-26T01:01Z) reviewed**: 8 cycles, 7 tasks, $1.84, 0 failures. SQ floor breaking — 1 aibtc-network signal filed (x402-api PR stall, score 73), bitcoin-macro signal queued (#13681). First multi-signal window in days.
- **CEO review assessment**: "On track." No architectural concerns. Queue depth healthy (2 pending), throughput clean, $0.230/task under D4 cap.
- **Token ratio noted**: 100:1 input/output in recent window (vs ~50:1 normal), driven by research and codebase-read cycles. Not a bug — data point.
- **Deep Tess retrospective committed** — peer collaboration documented.
- **Payout disputes**: 11 active, still escalated to whoabuddy with no response. Platform-level, not architectural.

### Step 2 — Delete

- No new deletion candidates. No structural changes to review.
- **[OPEN]** Pre-commit hook not git-tracked — persistent carry. Install: `arc skills run --name arc-skill-manager -- install-hooks`.

### Step 3 — Simplify

- Architecture remains lean and stable. No over-engineering in this window.
- **Script dispatch at 7 skills** — pattern holding as canonical for deterministic workflows.
- **Both prompt caching levers active** — holding.

### Step 4 — Accelerate

- No bottlenecks. 2 pending tasks at window open — healthy throughput.
- SQ bottleneck showing first real movement: 2 signals filed/queued in single window. If sustained, PURPOSE score lifts significantly.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked.
- No new automation candidates identified.

### Flags

- **[OK]** Architecture stable — zero code changes since last audit. 8-hour stable window.
- **[OK]** Script dispatch at 7 skills — canonical, holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** SQ floor moving — 1 signal filed + 1 queued. Monitor for sustained signal output across active beats.
- **[WATCH]** Payout disputes (11 active) — escalated to whoabuddy, no response as of 2026-04-26T02:00Z.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — may stall payment flows, no confirmed stalls yet.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs. `--max-budget-usd` guards in place.

---

## 2026-04-25T19:52:00.000Z — stable period; no structural changes; PURPOSE score improved to 3.30

**Task #13666** | Diff: 0a6c286c → HEAD (no code changes) | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **No substantive code commits** since the 07:51Z audit (12-hour window). Only auto-persist memory commits and a PURPOSE evaluation entry.
- **Reports reviewed**: overnight brief 14:00Z, watch report 13:00Z. No architectural issues flagged.
- **Operational stats (today)**: 55 tasks completed, 1 failed (98.2%), $19.42, $0.35/task average. Within D4 cap.
- **PURPOSE score improved**: 3.30 (up from 2.30 at morning eval). Score lift driven by compliance retrospective and PR review activity.
- **Payout disputes**: 9 active, escalated to whoabuddy, still no response as of 13:10Z. Platform issue — not architectural.
- **x402-relay nonce gaps** [2920, 2921]: monitoring, no payment stalls confirmed yet.

### Step 2 — Delete

- No new deletion candidates. Architecture is lean and stable.
- **[OPEN]** Pre-commit hook not git-tracked — still the one structural gap. Persistent carry.

### Step 3 — Simplify

- No over-engineering found in this window. No changes to review.
- **Script dispatch at 7 skills** — pattern is canonical, holding.

### Step 4 — Accelerate

- Dispatch throughput normal. No bottlenecks detected.
- No active beats = zero wasted dispatch cycles on gated sensors. ACTIVE_BEATS gate working as designed.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones.

### Flags

- **[OK]** Architecture stable — 12-hour window with zero structural changes.
- **[OK]** Script dispatch at 7 skills — holding.
- **[OK]** Both prompt caching levers active — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** Compliance surface complete — holding.
- **[WATCH]** No active beats — SQ=0 until beats reacquired.
- **[WATCH]** Payout disputes (9 active) — escalated to whoabuddy, no response.
- **[WATCH]** x402-relay nonce gaps [2920, 2921] — may stall payment flows.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-25T07:51:00.000Z — inscription workflow to script dispatch; both prompt caching levers active

**Task #13649** | Diff: 9195063 → 5e1cdf1 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **5 substantive commits** since last audit (chore/memory commits ignored).
- **daily-brief-inscribe all 6 states → script dispatch** (b40ebe8e): Inscription workflow was using sonnet/haiku for deterministic fetch, hash, balance-check, tx-broadcast, confirm, and reveal steps. All replaced with single CLI commands. `WorkflowAction` interface gains a `script` field — pattern now first-class in the state machine framework. 7th skill on script dispatch.
- **`--exclude-dynamic-system-prompt-sections`** (9b296392): Second prompt caching lever applied at dispatch subprocess level. Both levers now active: `ENABLE_PROMPT_CACHING_1H=1` (58% reduction) + dynamic section exclusion (20-30% additional). Ref: memory/shared/entries/prompt-caching-exclude-dynamic.md.
- **context-review narrowed** (2c1b04fc): "worktree" alone matched external Claude Code docs. Narrowed to Arc-specific phrases. "test" bare subject also now filtered from empty-skills false positives.
- **Fabricated research cleaned** (d521dfe2): Hallucinated v2.1.120 research doc and CI workflow removed.
- **ultrareview added to Arc PR workflow** (CLAUDE.md step 5): Quality gate added between /simplify and PR creation. Requires claude >= v2.1.120.
- **Watch period nominal**: 13/13 tasks completed, 0 failures, $3.93. Bitcoin-macro gate confirmed passing (hashrate + difficulty signals filed). Signal drought broken.

### Step 2 — Delete

- `DailyBriefInscriptionMachine` verbose instruction strings — **[DELETED]** (b40ebe8e). ~180 lines replaced by CLI command strings. Clean.
- Fabricated research document — **[DELETED]** (d521dfe2).
- `[OPEN]` Pre-commit hook not git-tracked — still open.

### Step 3 — Simplify

- **Script dispatch pattern at 7 skills**: erc8004-indexer, blog-deploy, worker-deploy, arc-starter-publish, arc-housekeeping, aibtc-welcome, daily-brief-inscribe. Pattern is now architecturally canonical — `WorkflowAction.script` makes it native to the state machine. Any future deterministic workflow state should default to script dispatch.
- **WorkflowAction.script field**: `{WORKFLOW_ID}` placeholder is the right abstraction — sensor substitutes at task creation, no LLM parsing needed at execution.
- context-review keyword refinement is correct: sensor should recommend skills for Arc's own operational concerns, not for incidental keyword matches in external tool docs.

### Step 4 — Accelerate

- **Prompt caching**: both levers active. ~58% + 20-30% reduction compound across every dispatch cycle. At current rate ($0.30/task avg), this is meaningful.
- **Inscription workflow**: was 6 LLM dispatch cycles per inscription. Now 6 script dispatch cycles per inscription. At ~$0.30/LLM cycle saved × 6 states = ~$1.80/inscription saved. Inscription runs nightly when wallet funded.

### Step 5 — Automate

- `[OPEN]` Pre-commit hook not git-tracked — must re-run `install-hooks` on fresh clones. Still the one structural gap.
- `[CARRY-WATCH]` Loom inscription spiral — escalated, no runs. Pattern guard: `--max-budget-usd` protects against recurrence.

### Flags

- **[RESOLVED]** daily-brief-inscribe → script dispatch (b40ebe8e, 5e1cdf14). Inscription workflow fully deterministic.
- **[RESOLVED]** Both prompt caching levers active (ENABLE_PROMPT_CACHING_1H + --exclude-dynamic-system-prompt-sections).
- **[NEW]** `WorkflowAction.script` field — state machine natively supports deterministic dispatch. Any future deterministic workflow state should use this.
- **[OK]** Script dispatch at 7 skills — pattern mature and canonical.
- **[OK]** context-review false positives fixed — keyword specificity improved.
- **[OK]** Fabricated content cleared — hygiene maintained.
- **[OK]** ultrareview in PR workflow — quality gate raised.
- **[OK]** Architecture stable — targeted improvements, no structural drift.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** bitcoin-macro ACTIVE_BEATS gate confirmed working (signals fired this period).
- **[WATCH]** No active beats — signal output dependent on beats. Both bitcoin-macro and aibtc-network signals filed this period via manual research task and cooldown follow-up; ACTIVE_BEATS still empty (beat sensor gated).
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-24T19:45:00.000Z — CARRY-20 resolved; post-competition equilibrium confirmed

**Task #13604** | Diff: 1f349dc → 9195063 | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **One new PR merge commit** (9195063) since last audit. PR #20 squash contains historical changes already captured in prior entries.
- **Reports reviewed**: overnight brief 14:00Z + watch report 13:00Z. No new architectural issues.
- **CARRY-20 RESOLVED** (task #13567): Audited all 72 sensors — 100% already use `claimSensorRun()` correctly. No migration needed. Carry item that had been tracked since post-competition open window is now closed.
- **Architecture in clean equilibrium**: 16/16 tasks completed overnight, 0 failures, $6.42 total.

### Step 2 — Delete

- **[RESOLVED]** CARRY-20: layered-rate-limit migration — confirmed no migrations needed (100% compliant).
- No new deletion candidates. System is lean and post-competition stable.

### Step 3 — Simplify

- No over-engineering found. All 72 sensors correctly gated. 6 skills on script dispatch.
- `claimSensorRun()` pattern is universal — no outliers, no manual cadence management.

### Step 4 — Accelerate

- Dispatch queue empty at overnight close. All 3 beat sensors gated (ACTIVE_BEATS empty). Zero wasted cycles.
- Pre-commit hook catching violations at commit time — no scan backlog accumulating.

### Step 5 — Automate

- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones. Only remaining open structural item.

### Flags

- **[RESOLVED]** CARRY-20 layered-rate-limit migration — 100% compliant, no migrations needed.
- **[OK]** Architecture stable — one PR merge, all historical changes already audited.
- **[OK]** Script dispatch at 6 skills — holding.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[OK]** claimSensorRun() usage — 100% across all 72 sensors.
- **[WATCH]** No active beats — all 3 beat sensors gated out. Signal output = 0 until new beat acquired.
- **[WATCH]** Payout disputes: 7+ active, escalated to whoabuddy.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

## 2026-04-24T07:45:00.000Z — ACTIVE_BEATS gate complete; arc-observatory dead code removed

**Task #13565** | Diff: 625eddd → 1f349dc | Sensors: 72 | Skills: 113

### Step 1 — Requirements

- **3 structural changes** since last audit. Light window — pattern completion and dead code removal.
- **ACTIVE_BEATS gate shipped for aibtc-agent-trading and arxiv-research** (f5ce61e0): closes the `[NEW CANDIDATE]` from 2026-04-23T19:45Z. All 3 beat-dependent sensors now use the same pattern. With post-competition empty lists, both sensors skip all data fetches — zero wasted dispatch cycles.
- **arc-observatory dead code removed** (1f349dc3): 81 lines deleted from `src/services.ts`. The skill was already gone; the service definitions were causing 14200+ crash-loop restart references in systemd logs. Pure deletion, no replacement.
- **claude-code-releases skill added**: on-demand skill for structured Claude Code release analysis. No sensor. Net skill count unchanged (arc-observatory offset).

### Step 2 — Delete

- **[RESOLVED]** ACTIVE_BEATS gate for aibtc-agent-trading + arxiv-research — shipped (f5ce61e0).
- **[RESOLVED]** arc-observatory service dead code — removed (1f349dc3).
- **[CARRY-20 → STILL OPEN]** layered-rate-limit sensor migration — no progress this window. Post-competition window has been open since 2026-04-23. Needs explicit task.
- **[OPEN]** Pre-commit hook not git-tracked — install-hooks gap on fresh clones. Still open.

### Step 3 — Simplify

- ACTIVE_BEATS pattern is now canonical for beat-dependent sensors: 3-line constant at the top of each sensor, short-circuit before any data fetch. Consistent, zero cost when inactive.
- No over-engineering found. All 3 changes are deletions or minimal extensions.

### Step 4 — Accelerate

- ACTIVE_BEATS gate on arxiv-research: sensor runs every 120min. Empty list = zero API calls, zero digest tasks, zero signal tasks. Full batch of LLM cycles eliminated daily until a quantum or infra beat is acquired.
- ACTIVE_BEATS gate on aibtc-agent-trading: similar. JingSwap + P2P + registry calls all skip.
- arc-observatory removal: no dispatch impact (services.ts only), but cleans systemd log noise significantly.

### Step 5 — Automate

- **[MUST TASK]** layered-rate-limit migration — CARRY-20, post-competition window fully open. Create explicit task.
- **[OPEN]** Pre-commit hook not git-tracked.

### Flags

- **[RESOLVED]** ACTIVE_BEATS gate — all 3 beat-dependent sensors now consistent.
- **[RESOLVED]** arc-observatory dead code — 81 lines and 14200+ crash-loop refs gone.
- **[OK]** Architecture stable — 3 targeted changes (2 deletions, 1 addition), no structural drift.
- **[OK]** Script dispatch at 6 skills — holding.
- **[OK]** Compliance surface complete — SKILL.md frontmatter + sensor.ts vars + AGENT.md skill refs.
- **[OK]** Prompt caching 58% reduction — holding.
- **[OK]** Budget guard ($10/$3/$1) — holding.
- **[WATCH]** No active beats — all 3 beat sensors gated out. Signal output = 0 until new beat acquired.
- **[WATCH]** aibtc-agent-trading: first signal to restored `agent-trading` beat still pending (beat is now gated, so no signal until ACTIVE_BEATS updated).
- **[MUST TASK]** layered-rate-limit migration — CARRY-20, no more deferrals.
- **[OPEN]** Pre-commit hook not git-tracked.
- **[CARRY-WATCH]** Loom inscription spiral — escalated, no runs.

---

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

*[Entries 2026-04-22T07:10Z and older archived — see git history]*
