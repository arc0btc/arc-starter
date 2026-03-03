# Arc Archive — Historical Milestones & Reference Data

*Historical context and snapshot data. Link: [MEMORY.md](MEMORY.md)*

## Upstream Release: aibtcdev/skills v0.12.0 (2026-03-02 20:45Z)

**Released:** 2026-03-02T17:28:28Z

Two new skills published:
1. **business-dev** (PR #65) — Enterprise CRM/sales pipeline
   - 7-stage pipeline: Research→Contacted→Qualified→Solution→Negotiating→Closed→Retained
   - 5 sales frameworks: SPIN, Challenger, Sandler, Solution, MEDDIC
   - BIP-137 signed x402 messaging, external sales via GitHub
   - Requires: wallet skill + x402
   - Guidelines: max 3 cold msgs/day, max 7 touches/prospect, max 1000 sats/prospect
   - Energy allocation: 30% close qualified, 25% follow-up warm, 20% new discovery, 15% build free tools, 10% cold outreach

2. **ceo** (PR #67) — Operator manual (Arc maintains local copy, published upstream)

**Config update (PR #63):** aibtc-agents/arc0btc/README.md documents Arc's v5 architecture (29 skills, 24 sensors). Arc is reference agent in aibtcdev/skills.

**Impact:** Zero breaking changes. business-dev ready for partnership workflows when Arc pivots to revenue generation.

## On-Chain Balances (2026-03-01 20:12Z, task #542)

**Mainnet check via Hiro API:**

| Asset | Balance | Address / Note |
|-------|---------|----------------|
| BTC | 546 sats | L1 native SegWit: bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| STX | 90.671151 STX | 90,671,151 μSTX (↑ 0.001151 from baseline) |
| sBTC | 8,200 sats | Token balance (↓ 300 from baseline — gas/tx costs) |
| LEO | 25,000,000,000 | 25B (unchanged) |
| WELSH | 500,000,000,000 | 500B (unchanged) |
| stSTX | 100,000,000 | 100M (unchanged) |
| NFTs | agent-identity (1), BNS-V2 (1) | Unchanged |

**Summary:** All accounts active on mainnet. Minor balances stable. Core assets sufficient for operations.

## GitHub Restrictions Resolution (2026-03-02T18:03Z)

**Finding:** spark0btc GitHub account permanently restricted (GitHub Support final denial).

**Reason:** GitHub Actions used for incentivized/3rd-party activity (Additional Product Terms violation).

**Impact:**
- PR #16 (aibtcdev/worker-logs) permanently blocked — whoabuddy must merge directly
- Spark cannot have GitHub presence via spark0btc
- Tasks #271/#629/#630 recovery path closed

**Escalation:** Task #680 (P2) sent to whoabuddy 2026-03-02T18:28Z with options:
- (a) new GitHub account
- (b) Spark GitHub-free / AIBTC-only **(Recommended)**
- (c) collaborator under different name

**Status:** Task #630 closed as failed. Awaiting whoabuddy decision. Agent addresses still needed for x402 messaging (task #661).

## Queued Integrations (as of 2026-03-02)

- Bitflow (DEX aggregator on Stacks) — signal filing + DCA automation
- Zest V2 (Bitcoin-native lending on Stacks) — sBTC yield farming (mainnet launch pending)
- Zero Authority DAO — Bitcoin reputation layer

See `research/` directory for full analysis of Bitflow and Zest V2.
