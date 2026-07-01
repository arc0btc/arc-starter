# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-06-30T04:33:00Z*

---

## [A] Active Items

**daily-eval** [ROLLING, last 2026-07-01 task #20605] 2.60/5 — S:1 O:4 E:4 C:1 Ad:3 Co:2 Se:4 | $0.733/task, $179.69/day | 234/245 success (95.5%), 10 PR reviews, 0 signals filed | Cost Efficiency now the binding constraint (1/5, $179.69/day vs $200 D4 cap — thin margin); Signal Quality still 0 beats/0 signals (policy PAUSED since 2026-05-19, not a gap); Adaptation not closing loop on known cost regression. **[BLOCKED] PR #133 (aibtcdev/x402-api form-data CVE)**: still needs CF dashboard access (whoabuddy escalated). Overwrite this line at next eval.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Re-enable: grep + flip to false. x402: `POST /api/signals` now FREE; file-signal gap: doesn't poll 202 (pending) — still open.

**mcp-timeout-reduction** [DEPLOYED 2026-06-24, task #19906] MCP_TOOL_TIMEOUT 120s→90s (commit 43850201). ✅ SAFE — zero timeout failures observed. 2-week observation ends 2026-07-01; rationale in `research/mcp-timeout-reduction-v2191.md`.
**whop-wedge** [P22 SHIPPED 2026-06-15] $9 SKU LIVE 2026-06-28: "The Loop, graded" — prod_iRxuQeieW4RCm at whop.com/the-loop-graded. **[FLAG] M0 UNREACHED 2026-06-29**: 1 comped buyer ($0), 0 MRR. Monologue gate DEFERring correctly (4 Arc, 0 human) — chicken-and-egg, can't seed without human speaker. **Next**: direct outreach to comped buyer, or lower monologue gate threshold for bootstrap. **Creds**: `whop` — `company_api_key`+`app_api_key`+`company_id biz_zQbfh5SnRnAF5Y`. API: POST `/api/v1/messages` (v1 NOT v5), channel `exp_I2Wew0PqJQ50a8`. NEVER auto-post without sign-off. **2 SKUs drafted 2026-06-30** (task #20403, awaiting sign-off) in `skills/whop/drafts/` (gitignored, untracked). Verify code claims before packaging — e.g. `nextRung` not `advanceRung` (`src/escalation.ts`).

**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, task #20192] Fleet-safe dispatch spec at `agent-runtime/proposals/0013` (commit 8f5c0554) — atomic SQL `UPDATE...RETURNING` claim replaces file lock. **Blocking**: whoabuddy decision on DB substrate (SQLite single-node vs networked). No code phase until sign-off. See [[fleet-dispatch-atomic-claim]].
**open-weight-routing** [POLICY WRITTEN 2026-06-28, task #20198] GLM-5.2 (~$0.01/task) + Devstral-2512 (~$0.003/task) both passed bounded code tasks. Policy in [[openrouter-open-weight-routing]]. **Bottleneck**: task-type classification UNQUEUED — queue it if cost/task sustains above $0.40 avg.
**x-cadence** [RESUMED-GUARDED 2026-06-30 task #20420] Account lock (#20397, self-reply 403 cascade) CLEARED by whoabuddy. **SHIPPED commit baf11fab**: content-calendar `x_thread` hop gated by `X_THREAD_CHAINING_ENABLED` (default OFF) — posts ONE standalone root, no `--reply-to` chaining, until ~1 clean week passes. Cadence path stays ON (`X_CADENCE_ENABLED=true`, single-root ~2/day); BLOG_TO_X stays OFF. **Restore full threading**: flip `X_THREAD_CHAINING_ENABLED=true` after a clean week. On any self-reply 403: stop+escalate, never retry. 4 beats: hot-topic, agent-philosophy, agent-journey, research-highlight (12h). [GOTCHA: read "Created task #N" line, not echoed `--source` value.]

**content-calendar-tier-A** [DORMANT] 17 instances ids 2982–2998. UN-GATE: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off. See `memory/content-calendar-tier-a.md`.
**Dead-ends** → dead-ends.md [[dead-ends-convention]]: amber-otter (cred exposure 05-18), payout-disputes (11 stale 04-26), wallet-rotation (policy 04-24), loom-spiral (token spiral), pr-511 (license blocker).
**dormant-workflow-noop-states** [CLOSED 2026-07-01] 13 dormant noop-state workflows closed; repair-stale-completions can silently reopen them (no real terminal state). See [[dormant-workflow-audit-noop-states-repair-landmine]].
**whop-content-calendar-phase3** [BLOCKED 2026-07-01, task #20638] First `content-calendar:*:whop-chat` hop reached dispatch; drafted post held, task closed `blocked` — Phase 3 sign-off (CADENCE.md) never granted/recorded. Expect all future instances to block the same way until whoabuddy signs off or a review-queue mechanism exists. See [[whop-content-calendar-phase3-signoff-gap]]. Explains content-calendar template's 45% completion rate in workflow health reports.
**self-review-cycle-dispatched-stuck** [FIXED 2026-07-01, task #20644, commit c20a14d8] 16 self-review-cycle workflows were stuck in `dispatched` state (some since 2026-06-05) because `SelfReviewCycleMachine.dispatched` had `action: () => null`. Fixed by polling `context.fixTaskIds` via `getTaskById` and transitioning to `resolved` once all are terminal. Stuck instances self-resolve on next `arc-workflows` sensor cadence (5min). Same fix applied to `CostReportAuditMachine.auditing` (task #20650). **[CLOSED 2026-07-01, task #20659]**: full audit of all ~80 `action:()=>null` states across 35 templates found this fan-out-poll bug shape does NOT recur elsewhere — everything else is terminal, human-decision-wait (`pr-lifecycle.approved`, `psbt-escalation.awaiting_approval`), self-transition (dispatched task calls `transition` itself), or sensor-driven (`pr-lifecycle.changes-requested`). One latent non-urgent gap found (`NewReleaseMachine.integrating` missing self-transition instruction, zero live instances) — task #20665. See [[action-null-noop-stuck-state]].
**retrospective-machine-evaluated-rejected** [CLOSED 2026-07-01, task #20645] Evaluated a generic `RetrospectiveMachine` (11 recurrences flagged by sensor) — not built. Ad-hoc `Retrospective: extract learnings from task #N` tasks self-dedup by parent task id (1921 completed/67 failed, all failures pre-dating solo-Arc; zero drift observed). Dedup risk only shows up in workflow-instance-keyed machines (HealthAlertMachine, FailureRetrospectiveMachine, SelfReviewCycleMachine, OvernightBriefMachine) which already exist for their specific triggers. See [[retrospective-pattern-no-generic-machine-needed]].

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

---

## [E] Recent Evaluations

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-06-28 AM | 2.05 | 100% (104) | $0.527 | S:1 O:5 E:1 C:1 Ad:2 Co:2 Se:3; overnight; 0 PR reviews; Whop DEFERs ×3 |

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

**huge-sphinx** [CO-AUTHOR 2026-06-23] AIBTC agent. Co-drafting proposal #384 (URI-change → reputation-event). Arc accepted joint co-ownership 2026-06-23 task #19788. Spec v1 drafted 2026-06-22 task #19689. **Watch**: idempotency collision risk — triage task and reply task both fire on same thread message; idempotency guard on repliedAt timestamp is the correct defense. **Next**: await Huge Sphinx response on spec v1 before advancing to PR.

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Must rotate creds before trusting.

**frosty-narwhal** Iskander (BNS: `iskander-ai.btc`, #124). STX: `SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E`. AIBTC display ≠ BNS — resolve via contacts before treating as spoofing.

**crystal-engine** [STALLED 2026-05-02] Quantum/research/fact-check microtask offer. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. Arc replied same-day asking about their edge + dark-domain handling; peer never responded, no follow-up sent. See [[stale-workflow-email-stage-replay]] (10th instance) — promised next step ("send test quantum microtask") was never tracked as a task, only sat in workflow context. Resume only if peer re-initiates.

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — restart loop diagnosis
- [claude-effort-skill-assessment](memory/shared/entries/claude-effort-skill-assessment.md) — effort-aware skills audit
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation
- [signal-quality-boost-checklist](memory/shared/entries/signal-quality-boost-checklist.md) — pre-flight checklist
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [blog-frontmatter-validation](memory/shared/entries/blog-frontmatter-validation.md) — duplicate YAML keys fail at build
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
- [agent-collab-feedback-loop](memory/shared/entries/agent-collab-feedback-loop.md) — UX feedback signal pattern
- [edge-cache-auth-gate-leak](memory/shared/entries/edge-cache-auth-gate-leak.md) — cache before auth = data leak
- [claude-code-version-deploy](memory/shared/entries/claude-code-version-deploy.md) — manual upgrade procedure
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — detector taxonomy
- [shai-hulud-npm-worm-class](memory/shared/entries/shai-hulud-npm-worm-class.md) — npm CI-takeover worms
- [harness-engineering-five-subsystems](memory/shared/entries/harness-engineering-five-subsystems.md) — 5-subsystem model
- [harness-engineering-completion-verification](memory/shared/entries/harness-engineering-completion-verification.md) — verification gaps
- [content-publish-verify-deploy](memory/shared/entries/content-publish-verify-deploy.md) — build ≠ deploy
- [agent-eval-volume-taxonomy](memory/shared/entries/agent-eval-volume-taxonomy.md) — Hylak volume tiering
- [file-inbox-hcom-pattern](memory/shared/entries/file-inbox-hcom-pattern.md) — local IPC file pattern
- [dead-ends-convention](memory/shared/entries/dead-ends-convention.md) — when to use dead-ends.md
- [file-dep-sha-pin-illusion](memory/shared/entries/file-dep-sha-pin-illusion.md) — file deps don't pin SHA
- [escalation-ladder-arc0011](memory/shared/entries/escalation-ladder-arc0011.md) — ARC-0011 retry ladder
- [fleet-dispatch-atomic-claim](memory/shared/entries/fleet-dispatch-atomic-claim.md) — atomic claim dispatch
- [workflow-context-clobber](memory/shared/entries/workflow-context-clobber.md) — context timing landmine
- [whop-api-capabilities](memory/shared/entries/whop-api-capabilities.md) — Whop monetization wedge
- [path-conditional-hook-guards](memory/shared/entries/path-conditional-hook-guards.md) — hook guard patterns
- [high-divergence-pr-merge](memory/shared/entries/high-divergence-pr-merge.md) — high-divergence branch merge
- [maintainability-sensors-coding-agents](memory/shared/entries/maintainability-sensors-coding-agents.md) — sensor taxonomy
- [omnigent-competitive-intel](memory/shared/entries/omnigent-competitive-intel.md) — meta-harness architecture
- [domain-glossary-context-md](memory/shared/entries/domain-glossary-context-md.md) — domain glossary pattern
- [rfc-demand-first-evaluation](memory/shared/entries/rfc-demand-first-evaluation.md) — RFC evaluation framework
- [stop-slop-prose-voice-filter](memory/shared/entries/stop-slop-prose-voice-filter.md) — AI prose filter
- [hermes-agent-convergent-architecture](memory/shared/entries/hermes-agent-convergent-architecture.md) — Hermes convergence
- [ponytail-yagni-skill-class](memory/shared/entries/ponytail-yagni-skill-class.md) — YAGNI skill ladder
- [twelve-factor-agents-arc-scorecard](memory/shared/entries/twelve-factor-agents-arc-scorecard.md) — 12FA scorecard
- [tracebase-agent-session-observability](memory/shared/entries/tracebase-agent-session-observability.md) — trace capture pattern
- [llm-council-deliberation-pattern](memory/shared/entries/llm-council-deliberation-pattern.md) — council 3-phase pattern
- [agent-council-dsl-grammar-v1](memory/shared/entries/agent-council-dsl-grammar-v1.md) — council DSL standard
- [wiki-builder-knowledge-base-pattern](memory/shared/entries/wiki-builder-knowledge-base-pattern.md) — wiki-builder pattern
- [self-fork-inherits-full-context](memory/shared/entries/self-fork-inherits-full-context.md) — self-fork gotcha
- [agent-reliability-at-scale](memory/shared/entries/agent-reliability-at-scale.md) — arXiv reliability cluster
- [agent-reliability-dispatch-loop](memory/shared/entries/agent-reliability-dispatch-loop.md) — dispatch loop validation
- [arxiv-name-collision-resolve-tco](memory/shared/entries/arxiv-name-collision-resolve-tco.md) — name collision resolution
- [dispatch-revert-uses-git-revert](memory/shared/entries/dispatch-revert-uses-git-revert.md) — git revert vs reset
- [mcp-server-buffer-hex-no-0x-prefix](memory/shared/entries/mcp-server-buffer-hex-no-0x-prefix.md) — buffer hex format
- [research-batch-triage-process-once](memory/shared/entries/research-batch-triage-process-once.md) — batch triage pattern
- [openrouter-open-weight-routing](memory/shared/entries/openrouter-open-weight-routing.md) — open-weight routing
- [claude-code-skill-patterns](memory/shared/entries/claude-code-skill-patterns.md) — skill author best practices
- [multi-repo-research-decomposition](memory/shared/entries/multi-repo-research-decomposition.md) — multi-repo research
- [flag-gates-creation-not-evaluation](memory/shared/entries/flag-gates-creation-not-evaluation.md) — flag gate timing
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — hook form audit result
- [x-reply-403-account-lock-cascade](memory/shared/entries/x-reply-403-account-lock-cascade.md) — X self-reply 403 = pre-lock signal, stop + escalate
- [fork-inherits-full-plan](memory/shared/entries/fork-inherits-full-plan.md) — forked agent inherits full conversation plan context
- [no-proxy-verification](memory/shared/entries/no_proxy_verification.md) — proxy config not verified on systemd/bun deploy
- [openrouter-open-weight-benchmark](memory/shared/entries/openrouter-open-weight-benchmark.md) — GLM-5.2/Devstral-2512 benchmark data vs Sonnet
- [goose-headless-eval](memory/shared/entries/goose-headless-eval.md) — Goose 1.39.0 headless GO (conditional): json out splits in/out tokens, no native $ cost
- [self-authored-pr-no-approve](memory/shared/entries/self-authored-pr-no-approve.md) — gh pr review --approve fails on Arc's own PRs, comment instead
- [report-path-archive-rotation](memory/shared/entries/report-path-archive-rotation.md) — rotated report files live in reports/archive/, not reports/
- [stale-workflow-email-stage-replay](memory/shared/entries/stale-workflow-email-stage-replay.md) — un-sticking stale workflows replays their email stage with months-old content (whoabuddy got 3 stale Apr watch reports 2026-06-30); guard side-effects before un-stick repairs
- [failure-triage-pattern-coverage-gap](memory/shared/entries/failure-triage-pattern-coverage-gap.md) — "unknown" failure bucket = regex coverage gap, widen categories not exact strings
- [retrospective-workflow-3054-duplicate-flood](memory/shared/entries/retrospective-workflow-3054-duplicate-flood.md) — workflow:3054 spawned 6 dup dispatch-stale retrospectives in 30min, no dedup guard
- [retrospective-pattern-no-generic-machine-needed](memory/shared/entries/retrospective-pattern-no-generic-machine-needed.md) — generic RetrospectiveMachine evaluated and rejected, ad-hoc task pattern already self-dedups
