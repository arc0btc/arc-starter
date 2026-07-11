# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-07-11T04:20:00Z*

---

## [A] Active Items

**x-api-cost-model-reframe** [MERGED 2026-07-11, #22015, merge commit a8714813, full history intact] PR #28 → main. whoabuddy confirmed pay-per-use billing: read=$0.005, owned-read=$0.001, write=$0.015 ($0.20 if link). Shipped: $0.50/day read budget, LINK_POST_DAILY_CAP=3, per-post $ logging. **[FLAG open]** Local working tree still on `feat/x-api-pay-per-use-dollar-budget`, re-diverged from main (650 ahead/0 behind) since --ff-only failed. Reconciling onto main is a "swap what you're running on" op — needs an out-of-band window, not a queued task on the branch it mutates. #22018 produced a verified cherry-pick runbook (3 real post-merge fixes off ~96 auto-commit noise) and emailed it to whoabuddy; awaiting execution. CI typecheck errors on main are PRE-EXISTING (~50, mostly gitignored `github/aibtcdev/skills/*` sibling-checkout imports), not a branch regression — see [[pr28-typecheck-preexisting-on-main]]. See [[x-api-pay-per-use-cost-model]], [[p-long-lived-diverged-branch-reconciliation]].
**disallowed-tools-not-enforced** [RESOLVED via docs reframe 2026-07-09, #21796; real-enforcement ask emailed #21800, awaiting reply] `disallowed-tools` frontmatter has zero enforcement in dispatch (skills are concatenated prompt text in one bypassPermissions subprocess, not native `.claude/skills/` objects). Reframed SKILL.md as intent-signaling only, not a technical control. Real enforcement would need per-subprocess tool-intersection logic across co-loaded skills — non-trivial, recommended against building it. See [[disallowed-tools-not-enforced-in-dispatch]].
**claude-cli-stale-version** [BLOCKED 2026-07-10, #21901→#21907] Installed CLI 2.1.174 vs npm latest 2.1.206, frozen by `DISABLE_UPDATES=1` (`src/services.ts:134`, intentional). **[FLAG]** Self-upgrade is structurally paradoxical via the task queue — any dispatch of "upgrade claude" task IS itself a live subprocess holding the lock, so the precondition "no claude subprocess running" can never be true from inside. Needs a genuinely out-of-band actor (human SSH / external systemd unit). Emailed whoabuddy manual steps; #21907 filed a safe read-only drift-detection sensor. Check `claude --version` vs npm before acting on any release-note feature. See [[claude-cli-stale-version-doctor-hang]], [[self-upgrade-task-queue-paradox]].
**x-daily-read-tweet-cap-crowdout** [BLOCKED 2026-07-07, #21577] `arc-daily-read` posts 4 tweets, eating 4/6 of shared `DAILY_TWEET_CAP` before content-calendar gets a turn (blocked 3x: #21157/62/#21385). Emailed whoabuddy 3 options (raise cap / sub-reservation / reorder); left blocked pending sign-off. See [[x-daily-read-tweet-cap-crowdout]].
**whop-sku-agent-loop-engineering-overlap** [BLOCKED 2026-07-06, #21499; no-op re-reviewed 2026-07-08 #21692] Held 2nd same-day loop SKU — overlaps a published SKU from hours earlier. 4 consecutive blocked-review cycles hit the same false-positive "mention" signal (daily digest quoting a prior review's own text); fix filed #21694. Awaiting whoabuddy reply. See [[whop-sku-sign-off-vs-blanket-approval]].
**content-calendar-tier-A** [INCOMPLETE, #21213] 10/17 documented instances created; 7 missing. Un-gate: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off.
**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, #20192] Atomic SQL claim to replace file lock. Blocked on whoabuddy's DB-substrate decision. See [[fleet-dispatch-atomic-claim]].
**daily-eval** [ROLLING, last 2026-07-11 #22118] 2.40/5 — S:1 O:5 E:2 C:1 Ad:4 Co:1 Se:3 | $0.742/task actual ($92.08/124 cycles), $92.08/day, 122/124 completed (0 failed, 2 deliberate blocked), ~98%+ success. Signal Quality 1/5 pinned by standing `SIGNAL_FILING_DISABLED` policy (expected). Ecosystem 2/5: only 1 PR review (#22065, approved aibtcdev/agent-news #862) but real skill work shipped (reservation-leak fix #22087 + backstop sweep #22089, META_TASK_SOURCES refactor #22113). Cost 1/5: driven by legit content throughput (2 blog posts, article-8, 6 Nostr notes, Whop SKU packaged+published) not waste — under $200 D4 cap. Adaptation 4/5: 8+ patterns captured across retrospectives today (catch-block-resource-release, atomic-group crash recovery, excerpt-suitability-screening, etc.) plus new revenue capability shipped (Whop SKU `prod_DFg0QuZSRQ5zU` published, D1). Collaboration 1/5: still one-way emails awaiting whoabuddy reply (x-api branch reconciliation, whop-sku overlap, disallowed-tools). Security 3/5, zero incidents, no proactive audit today. No follow-up task filed — all underperforming dimensions already tracked by existing Active Items with owners (whoabuddy sign-off pending), nothing new stalled. Overwrite this line at next eval.
**Dead-ends** → `dead-ends.md` [[dead-ends-convention]]: amber-otter (cred exposure), payout-disputes (stale), wallet-rotation (policy), loom-spiral (token spiral), pr-511 (license blocker).

**Recently shipped/fixed** (no pending action, kept for pattern reference):
- Reserved-group X posts leaked `budget_ledger` reservations on non-403 send failures (402 CreditsDepleted) — fixed #22087, catch block now releases on ANY failure; manually recovered Edition 7's leaked daily-read siblings (reserved_count 3→0). Backstop-sweep follow-up shipped #22089 (commit 7ffc2960): a root that dies WITHOUT the catch block running (crash/kill, not just an API error) orphaned its still-'queued' siblings forever — `releaseAbandonedReservations()`'s lease-expiry + window-closed sweeps now also release group siblings via new `releaseGroupRemainderTx()`. [[reserved-group-non-403-release-leak]], [[reservation-leak-orphaned-group-siblings-sweep]]
- `tasks-close` re-closing a terminal task reset `completed_at`, looping stale tasks into daily retros — fixed #22006, terminal-state guard added. [[tasks-close-reclosing-resets-completed-at-retro-loop]]
- Email worker never implemented `--in-reply-to` (no headers, no DO columns) — fixed+deployed #22033-#22043, live-verified on mail.arc0.me. [[email-worker-in-reply-to-not-implemented]]
- `blog-publishing`'s `cmdPublish` never committed to git, so deploy sensor never fired — fixed #22010, 11-post backlog recovered and deployed. [[blog-publish-never-committed-gap]]
- `scoreEcosystem()` self-review/other-agent blind spot (zero-PR-review false alarms) — fixed commit d1eb32dc, #21998. [[pr-review-metric-self-review-blind-spot]]
- Article pipeline: date-prefixed slug → bare-year tag → unquoted YAML parsed as number, broke Astro schema — fixed #21604. [[yaml-unquoted-numeric-string-frontmatter-bug]]
- deepmind-6attack ingestion audit (#21474): fixed `arc-link-research` framing/auto-follow/HTML-strip gaps, added `arc-peer-inbox` AGENT.md, flagged `recent.log`→MEMORY.md provenance gap. [[deepmind-6attack-taxonomy-ingestion-audit]]
- Other resolved, detail in shared entries only: [[sqlite-datetime-naive-parse-utc-skew]], [[completion-rate-metric-vs-stuck-detection-mismatch]], [[arc-workflows-complete-vs-transition]], [[sensor-health-report-blind-spots]] (both gaps fixed, reverified 86/86 nominal #22028), [[watch-report-email-skill-name]], [[classifier-auto-adoption-audit]], [[misplaced-brace-scoped-out-normal-path]], [[introspection-daily-eval-overlap]], [[cost-efficiency-review-2026-07-06]], [[dormant-workflow-audit-noop-states-repair-landmine]], [[reserve-group-lane-default-bypass]], [[kill-switch-legacy-path-fail-open]], [[social-x-posting-legacy-path-consolidation-assessment]], [[pr-review-crowdout-false-alarm]].

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.
**Beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. **Cap**: 10/day/beat. **Cooldown**: 60min GLOBAL at SENSOR TIME.
**EIC min 75**: Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10).
**Format**: headline, body ≤1000 chars, "For agents:", sources as JSON. `file-signal` requires `--tags` or 400.
**Quantum**: ≥3 keywords + specific arxiv.org/abs/ID. Skills: `arxiv-research` / `aibtc-news-editorial` (NOT "quantum"/"arc-signal-manager").

---

## [P] Critical Patterns
→ Full validated patterns: `memory/patterns.md`. Key rules:

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

**Cloudflare**: DO row reads dominate (5M/day). 1min sensors against SQLite DOs must use cursors. **[CORRECTED 2026-07-11, #22032]** Stored CF creds DO work for the arc0.me zone (account "Stacklets") — prior "creds mismatch" flag was scoped to a different zone/resource, not blanket. Re-verify against the specific resource before assuming mismatch; `email/routing` (toggle) still errors even though `.../rules` works, so token is partially scoped.

**Whop**: RECENT_ARC_POSTS = scan `windowMessages` for `ARC_USER_ID`. Monologue gate: DEFER on 2 Arc posts + 0 human speakers. Inflow/outflow: if consumed > produced, hold synthesis. Verify blog URL is live before seeding a Whop chat reference link. Benchmark: 1 blog chop → 4 Nostr notes + 1 Whop teaser + 1 Whop seed. NEVER auto-post to Whop chat without sign-off, except the standing Phase 3 blanket pre-approval for blog-derived paid-chat seeds (`content-calendar:*:whop-chat`). See [[whop-wedge-status]], [[whop-content-calendar-phase3-signoff-gap]].

**Link research**
- t.co links → tweet body only. Bare t.co + no embedded URLs = skip.
- Re-dispatch idempotency: check existing reports' front-matter + sent folder BEFORE re-sending.
- **[FLAG]** Dispatch is a fork — Agent/Task fork fails after first call. Write reports inline, don't fan-out.
- **[GOTCHA]** `arc tasks add` dedups by `--source` — unique suffix per topic for fan-out batches.

**arXiv clusters** → [[agent-reliability-at-scale]] + [[agent-reliability-dispatch-loop]]. ARC-0011 validated by Hierarchical Recovery paper.

**Misc**
- X 402 = CreditsDepleted (park blocked, escalate). x402 404 = deregistered (don't retry).
- X self-reply 403 = pre-lock signal (X spam detection fires before account lock), not a code bug. On first occurrence: stop, check `social-x-posting -- status`, escalate if locked. See [[x-reply-403-account-lock-cascade]].
- build ≠ deploy: verify deploy step ran. `tasks update --status blocked` NOT supported — use `tasks close`.
- Version-gated changes: run `claude --version` pre-flight. Per-file reads >10 files → add CLI first.
- Memory structure → dispatch speed: lean MEMORY.md = -36% avg duration, -72% P95 (verified #19374/77).
- Reactive lane / X budget / bash-cwd / auth-cascade / retrospective-yield / bounded-task-routing → full detail in patterns.md (`p-sensor-stale-block-diagnostics`, `p-rate-limit-budget-discipline`, `p-bash-cwd-persistence-wrong-db-target`, `p-auth-failure-cascade-transient-outage`, `p-retrospective-spawn-cost-yield`, `p-bounded-task-model-routing`).
- Cost benchmarks: code-change tasks ~$1.78 each (outlier); standard ops ~$0.30 avg; mixed-night avg ~$0.35/task; content-heavy nights ~$0.48/task. Use task-type breakdown, not raw avg.
- `arc status` tracks cache_hit_rate + cost/accepted-change for capacity planning.
- Meta-work ratio watch (2026-07-03): `arc-skill-manager` retrospectives were 43% of a 107-task day, 100% sensor-driven. Cheap per-task but watch if recurring.

---

## [E] Recent Evaluations

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-07-02 | 2.50 | 100% (88) | $0.562 | #20643; S:1 O:5 E:2 C:1 Ad:5 Co:1 Se:3; PR #587 review+re-review; Whop M0 stalled 4 days |
| 2026-07-06 | 2.00 | 97.5% (154/158) | $0.692 | #21310; see daily-eval above |

---

## [L] Core Validated Patterns

**quantum-gate-framework** 7-gate validation. ≥3 quantum keywords (G5). ≥500 chars + ≥1 number (G6). Specific arxiv.org/abs/ID (G0). Score: 75 std, 65 dark. Cluster cap: 2/cluster.

**bitcoin-macro-sensor** `skills/bitcoin-macro/sensor.ts`, 240min. Signals: price-milestone, price-move (>5%/4h), hashrate-record, difficulty-adjustment (≤288 blocks + ≥3%). hashrate via mempool.space = sourceQuality=10 only.

**signal-pipeline** JingSwap → P2P fallback. Gap: pending-task check before queuing.

**nonce-serialization** All STX send paths via `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`.

**approved-pr-guard** `gh pr view NUMBER --repo OWNER/REPO --json reviews` (NOT `gh pr reviews` — silent exit 1).

---

## [N] Agent Network Contacts

**quasar-garuda** [PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Took agent-news publisher seat 2026-06-18. Per-signal payouts paused (reversible); free filing + editors intact.

**huge-sphinx** [STALL NUDGE SENT 2026-07-04] AIBTC agent, co-drafting proposal #384. 11 days silent post-#19788; final nudge sent. Mark dormant if no reply by 2026-07-07. See [[huge-sphinx-collab]].

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Must rotate creds before trusting.

**frosty-narwhal** Iskander (BNS: `iskander-ai.btc`, #124). STX: `SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E`. AIBTC display ≠ BNS — resolve via contacts before treating as spoofing.

**crystal-engine** [STALLED 2026-05-02] Quantum/research microtask offer. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. Peer never responded; resume only if peer re-initiates. See [[stale-workflow-email-stage-replay]].

---

## [Shared Entries Index]

Full index at `memory/shared/INDEX.md`. Inline `[[slug]]` links above resolve to `memory/shared/entries/<slug>.md`; check INDEX.md when a topic isn't already linked inline.
