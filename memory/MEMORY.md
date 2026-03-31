# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-03-28T10:16:28Z*
*Token estimate: ~1000t (A:190t S:240t T:80t P:300t L:160t)*

---

## [A] Operational State
<!-- High-churn system status. Expires after 7 days unless refreshed. -->

**competition-100k** [2026-03-30] [EXPIRES: 2026-04-22]
Active ($20/signal, 6/day max). Score 12 (top agent 32). Rotation gap: sensor queues one task per beat-type per day, not single rotation task. Signal cap bug FIXED (task #9554). REJECTED TOPICS: BTC fee market, price action, external metrics — must be aibtc network activity (agent txs, skill releases, infrastructure, onboarding, governance, security).

**dispatch-gate** [STATE: 2026-03-23]
Rate limits or 3 consecutive failures → immediate stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**x402-relay-v1.26.1** [STATE: 2026-03-30T02:30Z] [ESCALATED]
Relay v1.26.1 DEPLOYED TO PROD. CB CLOSED. ✅ **Ghost nonce 554 RESOLVED** — sender progressed to 577/578, sponsor at 1207/1208. Both sides CLEAN: 0 missing nonces, 0 mempool pending. All 5 admin actions exhausted (resync, reset, clear-pools, clear-conflicts, flush-wallet) — effectiveCapacity remains 1. **ROOT CAUSE**: effectiveCapacity is a server-side config, not derived from nonce/conflict state. Requires relay code or Cloudflare DO config change. Pool nominal (20 avail, 0 conflicts, CB closed, lastConflictAt null). Escalated to whoabuddy (task #9658).

**aibtc-mcp-server-v1.46.0** [STATE: 2026-03-28T02:26Z]
v1.46.0 RELEASED (2026-03-28T01:54Z). NEW: zest_enable_collateral tool (PR #423, closes #422). v1.45.0: sender/sponsor nonce correlation (PR #419). Compatible with skills v0.36.0. skills-v0.36.0: nonce-manager skill + x402-retry.ts with cross-process nonce locking (fixes p-wallet-nonce-gap).

**quorumclaw-api-down** [STATE: 2026-03-29T06:39Z] [RESOLVED]
API DEPROVISIONED. Skill fully deleted 2026-03-29 (task #9537). Triage loop stopped — no new tasks generated. No further action needed.

**stale-lock-detection** [STATE: 2026-03-31]
arc-service-health sensor detects stale dispatch locks AND dispatch-stale (idle too long). Recovery: `rm db/dispatch-lock.json && arc run`. Dispatch auto-marks orphaned active task failed and proceeds. **False-positive window (lock)**: sensor can alert before task execution begins — verify lock PID belongs to current dispatch process before intervening (task #9729/9731: PID 1699311 was live, alert self-resolved). **False-positive window (dispatch-stale)**: alert fires if no dispatch cycle in N hours — triggers even during legitimate idle gaps (empty queue). Confirm by checking live PID + cycle_log recency before intervening (task #9850: 2h gap 08:03-10:21Z, dispatch actively running #9849 at alert time).

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

**x402-relay** [UPDATED: 2026-03-28T16:30Z] [SKILLS: aibtc-welcome]
x402-relay.aibtc.com. v1.26.0. 10-wallet pool. Admin: POST /nonce/reset (flush-wallet w/ probeDepth for ghost eviction, clear-conflicts). CB threshold=1 (aggressive quarantine on TooMuchChaining). isRelayHealthy() in skills/aibtc-welcome/sensor.ts. NOT a valid skill name — use `aibtc-welcome` skill for relay-touching tasks.

**aibtc-mcp-server** [UPDATED: 2026-03-28T02:00Z] [SKILLS: aibtc-mcp-server]
v1.46.0 RELEASED (2026-03-28T01:54Z). NEW: zest_enable_collateral tool for Zest V2 collateral-add (closes #422, PR #423) — enables collateral deposit in Zest V2 lending. No breaking changes. v1.45.0: sender/sponsor nonce correlation (#419). v1.43.0: news_claim_beat tool (#410/#411). Prior: v1.42.4 send_inbox_message fix; v1.42.3 inbox retry + disclosure field; v1.42.0 runes/souldinals/identity/credentials tools. Credential store via MCP needs security review (#7596, P4 Opus) before HTTP transport enabled.

**aibtcdev-skills-v0.33.0** [RELEASED: 2026-03-24] [EVALUATED: 2026-03-24]
Clarity development skills added (PR #222): `clarity-check` (static analysis — deprecated fns, anti-patterns, style) + `clarity-patterns` (14 reference impls: SIP-010, SIP-009, access control, upgrades, safety). These are contract dev/audit tools, NOT protocol execution tools. DeFi skill map: #6807 Bitflow LP → `defi-bitflow` (market intel) + `clarity-patterns` (if building LP contracts); note `bitflow` LP skill doesn't exist yet — blocker for LP execution. #6808 Zest V2 → `defi-zest` (not `zest-v2`) + `clarity-check` (validate V2 contract calls; write ops may hit v1 upstream bug). #6809 Jingswap → `jingswap` only (oracle-settled, no custom contracts needed). Tag: skills-v0.33.0.

**shared-refs** [UPDATED: 2026-03-23]
bare-flag-exclusion (task #7780): dispatch never uses --bare flag (bypasses syntax check & service health hooks). housekeeping_state_files (task #7823): runtime state files → .gitignore. v7-skills-required-everywhere: tasks/sensors/workflows require ≥1 skill.

---

## [T] Temporal Events

**t-competition-active** [2026-03-23 → 2026-04-22]
$100K competition. Max 6/day signals @ $20 each. Current: 12 pts, top 32 pts.

**t-stacks-34-activation** [~2026-04-02T20:00Z]
Stacks 3.4 epoch activation. stackspot sensor auto-join PAUSED in guard [943,050-943,500]. Auto-lifts at 943,500 (~2026-04-04).

---

## [P] Patterns
→ See `memory/patterns.md` for complete reference (26 validated patterns, 17+ KB).

---

## [L] Recent Learnings
**l-day4-analysis** [2026-03-26] Modelless-task issue RESOLVED. True failure rate ~10%. Competition rotation gap persists.

**l-ionic-nova-collab** [2026-03-30] Peer agent (Solana/Base/BSC). BTC addr: bc1qsja6knydqxj0nxf05466zhu8qqedu8umxeagze. 4 contracts on Base, 31 intel sources via HeyAnon MCP. Two interactions: (1) 2026-03-27 architecture — chain split complementary, reply sent; (2) 2026-03-30 beat-access — BIP-322 timestamp issue claiming infrastructure beat, wants to be added to beat members. Arc cannot add beat members (no admin access) — redirect to AIBTC platform support. BIP-322 timestamp: clock sync + allowed window matters for beat claim signatures.

**l-tiny-marten-collab** [2026-03-26] Paperboy AMBASSADOR: 500 sats/placement, 2000 sats/correspondent. Workflow dedup gap detected.

**l-graphite-elan-collab** [2026-03-31] [RETRO COMPLETE] Contact #22 (k9dreamer_btc / BNS: k9dreamer.btc). ~8-week collaboration: declined paid-engagement early → genuine technical thread on HTLC escrow + x402-clearing Clarity contract (Phase 2). Last substantive msg 2026-03-23: GE confirmed PRs #162/#163 merged, promised to file Clarity contract PR. **As of 2026-03-31: Phase 2 Clarity contract PR still not filed (8+ days silence) — collaboration now in confirmed dormancy phase.** Pattern doc: `memory/shared/entries/peer-collab-lifecycle.md`. No further follow-up needed unless GE resumes substantive contact.

**l-day5-analysis** [2026-03-29] 80% success rate (94/118 tasks). 20/24 failures are x402 welcome cascades — one stuck nonce (543→547→553) multiplied across the welcome queue, not 20 independent failures. Nonce-broadcast quest Phase 2 failed again; relay CB still blocking. Non-relay work was genuinely productive (relay health PR, zest-yield-manager sensor, arch diagram, skills v0.36.0). Once CB clears and ghost nonces evict, failure rate should drop to ~5%.

**l-day6-audit** [2026-03-29T00:02Z] 80% success rate confirmed (94/118). 24 failures: 23 x402 welcome cascades (nonces 543→547→553 progressing — ghost probe not evicting in prod, v1.26.0 fix may be staging-only), 1 duplicate retrospective (benign), 1 QuorumClaw (pre-existing, sensor paused). No new failure types. Relay CB root cause persists; requires prod relay deployment of v1.26.0 to resolve.

**l-day7-retro** [2026-03-29T00:28Z] 26 failures. Breakdown: 22 x402 welcome (nonce now at 554 — progressing from 543→547→553→554, slow ghost eviction), 4 QuorumClaw repeat (failure-triage keeps creating "API unavailable" tasks despite sensor paused — archive task #9505 will fix), 1 beat-cooldown new type (#9508 — signal attempted 59min into cooldown window, handled gracefully by sensor), 1 duplicate retrospective. New pattern: STX-only deliveries (STX sent, x402 timed out) — agents get tokens without welcome, sentinels handle retry. QuorumClaw triage loop: pausing a sensor doesn't stop failure-triage from generating tasks for old failures — archiving the skill is the correct fix.

**l-relay-cb-cleared** [2026-03-29T06:35Z] Relay v1.26.1 deployed to prod (wasn't staged-only — already live). CB is now CLOSED. Cleared 16 conflicts via clear-conflicts action. flush-wallet blocked by relay↔Hiro API connectivity (Cloudflare Durable Object can't reach Hiro). Ghost nonces still unresolved but CB being open was the cascade root cause. effectiveCapacity remains 1. Welcome queue should start flowing again with CB closed.

**l-day8-retro** [2026-03-29T14:00Z] 21 completed, 10 failed ($8.89 = $0.42/task). All 10 failures explainable: 5 ghost nonce 554 (one infra blocker multiplying), 2 beat cooldowns, 1 agent-not-found, 1 external Hiro, 1 benign dup. PR review velocity high — 4 PRs on same x402 root cause batched efficiently while context fresh. Self-healing loop worked: arc-workflows sensor caught workflow dedup bug, patched without human. Signal cap bug found: `countSignalTasksToday()` subject mismatch means daily 6-cap not enforced.

**l-day9-retro** [2026-03-30T00:00Z] 116 completed, 14 failed ($34.50 = $0.265/task). Success rate 89% — best day yet. Failures: 8 welcome cascade (4 SENDER_NONCE_DUPLICATE + 4 relay timeouts, all ghost nonce 554), 3 beat cooldowns (handled gracefully), 1 agent-not-found, 1 Hiro API unreachable, 1 superseded. Repo-maintenance dominated (57/130, 44%) — competition-driven PR surge, appropriate for competition window. Signal cap bug (#9554) FIXED (`countSignalTasksToday()` now matches agent-trading subject strings). Ghost nonce 554 persists but with CB closed, failure count is capped vs prior cascade days.

**l-day10-audit** [2026-03-30T00:02Z] 14 failures confirmed explained (from day9 retro). Signal cap fix committed. Nonce strategy alignment plan added (docs/nonce-strategy-alignment-plan.md) — 3 tx paths need nonce-tracker consolidation. No new failure types. System healthy: 0 pending, 100 skills, 68 sensors.

**l-relay-capacity-audit** [2026-03-30T00:23Z] Wallet audit task #9635: Relay v1.26.1 healthy, CB CLOSED, no conflicts detected (0). Pool: 20 available, 0 reserved. **effectiveCapacity remains 1** — unchanged from 2026-03-29T08:42Z snapshot. lastExecutedNonce: 1207→possibleNextNonce: 1208, no missing nonces, no mempool churn. Last conflict 7h ago. Capacity recovery stalled; flush-wallet succeeded (25 probes enqueued) but ghost nonce 554 eviction still in-flight. No manual intervention needed yet — monitor next cycle for passive recovery. Sender hand nextExpected: 544 per concurrent task execution.

**l-day10-retro** [2026-03-30T00:26Z] 11 failures reviewed (early day 10, post-flush-wallet). Breakdown: 7 nonce/relay (5 SENDER_NONCE_DUPLICATE ghost nonce 554 + 2 relay timeouts), 2 beat cooldowns (graceful), 1 agent-not-found (external, no fix), 1 superseded (benign). No new failure types. Key insight: flush-wallet completed at 00:21Z but effectiveCapacity still 1 — probes 1183-1208 enqueued but ghost nonce 554 eviction slower than expected. Hiro API unreachable from Cloudflare DO persists as relay infrastructure constraint. All failures explained; no follow-up tasks needed.

**l-capacity-stall-resolved-root-cause** [2026-03-30T02:30Z] Ghost nonce 554 RESOLVED — sender progressed to 577/578, sponsor at 1207/1208, both sides clean (0 missing, 0 mempool). effectiveCapacity=1 persists because it's a server-side relay config (Cloudflare DO), NOT derived from nonce state or conflict history. All 5 admin actions exhausted (resync, reset, clear-pools, clear-conflicts, flush-wallet) — none affect effectiveCapacity. Requires relay code or DO config change by whoabuddy. Welcome tasks will succeed at throughput=1 until capacity is raised.

**l-rising-leviathan-collab** [2026-03-31] [RETRO COMPLETE] RL is an **automated signal review system** on the competition platform, not a human-operated peer agent. Single workflow (1 msg): rejected Arc's agent-trading signal about Bitcoin fee market. Pattern: 5 rejections in 27h for fee-market/external-data signals — ordinals-market-data sensor was still including fee-market as a fallback candidate despite the known rejection rule. **Fix applied**: `fix(ordinals-market-data): remove fee-market from flat-market fallback candidate order` (committed 2026-03-31). RL also active in aibtcdev/skills repo (filed issue #268: 0x prefix fix). **Key learnings**: (1) RL rejections are signals about *our* signal quality, not collaboration dialogue — no reply needed. (2) Automated reviewers provide fast feedback loops on signal rule violations. (3) Sensor fallback candidate lists must exclude known-rejected topics, not just primary candidates.

**l-flaring-leopard-collab** [2026-03-30] Peer agent at bc1qdredf4adwvh8548fe95tv0vh56429uw78jec5l. Single interaction via Paperboy relay: forwarded Inner Whale signal — AIBTC referral layer now pays for agent acquisition (not just messaging). Action type: information only, no ops required. **Key insight**: Referral layer economics shift (acquisition payments) is the kind of aibtc network infrastructure/economics change that *is* signal-eligible for agent-trading beat — file signal if coverage window allows. Pattern: Flaring Leopard acting as Paperboy relay agent (forwarding third-party signals, not direct communication). No reply sent — information-only relay with no open questions.

**l-overnight-2026-03-30** [2026-03-30T13:00Z] Cleanest night to date: 57/57 tasks completed, 0 failures, 58 cycles at $25.50 ($0.447/task). Three highlights: (1) **Research sprint**: 22 whoabuddy links processed in ~90 min with quick-reject screening — 22 tasks → 1 high-relevance signal (NanoClaw/OneCLI dev-tools infrastructure). Research-to-signal pipeline validated. (2) **Pattern capture velocity**: 4 new patterns added in one morning session from research retrospectives (bulk-list-to-individual-tasks, research-triage-quick-reject, CLAUDE.md length, synthesis-after-parallel-bulk). (3) **Cost note**: $0.447/task for research-heavy work vs $0.265 typical — tweet fetches accumulate across 22 tasks but still within acceptable range. bff-skills PR carousel (8+ re-reviews) fully resolved. effectiveCapacity=1 still escalated to whoabuddy (#9658), no change.

**l-day11-retro** [2026-03-31T00:00Z] 177/178 tasks completed (99%) at $56.08 ($0.315/task) — best success rate to date. Single failure: arxiv sensor had stale beat slug `dev-tools` (renamed to `infrastructure` by platform); self-detected and fixed same-day (#9786). Model split appropriate: 74% sonnet, 17% opus, 10% haiku. **Key concern**: queue composition — aibtc-repo-maintenance (76) + github-ci-status (57) = 75% of all tasks, but competition score remains 12 vs top 32. PR review velocity doesn't earn competition points; only filed signals do. With 6 signals/day cap × $20 = $120/day potential vs $56 actual spend, the ROI gap is in signal volume, not task volume. **Beat slug drift**: recurring failure class — external platforms rename beats without notice; sensors hold stale slugs; results in 404 on signal file. Sensors should validate beat existence or detect 404s explicitly rather than failing silently.


