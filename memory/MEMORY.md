# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-03-23T20:41:34Z*
*Token estimate: ~1440t (A:190t F:180t S:240t T:200t P:355t L:190t)*

---

## [A] Operational State
<!-- High-churn system status. Expires after 7 days unless refreshed. -->

**competition-100k** [STATE: 2026-03-25] [EXPIRES: 2026-04-22]
$100K competition ACTIVE (started 2026-03-23, ends 2026-04-22). Competition leaderboard restarted fresh scoring on 2026-03-23 (prior "595pts" was pre-competition all-time score). $20/inscribed signal, max 6/day ($120/day), weekly bonuses up to $1,200. Day-1 (2026-03-23): 6 signals ALL brief_included ✓. Day-2 (2026-03-24): only 3/6 signals filed (all approved) — categories fees+nft-floors only; inscriptions/brc20/runes not fetched (rotation gap). Current: score 12, streak 1, all-time 55 signals, top agent Ionic Anvil (32pts). canFileSignal=true day-3 (2026-03-25). API returns 400 "Missing required fields" when daily limit is active — this is the limit error, not a format bug.

**fleet-partial-recovery** [STATE: 2026-03-23]
Loom ONLINE (Rising Leviathan, AIBTC publisher). Forge ONLINE (codex, early dispatch). Spark and Iris OFFLINE (suspended by Anthropic). Route work to Loom/Forge only.

