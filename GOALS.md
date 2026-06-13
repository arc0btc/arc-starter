# Goals

*Shared roadmap for whoabuddy and Arc. Review monthly. Update as decisions land.*
*Last reviewed: 2026-06-13*

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

- [ ] **Revenue: Whop monetization.** hash-it-out shop live. Phase 1 (reactive lane) active since 2026-06-12. Phase 2 (synthesis) in dry-run — awaiting voice review + whoabuddy sign-off before go-live. Goal: prove $50/mo subscription value.
- [ ] **Content calendar.** 17 ContentCalendarMachine instances ready, staggered 1/day from 2026-06-13. Dormant — awaiting `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + whop clean-post + sign-off.
- [ ] **Zest V2 integration.** Bounty submission active (closes 2026-06-16). DeFi skill for Zest Protocol lending/borrowing.
- [ ] **Bitflow integration.** DEX skill for Bitflow swaps and liquidity.
- [ ] **Zero Authority DAO.** Design and deploy Arc's governance structure.
- [ ] **ERC-8004 complete.** Set URI, link wallet, deploy reputation sensor.
- [x] **MCP server (Phase 1).** Local HTTP server exposing task queue + skill tree.

### Done

- [x] arc0me-site live — PR #8 (blog content branch) + PR #9 (whop routes) merged and deployed (2026-06-13)
- [x] 3-tier model routing (P1-4 Opus, P5-7 Sonnet, P8+ Haiku)
- [x] Multisig capability (BIP-340/342, 2-of-2 and 3-of-3 proven)
- [x] Brand voice audit and X comeback
- [x] ERC-8004 agent registration (agent 1 on mainnet)
- [x] 68+ sensors, 100+ skills installed
- [x] Safety layers (syntax guard + post-commit health + worktree isolation)
- [x] X cadence active (@arc0btc, 12h beat, AI-prefers-Bitcoin theme)

---

## Active Priorities

What to focus on *right now*, in rough order. Dispatch should prefer tasks aligned with these.

1. **Whop monetization.** Phase 1 live, Phase 2 dry-run. Get first clean synthesis post through voice review → flip dry-run off. Laser focus on $50/mo value.
2. **Content calendar.** 17 instances ready. Un-gate after whop clean-post confirmed + sign-off.
3. **DeFi integrations.** Zest V2 (bounty closes 2026-06-16) + Bitflow skills.
4. **AIBTC contributions.** PR reviews, ecosystem engagement, signal filing (paused — re-enable when policy lifts).
5. **Stack reliability.** Cost optimization (target <$0.40/task), sensor health, dispatch resilience.

---

## Blocked / Waiting

| Item | Blocker | Since |
|------|---------|-------|
| Signal filing | Paused by whoabuddy policy (EIC stepped down). Re-enable: grep `SIGNAL_FILING_DISABLED` and flip false. | 2026-05-19 |
| Spark GitHub presence | GitHub restriction permanent. Awaiting whoabuddy decision. | 2026-03-02 |

---

## How to Use This File

- **whoabuddy:** Edit directives and milestones directly. Push or tell Arc to update.
- **Arc:** Reference during dispatch to evaluate task relevance. Propose milestone additions via tasks. Never modify directives without whoabuddy's input.
- **Format:** Keep under 100 lines. Milestones move from Active to Done. Priorities reorder as work shifts. Monthly review keeps it current.
