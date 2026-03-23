# Arc Memory — Current Status & Index

*Last updated: 2026-03-23T05:55Z*

## Shared Reference Entries

- **bare-flag-exclusion** (task #7780): Why Arc dispatch must never use `--bare` flag (bypasses syntax check & service health hooks)
- **housekeeping_state_files** (task #7823): Runtime state files (cache, status) should be ignored in .gitignore, not committed
- **[v7-test-vm](reference_test_vm.md)**: Test VM at 192.168.1.16 for Q3 engine-validation (creds in `arc creds` manage-agents)
- **[v7-skills-required-everywhere](project_v7_skills_required.md)**: Design decision — tasks, sensors, workflows all require ≥1 skill

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy). Spark DeFi execution blocked (fleet suspended). DeFi tasks pre-positioned: #6807 Bitflow LP (P9, defi-bitflow), #6808 Zest V2 sBTC (P9, zest-v2). Jingswap skill build first (#6809, P3).

**Bitcoin DeFi Landscape (2026-03-19):**
- **sBTC yield ladder** (low→high risk): Dual Stacking ~0.5% → +STX lock ~2-5% → Zest lending ~3.5% BTC → stSTXbtc ~15% → Bitflow LP 12-50%+ → Hermetica USDh 8-25%
- **Bitflow:** Leading DEX aggregator on Stacks. Deployer: `SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M`. SDK: `@bitflowlabs/core-sdk`. Public REST API at `https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev` (no auth, 500 req/min). defi-bitflow skill ✅ READY.
- **Zest v2:** Aave v3-style lending. Deployer: `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N`. Entry: `pool-borrow-v2-3`. sBTC APY ~3.5%. E-mode: 80% LTV. GitHub: `Zest-Protocol/zest-v2-contracts`.
- **Jingswap contracts:** `sbtc-stx-jing`, `sbtc-usdcx-jing` (updated in v1.42.0).

## Fleet Roster

| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi — OFFLINE |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X — OFFLINE |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD, AIBTC Publisher (Rising Leviathan) — ONLINE |
| Forge | 192.168.1.15 | bc1q9hme... | Infra (codex, early dispatch) — ONLINE |

## Critical Flags

**FLEET PARTIALLY RECOVERED (2026-03-23):** Loom ONLINE (Rising Leviathan AIBTC publisher). Forge ONLINE (codex, early dispatch). Spark and Iris remain OFFLINE (suspended by Anthropic). Route work to Loom/Forge only.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

**Dispatch gate:** Rate limits → immediate stop + email whoabuddy. 3 consecutive failures → same. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**Umbrel node (192.168.1.106):** Bitcoin Core must run full (currently pruned). Stacks node + API planned.

**x402 NONCE_CONFLICT — NOT RESOLVED (2026-03-23, task #8115):** Relay v1.20.1 health endpoint reports healthy but `send-inbox-message` calls STILL fail. 158+ welcome task failures across 2 days. **Circuit breaker latch fix (task #7914, commit 1b36a62) in PR on feat/inbox-endpoint — NOT YET MERGED.** STX transfers succeed; only x402 inbox messages fail. Self-heal loop active until merged.

**Stale dispatch lock detection (2026-03-23):** arc-service-health sensor detects stale locks. Recovery: `rm db/dispatch-lock.json && arc run`. Dispatch auto-marks orphaned active task failed and proceeds.

**[FLAG] $100K competition ACTIVE (started 2026-03-23, runs through 2026-04-22):** Arc 3rd (278pts, streak 5, 43 signals). Leaders: Secret Mars (504, 20-streak), Sonic Mast (449, 20-streak). Ionic Anvil 4th (259pts) — 19pts behind. $20/inscribed signal, max 6/day ($120/day), weekly bonuses up to $1,200. Day-1 task #7837 scheduled 2026-03-23T06:00Z — verify executed. **Must file daily.** No NONCE_CONFLICT excuse — signals use BIP-137, not x402.

**[FLAG] aibtc.news signal rules:**
- **Disclosure auto-filled** by file-signal CLI (task #7681). PATCH /signals does NOT store disclosure — only POST.
- **Beat slug:** `ordinals` (NOT `ordinals-business`). Arc ONLY files to ordinals beat. DAO Watch / BTC Macro owned by others.
- **Rate limit:** 60 min/signal/beat. **Daily cap:** 6/day. Do NOT retry same-day after cap hit.
- **Approved signal types:** NFT floors (CoinGecko), ordinals marketplace liquidity, fee market (only when materially changed), inscription volumes, BRC-20 (Unisat), cross-collection comparisons.
- **NEVER:** sBTC/STX DeFi volatility under Ordinals beat (rejected). Repetitive fee-market with no material change (rejected).
- API requires: beat_slug, btc_address, headline, sources (array), tags. BIP-137 works from bc1q addresses.
- **magiceden.io unreachable** — unreliable, don't use as sole source.

**D4 cost pattern:** Normal run rate $107/day avg (sustainable under $200/day cap). $272 spike on 2026-03-18 was incident-driven (x402 endpoint + monitoring deploy + 191 gh-issues backlog). Monitor if day exceeds $150 to flag risk. High volume (455 tasks on 2026-03-20) still under cap at ~$0.255/task avg.

## Fleet Architecture

- GitHub sensors centralized (Arc-only). Pre-dispatch gate routes GitHub tasks to Arc.
- OAuth: Workers use ANTHROPIC_API_KEY (OAuth unreliable across VMs).
- Welcome dedup: Verify completion via `completedTaskCountForSource()`, not task creation.
- **Agent identities:** Arc=Trustless Indra (1), Spark=Topaz Centaur (29), Loom=Fractal Hydra (85) aka Rising Leviathan, Forge=Sapphire Mars (84), Iris=not yet registered (#2890).
- ALB: trustless-indra@agentslovebitcoin.com registered. Spark/Forge queued (#6803/#6804) for fleet resumption.

## Key Learnings

**Sentinel file pattern:** For 402/CreditsDepleted or transient gate conditions, write sentinel and gate all downstream callers. Check before runtime failure.

**Auth cascade:** OAuth expiry causes wave of consecutive auth failures. Mitigation: ANTHROPIC_API_KEY fallback in dispatch.ts. whoabuddy refreshes; dispatch auto-recovers.

**arc-payments:** Monitors STX token_transfer + sBTC SIP-010 (`SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`). Hook state key: `arc-payments`.

**Zero Authority DAO:** Sensor removed (no on-chain contracts). CLI + daos.json ready. Rebuild sensor when contracts deploy.

**ERC-8004:** Standard live Jan 29, 2026. Arc is agent #1 (Trustless Indra). Polyglot stack: ERC-8004 identity + A2A tasks + MCP tools + x402 + AP2 mandates. Expand sensors to Validation Registry events and Reputation Registry interactions.

**nostr-wot trust:** Wired into defi-bitflow swap (--counterparty-pubkey gate), arc-payments trust scoring, x402-sponsor-relay validation.

**aibtc-mcp-server:** v1.42.0 updated Jingswap contracts. Credential store via MCP needs security review (#7596, P4 Opus) before HTTP transport enabled.

**Memory as training:** `memory/frameworks.md` has 6 decision trees. `skills/arc-memory/` provides `add-pattern`, `list-sections`, `retrospective`, `framework`. Load on retrospective/strategy/triage tasks.

**Temporal awareness:** Dispatch prompt shows day-of-week, elapsed, DST-correct MT, memory staleness warning if 3+ days old.

**Group Decisions directive:** whoabuddy seeks multi-agent input before fleet/contacts feature decisions — use AIBTC inbox, message agents, pay 100 sats for 2nd opinions.

**GitHub tasks + fleet-handoff:** Tasks requiring git push/PR must include `fleet-handoff` in skills array so handoff route is visible. Otherwise task fails.

**aibtc.news /api/brief:** POST /api/brief doesn't exist. Don't queue brief tasks until endpoint is built.

**GitHub sensor dedup:** No daily caps. Dedup on unique IDs. One reaction per review/re-review. `github-issue-monitor` uses "any"; `github-mentions` uses "pending"; `aibtc-repo-maintenance` uses pendingTaskExistsForSource.

**Landing-page gate:** Pre-dispatch gate drops landing-page PR/merge tasks. Analysis tasks pass. Consider dropping all `[landing-page]` tasks if analysis is also wasteful.

**PR comment etiquette:** When CI (Vercel, GitHub Actions) already comments a PR Arc filed, Arc must NOT add review comments. File PR, stay silent unless asked.

**Workflow coverage:** All repeating patterns covered by existing state machines through Q2 2026. No new templates needed.

**agentslovebitcoin.com:** D1/D2 strategic initiative. 4-phase plan active.

**Site mapping:** `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X dedup: 24h window, rewrite > split.

## Consolidated Retrospective Patterns

**Sensor model field required:** All sensors calling `insertTaskIfNew`/`insertTask` must include `model` field. Failure: tasks fail at dispatch with "No model set." (Fixed in aibtc-welcome, 2026-03-23.)

**Dispatch must include --model:** Follow-up tasks created without `--model` fail silently at dispatch. CLI validation task #8258 queued.

**No same-day retry after daily cap:** Never create retry tasks for signals after 6/6 daily cap hit. Sensor handles next day naturally.

**PR supersession closure:** When a higher-priority task supersedes pending tasks, explicitly close them (`status=failed, summary="superseded by #X"`). Don't leave to fail independently.

**Bulk-kill inflation:** Bulk-killed tasks register as `status=failed`. When retro failure counts look anomalously high (100+), check for bulk-kill events first.

**Cooldown pre-check in sensors:** Before `db.createTask()` in signal-filing sensors, check (1) active cooldown via hook-state and (2) daily task count. Gap exists in ordinals-market-data sensor (task #8259 queued).

**DeFi pairs not in Ordinals beat:** Bitflow sBTC/STX pair rejected under ordinals beat. Gate DeFi-only pairs in ordinals signal sensor (#8259).

**Empty retrospectives:** Retro sensor queuing tasks for upstream tasks that never executed — not bugs, just noise.
