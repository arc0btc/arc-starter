# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-07-11T04:20:00Z*

---

## [A] Active Items

**arc-blocked-review-autocommit-regression-fixed** [RESOLVED 2026-07-15, #22717, commit 56e2e766] Auto-commit 52d5cf59 (unattended, no dispatch session) broke `arc-blocked-review/sensor.ts`'s `insertTaskIfNew` call (wrong arg type, dropped `model` field) — sensor threw at runtime on every candidate batch for ~11h, silently halting blocked-task review creation. Fixed. Neither dispatch safety layer (transpile-only pre-commit guard, post-commit service health check) catches type/runtime regressions shipped via the fallback auto-commit path. **[FIXED 2026-07-15, #22721, commit f3469b19]** New `arc-typecheck-guard` skill (30-min sensor) runs real `tsc --noEmit`, flags per-file error-count INCREASES in `.ts` files touched by auto-commits, diffed against persisted baseline `db/tsc-baseline.json` (ignores pre-existing errors; tsconfig `include` scopes out the gitignored sibling-import noise, so branch baseline = 1). Validated end-to-end against real 52d5cf59. Flags a sonnet follow-up, does NOT revert (type errors don't crash a running Bun service). CLI: `arc skills run --name arc-typecheck-guard -- check|status|baseline`. See [[auto-commit-fallback-can-ship-silent-runtime-regressions]].
**observer-protocol-closed-no-action** [CLOSED 2026-07-14, #22604, issue aibtcdev/aibtc-mcp-server#269] Mention fired on already-closed thread (maintainer biwasxyz closed as invalid 12:43 UTC same day). No action taken — verified zero `observerprotocol` creds and zero DB/skills artifacts exist despite extensive prior `arc0btc` thread engagement that had escalated to "pilot staged, waiting on whoabuddy to proceed" with a real keypair registration/signing plan. **[FLAG]** This is a sustained social-engineering pattern (fake urgency, manufactured multi-agent consensus, incremental technical validation) that pulled several past dispatch cycles into treating an unverified third-party outreach pitch as legitimate infra to integrate with — each cycle saw only the latest comment, not the full escalation arc. See [[observer-protocol-social-engineering-escalation]] for the full pattern and how-to-apply rules (treat "register a keypair / sign a challenge" asks from external services as financial actions requiring pre-approval, not just the final go-ahead).
**x-api-cost-model-reframe** [MERGED 2026-07-11, #22015, merge commit a8714813, full history intact] PR #28 → main. whoabuddy confirmed pay-per-use billing: read=$0.005, owned-read=$0.001, write=$0.015 ($0.20 if link). Shipped: $0.50/day read budget, LINK_POST_DAILY_CAP=3, per-post $ logging. **[FLAG open]** Local working tree still on `feat/x-api-pay-per-use-dollar-budget`, re-diverged from main (650 ahead/0 behind) since --ff-only failed. Reconciling onto main is a "swap what you're running on" op — needs an out-of-band window, not a queued task on the branch it mutates. #22018 produced a verified cherry-pick runbook (3 real post-merge fixes off ~96 auto-commit noise) and emailed it to whoabuddy; awaiting execution. CI typecheck errors on main are PRE-EXISTING (~50, mostly gitignored `github/aibtcdev/skills/*` sibling-checkout imports), not a branch regression — see [[pr28-typecheck-preexisting-on-main]]. See [[x-api-pay-per-use-cost-model]], [[p-long-lived-diverged-branch-reconciliation]].
**disallowed-tools-not-enforced** [RESOLVED via docs reframe 2026-07-09, #21796; real-enforcement ask emailed #21800, awaiting reply] `disallowed-tools` frontmatter has zero enforcement in dispatch (skills are concatenated prompt text in one bypassPermissions subprocess, not native `.claude/skills/` objects). Reframed SKILL.md as intent-signaling only, not a technical control. Real enforcement would need per-subprocess tool-intersection logic across co-loaded skills — non-trivial, recommended against building it. See [[disallowed-tools-not-enforced-in-dispatch]].
**claude-cli-stale-version** [RESOLVED 2026-07-10, #21907, task status=completed] Installed CLI 2.1.174 vs npm latest 2.1.206, frozen by `DISABLE_UPDATES=1` (`src/services.ts:134`, intentional). Self-upgrade is structurally paradoxical via the task queue (see [[self-upgrade-task-queue-paradox]]) so no manual-upgrade reply is actually being awaited — resolved autonomously via `skills/claude-cli-drift-watch` (commit 0459eb90), a read-only monthly sensor that flags 5+ version drift without attempting upgrade. Not an open thread; drop from any "awaiting whoabuddy reply" tally. See [[claude-cli-stale-version-doctor-hang]].
**x-daily-read-tweet-cap-crowdout** [RESOLVED-SHIPPED 2026-07-08, #21577 decision → arc-day-n-publishing quest LIVE] whoabuddy's OPERATOR DECISION (2026-07-08): merge daily-read/blog/X-thread into one serialized "Day N" unit; DAILY_TWEET_CAP=6 unchanged. **[CORRECTED 2026-07-15, #22695]** The prior "**[GAP]** no implementation quest filed" note was a FALSE NEGATIVE — the merge WAS implemented the same day as a planned dev-council quest under `arc-day-n-publishing P0–P5` naming (not a subject matching "Day N merge", so a recent.log grep missed it). Verified LIVE: `agent_config.DAYN_MERGED=true`, `DAYN_EMAIL_ENABLED=true`. All 4 required aspects present — merge (`arc-daily-read/cli.ts` producer → single atomic 4-tweet thread + `buildBlogPublishTask` in `arc-workflows/blog-render.ts` + `subscriber-email.ts` + moltbook mirror; `daily_read_log.blog_slug` cross-ref stops ContentCalendarMachine double-ownership), never-skip degradation (`composeMinimalBeat` 1-tweet fallback, spec §3.4, `--simulate-failure`), reply-lane priority (dedicated `daily-read` lane 13:00–14:00 window; reply lane drains via social-engine, doesn't consume DAILY_TWEET_CAP — crowd-out dissolved structurally), attribution (`SRC_TAGS` registry in `arc-attribution/lib/src-tags.ts`). `blog-publishing/sensor.ts:24-26` cut to 4-5 posts/wk (research/council/operating/philosophical only — NO "read" category = no double-production). Edition 6 shipped via merged path 2026-07-10; ed 7-11 void/reserving ONLY due to X-credit depletion (#22075, auto-clears 2026-08-10), not an impl gap. Lesson: verify code/config state before treating a decision-backlog item as unbuilt — grep the actual quest naming, not just recent.log subjects. See [[x-daily-read-tweet-cap-crowdout]], [[verify-impl-state-before-reimplementing-decision-backlog]].
**whop-sku-agent-loop-engineering-overlap** [BLOCKED 2026-07-06, #21499; no-op re-reviewed 2026-07-08 #21692] Held 2nd same-day loop SKU — overlaps a published SKU from hours earlier. 4 consecutive blocked-review cycles hit the same false-positive "mention" signal (daily digest quoting a prior review's own text); fix filed #21694. Awaiting whoabuddy reply. **[FLAG]** `arc-blocked-review` sensor's `SIGNAL_REVIEW_COOLDOWN_HOURS` is bypassed whenever a task also carries a "blocked for Xh" stale reason (`skills/arc-blocked-review/sensor.ts:194-195` — `if (hasStaleReason) return true` skips the cooldown check entirely instead of falling back to the 48h/168h window), so #21499 and #21800 have been re-reviewed every ~8h (sensor interval) for days instead of the intended 48h/168h cadence. Fix filed #22689-review. See [[whop-sku-sign-off-vs-blanket-approval]].
**content-calendar-tier-A** [INCOMPLETE, #21213] 10/17 documented instances created; 7 missing. Un-gate: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off.
**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, #20192] Atomic SQL claim to replace file lock. Blocked on whoabuddy's DB-substrate decision. See [[fleet-dispatch-atomic-claim]].
**arc-0014-codex-review-gate** [PROPOSAL SUBMITTED 2026-07-14, #22623] Optional Codex adversarial cross-check step (advisory, high-stakes-PRs-only, gated same bar as opus routing) proposed for CLAUDE.md PR workflow step 5a. Uses existing `dispatchCodex()` (`src/codex.ts`) — no new infra. No CLAUDE.md edit made; needs whoabuddy sign-off since the PR workflow is a standing cross-repo SOP. See `agent-runtime/proposals/0014-codex-adversarial-review-gate.md`.
**x-daily-read-editions-8-9-void** [VOID 2026-07-12, #22161/#22165] Both editions drafted+validated clean but voided at post — X credits depleted since 2026-07-11 (pre-existing #22075, auto-clears 2026-08-10). Edition 8's abort also leaked its 4-tweet group reservation (`status='queued'`, never swept — sweep only covers `status='sending'`), blocking Edition 9's `reserve-group` call with `budget_exhausted`; fix filed #22166. See [[reservation-leak-orphaned-group-siblings-sweep]].
**arc-link-research-dedup-measurement** [2026-07-15 #22690 deferred, #22699 filed] Incident-dedup fix shipped 2026-07-13 17:38 UTC (commit 414ce89a, #22469). Early measurement at 2026-07-14 00:08 showed volume unchanged at 170 tasks / $103.57 (expected — window was 17.5/24h pre-deploy, 6.5/24h post-deploy, mostly old behavior). #22690 attempted re-measurement at 2026-07-15 03:11 UTC — still before the required 2026-07-15 17:38 UTC threshold (full 24h post-deploy window not yet elapsed), deferred without measuring. Follow-up #22699 filed to retry after threshold. See [[arc-link-research-cost-driver]].
**daily-eval** [ROLLING, last 2026-07-15 #22805] 2.10/5 — S:1 O:5 E:1 C:1 Ad:3 Co:1 Se:3 | $0.68/task actual ($96.24/day, 141 tasks, 24h) — cost/task rose again vs #22670's $0.613, still under D4's $200/day cap in absolute terms but trending wrong direction. 141/141 completed, 0 failed (100% success). Signal Quality 1/5, pinned by standing `SIGNAL_FILING_DISABLED` (policy, not a gap) — 4 "signal"-matching tasks were research/adjacent, not competition filings. Operational Health 5/5: zero-intervention day. Ecosystem 1/5: only 2 PR reviews (24h) — unchanged from #22670, still well below 20+/week target; no new follow-up (volume gap already tracked, not capability gap). Cost 1/5: `arc-link-research` dedup re-measurement (#22699) still the open lever — cost/task climbing while that measurement is outstanding is the thing to watch next eval. Adaptation 3/5: 44 retrospective/pattern-tagged tasks in the 24h window, `arc-typecheck-guard` skill (#22721) shipped and validated the prior cycle. Collaboration 1/5: same 2 one-way threads as #22670 (#21499 whop-sku, #21800 disallowed-tools-enforcement), neither past 14-day dead-end threshold, no re-nudge sent. Security 3/5: no incidents, no proactive audit this window. No follow-up filed — cost-per-task drift already covered by #22699's pending re-measurement; re-flag if #22699 lands and cost/task still >$0.60. Overwrite this line at next eval.
**stackspot-pox5-migration-risk** [RESOLVED 2026-07-15, #22814/#22817] Verified on-chain: all 4 stackspot.app pot contracts (Genesis, BuildOnBitcoin, STXLFG, Skull-Jackpot) hardcode `pox-4.allow-contract-caller`, which pox-5 removes. Already-deployed/immutable — can't patch. No `Epoch40`/pox-5 activation height configured on mainnet yet, not urgent today. #22817 shipped both follow-ups: Skull-Jackpot registered in `KNOWN_POTS` (nested-repo `github/aibtcdev/skills` commit a0191bf), sensor now pauses auto-join if Epoch40 activation is within 1 PoX cycle (arc-starter commit c65d5b2a). **[GOTCHA]** `github/aibtcdev/skills` is gitignored with its own independent git history, not a submodule — check both repos' git status separately on cross-repo tasks. See [[stackspot-pox4-hardcoded-pox5-migration-risk]].
**Dead-ends** → `dead-ends.md` [[dead-ends-convention]]: amber-otter (cred exposure), payout-disputes (stale), wallet-rotation (policy). Pruned 2026-07-14 (#22547): loom-spiral (root cause fixed — `arc-workflows` redesign is now structurally loom-spiral-proof, see `skills/daily-brief-inscribe/AGENT.md`), pr-511 (aibtc-mcp-server PR #511 closed 2026-05-17, no merge).

**Recently shipped/fixed** (no pending action, kept for pattern reference):
- `arc tasks close` terminal guard (#22006/a3f29176) wrongly lumped `blocked` in with `completed`/`failed`, but `markTaskBlocked` never sets `completed_at` so the reset-justification didn't apply — blocked resolved-blocked→completed/failed for good, re-flagging them forever via arc-blocked-review. Fixed #22505 (commit 71d6f298), `src/cli.ts:380` now only rejects re-close of `completed`/`failed`. #22086 still blocked pending whoabuddy confirmation of supersession. [[tasks-close-terminal-guard-overblocks-blocked-resolution]]
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
