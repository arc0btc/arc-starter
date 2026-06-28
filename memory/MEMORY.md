# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-06-28T14:22:00Z*

---

## [A] Active Items

**daily-eval** [ROLLING, last 2026-06-28 PM task #20225] 2.50/5 — S:1 O:5 E:1 C:2 Ad:5 Co:2 Se:3 | $33.31/day = $0.411/task | 81/82 (98.8%) | Signal PAUSED; 0 PR reviews (structural); strong adaptation day ($9 SKU live, buildPrompt reorder, cache metrics, GLM routing, memory-health wired). Overwrite this line at next eval.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**x402-signal-payment** [UPDATED 2026-06-18] `POST /api/signals` now FREE — x402 sBTC is fallback only. Gap: file-signal does NOT poll 202 (pending) — still open. Filing PAUSED per whoabuddy policy (separate from cost).

**mcp-timeout-reduction** [DEPLOYED 2026-06-24 16:05:34, task #19906] MCP_TOOL_TIMEOUT reduced 120s→90s (commit 43850201). **Status**: ✅ SAFE, no rollback needed. First 6h observation: zero timeout failures, max x402 ops 63s (27s margin), capability discovery healthy. Leverages v2.1.191 retry backoff. Continue 2-week observation (checkpoint 2026-07-01). Rationale in `research/mcp-timeout-reduction-v2191.md`.

**whop-wedge** [P22 SHIPPED 2026-06-15] All phases P17–P22 live. **$9 SKU LIVE 2026-06-28**: "The Loop, graded" — prod_iRxuQeieW4RCm at whop.com/the-loop-graded; Boris/Eric/Prajwal-mapped; visible. **[FLAG] Channel active 2026-06-18**: whoabuddy seeded paid room; Arc replied 3 times. Synthesis DEFER: 2 Arc posts + 0 human speakers. **Next**: gate on ≥1 human message in window rather than dropping Arc-post count. **Creds**: `whop` — `company_api_key` + `app_api_key` + `company_id` `biz_zQbfh5SnRnAF5Y`. **API**: POST `/api/v1/messages` `{channel_id,content}` (v1 NOT v5). Channel `exp_I2Wew0PqJQ50a8`; feed `chat_feed_1CbxMbfsj2yvpGqNnMcuCg`. Phase 3: `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=true`. NEVER auto-post without sign-off.

**arc-0013-fleet-dispatch** [SPEC SUBMITTED 2026-06-28, task #20192] Fleet-safe dispatch loop spec written to `agent-runtime/proposals/0013` (commit 8f5c0554). Key change: atomic SQL `UPDATE...RETURNING` claim replaces file lock. **Blocking**: whoabuddy decision on DB substrate — extend arc-starter SQLite (single-node fleet) vs. networked DB (true multi-host). No code phase until sign-off. See [[fleet-dispatch-atomic-claim]].

**open-weight-routing** [POLICY WRITTEN 2026-06-28, task #20198] GLM-5.2 (~$0.01/task) + Devstral-2512 (~$0.003/task) both passed bounded code tasks. Routing policy in [[openrouter-open-weight-routing]]. **Bottleneck**: task-type classification work is UNQUEUED — without it, no automated routing happens. Queue classification task if cost tracking shows sustained elevation above $0.40/task avg.

**x-cadence** [ACTIVE] 4 beats: hot-topic, agent-philosophy, agent-journey, research-highlight (12h, `X_CADENCE_ENABLED=true`). **BlogToXMachine SHIPPED**: deduped by instance-key, pausable via `WORKFLOWS_BLOG_TO_X_ENABLED=false`. Double-post fix #19298: `syncBlogPublishes()` skips publish-fanout if `content-calendar:<postId>` exists. [GOTCHA: read "Created task #N" line, not echoed `--source` value.]

**content-calendar-tier-A** [DORMANT] 17 instances ids 2982–2998. UN-GATE: `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whoabuddy sign-off. See `memory/content-calendar-tier-a.md`. Double-post blocker CLEARED 2026-06-18.

**Dead-ends** → dead-ends.md [[dead-ends-convention]]: amber-otter (cred exposure 05-18), payout-disputes (11 stale 04-26), wallet-rotation (policy 04-24), loom-spiral (token spiral), pr-511 (license blocker).

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

**Cloudflare**: DO row reads dominate (5M/day). 1min sensors against SQLite DOs must use cursors.

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
- Reactive lane anomaly: 116 ticks/0 tasks = `already_queued` stale-blocking; fix = state-encoding in source keys (`action.source:state`) + `pendingTaskExistsForSourcePrefix` duplicate guard. Shipped #19828 2026-06-24. See patterns.md.
- Cost benchmarks: code-change tasks ~$1.78 each (~5-6× outlier); standard operational tasks ~$0.30 avg; mixed-night avg ~$0.35/task. Content-heavy nights (weekly deck + PR cluster + Whop seeds) run ~$0.48/task. Use task-type breakdown, not raw avg, for capacity planning.
- **[FLAG] Auth cascade = extended silence**: 3 consecutive "Failed to authenticate. API Error" tasks (non-retryable per failure rules) caused 35h dispatch outage (2026-06-20 15:02Z → 2026-06-22 02:14Z). Root cause was transient Anthropic API issue, not a credential failure. Health sensors fired correctly (8 alerts). Recovery required manual dispatch resume. If auth failures cluster (3+ in <1h with no prior session issues), treat as likely transient outage — escalate to whoabuddy rather than silently stalling. **Recovery capacity**: 67 tasks cleared in ~10h post-resume with no cascade failures (pure queue accumulation, not errors). Estimate ~6–7 tasks/hour for post-outage recovery planning.
- **X post ceiling is binding DAILY, not just on spikes** (corrected #19829): budget history shows 3/3 every day 06-18→23, not occasional overflow. This is the intended GTM dial-down (cli.ts:187, 10→3 set 06-15), so constant saturation = discipline working, NOT a too-low cap. Threads queue to next AM (delayed, not dropped). Decision framing made #19829: keep cap at 3; the lever for a stuck time-sensitive thread is prioritization within the 3-slot budget, not a higher ceiling. X cap ⟂ PR throughput — never conflate the two when diagnosing PURPOSE score. **Thread starvation pattern** (observed 2026-06-25): threads needing 3-4 posts lose consistently when single-post cadence tasks consume budget first. Cadence posts execute earlier in the day; queued threads arrive and find 0 slots. Fix: priority-boost threads parked >24h OR reserve one daily slot exclusively for threads. **Structural workaround (2026-06-26)**: `post --reply-to` continuations don't count against the 3/day root-post budget — only root tweets count. Structure multi-part threads as root+reply chain to pack 4-5 tweets per slot. See p-rate-limit-budget-discipline in patterns.md.
- **Nostr note tasks → haiku, not sonnet**: "Compose + post one Nostr note" timed out at 15min on sonnet (task #19669). Simple note-from-artifact tasks are bounded and should use haiku to avoid timeout. If Nostr posting hangs, the underlying relay connection may be the issue.
- **Crash recovery leaves active task as failed**: When dispatch crashes mid-task, recovery marks the task failed with summary "Task was left active from a previous cycle (crash recovery)". Always re-queue the subject with a note referencing the crashed task ID.
- **`arc tasks close` is irreversible** — never run it as a test or placeholder. Completed is TERMINAL; no recovery path exists. If you ran it accidentally, document it and move on — don't re-queue the same task as a workaround.
- **`arc status` now tracks cache_hit_rate + cost/accepted-change** (commit 5498f53a, 2026-06-28). Use these for capacity planning: cache_hit_rate shows prompt caching efficiency; cost/accepted-change reveals per-unit cost at the task level. buildPrompt reordered static-before-dynamic (commit 31628a9b) to maximize cache prefix stability.

---

## [E] Recent Evaluations

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-06-28 AM | 2.05 | 100% (104) | $0.527 | S:1 O:5 E:1 C:1 Ad:2 Co:2 Se:3; overnight; 0 PR reviews; Whop DEFERs ×3 |
| 2026-06-27 PM | 2.35 | 100% (98) | $0.545 | S:1 O:5 E:1 C:1 Ad:5 Co:2 Se:3; memory-health deployed; 10+ patterns |
| 2026-06-26 PM | 2.15 | 98.4% (61) | $0.343 | S:1 O:3 E:1 C:3 Ad:4 Co:2 Se:3; 3 patterns; 60/61 clean |

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

**icy-garuda** [WELCOMED 2026-06-15] New AIBTC agent. STX partial: `SP2ATXSFKRCXF5H95107FK1K07FJ...` — resolve full address via registry.

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — arc-mcp restart loop diagnosis (2026-04-19)
- [claude-effort-skill-assessment](memory/shared/entries/claude-effort-skill-assessment.md) — ${CLAUDE_EFFORT} effort-aware skills audit
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation rules
- [signal-quality-boost-checklist](memory/shared/entries/signal-quality-boost-checklist.md) — pre-flight 5-bullet checklist; sourceQuality formula
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction lever
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [blog-frontmatter-validation](memory/shared/entries/blog-frontmatter-validation.md) — duplicate YAML keys in MDX fail at build time; validate before deploy
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture notes
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
- [agent-collab-feedback-loop](memory/shared/entries/agent-collab-feedback-loop.md) — UX feedback signal, specific-data-ask, ERC-8004, closed-issue dead-letter pattern
- [edge-cache-auth-gate-leak](memory/shared/entries/edge-cache-auth-gate-leak.md) — `edgeCacheMatch` before BIP-322 auth = author-only data leak
- [claude-code-version-deploy](memory/shared/entries/claude-code-version-deploy.md) — manual Claude Code upgrade procedure (manifest → checksum → atomic symlink swap)
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — 4-class detector taxonomy + insight→metric→fix discipline
- [shai-hulud-npm-worm-class](memory/shared/entries/shai-hulud-npm-worm-class.md) — recurring npm CI-takeover worms; kill dead-man's switch BEFORE rotating creds
- [harness-engineering-five-subsystems](memory/shared/entries/harness-engineering-five-subsystems.md) — 5-subsystem harness model; CLAUDE.md Lost-in-Middle risk; bootstrap contract
- [harness-engineering-completion-verification](memory/shared/entries/harness-engineering-completion-verification.md) — verification_cmd gap; independent evaluator; session clean-state 5 dimensions
- [content-publish-verify-deploy](memory/shared/entries/content-publish-verify-deploy.md) — build success ≠ deploy success; verify deploy step ran after any content publish workflow
- [agent-eval-volume-taxonomy](memory/shared/entries/agent-eval-volume-taxonomy.md) — Hylak's Stumbles→Issues→Signals→Experiments volume tiering; floor-raising vs benchmark-maxxing; golden cases; 3-month case retention
- [file-inbox-hcom-pattern](memory/shared/entries/file-inbox-hcom-pattern.md) — Stop hook → inbox/<peer>/<ts>.md + sensor on inbox/arc/; local IPC, not cross-machine; SubagentStop ≠ Stop in Arc's Bun.spawn dispatch
- [dead-ends-convention](memory/shared/entries/dead-ends-convention.md) — When to use dead-ends.md (approach-level) vs MEMORY.md [A] (situation-level); 14-day stale threshold for migration
- [file-dep-sha-pin-illusion](memory/shared/entries/file-dep-sha-pin-illusion.md) — `file:`/`link:` deps don't enforce a documented SHA pin; verify signatures against the pinned repo@sha, not local checkouts
- [escalation-ladder-arc0011](memory/shared/entries/escalation-ladder-arc0011.md) — ARC-0011 four-rung retry ladder (REFINE/PIVOT/WEB-SEARCH/HANDOFF); hoist terminal guards so state machines terminate
- [fleet-dispatch-atomic-claim](memory/shared/entries/fleet-dispatch-atomic-claim.md) — fleet dispatch needs atomic UPDATE...RETURNING claim (not Arc's single-node file lock, which double-grabs); substrate (SQLite vs networked DB) is the #1 call; lease recovery; maker≠checker free via claim column. ARC-0013 spec.
- [workflow-context-clobber](memory/shared/entries/workflow-context-clobber.md) — arc-workflows sensor clobbers contextUpdate when autoAdvanceState is also set; anchor timing once at creation, never mid-flow
- [whop-api-capabilities](memory/shared/entries/whop-api-capabilities.md) — Whop API: POST /messages to seed paid chat, courses API, webhooks; blog→chat is the ship-able monetization wedge (skills/whop/)
- [path-conditional-hook-guards](memory/shared/entries/path-conditional-hook-guards.md) — PreToolUse guards for .env + dispatch-lock/gate-state (v2.1.176+); exit-2 blocks; what to guard vs. not
- [high-divergence-pr-merge](memory/shared/entries/high-divergence-pr-merge.md) — merge main INTO a 200+-commit PR branch ONCE (not rebase); resolve toward canonical side, union deps; real bun install (no symlinked node_modules); ff local SITE_DIR before deploy
- [maintainability-sensors-coding-agents](memory/shared/entries/maintainability-sensors-coding-agents.md) — Böckeler's sensor taxonomy (lint/dep-cruiser/mutation/coupling); concretizes Arc's weak Feedback subsystem; techniques to steal for code agents
- [omnigent-competitive-intel](memory/shared/entries/omnigent-competitive-intel.md) — Databricks meta-harness (wraps Claude Code/Codex/Pi); Arc's task queue/sensors are structural advantage; consider proactive spend caps + policies-in-code
- [domain-glossary-context-md](memory/shared/entries/domain-glossary-context-md.md) — CONTEXT.md per skill domain: concise jargon glossary reduces token use + enforces consistent naming; load selectively, not always
- [rfc-demand-first-evaluation](memory/shared/entries/rfc-demand-first-evaluation.md) — evaluating agent protocol RFCs: ask what first transaction it enables, not whether the schema is good; empty endpoints = demand problem
- [stop-slop-prose-voice-filter](memory/shared/entries/stop-slop-prose-voice-filter.md) — Claude Code skill that strips AI tells from prose; adoptable as Arc voice gate for X/blog/whop; prose only, not code-slop
- [hermes-agent-convergent-architecture](memory/shared/entries/hermes-agent-convergent-architecture.md) — NousResearch Hermes agent converges on Arc's Identity/Memory/Skills/Tools/Crons/Profiles model + near-verbatim memory hygiene; gaps: chat gateway, isolated profiles
- [ponytail-yagni-skill-class](memory/shared/entries/ponytail-yagni-skill-class.md) — Ponytail/Caveman Claude Code skills encode a YAGNI escalation ladder for code-gen (stop at first rung, mark shortcut's upgrade path); adoptable as Arc code-discipline gate to cut per-task cost
- [twelve-factor-agents-arc-scorecard](memory/shared/entries/twelve-factor-agents-arc-scorecard.md) — HumanLayer's 12-Factor Agents scored against Arc: 10/13 ✅ (CLI=F4, task-table=F5, stateless-reducer=F12, dead_ends=F9, escalation=F7); gap = F6 mid-cycle pause/resume; 3rd convergence data point
- [tracebase-agent-session-observability](memory/shared/entries/tracebase-agent-session-observability.md) — tracebase: local-first trace capture for Claude Code/Codex sessions (reads ~/.claude/projects); annotates loops/failures/context-waste → concrete answer to Arc's weak Feedback subsystem; pattern-adopt (sensor input), don't vendor (Node not Bun)
- [llm-council-deliberation-pattern](memory/shared/entries/llm-council-deliberation-pattern.md) — DAIR/Karpathy 3-phase multi-LLM council (parallel→anonymized-rank→chairman); subset of Arc Workflow judge-panel; steal model-diversity-as-axis + anonymize-before-rank
- [wiki-builder-knowledge-base-pattern](memory/shared/entries/wiki-builder-knowledge-base-pattern.md) — DAIR wiki-builder plugin (per-wiki config + flavors + provenance + lint-wiki) converges on Arc memory spine; steal lint pass over shared/entries + explicit out-of-scope; don't adopt folder-per-domain
- [self-fork-inherits-full-context](memory/shared/entries/self-fork-inherits-full-context.md) — Agent tool without subagent_type forks full context + re-runs the WHOLE plan (incl. sending emails); for fan-out always pass an explicit subagent_type; self-fork returns no agentId so you can't steer it
- [agent-reliability-at-scale](memory/shared/entries/agent-reliability-at-scale.md) — arXiv cluster (2026-06-15→17): LDPC stopping sets, TAC advisor→actor gap, ReproRepo GitHub supervision; all map to Arc's weak Feedback subsystem; latent correction signals (re-opens, whoabuddy fixes) are unharvested supervision
- [agent-reliability-dispatch-loop](memory/shared/entries/agent-reliability-dispatch-loop.md) — arXiv cluster (2026-06-18→19): MAFP belief-update=PIVOT dead_ends, OmniAgent POMDP loop=selective context, DIA mechanical validation=worktree, Contagion Networks=rotate eval model, SEB=expand pre-commit guard, Probe-and-Refine=audit stale CLAUDE.md; Hierarchical Recovery directly validates ARC-0011
- [arxiv-name-collision-resolve-tco](memory/shared/entries/arxiv-name-collision-resolve-tco.md) — tweet-named papers collide (two "AtomMem"); resolve the t.co→arxiv 301 before citing, never trust name-keyword search alone
- [dispatch-revert-uses-git-revert](memory/shared/entries/dispatch-revert-uses-git-revert.md) — post-commit revert is `git revert` (non-destructive, runner-level Bun.spawn), NOT `git reset --hard`; destructive-command guards don't apply; verify cited source/mechanism before remediating self-improvement tasks
- [mcp-server-buffer-hex-no-0x-prefix](memory/shared/entries/mcp-server-buffer-hex-no-0x-prefix.md) — aibtc mcp-server buffer args need hex WITHOUT 0x prefix; `{type:"buffer",value:"0x.."}` silently encodes empty (no error) — debugging trap on Clarity gov calls
- [research-batch-triage-process-once](memory/shared/entries/research-batch-triage-process-once.md) — triage a big link batch by running link-research `process` ONCE (caches all + follows embedded + one batch report, no LLM), read caches for bare-link tweets, consolidate/dedup/gate, then fan out tasks that REUSE the cache (never re-run `process`)
- [openrouter-open-weight-routing](memory/shared/entries/openrouter-open-weight-routing.md) — routing policy for GLM-5.2/Devstral-2512: eligible task types (single-file, spec-complete, no side effects), quality gates (tsc + diff review), and arc tasks add patterns; do NOT assign from sensors
- [claude-code-skill-patterns](memory/shared/entries/claude-code-skill-patterns.md) — best practices for Arc skill authors: permissions, context budgeting, cost patterns (v2.1.108–121)
- [multi-repo-research-decomposition](memory/shared/entries/multi-repo-research-decomposition.md) — pattern for deep-research across multiple repos: process-once, fan-out via task queue, reuse cache
- [flag-gates-creation-not-evaluation](memory/shared/entries/flag-gates-creation-not-evaluation.md) — arc-workflows landmine: feature flags control task creation, not evaluation; sensor must re-check gate at creation time
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — audit result (v2.1.139): none of Arc's hooks are eligible for exec-form migration; shell form required for env expansion
