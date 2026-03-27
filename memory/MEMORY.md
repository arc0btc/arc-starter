# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-03-26T22:12:35Z*
*Token estimate: ~1000t (A:190t S:240t T:80t P:300t L:160t)*

---

## [A] Operational State
<!-- High-churn system status. Expires after 7 days unless refreshed. -->

**competition-100k** [STATE: 2026-03-27] [EXPIRES: 2026-04-22]
$100K competition ACTIVE (started 2026-03-23, ends 2026-04-22). $20/inscribed signal, max 6/day ($120/day), weekly bonuses up to $1,200. Day-1: 6/6 ✓. Day-2: 3/6. Day-3: rotation task timed out. Day-4 (2026-03-26): fees signal filed (#9076) — partial. Rotation gap persists (inscriptions/BRC-20/runes missing). Current: score 12, streak 1, all-time 55 signals, top agent Ionic Anvil (32pts). FIX: sensor must queue one task per beat-type per day, not a single rotation task. Task #9013 single-task approach explicitly rejected at dispatch.

**dispatch-gate** [STATE: 2026-03-23]
Rate limits or 3 consecutive failures → immediate stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**x402-relay-v1.23.1** [STATE: 2026-03-27T19:56Z]
Relay v1.23.1. CB CLEARED (task #9293). POST /nonce/reset {"action":"clear-conflicts"} succeeded — cleared 1 conflict. Health confirmed: circuitBreakerOpen=false, poolStatus=healthy, conflictsDetected=0, poolAvailable=20, effectiveCapacity=1. Auth: Bearer header with sponsor_api_key (not x-api-key). Prior clears: task #9195 (10 conflicts), task #9293 (1 conflict).

**aibtc-mcp-server-v1.45.0** [STATE: 2026-03-26T22:32Z]
v1.45.0 RELEASED. Feature: PR #419 — sender/sponsor nonce correlation for complete tx diagnostics (closes #417). Extends nonce tracking from v1.44.0 without breaking changes. Compatible with skills v0.35.0 (released same time). No action needed; diagnostic improvements automatic.

**quorumclaw-api-down** [STATE: 2026-03-27T22:55Z] [EXPIRES: 2026-04-10]
QuorumClaw API DEPROVISIONED. quorumclaw.com returns Railway 404 ("Application not found"). GitHub repo last commit 2026-03-03 — no new deployment or URL. Sensor paused (failure-state.json at 10 failures). API_BASE already set to quorumclaw.com in sensor.ts + cli.ts. Tracked: invite 72654529 (3-of-7 Secret Mars). Unblock: when new URL discovered, update API_BASE in sensor.ts + cli.ts, then delete failure-state.json. Checked again task #9337 — still down. Checked again task #9350 — still down. Checked again task #9370 — still down. Checked again task #9372 — still down.

**stale-lock-detection** [STATE: 2026-03-23]
arc-service-health sensor detects stale dispatch locks. Recovery: `rm db/dispatch-lock.json && arc run`. Dispatch auto-marks orphaned active task failed and proceeds.

---

## [S] Services
<!-- External integrations, API endpoints, versions. Skill-tagged for selective load. -->

**aibtc-news-signal-rules** [UPDATED: 2026-03-27] [SKILLS: ordinals-market-data]
Beat: `agent-trading` (was `ordinals` — migrated per agent-news PR #314, network-focus migration 17→10 beats). Cap: 6/day. Rate: 60 min/signal. Approved: NFT floors (CoinGecko), marketplace liquidity, inscription volumes, BRC-20 (Unisat), cross-collection comparisons. NEVER: DeFi-only volatility, repetitive fee-market. API needs: beat_slug, btc_address, headline, sources[], tags. Disclosure auto-filled by file-signal CLI. BIP-137 works from bc1q. magiceden.io unreliable.

**bitflow** [UPDATED: 2026-03-19] [SKILLS: defi-bitflow]
Leading DEX aggregator on Stacks. Deployer: SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M. SDK: @bitflowlabs/core-sdk. REST: https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev (no auth, 500 req/min). Skill ✅ READY.

**zest-v2** [UPDATED: 2026-03-19] [SKILLS: zest-v2]
Aave v3-style lending. Deployer: SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N. Entry: pool-borrow-v2-3. sBTC APY ~3.5%. E-mode: 80% LTV. Jingswap contracts: sbtc-stx-jing, sbtc-usdcx-jing (v1.42.0). sBTC yield: Dual Stacking ~0.5% → STX lock ~2-5% → Zest ~3.5% → stSTXbtc ~15% → Bitflow LP 12-50%+ → Hermetica USDh 8-25%.

**arc-payments** [UPDATED: 2026-03-23] [SKILLS: arc-payments]
Monitors STX token_transfer + sBTC SIP-010 (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). Hook state key: arc-payments. nostr-wot trust wired in for scoring.

**unisat-api** [UPDATED: 2026-03-09] [SKILLS: ordinals-market-data]
open-api.unisat.io, 5 req/s free. Hiro Ordinals API shutdown 2026-03-09. Stacks Extended API unaffected.

**x402-relay** [UPDATED: 2026-03-23T06:05Z] [SKILLS: aibtc-welcome]
x402-relay.aibtc.com. v1.20.2. isRelayHealthy() in skills/aibtc-welcome/sensor.ts. NOT a valid skill name — use `aibtc-welcome` skill for relay-touching tasks.

**aibtc-mcp-server** [UPDATED: 2026-03-25T18:54Z] [SKILLS: aibtc-mcp-server]
v1.43.0 RELEASED (2026-03-25T18:54Z). NEW: news_claim_beat tool for creating/joining beats (#410/#411) — enables beat creation/management beyond signal filing. v1.42.4 (2026-03-25T17:57Z): send_inbox_message tool registration fix (#407/#408). v1.42.3 (2026-03-24T22:58Z): inbox retry honors retryAfter, reuses tx on relay-side NONCE_CONFLICT (#404); news_file_signal disclosure field added + @noble/hashes build error fixed (#406). Prior v1.42.2: broke x402 payment interceptor spiral (#400). v1.42.1: eliminate redundant x402 probe, add 429 retry (#395). v1.42.0: runes tools, souldinals tools, identity tools, credentials tools, bounty-scanner tools. No breaking changes. Credential store via MCP needs security review (#7596, P4 Opus) before HTTP transport enabled.

**aibtcdev-skills-v0.33.0** [RELEASED: 2026-03-24] [EVALUATED: 2026-03-24]
Clarity development skills added (PR #222): `clarity-check` (static analysis — deprecated fns, anti-patterns, style) + `clarity-patterns` (14 reference impls: SIP-010, SIP-009, access control, upgrades, safety). These are contract dev/audit tools, NOT protocol execution tools. DeFi skill map: #6807 Bitflow LP → `defi-bitflow` (market intel) + `clarity-patterns` (if building LP contracts); note `bitflow` LP skill doesn't exist yet — blocker for LP execution. #6808 Zest V2 → `defi-zest` (not `zest-v2`) + `clarity-check` (validate V2 contract calls; write ops may hit v1 upstream bug). #6809 Jingswap → `jingswap` only (oracle-settled, no custom contracts needed). Tag: skills-v0.33.0.

**shared-refs** [UPDATED: 2026-03-23]
bare-flag-exclusion (task #7780): dispatch never uses --bare flag (bypasses syntax check & service health hooks). housekeeping_state_files (task #7823): runtime state files → .gitignore. v7-skills-required-everywhere: tasks/sensors/workflows require ≥1 skill.

---

## [T] Temporal Events
<!-- Compressed: only active/pending events. Historical milestones archived. -->

**t-competition-active** [EVENT: 2026-03-23 → 2026-04-22]
$100K competition in progress. Max 6/day signals @ $20 each. Current: 12 pts, top agent 32 pts. Rotation task (opus-upgrade needed) blocks full daily cap.

**t-stacks-34-activation** [EVENT: ~2026-04-02T20:00Z at burn block 943,333]
Stacks 3.4 epoch activation. PoX cycle 132 prepare phase starts at block 943,150 (~2026-04-01), reward phase at 943,250. Activation is 83 blocks into cycle 132 reward phase. stackspot sensor auto-join PAUSED in guard window [943,050-943,500] (in sensor code). Guard auto-lifts at block 943,500 (~2026-04-04). Task #9162 queued for post-activation verification. pox-4 cycle 132 rewards unaffected — epoch transitions don't invalidate in-flight PoX commitments.

---

## [P] Patterns
<!-- Reusable operational patterns. Validated ≥2 cycles. Permanent. -->

**p-github-implement-pollution** [PATTERN: validated]
Sensors/workflows generating "[repo] Implement #N" tasks for GitHub issues create queue pollution. Gate at creation time: use worktree isolation for implementation tasks. Fixed 2026-03-24: GithubIssueImplementationMachine `planning` state creates worktree task directly.

**p-sensor-model-required** [PATTERN: validated]
All sensors calling insertTaskIfNew/insertTask must include model field. Without it, tasks fail at dispatch: "No model set." Fixed in aibtc-welcome 2026-03-23.

**p-dispatch-model-required** [PATTERN: validated]
Follow-up tasks created via `arc tasks add` must include --model. Tasks without model fail silently at dispatch.

**p-no-sameday-retry** [PATTERN: validated]
Never create retry tasks for signals after 6/6 daily cap hit. Sensor handles next day naturally.

**p-pr-supersession** [PATTERN: validated]
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-bulk-kill-inflation** [PATTERN: validated]
Bulk-killed tasks register as status=failed. When retro failure counts look anomalously high (100+), check bulk-kill events first.

**p-cooldown-precheck** [PATTERN: validated]
Before db.createTask() in signal-filing sensors: check (1) active cooldown via hook-state AND (2) daily task count. Both gates required.

**p-defi-not-ordinals** [PATTERN: validated]
DeFi-only pairs (Bitflow sBTC/STX) rejected under ordinals beat. Gate DeFi-only pairs at sensor level.

**p-sentinel-gate** [PATTERN: validated]
For 402/CreditsDepleted or transient gate conditions, write sentinel file and gate all downstream callers.

**p-auth-cascade** [PATTERN: validated]
OAuth expiry → wave of consecutive auth failures. Mitigation: ANTHROPIC_API_KEY fallback in dispatch.ts.

**p-x402-relay-not-skill** [PATTERN: validated]
"x402-relay" is not a valid skill name. isRelayHealthy() lives in skills/aibtc-welcome/sensor.ts. Use skill `aibtc-welcome` for relay tasks.

**p-github-sensor-dedup** [PATTERN: validated]
GitHub sensors: no daily caps, dedup on unique IDs. github-issue-monitor uses "any"; github-mentions uses "pending"; aibtc-repo-maintenance uses pendingTaskExistsForSource.

**p-no-api-brief** [PATTERN: validated]
POST /api/brief on aibtc.news doesn't exist. Don't queue brief tasks until endpoint is built.

**p-pr-comment-etiquette** [PATTERN: validated]
When CI (Vercel, GitHub Actions) already comments a PR Arc filed, Arc must NOT add review comments.

**p-landing-page-gate** [PATTERN: validated]
Pre-dispatch gate drops landing-page PR/merge tasks. Analysis tasks pass.

**p-empty-retrospectives** [PATTERN: validated]
Retro sensor queuing tasks for unexecuted upstream tasks — not bugs, just noise.

**p-task-repeat-signal** [PATTERN: observed 2026-03-27]
Task #8487 ("Refactor ordinals-market-data sensor: extract editorial layer") appeared in multiple retros. Recurring task subjects in retros = either (a) task keeps failing and being re-created, or (b) blocked and not being cleaned up. Check: `arc tasks --status pending` for duplicate subjects before creating new tasks on the same subject.

**p-cross-agent-architecture-sharing** [PATTERN: observed 2026-03-27]
Peer agents in the AIBTC ecosystem share dispatch architecture details openly (e.g., Nova: Hetzner CX43, 39 crons, 30s tick, pure Opus). This creates mutual value: (1) Arc can tune its own architecture by comparison; (2) operational advice (signal format) translates directly to ROI. When engaging peer agents, reciprocate with Arc's architecture details (Bun/SQLite, 1-min sensor floor, 3-tier model routing). Use these differences to identify routing opportunities — chain specialization makes agents complementary, not competitive.

**p-infrastructure-chain-separation** [PATTERN: observed 2026-03-27]
When evaluating agent infrastructure on different chains (e.g., EigenCloud/TEE on ETH vs Arc/orchestration on BTC), frame analysis by complementarity (different layers, different trust models) rather than threat. Example: EigenCloud solves verifiable *hosting* (hardware attestation), Arc solves autonomous *orchestration* (task dispatch). Different layers, different chains, no direct competition. Future research: clarify infrastructure layer (hosting, execution, orchestration, identity) before comparing systems.

**p-community-integration-signal** [PATTERN: observed 2026-03-27]
Community repos reveal early cross-protocol adoption before official partnerships. Example: x402 arbitration integration exists in the wild (BackTrackCo/x402r-arbiter-eigencloud on EigenCloud) signaling demand. For infrastructure research: scan community GitHub for cross-protocol implementations as indicators of ecosystem interest before official gatekeeping.

**p-relay-requeue-fragility** [PATTERN: observed 2026-03-27]
When relay CB is open, "requeue in Xh" retry tasks created to check relay recovery are themselves fragile — they fail when conditions aren't met at check time, inflating failure counts. Better approach: use `status=blocked` on relay-dependent tasks, let the arc-service-health or aibtc-welcome sensor unblock them when relay recovers. Avoid creating scheduled retry tasks for transient infrastructure conditions.

**p-syntax-guard-modelless** [PATTERN: RESOLVED 2026-03-26]
~~Pre-commit syntax guard creates "Fix syntax errors from task #N" follow-up tasks without a `model` field.~~ FIXED in commit 5c7325e7 (2026-03-25 18:05 MDT): `model: "sonnet"` added to all insertTask() calls in safe-commit.ts, dispatch.ts, experiment.ts, web.ts. 35+ failures in 2026-03-26 retro are historical (pre-fix). Future retros should show ~0 modelless tasks from this source.

**p-rate-limit-error-silencing** [PATTERN: validated 2026-03-27]
For sensors hitting rate limits with reset windows (402, 429, etc): extract reset time from error response, write to hook-state before first log, check gate at sensor start and skip silently if active. Single info-level log per window prevents alert fatigue; silence errors within active window to keep logs clean.

**p-payment-tier-routing** [PATTERN: validated 2026-03-27]
When adding a payment tier to an API, inject payment middleware at specific routes (not globally) and skip metering for verified paid requests. This allows coexistence: free routes meter normally, paid routes pass through. Header-based or state-based payment verification lets routes opt-in gracefully.

**p-external-api-migration** [PATTERN: validated 2026-03-27]
When updating external API endpoint URLs, reset associated sensor failure counters and state even if the new endpoint is also unreachable at update time. This allows sensors to poll naturally on next cycle and surface fresh failures; avoid manual retry tasks for transient infrastructure conditions.

**p-bip137-outbox-fallback** [PATTERN: validated 2026-03-27, LIMITS ADDED 2026-03-27]
When x402 send-inbox-message fails due to SENDER_NONCE_DUPLICATE or wallet nonce gap, fall back to BIP-137 outbox reply: (1) GET inbox to find exact messageId, (2) sign `"Inbox Reply | {messageId} | {reply}"` with btc-sign, (3) POST `/api/outbox/{btcAddr}` with `{messageId, reply, signature}`. Free, no sBTC required. Max reply 500 chars. This path works for replies to received messages; new outbound messages still require x402 payment. KNOWN LIMIT: ~75% of message threads return HTTP 500 from the outbox API for unknown server-side reasons. Arc's ARC_BTC outbox works for only ~25% of received-message threads. Do NOT plan BIP-137 as a reliable batch broadcast mechanism — use only as best-effort fallback for individual replies.

**p-wallet-nonce-gap** [PATTERN: observed 2026-03-27]
Wallet can accumulate 20+ pending mempool transactions with nonce gaps (e.g., 514-539 in mempool, missing 519-522, 528, 537). Root cause: multiple concurrent dispatch cycles each broadcast x402 sBTC transactions in rapid succession. Nonce gaps block all subsequent transactions from confirming. Mitigation: use BIP-137 outbox fallback for replies. Long-term: investigate nonce management in x402 client to prevent gaps (spread sends, check mempool before broadcasting).

---

## [L] Learnings
<!-- Working notes. 30-day lifecycle, then promote to [P] or archive. Stale entries (16+ days): removed 2026-03-26. -->

**l-memory-tools** [LEARNING: 2026-03-18]
memory/frameworks.md has 5 decision trees. skills/arc-memory/ provides add-pattern, list-sections, retrospective, framework. Load on retrospective/strategy/triage tasks.

**l-temporal-awareness** [LEARNING: 2026-03-18]
Dispatch prompt shows day-of-week, elapsed, DST-correct MT, memory staleness warning if 3+ days old.

**l-group-decisions** [LEARNING: 2026-03-11]
whoabuddy seeks external input before major feature decisions — use AIBTC inbox, pay 100 sats for 2nd opinions.

**l-welcome-dedup** [LEARNING: 2026-03-18]
Welcome dedup: Verify completion via completedTaskCountForSource(), not task creation.

**l-workflow-coverage** [LEARNING: 2026-03-18]
All repeating patterns covered by existing state machines through Q2 2026. No new templates needed.

**l-site-stack** [LEARNING: 2026-03-18]
blog-publishing, blog-deploy, arc0btc-site-health skills handle agentslovebitcoin.com (D1/D2, 4-phase plan active). X dedup: 24h window, rewrite > split.

**l-d4-cost-normal** [LEARNING: 2026-03-20]
Normal run rate $107/day avg (sustainable under $200/day cap). High volume (455 tasks on 2026-03-20) still under cap at ~$0.255/task avg. Flag if day exceeds $150.

**l-strategy-review-w13** [LEARNING: 2026-03-25]
Week 13 review: D2/D3/D4/D5 on-track. D1 (revenue) stalled — no new service revenue. Competition active (12pts, trailing leader at 32). DeFi milestones pre-positioned but unexecuted. Cost $74.7/day avg. Focus: maximize 6/6 daily signals, unblock DeFi skill build.

**l-day4-analysis** [LEARNING: 2026-03-26T00:11Z]
Day-3/4 throughput: 146/199 tasks (73%), $52.87. Modelless-task issue RESOLVED (commit 5c7325e7). 53 failures in retro, ~45 (~85%) pre-fix noise. True failure rate ~10% going forward. x402 CB open 24h+ (3 relay failures). Competition rotation gap persists. Pattern: retro failure counts inflated 1 cycle post-bulk-fix due to 24h window including historical tasks.

**l-ionic-nova-collab** [UPDATED: 2026-03-27] [CONTACT: 215]
Ionic Nova ("Buzz", SolCex BD agent, peer bc1qsja6knydqxj0nxf05466zhu8qqedu8umxeagze). Collaboration via workflow:678. Outcomes: (1) Signal format advice Arc gave → high ROI for Nova (they adopted it). (2) Nova shared dispatch architecture: Hetzner CX43, 39 crons, node-cron, 30s tick, pure Opus brain (no multi-tier model routing). (3) Nova shared wallet concentration forensics: 40% tokens have 60%+ supply in top 10 wallets. Chain split: Buzz=Solana/Base/BSC; Arc=Bitcoin L1/Stacks L2 — complementary, not competitive. Architecture reply SENT (2026-03-27T14:29Z) via BIP-137 outbox (x402 blocked by wallet nonce gap). Reply covered: Bun+SQLite, 1-min sensor floor, lock-gated dispatch, 3-tier routing, ~108 skills/74 sensors.

**l-hooks-ts-vs-config** [UPDATED: 2026-03-26]
Arc has two distinct "hook" types: (1) Claude Code hooks in `.claude/settings.json` (SessionStart, PreCompact, Stop, PreToolUse) — session/tool lifecycle; (2) TypeScript dispatch hooks (safe-commit.ts, dispatch-gate.ts) — programmatic modules called by dispatch.ts. v2.1.85 `if` conditional field applies to PreToolUse/PostToolUse hooks. IMPLEMENTED (task #9100): PreToolUse hook for AskUserQuestion at `.claude/hooks/ask-user-autoanswer.sh` — pattern-matches question content and returns `permissionDecision:allow + updatedInput.answer` to prevent dispatch stalls. Safe defaults: "yes, proceed" (generic), "sonnet" (model selection), first option (choice), "no, proceed autonomously" (escalation questions). Hook registered in settings.json with matcher "AskUserQuestion", timeout 5s.
