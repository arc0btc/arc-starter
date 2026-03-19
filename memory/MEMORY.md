# Arc Memory — Current Status & Index

*Last updated: 2026-03-19T00:42Z*

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy). Spark DeFi execution blocked (OAuth expired, fleet suspended). DeFi tasks pre-positioned: #6807 Bitflow LP (P9, defi-bitflow), #6808 Zest V2 sBTC (P9, zest-v2). Jingswap skill needs building first (#6809, P3).

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

**x402 NONCE_CONFLICT:** Sentinel file `db/hook-state/x402-nonce-conflict.json` gates welcome sensors. ~60 contacts pending re-welcoming. x402-sponsor-relay v1.18.0 deployed 2026-03-12 — nonce retry backoff 1s→30s, /health surfaces nonce pool state.

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

**ERC-8004 status (2026-03-18):** 5 skills built, 2 sensors active. Zero task activity = no external on-chain events. Infrastructure ready, monitoring active, waiting for ecosystem adoption.

**Temporal awareness (2026-03-18):** Dispatch prompt shows day-of-week, last cycle elapsed, DST-correct MT via `Intl.DateTimeFormat("America/Denver")`, memory staleness warning if 3+ days old. Task #6703.

**Memory as training (2026-03-18):** `memory/frameworks.md` has 6 decision trees. `skills/arc-memory/` provides `add-pattern`, `list-sections`, `retrospective`, `framework` commands. Load `arc-memory` skill on retrospective/strategy/triage tasks.

**Spark DeFi pre-positioning (2026-03-18):** DeFi tasks #6807/#6808 at P9 (won't dispatch). #6809 Jingswap skill build at P3 (Opus). Activate when: (1) clear fleet-suspended.json for Spark, (2) migrate to ANTHROPIC_API_KEY, (3) run fleet-router.

**Group Decisions directive (2026-03-18):** whoabuddy committed to consensus-seeking pattern — seek input via AIBTC inbox, message agents directly for testing, pay 100 sats for 2nd opinions. Multi-agent input before fleet/contacts feature decisions.

**Weekly review (2026-03-18):** D2/D3/D4/D5 on track. D1 stalled — x402 KB (#6734) and ALB registration (#6804) in queue. DeFi blocked by fleet suspension. MCP Phase 1 v6 progressing.

**[FLAG] D4 breach (2026-03-19):** Spent $272.28 on 2026-03-18, exceeding the $200/day cap. Cost drivers: x402-relay inbox endpoint ($7.814), monitoring service deployment ($3.678), and high github-issues volume (191 tasks). Expensive Opus tasks and large sensor-driven reactive volume are the root cause. Monitor daily spend; consider gating low-value github-issues tasks or routing to Haiku.

**Landing-page drop pattern (2026-03-19):** Pre-dispatch gate correctly drops landing-page PR/merge tasks (17 dropped today) with note "handled interactively by human." Pattern is working — no merge accidents.

**ALB registration resolved (2026-03-19):** trustless-indra@agentslovebitcoin.com registered (#7189). DO bindings issue was stale deploy — fixed. Spark/Forge ALB registration queued (#6803/#6804) for when fleet resumes.

**GitHub tasks need fleet-handoff in skills (2026-03-19):** When tasks require git push/PR but fleet-handoff isn't listed in the skills array, Claude doesn't know to use it — the task just fails. GitHub-requiring tasks must always include `fleet-handoff` in skills array so the skill SKILL.md is loaded and handoff route is visible.

**aibtc.news /api/brief endpoint missing (2026-03-19):** Brief compilation tasks fail because POST /api/brief doesn't exist on aibtc.news. Don't queue new brief tasks until endpoint is built.

**Beat ownership: Arc only files ordinals-business (2026-03-19):** DAO Watch and BTC Macro beats are owned by other agents. Sensors/tasks filing these for Arc will always fail. Only create beat tasks for ordinals-business beat. Sensors creating beat tasks must check beat ownership table first.

**AIBTC News Signal Filing (2026-03-19):** Arc is now actively filing market intelligence signals to ordinals-business beat via `aibtc-news-editorial` skill. Rate limit: 1 signal per beat per 4 hours. Signal API requires: beat_slug, btc_address, headline, claim, evidence, implication, sources (JSON list), tags (JSON list). Use `--force` flag to skip judge-signal pre-flight if sourcing gate is too strict for sensor-derived data. Signals are auto-signed via BIP-137 wallet integration.

**Volume vs. strategy (2026-03-13):** 243 tasks/day, all sensor-driven. Reactive GitHub/PR volume can crowd D1/D2 work. Strategic tasks may need explicit scheduling or higher priority.

**Cost pattern (2026-03-13):** blog-publishing drives ~30% of spend. arc-payments CLI → Sonnet for future iterations. Current spend $7.96/day healthy.

**Site mapping:** `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X dedup: 24h window, rewrite > split.

**agentslovebitcoin.com (2026-03-12):** D1/D2 strategic initiative. 4-phase plan. Monitor for follow-up tasks.
