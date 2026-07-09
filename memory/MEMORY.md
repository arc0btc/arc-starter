# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-07-07T00:25:00Z*

---

## [A] Active Items

**article-6-staged-tag-frontmatter-bug** [SHIPPED 2026-07-07, #21603; bug follow-up #21604] Article 6 (DeepMind 6-attack security audit) staged — blog synced to publish lane, X Article emailed to whoabuddy. Hit a real pipeline bug during staging: `arc-article-pipeline` derives a blog tag from `finding.slug.split("-")[0]`, which for date-prefixed slugs yields a bare year string ("2026"); `blog-publishing`'s unquoted YAML tag writer then lets that parse as a number, failing Astro's `string[]` schema. Worked around live by quoting the tag + re-running `fix-preview` (stage flow resumes idempotently via pinned `post_id`). Root fix filed #21604. See [[yaml-unquoted-numeric-string-frontmatter-bug]].
**x-daily-read-tweet-cap-crowdout** [BLOCKED 2026-07-07, #21577] Content-calendar thread blocked 3x in a row (#21157/#21162/#21385) — `arc-daily-read` posts 4 tweets and eats 4/6 of the shared `DAILY_TWEET_CAP` before other same-day threads get a turn. Distinct from the 2026-07-06 fix (commit bb9516e2) which protects daily-read FROM other lanes going first — that fix reserves nothing for content-calendar once daily-read has posted. Emailed whoabuddy 3 options (raise cap / daily-read sub-reservation / reorder scheduling) 2026-07-07; left blocked pending sign-off, not auto-fixed (cross-cadence tradeoff). See [[x-daily-read-tweet-cap-crowdout]].
**whop-sku-agent-loop-engineering-overlap** [BLOCKED 2026-07-06, #21499; re-reviewed no-op 2026-07-08 #21692] Held 2nd same-day loop SKU (`prod_YXBP0FKt3zzhm`) — overlaps published "Agent Loop Design" (`prod_W0UuZw8yIk5Yn`) from hours earlier. Emailed whoabuddy 3 options; still awaiting reply as of 2026-07-08 — 4 consecutive blocked-review cycles (#21563/#21589/#21634/#21692) found the same false-positive "mention" signal (daily PURPOSE-eval digest quoting a prior review's summary text, not a real resolution); fix filed #21694. Contrast with next entry: an explicit sign-off opt-out in a task description is deliberate, not stale boilerplate. See [[whop-sku-sign-off-vs-blanket-approval]].
**whop-sku-securing-autonomous-agents** [SHIPPED 2026-07-06, #21492] Published `prod_yJpaiGYdL4Ad6` ($9). Task said "needs sign-off" but that was stale — standing auto-publish directive (`skills/whop/cli.ts:415`) + explicit green light already existed (email 2026-07-06 23:21). Lesson: check `email_messages` table (`db/arc.sqlite`, no CLI search yet) and skill CLI comments for standing directives before trusting a task's framing. See [[whop-wedge-status]].
**disallowed-tools-not-enforced** [RESOLVED via docs reframe 2026-07-09, #21796; A gated as future feature] `disallowed-tools` frontmatter had **zero enforcement in dispatch** (confirmed #21642/#21790). Decision: **Option C** — reframed `arc-skill-manager/SKILL.md` from the false "Claude Code fails before it executes" control claim to explicit intent-signaling docs (+ "not enforced under Arc dispatch" banner). Rejected A (real `--disallowedTools` flag — it exists in v2.1.174) and B (soft prompt): the field is *per-skill* but dispatch loads many skills into one bypass subprocess — a read-only skill is routinely co-loaded with a write-needing one (#21642: `arc0btc-site-health` + `blog-deploy`), so subprocess-wide denial breaks the write skill; only intersection semantics + dropping bypassPermissions would work, both non-trivial → left sign-off-gated. Root: skills are prompt text, not native `.claude/skills/` objects, so per-skill tool scoping is meaningless in one concatenated subprocess. Real security boundary is elsewhere (worktree isolation, syntax guard, service-health check). See [[disallowed-tools-not-enforced-in-dispatch]].
**deepmind-6attack-security-audit-2026-07-06** [#21474] Mapped ingestion paths to DeepMind 6-attack taxonomy. Gaps found+fixed: `arc-link-research` missing data/instructions framing + unbounded URL auto-follow + CSS-blind HTML stripping (#21476/78/79); `arc-peer-inbox` had no AGENT.md, worst cross-agent-cascade vector (#21477); `recent.log`→MEMORY.md has no provenance check anywhere (#21480). No image/PDF ingestion exists yet. Report: `research/2026-07-06_security-audit-deepmind-6attack-taxonomy.md`. See [[deepmind-6attack-taxonomy-ingestion-audit]].
**x-api-cost-model-reframe** [SIGNED OFF 2026-07-06, #21462; impl #21463 CODE DONE, PR #28 STILL OPEN/UNMERGED as of 2026-07-08 #21665] whoabuddy confirmed billing = pay-per-use: read=$0.005, owned-read=$0.001, write=$0.015 ($0.20 if link). Shipped in-branch: $0.50/day dollar read budget, LINK_POST_DAILY_CAP=3, per-post $ logging, removed follower-reserve, fixed stale "500k free" comments. Mentions cadence 20→30min approved same day. **[FLAG]** #21665 investigated the "CI typecheck failing" self-review finding: confirmed it's PRE-EXISTING on `main` itself (~50 errors, mostly `github/aibtcdev/skills/*` imports — a gitignored sibling checkout never present in CI — plus a handful of unrelated logic bugs), NOT a regression from this branch's 250 commits. Diffed branch-vs-main error sets: only cosmetic differences (line-number shifts). Branch is 250 ahead / 0 behind main, so a merge is a clean fast-forward with no new CI regressions vs main's current (already-broken) baseline. Left unmerged pending whoabuddy sign-off (250 commits of unrelated ops work now riding this branch is a real scope-creep smell even if technically safe to merge) — see follow-up #21666. Root CI/typecheck debt (exclude `github/` imports from tsc or stub the sibling checkout in CI) filed separately, out of scope for a bounded fix. See [[x-api-pay-per-use-cost-model]], [[pr28-typecheck-preexisting-on-main]].
**pr-review-crowdout-false-alarm** [CORRECTED 2026-07-06, #21435] "3 consecutive zero-PR-review days" was a metric artifact, not real crowd-out — `scoreEcosystem()` samples one exact 24h window, sensitive to natural PR-volume burstiness. Queue latency was near-zero throughout. No queue changes made; fix filed #21437 to widen the metric. See [[pr-review-crowdout-false-alarm]].
**social-x-posting-legacy-path-consolidation** [MIGRATED 2026-07-07, #21524 shipped commit bb9516e2; assessed by architect #21580] Last 2 legacy `cmdPost` callers (whop-sales GTM, x-cadence beat) now reserve via `reserve-group` before posting, same as content-calendar/daily-read; fail-closed refusal widened to both new prefixes; dead CC `x_thread` cap block removed. Follow-up #21582 filed to assess whether the legacy (non-reserve-group) guard stack itself can now be deleted, since all known managed-lane sources are migrated. See [[social-x-posting-legacy-path-consolidation-assessment]].
**content-calendar-kill-switch-audit** [RESOLVED 2026-07-06/07, #21393/#21395] Live-posted thread traced to owning task #21164 (deferred repost) missing lane, not an out-of-band write — root cause (reserve-group default lane) already fixed same batch (commit ff2a49d8). Follow-up live-verified kill switch now correctly blocks at HEAD; found+filed a real fail-open bug where the legacy path check passes silently if `agent_config` row is missing (#21397), plus stray incomplete `arc.sqlite` files from relative DB paths (#21398). See [[reserve-group-lane-default-bypass]], [[kill-switch-legacy-path-fail-open]].
**daily-eval** [ROLLING, last 2026-07-08 #21750] 2.60/5 — S:1 O:5 E:3 C:1 Ad:4 Co:1 Se:3 | $0.665/task, $75.79/day so far (114/114 = 100% success today). Signal Quality pinned at 1 by standing `SIGNAL_FILING_DISABLED` policy — expected. Ops 5/5: zero failed tasks today. Ecosystem 3/5: 5 real PR reviews (agent-news #860/#861, landing-page #1028/#1031, mcp-server #596) + 1 skill improvement (arc-workflow-review detector prefix update, #21727); one PR (#593) was already-merged pre-dispatch, not a real review. Cost Efficiency 1/5: $0.665/task, driven partly by 2 back-to-back deferred X-cadence tasks (#21740/#21741, ~$0.55 each, `budget_exhausted` no-ops) — pattern already flagged in `p-rate-limit-budget-discipline`, no new action needed. Adaptation 4/5: multiple retrospectives extracted new patterns (polling-artifact-detection, external-api-field-limits, detector-refire-exemption update). Collaboration 1/5: no substantive two-way peer exchange today, only routine agent-news issue closures. Security 3/5: zero incidents, 2026-07-05 disallowed-tools restriction still untested. Overwrite this line at next eval.
**content-calendar-tier-A** [INCOMPLETE, #21213] 10/17 documented instances created; 7 missing (memory entries exist, workflow instances never created by #18674). Un-gate when ready: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off.
**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, #20192] Fleet-safe dispatch spec (`agent-runtime/proposals/0013`) — atomic SQL claim replaces file lock. Blocked on whoabuddy's DB-substrate decision (SQLite single-node vs networked). See [[fleet-dispatch-atomic-claim]].
**open-weight-routing** [DEPLOYED 2026-06-29, commit 85c0c022] `src/classifier.ts` wired into `--model auto` (GLM-5.2/Devstral-2512). Gap: subjects need a literal filename or `--file` flag to route off sonnet. See [[openrouter-open-weight-routing]].
**x-cadence** [CHAINING RE-ENABLED 2026-07-01, commit 095a4440] `X_THREAD_CHAINING_ENABLED=true`, re-enabled without full guardrail — route future re-enables through escalation. Any recurring self-reply 403: stop+escalate, don't assume fixed. See [[x-cadence-thread-chaining]].
**whop-wedge** [P22 SHIPPED 2026-06-15] $9 SKU live, zero memberships as of 2026-07-02; blocker is top-of-funnel value-giving, not lead volume. NEVER auto-post to Whop chat without sign-off, except the Phase 3 blanket pre-approval for blog-derived paid-chat seeds (`content-calendar:*:whop-chat`, resolved 2026-07-03). See [[whop-wedge-status]], [[whop-content-calendar-phase3-signoff-gap]].
**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused via `SIGNAL_FILING_DISABLED=true` in aibtc-news-editorial/bitcoin-macro/arxiv-research; full-skip in aibtc-news-deal-flow/aibtc-agent-trading. Re-enable: grep + flip false. x402 `POST /api/signals` now free; 202-pending polling gap still open.
**mcp-timeout-reduction** [DEPLOYED 2026-06-24] MCP_TOOL_TIMEOUT 120s→90s. 2-week observation closed 2026-07-01 clean, zero timeout failures.
**Dead-ends** → `dead-ends.md` [[dead-ends-convention]]: amber-otter (cred exposure), payout-disputes (stale), wallet-rotation (policy), loom-spiral (token spiral), pr-511 (license blocker).

**Resolved, no pending action** (detail in shared entries only): sensor-health-report negative-ago bug fixed [[sqlite-datetime-naive-parse-utc-skew]]; purpose-eval signal-research churn fixed [[completion-rate-metric-vs-stuck-detection-mismatch]]; content-calendar completion-rate false positive [[completion-rate-metric-vs-stuck-detection-mismatch]]; arc-workflows `complete` vs `transition` gotcha [[arc-workflows-complete-vs-transition]]; sensor-health-report blind spots (name-resolution fixed, failure-persistence gap open #21064) [[sensor-health-report-blind-spots]]; watch-report wrong skill name fixed [[watch-report-email-skill-name]]; classifier-auto-adoption audit corrected [[classifier-auto-adoption-audit]]; x-posting unescapedText bugfix [[misplaced-brace-scoped-out-normal-path]]; introspection/daily-eval overlap merged [[introspection-daily-eval-overlap]]; cost-efficiency review fixed via blocked-review template [[cost-efficiency-review-2026-07-06]]; 2026-07-01 workflow-machine fixes (dormant-noop-states, self-review stuck, retrospective-machine, orphan states, pr-lifecycle-approved) — see [[dormant-workflow-audit-noop-states-repair-landmine]] and linked entries.

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

**Cloudflare**: DO row reads dominate (5M/day). 1min sensors against SQLite DOs must use cursors. **[FLAG]** Arc's stored CF creds don't match aibtcdev's account — blocked on whoabuddy. See [[cloudflare-creds-account-mismatch]].

**Whop**: RECENT_ARC_POSTS = scan `windowMessages` for `ARC_USER_ID`. Monologue gate: DEFER on 2 Arc posts + 0 human speakers. Inflow/outflow: if consumed > produced, hold synthesis. Verify blog URL is live before seeding a Whop chat reference link. Benchmark: 1 blog chop → 4 Nostr notes + 1 Whop teaser + 1 Whop seed.

**Link research**
- t.co links → tweet body only. Bare t.co + no embedded URLs = skip.
- Re-dispatch idempotency: check existing reports' front-matter + sent folder BEFORE re-sending.
- **[FLAG]** Dispatch is a fork — Agent/Task fork fails after first call. Write reports inline, don't fan-out.
- **[GOTCHA]** `arc tasks add` dedups by `--source` — unique suffix per topic for fan-out batches.

**arXiv clusters** → [[agent-reliability-at-scale]] + [[agent-reliability-dispatch-loop]]. ARC-0011 validated by Hierarchical Recovery paper.

**Misc**
- X 402 = CreditsDepleted (park blocked, escalate). x402 404 = deregistered (don't retry).
- build ≠ deploy: verify deploy step ran. `tasks update --status blocked` NOT supported — use `tasks close`.
- Version-gated changes: run `claude --version` pre-flight. Per-file reads >10 files → add CLI first.
- Memory structure → dispatch speed: lean MEMORY.md = -36% avg duration, -72% P95 (verified #19374/77).
- Reactive lane / X budget / bash-cwd / auth-cascade / retrospective-yield / bounded-task-routing → full detail in patterns.md (`p-sensor-stale-block-diagnostics`, `p-rate-limit-budget-discipline`, `p-bash-cwd-persistence-wrong-db-target`, `p-auth-failure-cascade-transient-outage`, `p-retrospective-spawn-cost-yield`, `p-bounded-task-model-routing`).
- Cost benchmarks: code-change tasks ~$1.78 each (outlier); standard ops ~$0.30 avg; mixed-night avg ~$0.35/task; content-heavy nights ~$0.48/task. Use task-type breakdown, not raw avg.
- `arc status` tracks cache_hit_rate + cost/accepted-change for capacity planning.
- **[FLAG]** X self-reply 403 = pre-lock signal, not a code bug — X's spam detection fires before an account lock. On first occurrence: stop, check `social-x-posting -- status`, escalate if locked. See [[x-reply-403-account-lock-cascade]].
- Meta-work ratio watch (2026-07-03): `arc-skill-manager` retrospectives were 43% of a 107-task day, 100% sensor-driven. Cheap per-task but watch if recurring — consider batching per-task retrospective spawn.

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

**crystal-engine** [STALLED 2026-05-02] Quantum/research microtask offer. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. Peer never responded to same-day follow-up question; resume only if peer re-initiates. See [[stale-workflow-email-stage-replay]].

---

## [Shared Entries Index]

Full index at `memory/shared/INDEX.md`. Inline `[[slug]]` links above resolve to `memory/shared/entries/<slug>.md`; check INDEX.md when a topic isn't already linked inline.
