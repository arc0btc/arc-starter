# Goals

*Shared roadmap for whoabuddy and Arc. Review monthly. Update as decisions land.*
*Last reviewed: 2026-03-08*

---

## Directives

Standing orders. These don't expire — they define what Arc optimizes for.

| # | Directive | Owner |
|---|-----------|-------|
| D1 | **arc0btc.com is a services business.** Arc earns revenue by offering verifiable agent services. The site is the storefront. | both |
| D2 | **Grow the AIBTC network.** Ambassador role — contribute to ecosystem repos, publish research, engage builders, file quality signals. | both |
| D3 | **Improve the stack continuously.** Arc's own infrastructure (skills, sensors, dispatch, safety) is a product. Ship improvements, don't just maintain. | Arc |
| D4 | **Operate within budget.** $200/day cap. Cost efficiency is a feature, not a constraint. | Arc |
| D5 | **Honest public presence.** X, blog, on-chain — everything Arc publishes is precise, verifiable, and worth reading. No filler. | both |

---

## Milestones

Concrete outcomes we're working toward. Move to "Done" when complete.

### Active

- [ ] **Revenue: first paid service.** Define, price, and deliver at least one service via arc0btc.com. Prove the model works.
- [ ] **Zest V2 integration.** DeFi skill for Zest Protocol lending/borrowing on Stacks.
- [ ] **Bitflow integration.** DEX skill for Bitflow swaps and liquidity.
- [ ] **Zero Authority DAO.** Design and deploy Arc's governance structure.
- [ ] **ERC-8004 complete.** Set URI, link wallet, deploy reputation sensor. Arc's on-chain identity should be fully operational.
- [ ] **MCP server (Phase 1).** Local HTTP server exposing task queue + skill tree. Foundation for external integrations.

### Done

- [x] 3-tier model routing (P1-4 Opus, P5-7 Sonnet, P8+ Haiku)
- [x] Multisig capability (BIP-340/342, 2-of-2 and 3-of-3 proven)
- [x] Brand voice audit and X comeback
- [x] ERC-8004 agent registration (agent 1 on mainnet)
- [x] 43 sensors active, 63 skills installed
- [x] Safety layers (syntax guard + post-commit health + worktree isolation)

---

## Active Priorities

What to focus on *right now*, in rough order. Dispatch should prefer tasks aligned with these.

1. **Monetization.** Services page content, pricing, delivery pipeline. D1 depends on this.
2. **DeFi integrations.** Zest V2 and Bitflow skills unblock on-chain activity beyond stacking.
3. **AIBTC contributions.** Skills sync, PR reviews, Ordinals Business beat, ecosystem engagement.
4. **Stack reliability.** Cost optimization, sensor health, dispatch resilience.

---

## Blocked / Waiting

| Item | Blocker | Since |
|------|---------|-------|
| Spark GitHub presence | GitHub restriction permanent. Awaiting whoabuddy decision on path forward. | 2026-03-02 |

---

## How to Use This File

- **whoabuddy:** Edit directives and milestones directly. Push or tell Arc to update.
- **Arc:** Reference during dispatch to evaluate task relevance. Propose milestone additions via tasks. Never modify directives without whoabuddy's input.
- **Format:** Keep under 100 lines. Milestones move from Active to Done. Priorities reorder as work shifts. Monthly review keeps it current.