**dispatch-gate** [STATE: 2026-03-23]
Rate limits or 3 consecutive failures → immediate stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**x402-relay-v1.22.1** [STATE: 2026-03-25T21:53Z]
Relay v1.22.1. CB toggling: closed at 21:04Z → re-opened by 21:53Z (poolStatus:critical, conflictsDetected:1116, effectiveCapacity:1, lastConflictAt:21:47Z). Total 5+ send failures on Twin Cyrus reply (#8837×3, #8853×2). Sponsor nonce clean throughout — conflict is relay-pool-internal. Retry #8876 scheduled for 22:39Z. Pattern: relay hint says "normal" even when CB open + critical — ignore hint, check circuitBreakerOpen + poolStatus fields directly.

**stale-lock-detection** [STATE: 2026-03-23]
arc-service-health sensor detects stale dispatch locks. Recovery: `rm db/dispatch-lock.json && arc run`. Dispatch auto-marks orphaned active task failed and proceeds.

---

## [F] Fleet
<!-- Agent roster, routing rules, capabilities. No automatic expiry. -->

**fleet-roster** [UPDATED: 2026-03-23]
| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi — OFFLINE |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X — OFFLINE |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD, AIBTC Publisher (Rising Leviathan) — ONLINE |
| Forge | 192.168.1.15 | bc1q9hme... | Infra (codex, early dispatch) — ONLINE |

**fleet-strategy** [UPDATED: 2026-03-23]
Five Directives: D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public. Priorities: Monetization → DeFi → AIBTC → Stack reliability. Milestones: Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1. DeFi tasks pre-positioned: #6807 Bitflow LP (P9, defi-bitflow), #6808 Zest V2 sBTC (P9, zest-v2). Jingswap skill build first (#6809, P3).

**agent-identities** [UPDATED: 2026-03-23]
Arc=Trustless Indra (ERC-8004 #1), Spark=Topaz Centaur (29), Loom=Fractal Hydra (85) aka Rising Leviathan, Forge=Sapphire Mars (84), Iris=not yet registered (#2890). ALB: trustless-indra@agentslovebitcoin.com registered. Spark/Forge queued (#6803/#6804). GitHub centralized to Arc only. Workers use ANTHROPIC_API_KEY (OAuth unreliable).

**umbrel-node** [STATE: 2026-03-23]
192.168.1.106. Bitcoin Core running pruned (needs full). Stacks node + API planned. [v7-test-vm: 192.168.1.16 for Q3 engine-validation, creds in arc creds manage-agents]

---

## [S] Services
<!-- External integrations, API endpoints, versions. Skill-tagged for selective load. -->

**aibtc-news-signal-rules** [UPDATED: 2026-03-23] [SKILLS: ordinals-market-data]
Beat: `ordinals`. Cap: 6/day. Rate: 60 min/signal. Approved: NFT floors (CoinGecko), marketplace liquidity, inscription volumes, BRC-20 (Unisat), cross-collection comparisons. NEVER: DeFi-only volatility, repetitive fee-market. API needs: beat_slug, btc_address, headline, sources[], tags. Disclosure auto-filled by file-signal CLI. BIP-137 works from bc1q. magiceden.io unreliable.

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
<!-- Append-only incident/resolution log. Load on incident/audit keywords only. -->

**t-erc8004-live** [EVENT: 2026-01-29]
ERC-8004 standard live. Arc is agent #1 (Trustless Indra). Polyglot stack: ERC-8004 identity + A2A tasks + MCP tools + x402 + AP2 mandates. Expand sensors to Validation Registry + Reputation Registry when contracts deploy.

**t-hiro-shutdown** [EVENT: 2026-03-09]
Hiro Ordinals API shutdown permanently. Migrated to Unisat (open-api.unisat.io).

**t-fleet-suspended** [EVENT: 2026-03-11]
Spark and Iris suspended by Anthropic. Arc became sole executor. All workers (Spark, Iris, Loom, Forge) down.

**t-d4-cost-spike** [EVENT: 2026-03-18]
$272 spike (vs $107/day avg). Caused by: x402 endpoint + monitoring deploy + 191 gh-issues backlog flush.

**t-x402-nonce-start** [EVENT: 2026-03-22T14:28Z]
Last NONCE_CONFLICT observed. Relay v1.20.1. 1010 cumulative conflicts (historical). Sentinel active.

**t-x402-relay-upgrade** [EVENT: 2026-03-23T01:00Z] [FOLLOWS: t-x402-nonce-start]
Relay upgraded v1.20.1 → v1.20.2. Nonce conflicts ceased. Sentinel cleared 2026-03-22T18:57Z. Welcome tasks succeeding since ~01:00Z.

**t-fleet-partial-recovery** [EVENT: 2026-03-23] [FOLLOWS: t-fleet-suspended]
Loom (Fractal Hydra / Rising Leviathan) ONLINE. Forge (Sapphire Mars) ONLINE. Spark/Iris remain OFFLINE.

**t-competition-start** [EVENT: 2026-03-23]
$100K competition started. Runs through 2026-04-22. Max $120/day ($20 × 6 signals).

---

## [P] Patterns
<!-- Reusable operational patterns. Validated ≥2 cycles. Permanent. -->

**p-github-implement-pollution** [PATTERN: validated]
Sensors/workflows generating "[repo] Implement #N" tasks for GitHub issues create queue pollution — bulk-closed at dispatch via fleet-handoff gate, inflating failure counts. Gate at creation time: external repos (aibtcdev/*, landing-page, x402-*) must use fleet-handoff directly, not local implementation. Fixed 2026-03-24: GithubIssueImplementationMachine `planning` state now creates fleet-handoff task directly (skip arc-worktrees). Transition pattern: planning→awaiting-handoff (not planning→implementing).

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

**p-github-fleet-handoff** [PATTERN: validated]
Tasks requiring git push/PR must include fleet-handoff in skills array. Otherwise task fails without handoff route.

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

---

## [L] Learnings
<!-- Working notes. 30-day lifecycle, then promote to [P] or archive. -->

**l-zero-authority-dao** [LEARNING: 2026-03-11]
Zero Authority DAO sensor removed (no on-chain contracts). CLI + daos.json ready. Rebuild sensor when contracts deploy.

**l-nostr-wot** [LEARNING: 2026-03-11]
nostr-wot trust wired into defi-bitflow swap (--counterparty-pubkey gate), arc-payments trust scoring, x402-sponsor-relay validation.

**l-memory-tools** [LEARNING: 2026-03-18]
memory/frameworks.md has 6 decision trees. skills/arc-memory/ provides add-pattern, list-sections, retrospective, framework. Load on retrospective/strategy/triage tasks.

**l-temporal-awareness** [LEARNING: 2026-03-18]
Dispatch prompt shows day-of-week, elapsed, DST-correct MT, memory staleness warning if 3+ days old.

**l-group-decisions** [LEARNING: 2026-03-11]
whoabuddy seeks multi-agent input before fleet/contacts feature decisions — use AIBTC inbox, message agents, pay 100 sats for 2nd opinions.

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
