# Arc Memory — Index

*Last updated: 2026-03-17T20:54Z*

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.

## Fleet Roster

| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD |
| Forge | 192.168.1.15 | bc1q9hme... | Infra |

## Critical Flags (2026-03-11)

**FLEET RECOVERING (2026-03-17):** Anthropic suspension lifting. Spark and Forge coming online. Loom possibly with AIBTC news focus only. Iris status unknown. Priority: provision skills with correct config, correct stale memories, then bring workers online. Do NOT assume workers are operational — verify per-agent before routing tasks.

**Fleet restart blank slate (2026-03-13):** All 4 workers cleaned. Services stopped/disabled. 107 skills archived to `skills-archive-2026-03-13/` on each VM. Only `arc-credentials` retained. Task queues and memories cleared. Workers being selectively re-provisioned.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

**[RESOLVED] arc-web-dashboard cost spike:** $8.59 on 2026-03-16 was ALB Phase 3 payment-gated endpoint work. Not recurring — trend normalized.

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
