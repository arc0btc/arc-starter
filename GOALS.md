# Goals

*Shared roadmap for whoabuddy and Loom. Review monthly. Update as decisions land.*
*Last reviewed: 2026-03-09*

---

## Directives

Standing orders. These don't expire — they define what Loom optimizes for.

| # | Directive | Owner |
|---|-----------|-------|
| D1 | **Integration is the product.** Loom builds the connective tissue: API clients, protocol bridges, data pipelines. Working connections over beautiful abstractions. | both |
| D2 | **Grow the AIBTC network.** Contribute protocol integrations, publish integration research, support ecosystem builders, file quality signals. | both |
| D3 | **Ship integrations continuously.** Prioritize rough-but-working over perfect-but-pending. Sensor coverage and skill quality improve iteratively. | Loom |
| D4 | **Operate within budget.** $200/day cap. Cost efficiency is a feature, not a constraint. | Loom |
| D5 | **Honest integration work.** No phantom results. If an API call fails or a protocol is unreachable, say so precisely. Verifiable outputs only. | both |

---

## Milestones

Concrete outcomes we're working toward. Move to "Done" when complete.

### Active

- [ ] **Zest V2 integration.** DeFi skill for Zest Protocol lending/borrowing on Stacks.
- [ ] **Bitflow integration.** DEX skill for Bitflow swaps and liquidity.
- [ ] **MCP server (Phase 1).** Local HTTP server exposing task queue + skill tree. Foundation for external integrations.
- [ ] **ERC-8004 complete.** Set URI, link wallet, deploy reputation sensor. Loom's on-chain identity fully operational.
- [ ] **Fleet support layer.** Skills and sensors that serve Arc and other fleet agents — shared infrastructure Loom owns.

### Done

- [x] 3-tier model routing (P1-4 Opus, P5-7 Sonnet, P8+ Haiku)
- [x] Safety layers (syntax guard + post-commit health + worktree isolation)
- [x] ERC-8004 agent registration (wrappers: identity, reputation, validation)
- [x] Skills audit — 76 skills, 35 Loom-relevant identified
- [x] Fleet health sensor active

---

## Active Priorities

What to focus on *right now*, in rough order. Dispatch should prefer tasks aligned with these.

1. **DeFi integrations.** Zest V2 and Bitflow skills unblock on-chain activity beyond stacking.
2. **MCP server.** Exposes Loom's task queue and skill tree to external systems — enables cross-agent coordination.
3. **Fleet support.** Skills, sensors, and data pipelines that serve fleet-wide needs.
4. **Stack reliability.** Cost optimization, sensor health, dispatch resilience.

---

## Blocked / Waiting

| Item | Blocker | Since |
|------|---------|-------|
| Spark GitHub presence | GitHub restriction permanent. Awaiting whoabuddy decision on path forward. | 2026-03-02 |

---

## How to Use This File

- **whoabuddy:** Edit directives and milestones directly. Push or tell Loom to update.
- **Loom:** Reference during dispatch to evaluate task relevance. Propose milestone additions via tasks. Never modify directives without whoabuddy's input.
- **Format:** Keep under 100 lines. Milestones move from Active to Done. Priorities reorder as work shifts. Monthly review keeps it current.
