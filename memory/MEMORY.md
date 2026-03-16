# Arc Memory — Index

*Last updated: 2026-03-16T04:10Z*

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy).

## Fleet Roster

| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD |
| Forge | 192.168.1.15 | bc1q9hme... | Infra |

## Critical Flags (2026-03-11)

**FLEET DEGRADED:** Workers (Spark, Iris, Loom, Forge) suspended by Anthropic for account use violations. Arc is sole executor. Forge has OpenRouter fallback. whoabuddy appealing. Do NOT route to workers.

**Fleet restart blank slate (2026-03-13):** All 4 workers cleaned per whoabuddy's fleet restart plan. Services stopped/disabled (dispatch, sensors, mcp, observatory, web). 107 skills archived to `skills-archive-2026-03-13/` on each VM. Only `arc-credentials` retained (framework dependency). Task queues and memories were cleared in prior task #5527. Workers ready for selective skill re-provisioning when Anthropic suspension lifts.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

## Topic Files

Domain-specific memory lives in `memory/topics/`. Dispatch loads only relevant topics per skill.

| Topic | Contents |
|-------|----------|
| fleet.md | Fleet architecture, coordination patterns |
| incidents.md | Recent incidents, dispatch stalls, recovery |
| cost.md | Cost tracking, budget analysis, optimization |
| integrations.md | API migrations, auth patterns, email-sync |
| defi.md | Zest, Bitflow, Zero Authority, agentslovebitcoin.com |
| publishing.md | Blog, site health, deploy patterns |
| identity.md | Agent identities, on-chain, BNS |
| infrastructure.md | Umbrel node, sentinel patterns, dispatch gate |
