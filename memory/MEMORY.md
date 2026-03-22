# Arc Memory — Current Status & Index

*Last updated: 2026-03-22T00:02Z*

## Shared Reference Entries

- **bare-flag-exclusion** (task #7780): Why Arc dispatch must never use `--bare` flag (bypasses syntax check & service health hooks)
- **housekeeping_state_files** (task #7823): Runtime state files (cache, status) should be ignored in .gitignore, not committed

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy). Spark DeFi execution blocked (OAuth expired, fleet suspended). DeFi tasks pre-positioned: #6807 Bitflow LP (P9, defi-bitflow), #6808 Zest V2 sBTC (P9, zest-v2). Jingswap skill needs building first (#6809, P3).

**Bitcoin DeFi Landscape (2026-03-19, task #7290):**
- **sBTC yield ladder** (low→high risk): Dual Stacking alone ~0.5% → +STX lock ~2-5% → Zest lending ~3.5% BTC → stSTXbtc ~15% → Bitflow LP 12-50%+ → Hermetica USDh 8-25%
- **Bitflow:** Leading DEX aggregator on Stacks. XYK + StableSwap pools. Deployer: `SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M`. SDK: `@bitflowlabs/core-sdk`. Public REST API at `https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev` (no auth, 500 req/min). sBTC/STX pool reported 22-500% APY (emission-dependent). All contracts audited.
- **Zest v2:** Aave v3-style lending on Stacks. Deployer: `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N`. Entry: `pool-borrow-v2-3`. Supports sBTC/STX/stSTX/aeUSDC. Traditional mode: 50% max LTV, 70% liquidation threshold. E-mode: 80% LTV, 85% liquidation. sBTC supply APY: ~3.5% (utilization-dependent). GitHub: `Zest-Protocol/zest-v2-contracts`.
- sBTC pool on Zest earns "real BTC yield" from borrower interest. Hermetica USDh used for Zest liquidations.

## Fleet Roster

| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD |
| Forge | 192.168.1.15 | bc1q9hme... | Infra |

## Critical Flags

**FLEET DEGRADED (2026-03-11):** Workers (Spark, Iris, Loom, Forge) suspended by Anthropic. Arc is sole executor. Forge has OpenRouter fallback. whoabuddy appealing. Do NOT route to workers.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

**Dispatch gate:** Rate limits → immediate stop + email whoabuddy. 3 consecutive failures → same. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**Umbrel node (192.168.1.106):** Bitcoin Core must run full (currently pruned). Stacks node + API planned.

**x402 NONCE_CONFLICT:** Sentinel file `db/hook-state/x402-nonce-conflict.json` gates welcome sensors. Sentinel cleared 2026-03-21 (task #7908) after being stuck since 2026-03-11. Self-healing added to aibtc-welcome sensor: when sentinel is "error", sensor checks relay /health + sponsor nonces and auto-clears if healthy. x402-sponsor-relay v1.18.0 deployed 2026-03-12. **[FLAG 2026-03-22]:** NONCE_CONFLICT re-emerged at scale after sentinel cleared — 23+ welcome failures on 2026-03-21/22 with ConflictingNonceInMempool. Circuit breaker latch fix (task #7914, commit 1b36a62) is in PR but NOT yet merged. Until that PR merges, welcome sends will keep hitting this. Expect continued failures; sentinel self-heal is not sufficient fix.

**x402 circuit breaker latch bug (2026-03-21, task #7914):** `lastGapDetected` in nonce-do.ts was set unconditionally on any Hiro `detected_missing_nonces`, including transient/already-handled gaps. With alarm running every 60s and 5 wallets, the 10-minute RECENT_CONFLICT_WINDOW never expired → breaker stayed permanently open despite healthy pool. Fix: moved `setStateValue(lastGapDetected)` to after gap analysis loop, gated by `gapFillNonces.length > 0`. Commit 1b36a62 on feat/inbox-endpoint. PR pending (task #7916).

## Fleet Architecture

- GitHub sensors centralized (Arc-only). Pre-dispatch gate routes GitHub tasks to Arc.
- OAuth: Workers use ANTHROPIC_API_KEY (OAuth unreliable across VMs).
- Welcome dedup: Verify completion in DB via `completedTaskCountForSource()`, not task creation.
- Monitoring: Arc's 74 sensors unaffected. Worker sensors down during suspension.
- **Agent identities:** Arc=Trustless Indra (1), Spark=Topaz Centaur (29), Loom=Fractal Hydra (85), Forge=Sapphire Mars (84), Iris=not yet registered (task #2890).

## Key Learnings

**Sentinel file pattern:** For 402/CreditsDepleted or transient gate conditions, write sentinel and gate all downstream callers. Check before runtime failure.

**Auth cascade pattern:** OAuth token expiry causes wave of consecutive auth failures. Mitigation: ANTHROPIC_API_KEY fallback in dispatch.ts (task #5215). whoabuddy refreshes OAuth; dispatch auto-recovers.

**arc-payments (2026-03-12):** `stacks-payments` → `arc-payments`. Monitors STX token_transfer + sBTC SIP-010 (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). Hook state key: `arc-payments`.

**Zero Authority DAO (2026-03-12):** Sensor removed (no on-chain contracts). CLI + daos.json ready. Rebuild sensor when contracts deploy on Stacks.

**ERC-8004 status (2026-03-19, task #7291):** Standard live on Ethereum mainnet since Jan 29, 2026 (Draft status but de-facto standard). 100,000+ agents registered across 30+ EVM chains; BNB Chain leads growth, Solana cross-compatible via SATI soul-bound NFTs. Arc is agent #1 (Trustless Indra). Dominant pattern: polyglot agent stack = ERC-8004 identity + A2A tasks + MCP tools + x402 micropayments + AP2 mandates. Complementary standards: ERC-8001 (multi-agent coordination, orthogonal), ERC-8126 (verification/compliance, complementary). No competing identity standards in EVM. Open risks: Validation Registry can't be read by smart contracts (events only), reputation aggregation unsettled. V2 roadmap: deeper MCP support, richer on-chain reputation, x402 payment proof formats. Arc's zero-task-activity issue is NOT ecosystem adoption — adoption is massive. Arc sensors monitoring correct signals; likely need to expand to Validation Registry events or Reputation Registry interactions.

**Temporal awareness (2026-03-18):** Dispatch prompt shows day-of-week, last cycle elapsed, DST-correct MT via `Intl.DateTimeFormat("America/Denver")`, memory staleness warning if 3+ days old. Task #6703.

**Memory as training (2026-03-18):** `memory/frameworks.md` has 6 decision trees. `skills/arc-memory/` provides `add-pattern`, `list-sections`, `retrospective`, `framework` commands. Load `arc-memory` skill on retrospective/strategy/triage tasks.

**Spark DeFi pre-positioning (2026-03-18):** DeFi tasks #6807/#6808 at P9 (won't dispatch). #6809 Jingswap skill build at P3 (Opus). Activate when: (1) clear fleet-suspended.json for Spark, (2) migrate to ANTHROPIC_API_KEY, (3) run fleet-router.

**Group Decisions directive (2026-03-18):** whoabuddy committed to consensus-seeking pattern — seek input via AIBTC inbox, message agents directly for testing, pay 100 sats for 2nd opinions. Multi-agent input before fleet/contacts feature decisions.

**Weekly review (2026-03-18):** D2/D3/D4/D5 on track. D1 stalled — x402 KB (#6734) and ALB registration (#6804) in queue. DeFi blocked by fleet suspension. MCP Phase 1 v6 progressing.

**[FLAG] D4 breach (2026-03-19):** Spent $272.28 on 2026-03-18, exceeding the $200/day cap. Cost drivers: x402-relay inbox endpoint ($7.814), monitoring service deployment ($3.678), and high github-issues volume (191 tasks). Expensive Opus tasks and large sensor-driven reactive volume are the root cause. Monitor daily spend; consider gating low-value github-issues tasks or routing to Haiku.

**D4 recovery confirmed (2026-03-19 06:40Z):** Day trajectory: $27.78 code + $38.27 API est (125 cycles by 06:40Z). Cost report (#7304) showed 82 tasks through mid-afternoon: $22.62 code + $33.39 API est. Top drivers: arc-skill-manager ($5.35, strategic), arxiv-research ($3.78, 4 tasks—monitor alignment), aibtc-repo-maintenance ($2.08), aibtc-news-editorial ($1.91). Sensor costs distributed, no runaway. Expensive Opus tasks are strategic (architecture, skill building). **PATTERN CONFIRMED:** Yesterday's $272 spike WAS one-day incident (x402 endpoint, monitoring deployment, gh-issues backlog surge to 191 tasks). Today's volume 82-118 tasks/day is normal. D4 cap ($200/day) is holding. Weekly trend $747.09 / 7 = $107/day avg — healthy.

**Landing-page drop pattern (2026-03-19):** Pre-dispatch gate correctly drops landing-page PR/merge tasks (17 dropped today) with note "handled interactively by human." Pattern is working — no merge accidents.

**ALB registration resolved (2026-03-19):** trustless-indra@agentslovebitcoin.com registered (#7189). DO bindings issue was stale deploy — fixed. Spark/Forge ALB registration queued (#6803/#6804) for when fleet resumes.

**GitHub tasks need fleet-handoff in skills (2026-03-19):** When tasks require git push/PR but fleet-handoff isn't listed in the skills array, Claude doesn't know to use it — the task just fails. GitHub-requiring tasks must always include `fleet-handoff` in skills array so the skill SKILL.md is loaded and handoff route is visible.

**aibtc.news /api/brief endpoint missing (2026-03-19):** Brief compilation tasks fail because POST /api/brief doesn't exist on aibtc.news. Don't queue new brief tasks until endpoint is built.

**Beat ownership: Arc ONLY files to `ordinals` beat (slug: `ordinals`) (2026-03-19):** DAO Watch and BTC Macro beats are owned by other agents. The beat slug is `ordinals` NOT `ordinals-business`. Sensors fixed (task #7287): aibtc-news-editorial/sensor.ts and aibtc-news-deal-flow/sensor.ts now use correct `--beat ordinals`. auto-queue sensor has domain constraint. Root causes of task #7141 dao-watch violation: dispatch session created task from batch instructions without beat-ownership check (source=null). All sensor-generated tasks now hardcode correct slug.

**[FLAG] $100K competition readiness (2026-03-21, task #7835):** Competition runs March 23 – April 22. All sensor gates verified operational: defi-bitflow threshold=15%, rate_limit=720min, isDailySignalCapHit added. Editorial sensor has daily-cap + cooldown + canFileSignal pre-checks. Leaderboard: Arc 3rd (251pts, 4-streak, 39 signals). Leaders: Secret Mars (485, 19-streak), Sonic Mast (432, 19-streak). Day-1 task #7837 scheduled 2026-03-23T06:00Z. Unisat API key needed (#7836). **Signal diversity plan:** (1) NFT floors via CoinGecko, (2) Runestone 30d rally, (3) Fee market/inscription economics, (4) Block space utilization, (5) BRC-20 via Unisat, (6) Cross-collection liquidity. Market snapshot: all top collections showing 1-2 sales/day, fees at 1 sat/vB floor. Strategy: 6 diverse signals/day, Economist voice, streak maintenance critical.

**[FLAG] aibtc.news disclosure REQUIRED (2026-03-20, task #7681):** All signals were being rejected for missing `disclosure` field. Fix deployed: file-signal CLI now auto-fills `[Model: Claude (Arc agent) | Tools: Unisat API, Bitflow API, mempool.space, CoinGecko | Skills: aibtc-news-editorial, bitcoin-wallet]` as default. Classifieds PATCH endpoints updated to header-based auth (API v2). PATCH /signals corrections do NOT store disclosure — only new signals via POST include it. **$100K competition starts 2026-03-23** (March 23 – April 22): $20/inscribed signal, max 6/day ($120/day), weekly bonuses up to $1,200. aibtc.news docs reference BIP-322 but BIP-137 still works from bc1q addresses.

**AIBTC News Signal Filing (2026-03-19):** Arc is actively filing signals to `ordinals` beat (slug is `ordinals`, NOT `ordinals-business`) via `aibtc-news-editorial` skill. **RATE LIMIT: 60 minutes per signal per beat. DAILY CAP: 6 signals/day.** API requires: beat_slug, btc_address, headline, sources (array of {url,title}), tags. file-signal CLI accepts --headline, --claim, --evidence, --implication, --sources (JSON), --tags (comma-separated). `--force` skips judge-signal pre-flight. Signals auto-signed via BIP-137. Most recent signal filed 2026-03-19 22:35:59Z (sBTC/STX 18.2% range, rapid sequence). Daily limit reached 2026-03-19 (6/6) — no more signals until 2026-03-20. Do NOT queue retry tasks for same-day signals after daily limit is hit.

**GitHub sensor dedup policy (2026-03-19, task #7438):** whoabuddy directive: NO daily caps. Dedup on unique IDs (issue:{repo}#{number}, pr-review:{repo}#{number}). One reaction per review/re-review request. Real-maintainer approach. github-issue-monitor uses "any" dedup (triage once per issue). github-mentions uses "pending" dedup (re-engagement on completed entities — re-reviews, new mentions). aibtc-repo-maintenance uses pendingTaskExistsForSource (retry resilience). Daily caps removed from all three sensors.

**Volume vs. strategy (2026-03-13):** 243 tasks/day, all sensor-driven. Reactive GitHub/PR volume can crowd D1/D2 work. Strategic tasks may need explicit scheduling or higher priority.

**Cost pattern (2026-03-13):** blog-publishing drives ~30% of spend. arc-payments CLI → Sonnet for future iterations. Current spend $7.96/day healthy.

**Site mapping:** `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X dedup: 24h window, rewrite > split.

**agentslovebitcoin.com (2026-03-12):** D1/D2 strategic initiative. 4-phase plan. Monitor for follow-up tasks.

**defi-bitflow skill readiness (2026-03-19, task #7292):** ✅ READY FOR FLEET RESUMPTION. All CLI commands functional (tokens, spreads, quote, routes, ticker). Sensor logic sound: fetches tickers via Bitflow API, detects high-spread pairs (>5%), rate-limits signals (4h cooldown), creates signal filing tasks. Fixed documentation mismatch: ticker command accepts `--base-currency` and `--target-currency`, not `--base` and `--target`. No blockers. Bitflow API healthy at `bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev`. DCA commands stubbed but not implemented (safe to defer). Ready for Spark resumption.

**D4 sustained (2026-03-19 13:39Z):** Report #7346 at 07:39 MDT: $32.98 code + $51.78 API est, 124 tasks. No runaway costs. Cost distribution healthy: arc-skill-manager ($5.82, strategic), arxiv-research ($3.78), editorial ($2.22). No single expensive outlier. Confirmed pattern: $107/day normal run rate is sustainable within $200/day cap. Yesterday's $272 spike was incident-driven (x402 endpoint + monitoring deploy + gh-issues backlog). Today tracking normal volume.

**aibtc-mcp-server releases (2026-03-19/2026-03-20):**
- **v1.41.0 (task #7594):** No breaking changes. Impacts: (1) Bounty-scanner is new capability Arc lacks — task #7595 (P6) to assess. (2) Credential store via MCP needs security review before HTTP transport — task #7596 (P4 Opus). (3) ERC-8004 tools duplicate Arc's existing skill suite (no action). (4) Runes support + restored Unisat wallet tools strengthen ordinals beat. (5) Souldinals adds cross-chain identity depth (low priority). Security review (#7596) is critical path item before enabling HTTP transport.
- **v1.42.0 (2026-03-20, task #7777):** Non-breaking feature update. Jingswap contract names updated to `sbtc-stx-jing` and `sbtc-usdcx-jing`. No immediate action. When Jingswap skill (#6809, P3) is built, use updated contract identifiers. Created follow-up task #7797.

**Claude Code upgraded (2026-03-20, task #7779):** Upgraded v2.1.73 → v2.1.81 via `bun add -g @anthropic-ai/claude-code@2.1.81`. Fixes: stdin hang (v2.1.79), background agent task hang (v2.1.81). Version lag resolved.

**Volume high-water mark (2026-03-20):** 455 tasks in 24h, $115.94 — new volume record. Still under D4 cap ($200). Driven by aibtc-repo-maintenance (160), arc-skill-manager (113), github-ci-status (58). 97% success rate. Volume is high but cost-efficient at $0.255/task avg. Monitor if next day exceeds $150 to flag D4 risk.

**nostr-wot trust integration (2026-03-21, task #7793):** nostr-wot wired into 3 DeFi/payment flows: (1) defi-bitflow swap --counterparty-pubkey gate (blocks untrusted counterparties), (2) arc-payments incoming payment trust scoring, (3) x402-sponsor-relay counterparty validation. Trust layer is now available as a first-class gate in payment and DeFi operations. Use `--counterparty-pubkey <hex>` on swap commands to enforce trust check.

**Landing-page gate scope (2026-03-21):** Pre-dispatch gate drops landing-page *merge/PR* tasks but passes *analysis* tasks (#7791, #7790, #7789 all executed). If analysis tasks for landing-page are also wasteful (human context required), tighten gate to drop all subjects containing "[landing-page]" regardless of task type.

**Workflow architecture validated (2026-03-21, task #7794):** Evaluated 5 repeating patterns — all covered by existing state machines (agent-collaboration, git-workflow, etc.). No new workflow templates or architecture changes needed. Existing machine coverage is sufficient through at least Q2 2026.

**PR comment etiquette (2026-03-21, task #7898):** When CI systems (Vercel, GitHub Actions) already post comments on a PR Arc filed, Arc must NOT add its own review comments — it creates a confusing "self-review" appearance and noise. Pattern: file PR, then stay silent unless the PR author asks for feedback. Let CI comments speak for themselves. Cleanup task #7899 queued to remove redundant comments from 5 cryptoskills PRs.

**Retrospective 2026-03-21 (6 failures, task #7805):**
- **Sensor pre-check gap (recurring):** All 6 failures split into two known gate conditions — 3 rate-limit (cooldown active) and 3 daily-cap (6/6 hit). Root cause: sensors queue signal tasks without checking these transient states first. Fix pattern: before `db.createTask()` in a signal-filing sensor, check (1) active cooldown via hook-state and (2) daily task count for same beat/source. Task #7806 created to implement pre-checks in aibtc-news-editorial sensor.
- **magiceden.io unreachable (task #7749):** Signal pre-flight detected magiceden.io/ordinals unreachable. Note as unreliable data source — don't use as sole evidence source for signals.

**Retrospective 2026-03-20 (13 failures, task #7644):**
- **No-same-day-retry policy violations (2026-03-20):** Task #7623 was a retry for a signal that hit the daily cap — a policy violation. When closing a task due to daily cap hit, do NOT create a follow-up retry task. The policy is clear: "Do NOT queue retry tasks for same-day signals after daily limit is hit." The retry will be handled naturally by the sensor the next day.
- **Landing-page task leakage (2026-03-20):** Tasks #7432 and #7451 have subject prefix "[landing-page]" and lack a `source` field — they appear to be human-queued. Pre-dispatch gate drops them, but tasks are still executing and timing out (wasting Sonnet budget). Root cause: gate may be running post-queue not pre-execution. Create follow-up to harden landing-page detection in the gate.
- **PR supersession without closure (2026-03-20):** Tasks #7389, #7408, #7409 all related to the same aibtcdev PR/mention, all failed as "superseded by P1 Opus." When a higher-priority task supersedes others, old tasks should be explicitly closed (status=failed, summary="superseded by #X") by the superseding task — not left to fail independently. This creates clean audit trails and avoids confusion.
