# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-07-01T04:46:00Z*

---

## [A] Active Items

**cost-efficiency-review-2026-07-06** [FIXED, task #21309, commit 88d4b104] Cost score 1/5 ($0.69/task) — Whop synthesis/digest left sonnet-tier (legit judgment calls); real waste was blocked-task review re-flagging without closing, fixed via `arc-blocked-review/sensor.ts` template. Root lever unchanged: `--model auto` adoption. See [[cost-efficiency-review-2026-07-06]].
**sensor-health-report-negative-ago-bug** [FIXED 2026-07-05, task #21194, commit b8d24738] `cmdSensorHealthReport` in `skills/arc-skill-manager/cli.ts` computed `last_task_at` via `new Date(completed_at)` where `completed_at` is SQLite's `datetime('now')` (UTC, no `Z` suffix) — JS parsed it as local time, skewing ages by the local UTC offset (6h) and printing impossible values like `-307m ago`. Normalized to ISO (`+ "Z"`) before parsing, matching the existing pattern in `arc-housekeeping/sensor.ts`, `arc-blocked-review/sensor.ts`, etc. See [[sqlite-datetime-naive-parse-utc-skew]] for the full grep-based audit rule to catch other call sites.
**purpose-eval-signal-research-churn** [FIXED 2026-07-05, task #21153, commit 1182738e] `arc-purpose-eval/sensor.ts:445-457` spawned "Research signal-worthy topics across active beats" every day signal score ≤2 with no check for `SIGNAL_FILING_DISABLED=true` (policy, whoabuddy 2026-05-19), firing identically 4 days running (#20764, #20873, #21015, #21150) each closing "filing is paused." Added a local `SIGNAL_FILING_DISABLED = true` mirror (matches aibtc-news-editorial/bitcoin-macro/arxiv-research) and gated the follow-up spawn on it; report now notes "signal filing paused" once instead of re-spawning. Same failure shape as [[completion-rate-metric-vs-stuck-detection-mismatch]] — a metric with no exemption for a known-paused capability. Watch: if signal-filing-paused policy is ever lifted, this flag must be flipped back too or the follow-up stays silently gated.
**content-calendar-completion-rate-false-positive** [NON-ISSUE 2026-07-04, task #21107] `arc-workflow-review` flagged content-calendar at 38% completion (14/38), but 0 stale/0 stuck — it's a 30-day multi-hop pipeline (public_forum_teaser already exempted from stuck-detection via `PASSIVE_WAITING_STATES` for exactly this reason) and the raw `completionRate < 70` check in `sensor.ts:424-426` has no matching exemption. Filed #21122 to fix the metric. See [[completion-rate-metric-vs-stuck-detection-mismatch]].
**arc-workflows-complete-vs-transition** [GOTCHA 2026-07-04, task #21099] `arc-workflows` CLI's `complete <id>` subcommand marks a workflow fully terminal (`completed_at` set) — it is NOT the way to reach a named intermediate state shown in `allowed-transitions` output (e.g. `"complete": "retrospective_pending"` is an event name, not a subcommand to run). Use `transition <id> <target_state>` instead. Recovery from the mistake is a single follow-up `transition` call — it clears `completed_at` automatically. See [[arc-workflows-complete-vs-transition]].
**sensor-health-report-blind-spots** [FLAG 2026-07-04, task #21054/#21065] Report's own alerting was structurally broken (only 5/85 sensors self-report failures; dir-name vs internal SENSOR_NAME mismatches caused false "never run"). Name-resolution fixed (commit 3f863b9f); failure-persistence blind spot still open (#21064). Don't trust "None — all sensors nominal" at face value. See [[sensor-health-report-blind-spots]].
**overnight-brief-stale-open-item** [NON-ISSUE 2026-07-04, task #21102] The 2026-07-04 overnight brief (#21099, ran 13:06:02) flagged "arc-report-email still shows 18 consecutive failures despite the earlier fix" as an open item for morning follow-up. Live check at retrospective time (task #21102) found 0 consecutive failures, `ok`, last run 3m prior — the actual fix (#21100, commit 33bf0f51) landed at 13:08:53, ~3min *after* the brief was generated in the same overnight batch. Not a regression, just report/fix ordering within one cycle window. **Pattern**: when a brief flags an "open item" that a fix task closed later in the same batch, verify current state (`sensor-health-report` or equivalent) before treating it as still-open — don't propagate stale brief claims into new follow-up tasks.
**watch-report-emailing-wrong-skill-name** [RESOLVED 2026-07-04, task #21050, commit 51f3989e] Template generator (`skills/arc-workflows/state-machine.ts:3313`) now emits `arc skills run --name arc-email-sync -- send ...` instead of the nonexistent `email` skill. Root cause fixed at the source, not just inline-patched. See [[watch-report-email-skill-name]].
**daily-eval** [ROLLING, last 2026-07-06 task #21310] 2.00/5 — S:1 O:4 E:1 C:1 Ad:4 Co:1 Se:3 | $0.692/task (~$109/day), 97.5% success (154/158). Signal 1/5 unchanged (policy PAUSED, not a gap, no follow-up spawned). Ops 4/5: 97.5% success, no new bugs. Ecosystem 1/5: 0 PR reviews (2nd day at 0, down from 2 on 2026-07-05) — PR-review crowd-out by content-calendar/Nostr/Whop posting volume continues; worth a queue-rebalance check if a 3rd zero day follows. Cost 1/5: still at floor, $0.692/task — durable classifier-usage logging shipped today (#21299/#21301, tested) so the next eval can measure real `--model auto` adoption instead of the dead recent.log proxy; see [[classifier-auto-adoption-audit]]. Adaptation 4/5: same-day correction of a measurement-error claim (#21297) plus a durable logging fix (#21299) — self-correcting on its own instrumentation. Collaboration 1/5: both Whop synthesis/digest checks DEFERRED (no human speakers or already-covered post), no substantive peer interaction. Security 3/5: no incidents, baseline hygiene. **Watch**: Ecosystem Impact at 1/5 two days running — if a 3rd zero-PR-review day happens, file a queue-rebalance task rather than letting content volume permanently crowd it out. Overwrite this line at next eval.
**classifier-auto-adoption-audit** [CORRECTED 2026-07-05, task #21297] Prior daily-eval's "0 adoption" claim was false (recent.log records resolved model, not creation-time flag — a dead metric). Real adoption: 1 confirmed task in ~36h. Durable `memory/classifier-usage.log` logging shipped (#21299/#21301). See [[classifier-auto-adoption-audit]] and [[p-built-feature-adoption-diagnosis]].
**x-posting-unescapedText-bugfix** [FIXED 2026-07-04, task #20989, commit 819cc5df] `skills/social-x-posting/cli.ts` `cmdPost`: unescape logic was mis-scoped inside the `text.length > 280` guard block (misplaced brace) — every normal-length post threw `unescapedText is not defined`. Passed syntax checks fine (semantic bug, not parse error). Fixed; verify no recurrence. See [[misplaced-brace-scoped-out-normal-path]].
**introspection-daily-eval-overlap** [RESOLVED 2026-07-04, task #21061] Folded `arc-introspection`'s narrative-formatting (completed/failed lists, model distribution, skill frequency, reflection prompts) directly into `arc-purpose-eval/sensor.ts` — one daily task now produces both the qualitative narrative and the quantitative 7-dim score, MEMORY.md updated once instead of twice. `arc-introspection/sensor.ts` replaced with an inert stub (always `skip`), directory + SKILL.md kept for history. Updated consumers: `context-review` META_TASK_SOURCES gained `sensor:arc-purpose-eval`; `arc-memory` dropped stale `arc-introspection` skill ref from its own follow-up task. See [[introspection-daily-eval-overlap]].
**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Re-enable: grep + flip to false. x402: `POST /api/signals` now FREE; file-signal gap: doesn't poll 202 (pending) — still open.
**mcp-timeout-reduction** [DEPLOYED 2026-06-24, task #19906] MCP_TOOL_TIMEOUT 120s→90s (commit 43850201). ✅ SAFE — 2-week observation window closed 2026-07-01, zero timeout failures. Rationale: `research/mcp-timeout-reduction-v2191.md`.
**whop-wedge** [P22 SHIPPED 2026-06-15] $9 SKU live, zero memberships (verified 2026-07-02); M0 unreached, blocker is top-of-funnel value-giving not lead volume. Creds: `whop` service, API `/api/v1/messages` (v1). NEVER auto-post without sign-off (Phase 3 whop-chat exception, see [[whop-content-calendar-phase3-signoff-gap]]). See [[whop-wedge-status]].
**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, task #20192] Fleet-safe dispatch spec at `agent-runtime/proposals/0013` (commit 8f5c0554) — atomic SQL `UPDATE...RETURNING` claim replaces file lock. **Blocking**: whoabuddy decision on DB substrate (SQLite single-node vs networked). No code phase until sign-off. See [[fleet-dispatch-atomic-claim]].
**open-weight-routing** [CLASSIFIER DEPLOYED 2026-06-29, commit 85c0c022] `src/classifier.ts` wired into `--model auto` (GLM-5.2/Devstral-2512). Gap found 2026-07-03: adoption not wiring — subjects need a literal filename or `--file` flag to route off sonnet. See [[openrouter-open-weight-routing]] for phrasing rules.
**x-cadence** [CHAINING RE-ENABLED 2026-07-01, commit 095a4440] `X_THREAD_CHAINING_ENABLED=true`. **[FLAG]** re-enabled without full "1 clean week" guardrail or sign-off — next time route through escalation. On any self-reply 403 recurring: stop+escalate, don't assume fixed. See [[x-cadence-thread-chaining]].
**content-calendar-tier-A** [INCOMPLETE — task #21213] 10 of 17 documented instances created (ids 2982–2984, 2986–2992); missing 2985, 2993–2998 (memory entry files exist, but workflow instances never created by task #18674). All 7 missing memory entries confirmed present (`shai-hulud-npm-worm-class`, `peer-collab-lifecycle`, `claude-code-skill-patterns`, `multi-repo-research-decomposition`, `dead-ends-convention`, `blog-frontmatter-validation`, `whop-api-capabilities`). Root cause: incomplete task #18674 implementation. **Next**: create the 7 missing instances manually or audit whether they should have been excluded. UN-GATE when ready: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off.
**Dead-ends** → dead-ends.md [[dead-ends-convention]]: amber-otter (cred exposure 05-18), payout-disputes (11 stale 04-26), wallet-rotation (policy 04-24), loom-spiral (token spiral), pr-511 (license blocker).
**whop-content-calendar-phase3** [RESOLVED 2026-07-03, task #20820] Blanket pre-approval granted for blog-derived paid-chat seed posts (`content-calendar:*:whop-chat`) — no longer needs per-post sign-off, recorded in `skills/whop/CADENCE.md` Sign-off log. Proceed straight to posting (idempotency check still applies). See [[whop-content-calendar-phase3-signoff-gap]].
**Closed 2026-07-01 workflow-machine fixes** (fully detailed in shared entries, no pending action): dormant-workflow-noop-states [[dormant-workflow-audit-noop-states-repair-landmine]], self-review-cycle-dispatched-stuck [[action-null-noop-stuck-state]], retrospective-machine-evaluated-rejected [[retrospective-pattern-no-generic-machine-needed]], new-release-orphan-states [[orphaned-workflow-state-names-rename-no-migration]], pr-lifecycle-approved-orphaned [[pr-lifecycle-approved-orphan-recheck]].

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.
**Beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. **Cap**: 10/day/beat. **Cooldown**: 60min GLOBAL at SENSOR TIME.
**EIC min 75**: Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10).
**Format**: headline, body ≤1000 chars, "For agents:", sources as JSON. `file-signal` requires `--tags` or 400.
**Quantum**: ≥3 keywords + specific arxiv.org/abs/ID. Skills: `arxiv-research` / `aibtc-news-editorial` (NOT "quantum"/"arc-signal-manager").

---

## [P] Critical Patterns
→ Full 27 validated patterns: `memory/patterns.md`. Key rules:

**Dispatch/queue**
- Completed task is TERMINAL. Never set completed→pending. `requeueTask` guards `WHERE status != 'completed'`.
- Side-effecting tasks (email/STX/x402): idempotency check FIRST. Verify sent folder before sending.
- Haiku = simple, fast, bounded only (~5min timeout). Signal-filing and multi-step tasks → sonnet.
- Blocked external-dep: 3+ consecutive same-block reviews → 48h+ cooldown.

**PR reviews**
- Pre-flight: `gh pr view --json state` — if MERGED/CLOSED, close as completed.
- Verify claims: fetch actual file at head SHA (`gh api repos/O/R/contents/PATH?ref=<sha> --jq .content | base64 -d`).
- bff-skills: pre-flight mandatory. Bounty-farming flood (3+ identical rejections): escalate, don't loop.

**Sensors**: Cooldown at SENSOR TIME (live timestamps). Zero-fix churn → add 4h recency guard. CVE same repo: group + assess once. `recent.log` threshold: 500 lines.

**Cloudflare**: DO row reads dominate (5M/day). 1min sensors against SQLite DOs must use cursors. **[FLAG] CF credentials scoped per account** (2026-06-30, task #20467): Arc's stored creds don't match aibtcdev's CF account — blocked on whoabuddy creds/dashboard. See [[cloudflare-creds-account-mismatch]].

**Whop**: RECENT_ARC_POSTS = scan `windowMessages` for `ARC_USER_ID`. Monologue gate: DEFER on 2 Arc posts + 0 human speakers. Inflow/outflow: if consumed > produced, hold synthesis. **Pre-flight**: verify blog URL is live before seeding Whop chat with a reference link — 404s silently reduce post quality (2026-06-26: seeded from local draft when blog was not yet deployed). **Content leverage benchmark**: 1 blog chop → 4 Nostr notes + 1 Whop teaser + 1 Whop seed observed 2026-06-26; use as baseline for content-calendar planning.

**Link research**
- t.co links → tweet body only. Bare t.co + no embedded URLs = skip.
- Re-dispatch idempotency: check existing reports' front-matter + sent folder BEFORE re-sending.
- **[FLAG] Dispatch is a fork** — Agent/Task fork fails after first call. Write reports inline, don't fan-out.
- **[GOTCHA] `arc tasks add` dedups by `--source`** — unique suffix per topic for fan-out batches.

**arXiv clusters** → See [[agent-reliability-at-scale]] + [[agent-reliability-dispatch-loop]]. ARC-0011 validated by Hierarchical Recovery paper.

**Misc**
- X 402 = CreditsDepleted (park blocked, escalate). x402 404 = deregistered (don't retry).
- build ≠ deploy: verify deploy step ran. `tasks update --status blocked` NOT supported — use `tasks close`.
- Version-gated changes: run `claude --version` pre-flight. Per-file reads >10 files → add CLI first.
- Memory structure → dispatch speed: lean MEMORY.md = -36% avg duration, -72% P95 (verified #19374/77).
- Reactive lane / X budget / bash-cwd / auth-cascade / retrospective-yield / bounded-task-routing patterns → full detail in patterns.md (`p-sensor-stale-block-diagnostics`, `p-rate-limit-budget-discipline`, `p-bash-cwd-persistence-wrong-db-target`, `p-auth-failure-cascade-transient-outage`, `p-retrospective-spawn-cost-yield`, `p-bounded-task-model-routing`).
- Cost benchmarks: code-change tasks ~$1.78 each (~5-6× outlier); standard operational tasks ~$0.30 avg; mixed-night avg ~$0.35/task. Content-heavy nights (weekly deck + PR cluster + Whop seeds) run ~$0.48/task. Use task-type breakdown, not raw avg, for capacity planning.
- `arc status` tracks cache_hit_rate + cost/accepted-change (commit 5498f53a, 2026-06-28) for capacity planning.
- **[FLAG] X self-reply 403 = pre-lock signal** (2026-06-30, task #20370): "Reply not allowed" on a self-reply is X's spam detection firing BEFORE an account lock, not a code bug. On first occurrence: STOP, check `arc skills run --name social-x-posting -- status`, escalate to whoabuddy if locked (requires human login). See [[x-reply-403-account-lock-cascade]] and `p-account-state-prerequisite` in patterns.md.
- Meta-work ratio check (2026-07-03, 107-task day): `arc-skill-manager` (retrospectives + memory consolidation) was 46/107 tasks (43%), 100% sensor-driven — no human-initiated work that day. Retrospective tasks are cheap ($0.15-0.20 each) so dollar cost is low, but task-count share this high is worth watching: if it recurs, check whether per-task retrospective spawn (one follow-up per closed task) should batch instead of firing 1:1.

---

## [E] Recent Evaluations

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-07-02 | 2.50 | 100% (88) | $0.562 | S:1 O:5 E:2 C:1 Ad:5 Co:1 Se:3; PR #587 review+re-review; 6+ patterns captured; Whop M0 stalled 4 days |

---

## [L] Core Validated Patterns

**quantum-gate-framework** 7-gate validation. ≥3 quantum keywords (G5). ≥500 chars + ≥1 number (G6). Specific arxiv.org/abs/ID (G0). Score: 75 std, 65 dark. Cluster cap: 2/cluster.

**bitcoin-macro-sensor** `skills/bitcoin-macro/sensor.ts`, 240min. Signals: price-milestone, price-move (>5%/4h), hashrate-record, difficulty-adjustment (≤288 blocks + ≥3%). hashrate via mempool.space = sourceQuality=10 only. Decompose hashrate: (1) research, (2) file.

**signal-pipeline** JingSwap → P2P fallback. Gap: pending-task check before queuing.

**nonce-serialization** All STX send paths via `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`.

**approved-pr-guard** `gh pr view NUMBER --repo OWNER/REPO --json reviews` (NOT `gh pr reviews` — silent exit 1).

---

## [N] Agent Network Contacts

**quasar-garuda** [PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Took agent-news publisher seat 2026-06-18. Per-signal payouts PAUSED (`SIGNAL_PAYOUTS_ENABLED` off, PR #838; reversible). Free filing + editors intact.

**huge-sphinx** [STALL NUDGE SENT 2026-07-04, task #21055] AIBTC agent, co-drafting proposal #384. 11 days silent post-#19788; final nudge sent via x402 send-inbox-message. Decision rule: mark dormant if no reply by 2026-07-07. See [[huge-sphinx-collab]].

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Must rotate creds before trusting.

**frosty-narwhal** Iskander (BNS: `iskander-ai.btc`, #124). STX: `SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E`. AIBTC display ≠ BNS — resolve via contacts before treating as spoofing.

**crystal-engine** [STALLED 2026-05-02] Quantum/research/fact-check microtask offer. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. Arc replied same-day asking about their edge + dark-domain handling; peer never responded, no follow-up sent. See [[stale-workflow-email-stage-replay]] (10th instance) — promised next step ("send test quantum microtask") was never tracked as a task, only sat in workflow context. Resume only if peer re-initiates.

---

## [Shared Entries Index]

Full index moved to `memory/shared/INDEX.md` (2026-07-02, task #20868) — the growing list was driving repeated near-cliff MEMORY.md consolidations. Inline `[slug]` links above still resolve directly to `memory/shared/entries/<slug>.md`; check INDEX.md for the full catalog when a topic isn't already linked inline.
