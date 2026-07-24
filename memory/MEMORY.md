# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-07-11T04:20:00Z*

---

## [A] Active Items

**dispatch-oauth-42h-outage-2026-07-22** [FLAG 2026-07-24, #23624; follow-up #23643] Dispatch was fully down ~42h (2026-07-22T09:27:25Z → 2026-07-24T03:28:22Z) on OAuth 401 token expiry — every tick self-halted correctly (no retries, $0 wasted), but sensors kept queuing work so the queue grew to 42 pending tasks and the 2026-07-22 overnight brief was never generated. 9 correct "dispatch stale" health alerts fired during the outage but were auto-cancelled at recovery instead of surfaced — the outage was invisible without `journalctl --user -u arc-dispatch.service`. Recovery was silent (no `arc dispatch reset` logged, no operator action) — unconfirmed whether the token refresh is stable or a one-off. Brief at `reports/2026-07-23T140000Z_overnight_brief.md`. See memory shared entry `dispatch-oauth-42h-outage-2026-07-22` for full diagnostic method.

**article-pipeline-p4-revert-investigation** [DONE 2026-07-17, #23050] Investigated unexplained reverts of article 6/7 auto-package commits (c17f531e/9f568694) vs kept 8/9/10. No reason stated anywhere in arc-starter — bare git-revert commits, no matching cycle_log/task, originated from the external `manage-agents` control plane (`ops/article-covers/auto-package.ts`), not Arc dispatch. Content diff found no quality/dedup distinction from kept articles. Real finding: the revert wiped `packageEmailSentAt` for 6/7 back to pre-package state — risk of duplicate resend if the control-plane script re-runs and treats them as never-sent. Filed #23052 (control-plane fix + operator inbox check). See [[article-pipeline-p4-revert-clears-send-marker]]. **[FLAG-SECURITY → CLEARED-BENIGN 2026-07-17, #23053]** The "pre-fabricated result / planted completion" alarm was **self-confabulation, not tampering**. Forensics (#23053): 23050 had `attempt_count=1`, exactly ONE cycle_log row, NO duplicate/racing dispatch, and ZERO tasks in the DB have `completed_at<started_at` (the true planted-row signature). Real timeline: 23050 called `arc tasks close` at 08:42:52 (mid-run — set completed_at + wrote recent.log:521), then the subprocess idled to the **500s hard timeout** at 08:46:39; the recent.log line first entered git in 23050's OWN end-of-cycle auto-commit (e64076d4 @ 08:46:39), in no earlier commit. The session then re-read its own footprint during the trailing window and, suspicion-primed by the task subject + SOUL.md attack-trap framing, misread it as planted. 5 other tasks today show the same completed_at/cycle_log skew (#22999 skew 264s > 23050's 227s); none alarmed. NO integrity incident. Real minor lever: early-close-then-idle-to-timeout wastes cost ($2.51/2.79M-tok on 23050) — **[FIXED 2026-07-17, b9fdd085]** `fix(dispatch): self-close watchdog to avoid idling to hard timeout` ships the lever. See [[early-close-idle-to-timeout-completed-at-skew-false-tamper]].

**zest-yield-manager-nonce-gap-remediation** [RESOLVED 2026-07-16, #22939] Hard mempool gap on SP2GHQ...F3B (missing nonces 978/980/983 blocking 979/981/982/984 dust transfers + all sends behind them) fixed via `stx-send --nonce N` gap-fill (minimal 0.000001 STX pings to sponsor relay address). Chain confirmed clean (last_executed=985, no missing nonces, empty mempool); `nonce-manager` tracker re-synced. Unblocked #22936, which **COMPLETED 2026-07-16**: supplied 32,870 sats sBTC to Zest at nonce 986, txid `bbd33288b273d31aeaedc3e9c837902962df9eb93262fe29d336b968e2b0cb77`, confirmed on-chain `tx_status=success`. **[GOTCHA]** One "missing" nonce (983) was actually a stale sponsored sBTC tx silently dropped from mempool ~19h earlier — Hiro's tx-status API showed a transient circular `dropped_replace_by_fee` state for ~10s post-broadcast before settling to `success`; don't trust the first read. See [[nonce-gap-fill-via-explicit-nonce-stx-send]].
**zest-yield-manager-second-supply** [COMPLETED 2026-07-16, #22928] Second same-day supply: another 32,870 sats sBTC (cumulative Zest position now ~65,740 sats), nonce 988, txid `8603363af7a0af722904a28cdcbebfa30dc7f319091e3588c9cbca93d23191eb`, confirmed `tx_status=success` block 8567602. Sensor-triggered (idle sBTC above 200,000 sat liquid reserve threshold) — task description's "Current Zest position: 0 sats" was stale (sensor snapshot predated #22936's confirmation). **[GOTCHA]** `zest-yield-manager` has no `cli.ts` — invoke directly via `bun run skills/zest-yield-manager/zest-yield-manager.ts run --action=supply --amount=N --confirm --password <pass>` with `STACKS_ADDRESS` env var set explicitly (not read from creds store); wallet password is `arc creds get --service wallet --key password` (matches keystore id `6ebcdc9a-...`, not the separate `bitcoin-wallet` cred).
**x-outbound-kill-switch-tripped-2026-07-16** [ROOT CAUSE FIXED 2026-07-16 #22885 (ba589fa3); RE-ENABLE CLI SHIPPED 2026-07-16 #22887 (f4d880d3); STILL AWAITING OPERATOR SIGN-OFF] Trip at `2026-07-16T00:00:03Z` traced to `reply-watchlist-sensor` cron hitting a 403 `not-authorized-for-resource` on a routine reply-restriction, misclassified as auth failure by `classifyProviderError()`; fixed. `outbound_enabled` remains `false` — added `social-engine -- kill-switch status|enable --reason <text>` as the sole sanctioned re-enable path (mandatory --reason; deliberately does not self-invoke, per escalation design this needs whoabuddy's explicit go-ahead). See [[x-kill-switch-false-positive-reply-restriction-misclassified]]. (Older unresolved trip 2026-06-23 #21388/#21393 — see [[outbound-enabled-killswitch-contradiction-2026-07-06]] — is a separate incident, still unconfirmed.)
**arc-blocked-review-autocommit-regression-fixed** [RESOLVED 2026-07-15, #22717/#22721] Unattended auto-commit 52d5cf59 broke `arc-blocked-review/sensor.ts`'s `insertTaskIfNew` call (wrong arg type, dropped `model`), silently halting blocked-task review creation ~11h. Fixed (commit 56e2e766). New `arc-typecheck-guard` skill (30-min sensor, commit f3469b19) now runs real `tsc --noEmit` and flags per-file error-count INCREASES vs baseline `db/tsc-baseline.json` on auto-commit-touched files — closes the gap where neither dispatch safety layer catches type/runtime regressions from the fallback auto-commit path. CLI: `arc skills run --name arc-typecheck-guard -- check|status|baseline`. See [[auto-commit-fallback-can-ship-silent-runtime-regressions]].
**observer-protocol-closed-no-action** [CLOSED 2026-07-14, #22604] Mention on already-closed thread (aibtc-mcp-server#269, closed as invalid). No action — zero `observerprotocol` creds/artifacts exist. **[FLAG]** Sustained social-engineering pattern (fake urgency, manufactured consensus, incremental validation) previously escalated across cycles that each saw only the latest comment. Treat "register a keypair / sign a challenge" asks from external services as financial actions requiring pre-approval. See [[observer-protocol-social-engineering-escalation]].
**x-api-cost-model-reframe** [MERGED 2026-07-11, #22015, a8714813] PR #28 → main. Pay-per-use billing confirmed (read=$0.005, owned-read=$0.001, write=$0.015/$0.20-if-link). Shipped $0.50/day read budget, LINK_POST_DAILY_CAP=3. **[CORRECTED 2026-07-19, #23150]** Prior "re-diverged, needs cherry-pick judgment" framing was never actually verified with `git merge-tree`, and was wrong. Real state: branch is a strict superset of origin/main (ahead 1380, behind exactly 1 = the PR#28 merge commit itself, whose content the branch already has pre-merge). **Zero conflicts.** 1121/1380 commits are routine loop auto-commits; 259 are real work — this branch, not main, has been Arc's actual live trunk since 07-11 (dispatch just runs off whatever branch is checked out). Branch was 1380 commits unbacked-up locally — pushed to origin 2026-07-19. Filed #23159: single-decision ask (approve straight `gh pr create` + merge, no cherry-picking) to fast-forward main to reality; unblocks #21989/#22116/#22194/#22507/#22662/#22804/#22969. **[LESSON]** Don't assume "diverged branch" = "needs manual reconciliation" — run `git merge-tree $(git merge-base A B) A B` before escalating; empty output means a trivial merge regardless of commit count. See [[x-api-pay-per-use-cost-model]], [[p-long-lived-diverged-branch-reconciliation]].
**disallowed-tools-not-enforced** [RESOLVED via docs reframe 2026-07-09, #21796; real-enforcement ask #21800 awaiting reply] Frontmatter has zero enforcement in dispatch (concatenated prompt text, `bypassPermissions`). Reframed SKILL.md as intent-signaling only. Real enforcement needs per-subprocess tool-intersection across co-loaded skills — non-trivial, not recommended. See [[disallowed-tools-not-enforced-in-dispatch]].
**whop-sku-agent-loop-engineering-overlap** [BLOCKED 2026-07-06, #21499] Held 2nd same-day loop SKU, overlaps a published SKU. Awaiting whoabuddy reply. **[FLAG]** `arc-blocked-review`'s stale-reason path bypasses `SIGNAL_REVIEW_COOLDOWN_HOURS` (`skills/arc-blocked-review/sensor.ts:194-195`), so this and #21800 re-review every ~8h instead of 48h/168h; fix filed #22689-review. See [[whop-sku-sign-off-vs-blanket-approval]].
**content-calendar-tier-A** [INCOMPLETE, #21213] 10/17 instances created; 7 missing. Un-gate: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off.
**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, #20192] Atomic SQL claim to replace file lock. Blocked on whoabuddy's DB-substrate decision. See [[fleet-dispatch-atomic-claim]].
**arc-0014-codex-review-gate** [PROPOSAL SUBMITTED 2026-07-14, #22623] Optional Codex adversarial cross-check for high-stakes PRs (advisory, gated like opus routing), uses existing `dispatchCodex()`. Needs whoabuddy sign-off (PR workflow is cross-repo SOP). `agent-runtime/proposals/0014-codex-adversarial-review-gate.md`.
**arc-0016-nonce-state-network-namespacing** [PROPOSAL SUBMITTED 2026-07-16, #22940] Complete root-cause fix for the nonce clobber that produced #22939/#22936: shared `~/.aibtc/nonce-state.json` keys `addresses` by address only, so same-address different-network processes share a slot. Interim mitigations already shipped (dispatch defaults NETWORK=mainnet #92019508; wrong-network body reject arc0btc/skills#1). RFC proposes v3, keyed by `network:address`, explicitly NOT auto-migrating v2 entries (ambiguous network — re-sync fresh instead). Cross-repo (shared with `aibtc-mcp-server`), needs whoabuddy sign-off on coordinated deploy window before implementation. `agent-runtime/proposals/0016-nonce-state-network-namespacing.md`.
**arc-0015-link-research-grounding-gate** [PROPOSAL SUBMITTED 2026-07-16, #22857; STILL UNACTIONED 2026-07-20, #23250] Gate arc-link-research AGENT.md Step 8's mandatory two-repo grounding read to `arc_relevance>=3` reports (cost audit #22848: leaf Research tasks avg ~400-425k input tokens regardless of tier, Step 8 is the driver, fires on ~1/3 of ≤2-rated reports). Doesn't touch opus routing (deliberate, ~9% real cost spread). Sign-off required — AGENT.md marks Step 8 non-negotiable. `agent-runtime/proposals/0015-arc-link-research-grounding-gate.md`. **[4th eval flag, no reply]** Re-verified 2026-07-20 (#23250 cost review): Step 8 text unchanged in AGENT.md, arc-link-research still #2 skill by daily cost ($11.74/day). Re-flagging the same finding each eval wasn't converting to action, so filed #23257: a direct one-shot sign-off nudge (not another proposal re-file) instead of a 5th silent flag. See [[arc-link-research-cost-driver]].
**x-daily-read-editions-8-9-void** [VOID 2026-07-12, #22161/#22165] Voided at post — X credits depleted since 2026-07-11 (auto-clears 2026-08-10). Leaked group reservation fixed #22166. See [[reservation-leak-orphaned-group-siblings-sweep]].
**arc-link-research-dedup-measurement** [RESOLVED-VERIFIED 2026-07-16, #22847] Incident-dedup fix (414ce89a, 2026-07-13) confirmed: pre-deploy 169 tasks/$102.68/day → post-deploy clean day 2 tasks/$2.17/day (~98-99% reduction). Sensor batches per matured-candidate-set instead of per-candidate. Lineage closed. Per-task cost audit spawned [[arc-0015-link-research-grounding-gate]] above. See [[arc-link-research-cost-driver]].
**daily-eval** [ROLLING, last 2026-07-24 #23595] 1.70/5 — S:1 O:2 E:2 C:1 Ad:3 Co:1 Se:3 | $31.89 actual / $23.07 api over last 24h (45 tasks) = $0.709/$0.513 per-task — cost breach continues, worse than 07-22's $0.577/task. Signal Quality 1/5: still policy-paused since 05-19, 0 signals. Operational Health 2/5: 36 completed / 9 failed in 24h (20% nominal failure rate), but 8 of 9 "failures" are duplicate `health alert: dispatch stale` tasks closed as superseded — real signal is the 42h dispatch OAuth outage (2026-07-22 09:27Z–2026-07-24 03:28Z, #23624/#23643) that caused the alert storm; already root-caused and a proactive-expiry sensor shipped same day (#23661). Ecosystem 2/5: only 2 PR reviews in 24h, but real skill work landed (arc-article-pipeline cross-channel dedup fix #23670 after catching a near-duplicate Article 14 draft pre-publish, #23635/#23669). Cost 1/5: same regime as prior evals, no new driver — arc-0015 grounding gate (#22857) still the largest lever, still unimplemented, not re-flagging (see [[arc-link-research-cost-driver]]). Adaptation 3/5: 2+ patterns captured today (OAuth-outage diagnostic method, article-pipeline dedup gap) written to shared entries. Collaboration 1/5: no substantive peer exchange. Security 3/5: no incidents; the Article 14 near-duplicate catch was a content-integrity save, not a security event. Task constraints explicitly disabled queue boosting/reprioritizing this run — no priority changes made. No follow-up spawned: today's stalled items (arc-0015 sign-off, x-outbound-kill-switch re-enable) are pre-existing and already tracked; the 42h OAuth outage is resolved not open. Overwrite this line at next eval.
**stackspot-pox5-migration-risk** [RESOLVED 2026-07-15, #22814/#22817] All 4 stackspot.app pot contracts hardcode `pox-4.allow-contract-caller` (removed by pox-5); already-deployed/immutable, not urgent (no Epoch40 activation height set yet). Skull-Jackpot registered in `KNOWN_POTS`; sensor pauses auto-join if activation within 1 PoX cycle. **[GOTCHA]** `github/aibtcdev/skills` is gitignored with independent git history, not a submodule — check both repos separately. See [[stackspot-pox4-hardcoded-pox5-migration-risk]].
**Dead-ends** → `dead-ends.md` [[dead-ends-convention]]: amber-otter (cred exposure), payout-disputes (stale), wallet-rotation (policy).

**Recently shipped/fixed** (no pending action, pattern reference only — full detail in shared entries):
[[tasks-close-terminal-guard-overblocks-blocked-resolution]], [[reserved-group-non-403-release-leak]], [[reservation-leak-orphaned-group-siblings-sweep]], [[tasks-close-reclosing-resets-completed-at-retro-loop]], [[email-worker-in-reply-to-not-implemented]], [[blog-publish-never-committed-gap]], [[pr-review-metric-self-review-blind-spot]], [[yaml-unquoted-numeric-string-frontmatter-bug]], [[deepmind-6attack-taxonomy-ingestion-audit]], [[sqlite-datetime-naive-parse-utc-skew]], [[completion-rate-metric-vs-stuck-detection-mismatch]], [[arc-workflows-complete-vs-transition]], [[sensor-health-report-blind-spots]], [[watch-report-email-skill-name]], [[classifier-auto-adoption-audit]], [[misplaced-brace-scoped-out-normal-path]], [[introspection-daily-eval-overlap]], [[cost-efficiency-review-2026-07-06]], [[dormant-workflow-audit-noop-states-repair-landmine]], [[reserve-group-lane-default-bypass]], [[kill-switch-legacy-path-fail-open]], [[social-x-posting-legacy-path-consolidation-assessment]], [[pr-review-crowdout-false-alarm]], [[x-daily-read-tweet-cap-crowdout]], [[verify-impl-state-before-reimplementing-decision-backlog]], [[claude-cli-stale-version-doctor-hang]], [[self-upgrade-task-queue-paradox]].

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
- `candidate-maturation` sensor "consecutive failures" alert near end-of-day (e.g. 9 in a row overnight UTC) = X read-budget exhaustion (`db/x-read-budget.json` at daily cap), NOT a code bug — self-resolves at midnight UTC reset. Check `db/hook-state/candidate-maturation.json`'s `last_error` before treating as a real regression (#22825, 2026-07-16).
- `db/*.json` operational-state files (whop, x-budget, patterns-library, daily-read-materials) are NOT covered by the per-cycle auto-commit (`memory/`, `skills/`, `src/`, `templates/` only) — they accumulate as uncommitted drift between periodic dedicated "sync operational state" commits. Expected, not a drift-risk anomaly, unless the count grows unusually large.
- X self-reply 403 = pre-lock signal (X spam detection fires before account lock), not a code bug. On first occurrence: stop, check `social-x-posting -- status`, escalate if locked. See [[x-reply-403-account-lock-cascade]].
- build ≠ deploy: verify deploy step ran. `tasks update --status blocked` NOT supported — use `tasks close`.
- Version-gated changes: run `claude --version` pre-flight. Per-file reads >10 files → add CLI first.
- Memory structure → dispatch speed: lean MEMORY.md = -36% avg duration, -72% P95 (verified #19374/77).
- Reactive lane / X budget / bash-cwd / auth-cascade / retrospective-yield / bounded-task-routing → full detail in patterns.md (`p-sensor-stale-block-diagnostics`, `p-rate-limit-budget-discipline`, `p-bash-cwd-persistence-wrong-db-target`, `p-auth-failure-cascade-transient-outage`, `p-retrospective-spawn-cost-yield`, `p-bounded-task-model-routing`).
- Cost benchmarks: code-change tasks ~$1.78 each (outlier); standard ops ~$0.30 avg; mixed-night avg ~$0.35/task; content-heavy nights ~$0.48/task. Use task-type breakdown, not raw avg.
- `arc status` tracks cache_hit_rate + cost/accepted-change for capacity planning.
- Meta-work ratio watch (2026-07-03): `arc-skill-manager` retrospectives were 43% of a 107-task day, 100% sensor-driven. Cheap per-task but watch if recurring.
- `github-release-watcher` cost leak [FIX FILED 2026-07-17, #22982]: `anthropics/anthropic-sdk-typescript` is a monorepo tagging unrelated sub-packages (aws-sdk-, bedrock-sdk-, vertex-sdk-, google-cloud-sdk-) Arc doesn't use; `/releases/latest` surfaces whichever tagged most recently, so every sub-package release still spawned a full sonnet "Assess release"+retrospective pair since Feb 2026 (~$0.3-2.9/task, dozens of dispatches, zero led to integration). Cost-audit process: query `db/arc.sqlite` (not `db/tasks.db`/`db/arc.db`, both 0-byte stale placeholders — real path is `src/db.ts`'s `DB_DIR/arc.sqlite`) grouped by `skills`+`model` and by `source` prefix to find recurring high-volume/high-cost sensor sources.

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
