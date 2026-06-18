# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-06-16T13:10:00Z*
*Token estimate: ~5t*

---

## [A] Active Items

**daily-eval** [ROLLING, last 2026-06-18 task #19270] Weighted 2.20/5 — S:1 O:5 E:1 C:2 Ad:2 Co:2 Se:3. $28.82/day = $0.40/task. 72 tasks, 100% success. Midnight eval — ops perfect, S locked, only 1 PR review (low ecosystem), no new content/posts, double-post gap still open. Overwrite this line next eval — do not accumulate.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused. EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**x402-signal-payment** [LIVE 2026-05-04] `POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**zest-audit-bounty** [CLOSED 2026-06-16, task #18169] Static analysis of `pool-borrow-v2-3` submitted to bounty mpwj1rjde88d5b53b990 (5k sats). Submission ID: mpxf5rek026008332af2. Bounty window closed — monitoring for result. **Bounty API**: `POST /api/bounties/{id}/submit` with BIP-137 via `arc skills run --name bitcoin-wallet -- btc-sign`.

**whop-wedge** [P22 CAPSTONE SHIPPED 2026-06-15] P17–P22 all shipped: affiliate/referral (P17), paid-room CTA (P18), events ledger (P19), new-member welcome (P20), events as synthesis input (P21), revenue in CEO review (P22 capstone). Phase 2 synthesis dry-run deferred 4 consecutive checks (48h+ of 0 messages in channel); **[FLAG] channel may need manual seed post by whoabuddy** before synthesis can add value — check channel visibility/accessibility for members. **RECENT_ARC_POSTS bug fixed (#19052)**: sensor was missing Arc's own API-posted messages; now scans `windowMessages` for `ARC_USER_ID` directly. **Creds**: `whop` service — `company_api_key` + `app_api_key` + `company_id` `biz_zQbfh5SnRnAF5Y`. **API**: send message = `POST /api/v1/messages` `{channel_id,content}` (v1 NOT v5); chat feeds `GET /api/v1/chat_channels?company_id=`. Channel `exp_I2Wew0PqJQ50a8` ("AI Prefers Bitcoin"); chat feed `chat_feed_1CbxMbfsj2yvpGqNnMcuCg`. Post-chat uses `app_api_key`; mgmt uses `company_api_key`. Funnel: paid `prod_TJknsIOzPDlQS` + free `prod_4liMVXKGP4E4L`. **Phase 2 → live gates**: ≥1 dry-run POST passes voice review + reactive soaks overnight clean + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`. NEVER auto-post to paying room without sign-off. Phase 3 gate flipped 2026-06-12T22:51Z: `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=true`. **Strategy**: laser focus on $50/mo subscription value before sprawl; council in `genesis-works/agent-coordination` (gh-accessible). Patterns Library: Whop API has NO write path for experience doc body → serve `arc0me-site/src/data/patterns-library.json`.

**x-cadence** [ACTIVE 2026-06-12, task #18633] X posting cadence on AI-prefers-Bitcoin theme. 4 beats: hot-topic, agent-philosophy, agent-journey, research-highlight (12h cadence, `X_CADENCE_ENABLED=true`). Credits restored 2026-06-12. First 3 posts fired overnight. Cadence auto-resumes when credits return or `db/x-credits-depleted.json` 30d TTL expires. **BlogToXMachine SHIPPED (#18654)**: `blog_published → x_pending → completed`; arc-workflows sensor `syncBlogPublishes()` deduped by instance-key, pausable `WORKFLOWS_BLOG_TO_X_ENABLED=false`. Full `PublishFanoutMachine` GATED until whop #18600 lands a first clean post. **[FLAG] DOUBLE-POST GAP (2026-06-17)**: "Five Subsystems" blog posted to X twice ($0.35 wasted). BlogToXMachine dedup key is blog post ID but something allowed two workflow instances through. Audit `db/x_post_log` for duplicate instance-keys before content-calendar-tier-A goes live — MUST fix before enabling. [GOTCHA: `arc tasks add` echoes `--source` value — never grep output for new ID; read the "Created task #N" line.]

**content-calendar-tier-A** [DORMANT 2026-06-12, task #18674] 17 `ContentCalendarMachine` instances (ids 2982–2998) staggered 1/day from 2026-06-13 @ placeholder 15:00Z anchor. UN-GATE CHECKLIST in `memory/content-calendar-tier-a.md`; needs `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whop clean-post + human sign-off. Tier B/C after Tier A clears clean.

**Dead-ends** (no autonomous Arc action — see dead-ends.md):
- **amber-otter** — credential exposure 2026-05-18. Awaiting key rotation by owner.
- **payout-disputes** — 11 disputes 30+d stale since 2026-04-26. Requires whoabuddy direct outreach.
- **wallet-rotation** — awaiting whoabuddy policy decision since 2026-04-24.
- **loom-spiral** — workflow 23 token spiral. No runs until whoabuddy resolves root cause.
- **pr-511** — aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. Awaiting author.

→ See dead-ends.md for approach detail. Migration rule: [[dead-ends-convention]]

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19 per whoabuddy policy. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Check cooldown at SENSOR TIME, not dispatch. `file-signal` requires `--tags` or 400 error.
**Cooldown at dispatch**: (1) close as `failed`, (2) new task with `--scheduled-for <clear+5min>`.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.
**Skill names**: `arxiv-research` (quantum/bitcoin-dev), `aibtc-news-editorial` (signal filing). "quantum" and "arc-signal-manager" are INVALID.

---

## [P] Critical Patterns
→ Full 27 validated patterns: `memory/patterns.md`. Key operational rules (headlines only):

**Dispatch/queue**
- Completed task is TERMINAL — resurrection is always a bug. `requeueTask` guards `WHERE status != 'completed'` (db.ts). Never set completed→pending.
- Side-effecting tasks (email/STX/x402): check idempotency FIRST. Before sending, verify sent folder for matching subject. Re-dispatch + non-idempotent = duplicate sends.
- Dispatch-stale alerts: always FP — verify PID + recent cycle_log timestamps.
- Blocked external-dependency: if 3+ consecutive block-reviews confirm same external block, apply 48h+ cooldown before next review.
- Haiku dispatch timeout is ~5min. Signal-filing tasks must be sonnet; any multi-step task with unknown completion time should also be sonnet. Haiku = simple, fast, bounded operations only.

**PR reviews**
- Pre-flight: `gh pr view --json state` — if MERGED/CLOSED, close task as completed.
- Re-verify author fix-claims: fetch ACTUAL file at head SHA (`gh api repos/O/R/contents/PATH?ref=<sha> --jq .content | base64 -d`), NOT cached diff.
- bff-skills PRs: pre-flight mandatory (gregoryford963-sys generates stale-PR noise). Sensor-level dedup needed.
- Bounty-farming flood (3+ identical rejections): escalate to whoabuddy, don't loop.

**Sensors**
- Signal cooldown: check at SENSOR time. Staleness: fetch live timestamps, not cached values.
- Zero-fix churn: sensor producing 0-fix tasks consistently → add 4h recency guard.
- CVE same repo: group identical CVEs, assess once, apply ruling uniformly.
- `recent.log` consolidation: threshold 500 lines; long-term fix = age-based archiving (>14d).

**Cloudflare**
- DO row reads dominate free tier (5M/day), NOT invocations. Diagnose via `durableObjectsStorageGroups.rowsRead`. CF DO SQLite and D1 share the same 5M/day tier — migration alone doesn't fix quota burns.
- 1min-cadence sensors against SQLite-backed DOs must use cursors or they'll saturate row-read tier.

**Whop synthesis**
- RECENT_ARC_POSTS detection: scan `windowMessages` for `ARC_USER_ID` (not just recent activity). Arc's API-posted messages were previously invisible to its own sensor.
- Synthesis inflow/outflow ratio: when consumed > produced (7 in → 4 out), hold synthesis cadence — don't push more inputs until the backlog clears.

**Link research**
- X-thread t.co links resolve back to tweet body, not the underlying article (`embeddedUrls: []`, `preview_text` = tweet text only). When content is a bare t.co shortlink with no embedded URLs, mark as low-value and skip deeper fetch. For repo-based research use `gh api repos/O/R/contents/PATH` directly — bypasses JS gates (wiki-builder pattern).
- Research-night cost variance: 14+ opus link-research tasks in one night runs ~$0.59/task vs $0.40 target. Expected — don't flag as anomaly in daily-eval.

**arXiv clusters**
- Agent-reliability at scale: 3 consecutive distills (2026-06-15→17) surfaced multi-agent coordination failure papers — TAC benchmark (2606.18142, advisor→actor gap), LDPC reliability model (2606.18121), ReproRepo GitHub-issues supervision (2606.18237). All map to Arc's weak Feedback subsystem. When a research sprint slot opens, synthesize into `memory/shared/entries/`.

**Misc**
- X API HTTP 402 = CreditsDepleted (NOT rate limit). Park as `blocked`, escalate to whoabuddy for credit top-up. Won't auto-recover.
- arc0.me freshness: ~4-7 day cadence while filing paused. Proactive blog scheduling every 3-5d prevents reactive patches.
- AIBTC deck titles MUST lead with "AIBTC". Stats: never from memory, always re-query.
- build-without-deploy: build success ≠ deploy success. Verify deploy step ran. After deploying blog post, verify it appears in repo, not just that deploy command ran.
- `tasks update --status blocked` NOT supported — only `tasks close --status blocked`.
- x402 404 = agent deregistered — do NOT retry. Per-file reads in dispatch = token explosion (>10 files → add CLI first).
- Version-gated Claude Code changes: run `claude --version` pre-flight before applying changes that require a minimum version (e.g. claude-fable-5 requires v2.1.170+). If version insufficient, upgrade first via [[claude-code-version-deploy]] then re-queue. Don't let the task fail at the safety gate — check preconditions upfront.

---

## [E] Recent Evaluations

**Trend (2026-06-01 → 2026-06-15)**: PURPOSE range 1.95–3.05. Signal Quality (S) locked at 1 (filing paused). Cost target: <$0.40/task. Success rate: 96–100%.

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-06-16 | 2.65 | 100% (87/87) | $0.461 | S:1 O:5 E:2 C:2 Ad:4 Co:3 Se:3; full-day — 4 PR reviews + 1btc-news quantum bounty role, strong content + external-research adoption; cost over target from research sprint (supersedes AM 2.35 snapshot) |
| 2026-06-15 | 1.95 | 96.1% (174/181) | $0.449 | S:1 O:4 E:1 C:1 Ad:3 Co:2 Se:3; midnight eval — early day, low ecosystem impact, cost over target |
| 2026-06-14 | 2.65 | ~100% (164 today) | $0.47 | S:1 O:4 E:3 C:2 Ad:4 Co:3 Se:3; research sprint lifted cost; ops/adaptation strong (full-day, supersedes AM 2.20 snapshot) |
| 2026-06-13 | 2.15 | 98.5% (132/134) | $0.56 | PR #8 merge + whop Phase 1 live; cost spike from complex merge |
| 2026-06-09 | 2.70 | 98.7% (75/76) | $0.471 | OR research + sensor work; 0 human tasks |
| 2026-06-08 | 2.60 | — | — | Research+skill-fix day; 1 opus cost burst |
| 2026-06-05 | 3.05 | 98.4% (60/61) | $0.292 | 5 PR reviews; bff-skills dedup fix queued |
| 2026-06-04 | 2.65 | 100% (67/67) | $0.346 | stale-diff FN + exclusion patterns captured |
| 2026-06-03 | 2.50 | 100% (59/59) | $0.326 | 1btc-news bounty closed; arc-worktrees lstatSync fix |
| 2026-06-01 | 2.60 | 100% (41/41) | $0.259 | CF quota fix holding (70/hr) |

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor. Hashrate signal: always decompose (1) research+compose, (2) file.

**signal-pipeline** [validated 2026-04-13] JingSwap → P2P fallback. Known gap: pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08]
All STX send paths through `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`.

**approved-pr-guard** [SHIPPED, task #11183]
Use `gh pr view NUMBER --repo OWNER/REPO --json reviews` — NOT `gh pr reviews` (silent exit 1 bug).

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Reputation: elevated. Two confirmed infra tips. Last: 2026-06-03 (v1.57.0 deprecation PSA + Zest bounty lead).

**vivid-manticore** [CONTACT 2026-04-20] EmblemAI. 191 x402 tools via sBTC at `api.emblemvault.ai`. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`.

**deep-tess** [PENDING METRICS] Bitcoin maxi AI. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. ~6-week response cadence.

**fractal-swift** [AWAITING RESPONSE] Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`.

**crystal-engine** [AWAITING RESPONSE] Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`.

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2 agent. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Credentials exposed — must rotate before trusting.

**frosty-narwhal** [CONTACT 2026-06-14] AIBTC display name for Iskander (BNS: `iskander-ai.btc`, agent #124). STX: `SP3JR7JXFT7ZM9JKSQPBQG1HPT0D365MA5TN0P12E`. Sent agent-registry RFC (ERC-8004+A2A+MCP) — demand problem, not schema problem (empty `/api/capabilities` 3 months). Replied + ERC-8004 value-1 feedback submitted on-chain (non-sponsored). **Identity note:** AIBTC platform display name ≠ agent's BNS/self-name — always resolve via contacts before treating as spoofing.

**icy-garuda** [WELCOMED 2026-06-15, task #19032] New AIBTC agent. STX: partial in brief (`SP2ATXSFKRCXF5H95107FK1K07FJ...`) — resolve full address via AIBTC agent registry before engaging.

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
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — v2.1.139 exec form evaluation; Arc hooks require shell features
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
