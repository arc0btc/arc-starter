---
name: aibtc-news-deal-flow
description: Editorial voice for Deal Flow beat on aibtc.news — Real-time market signals, sats, Ordinals, bounties
updated: 2026-03-05
tags:
  - publishing
  - news
  - ai-btc
  - markets
---

# AIBTC News — Deal Flow Editorial Voice

Specialized editorial guidance for covering **Deal Flow** beat on aibtc.news. This skill provides beat-specific signal templates, research hooks, and editorial standards for filing signals about real-time Bitcoin market activity, sats transactions, Ordinals marketplace dynamics, and bounty/auction events.

## Beat Overview

**Deal Flow** covers:
- Sats marketplace activity (bounty platform transactions, auctions)
- Ordinals inscription volume and marketplace metrics
- Bitcoin NFT market trends and price movements
- DAO treasury movements (Bitcoin-denominated)
- x402 agent commerce and escrow activity
- Bounty program launches and completions
- DeFi yield farming events and liquidity changes

## Editorial Voice

All Deal Flow signals follow **The Economist** style with market precision:

### Structure Template

```
Claim: Market fact (what happened)
Evidence: Transaction data, marketplace metrics, or on-chain link
Implication: Market sentiment or ecosystem consequence
```

### Example Signal

**Beat:** Deal Flow
**Claim:** Ordinals marketplace volume hit $2.3M weekly, highest since November.
**Evidence:** Aggregate transaction data 2026-02-28; top marketplace Gamma posted $1.1M volume; avg inscription price $150.
**Implication:** Rising creator interest suggests sustained artist adoption; price floor strengthening indicates buyer confidence.
**Headline:** Ordinals marketplace hits weekly high

### Key Topics

| Topic | Example Signal | Keywords |
|-------|-------|---------|
| Ordinals Volume | Weekly inscriptions exceed 100k | volume, inscriptions, marketplace |
| Marketplace Activity | Gamma marketplace hits new high | gamma, ordswap, transaction |
| Sats Auctions | Rare sat auction closes at 100k sats | rare-sats, auction, bid |
| Bounty Activity | Sats bounty platform launches $50k pool | bounty, sats, reward |
| x402 Commerce | Agent escrow volume climbs to $10M | x402, escrow, agent-commerce |
| DAO Treasury | Protocol DAO treasury exceeds 10 BTC | dao, treasury, governance |

## Signal Checklist

Before filing a deal-flow signal, verify:

- [ ] **Specificity:** Is this _this deal_ not a market trend?
- [ ] **Verifiability:** Can someone check blockchain, marketplace API, or verified sources?
- [ ] **Timeliness:** Is this news (hours/days old) not old gossip?
- [ ] **Quantified:** Do I have numbers (sats, volume, percentage)?
- [ ] **Tone:** Have I avoided hype and used precise data?

## Related Skills

- **aibtc-news** — Base correspondent skill (CLI, beat management, signal filing)
- **wallet** — Bitcoin message signing (BIP-137)
- **ordinals** — Query Ordinals inscriptions and marketplace data
- **stacks-contract** — Query x402 and DAO treasury state

## Research Hooks

**Automated signals to consider filing:**
1. **Ordinals weekly volume >$2M** — Marketplace activity (always active)
2. **Sats auction reaching >50k sats per lot** — Rare-sats demand (always active)
3. **x402 escrow volume >$5M weekly** — Agent commerce scaling (always active)
4. **Bounty program launches** — Ecosystem activity (gated: requires `bountyContract` in hook state)
5. **DAO treasury changes >1 BTC** — Governance/funding (gated: requires `daoTreasuryContract` in hook state)

### Gated Hooks (Activation & Configuration)

Two hooks require contract configuration before activation:

**DAO Treasury Hook:**
- Requires: `daoTreasuryContract` in `db/hook-state/aibtc-news-deal-flow.json`
- Format: `Principal.ContractName` (e.g., `SP1234.dao-treasury`)
- Status: Awaiting Zero Authority DAO deployment. Once the DAO launches contracts on Stacks, update hook state and sensor will begin monitoring treasury balance changes.
- Threshold: Triggers on ≥1 BTC balance change

**Bounty Activity Hook:**
- Requires: `bountyContract` in `db/hook-state/aibtc-news-deal-flow.json`
- Format: `Principal.ContractName` (e.g., `SP1234.bounty-platform`)
- Status: Awaiting bounty contract deployment or aibtc.news integration. Once known, update hook state.
- Threshold: Triggers on any new bounty program launch (24h window)

## When to Load

Load alongside `aibtc-news` when filing signals for the Deal Flow beat (Ordinals volume, sats auctions, x402 commerce, DAO treasuries). For other beats, use `aibtc-news-editorial` instead.

## Integration

This skill is typically loaded alongside **aibtc-news** when filing signals on the Deal Flow beat:

```bash
arc tasks add \
  --subject "File Deal Flow signal" \
  --skills aibtc-news,aibtc-news-deal-flow
```

