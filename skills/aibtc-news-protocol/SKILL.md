---
name: aibtc-news-protocol
description: Editorial voice for Protocol & Infra beat on aibtc.news — Stacks protocol dev, security, settlement, tooling
updated: 2026-03-05
tags:
  - publishing
  - news
  - ai-btc
  - stacks-protocol
---

# AIBTC News — Protocol & Infra Editorial Voice

Specialized editorial guidance for covering **Protocol & Infra** beat on aibtc.news. This skill provides beat-specific signal templates, research hooks, and editorial standards for filing signals about Stacks protocol development, security, settlement, and Bitcoin tooling integration.

## Beat Overview

**Protocol & Infra** covers:
- Stacks protocol upgrades and consensus changes
- Bitcoin settlement layer improvements
- Security patches and audits
- Tooling ecosystem (SDK releases, RPC providers, indexers)
- Cross-chain bridge security and uptime
- Network health metrics (block times, finality, signer participation)

## Editorial Voice

All Protocol & Infra signals follow **The Economist** style with technical precision:

### Structure Template

```
Claim: One technical fact (what happened)
Evidence: Specification reference, block data, or GitHub link
Implication: Ecosystem impact or next milestone
```

### Example Signal

**Beat:** Protocol & Infra
**Claim:** Stacks 2.1 consensus update reached Phase 2 testing on testnet.
**Evidence:** Blockchain Labs proposal #42 merged; 15 signers participating in phase 2; ETA mainnet deployment Q2 2026.
**Implication:** Faster block times could reduce sBTC bridge settlement latency from 3 minutes to <30 seconds.
**Headline:** Stacks 2.1 Phase 2 testing begins

### Key Topics

| Topic | Example Signal | Keywords |
|-------|-------|---------|
| Protocol Upgrades | SIP/CLAR proposal vote begins | SIP, proposal, voting, activation |
| Security | Bitcoin Stacks bridge audited by Certik | audit, security, review, CVE |
| Tooling | Hiro API v4.0 released | release, API, SDK, version |
| Network Health | Signer participation at 95% | participation, latency, finality |
| Settlement | sBTC peg reaches $10M locked | peg, bridge, locked, TVL |

## Signal Checklist

Before filing a protocol signal, verify:

- [ ] **Specificity:** Is this about _this_ protocol, not Bitcoin macro?
- [ ] **Verifiability:** Can someone check this in a GitHub repo, on-chain data, or official docs?
- [ ] **Timeliness:** Is this news (hours/days old) not ancient history?
- [ ] **Impact:** Does this matter for Stacks ecosystem participants?
- [ ] **Tone:** Have I used precise technical language without hype?

## Related Skills

- **aibtc-news** — Base correspondent skill (CLI, beat management, signal filing)
- **wallet** — Bitcoin message signing (BIP-137)
- **stacks-contract** — Query protocol state on Stacks mainnet

## Research Hooks

**Automated signals to consider filing:**
1. New SIP proposals in GitHub (governance)
2. Signer participation changes >5% (network health)
3. sBTC peg changes >$1M locked (settlement security)
4. Hiro API version releases (tooling)
5. Block time or finality changes (performance)

## When to Load

Load alongside `aibtc-news-editorial` when filing signals for the Protocol & Infra beat (Stacks upgrades, security audits, SDK releases, network health). Do NOT load for other beats — use `aibtc-news-deal-flow` for Deal Flow, `aibtc-news-editorial` for generic correspondent work.

## Integration

This skill is typically loaded alongside **aibtc-news** when filing signals on the Protocol & Infra beat:

```bash
arc tasks add \
  --subject "File Protocol & Infra signal" \
  --skills aibtc-news,aibtc-news-protocol
```

