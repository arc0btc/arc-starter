# cryptoskill: AIBTC Repo Additions — Draft v3

*Revised 2026-03-21. Feedback applied — filing PRs (excluding erc-8004-indexer).*

---

## Repo Structure

cryptoskill organizes skills into categories: `skills/<category>/<slug>/`
Each entry requires two files:
- `SKILL.md` (YAML frontmatter + markdown body)
- `SOURCE.md` (attribution + classification)

Categories: exchanges, defi, mcp-servers, chains, analytics, trading, identity, payments, wallets, dev-tools, prediction-markets, ai-crypto, social

---

## Recommended Additions (6 skills)

| # | Path | Repo | Status |
|---|------|------|--------|
| 1 | `mcp-servers/aibtc-bitcoin-mcp` | aibtcdev/aibtc-mcp-server | Ready |
| 2 | `ai-crypto/aibtcdev-skills` | aibtcdev/skills | Ready |
| 3 | `payments/stacks-x402-relay` | aibtcdev/x402-sponsor-relay | Ready |
| 4 | `identity/aibtc-erc8004-indexer` | aibtcdev/erc-8004-indexer | Coming soon |
| 5 | `social/aibtc-agent-news` | aibtcdev/agent-news | Ready |
| 6 | `ai-crypto/loop-starter-kit` | aibtcdev/loop-starter-kit | Ready |

---

## Draft File Contents

---

### FILE: skills/mcp-servers/aibtc-bitcoin-mcp/SKILL.md

```markdown
---
name: aibtc-bitcoin-mcp
description: "Bitcoin-native MCP server with an encrypted on-disk wallet and 300+ tools across Bitcoin L1, Stacks L2, sBTC, DeFi (Bitflow/Zest/ALEX), ordinals, runes, x402 payments, BNS domains, and cryptographic signature-as-identity."
---

# AIBTC Bitcoin MCP Server

A single-install MCP server that gives any MCP-compatible client a Bitcoin-native encrypted wallet and access to 300+ tools spanning Bitcoin L1, Stacks L2, and the broader Bitcoin DeFi ecosystem. Available on npm as [@aibtc/mcp-server](https://www.npmjs.com/package/@aibtc/mcp-server).

Signature is identity — every tool that touches the chain signs with the agent's key, making cryptographic proof of authorship a first-class primitive for agent-to-agent and agent-to-service interactions.

## Install

For Claude Code:

```bash
claude mcp add aibtc-bitcoin-mcp -- npx @aibtc/mcp-server
```

For Claude Desktop (claude_desktop_config.json):

```json
{
  "mcpServers": {
    "aibtc-bitcoin-mcp": {
      "command": "npx",
      "args": ["@aibtc/mcp-server"]
    }
  }
}
```

Works with any tool that supports the Model Context Protocol. The AIBTC skills library (aibtcdev/skills) provides a nearly complete mapping to MCP as an alternative integration path.

## Tool Categories

| Category | Tools | Examples |
|----------|-------|---------|
| Wallet | 13 | Create, unlock, import, export, balance — encrypted on disk, password provided to agent for auto operations |
| Bitcoin L1 | 7 | Send BTC, PSBT construction, UTXO selection, balance |
| Mempool | 3 | Fee estimates, transaction status, block info (Bitcoin L1 and Stacks L2) |
| Ordinals & Inscriptions | 8 | Inscribe, transfer, marketplace queries, parent/child inscription support |
| Runes | — | Rune metadata parsed within inscription data (rune field returned on inscription queries) |
| Stacks | 6 | Send/receive STX, call contracts, read state, transaction broadcast |
| sBTC | 10 | Peg-in, peg-out, balance, Styx BTC↔sBTC conversion |
| SIP-010 Tokens | 5 | Transfer, balance, metadata — implements the SIP-010 fungible token standard |
| SIP-009 NFTs | 6 | List, transfer, floor prices — implements the SIP-009 non-fungible token standard |
| Stacking / PoX | 8 | Stack STX, check status, rewards, dual stacking — Proof-of-Transfer consensus |
| BNS | 9 | Resolve names, register, lookup — Bitcoin Name System standard |
| ALEX DEX | — | Swap, quote, pools (via DeFi category) |
| Zest Protocol | — | Supply, borrow, repay, health factor (via DeFi category) |
| Bitflow DEX | 11 | Swap, quote, liquidity, token discovery |
| DeFi | 10 | ALEX + Zest Protocol lending/borrowing |
| Pillar Smart Wallet | 39 | WebAuthn/passkey-signed operations (handoff model) + direct agent-signed mode |
| x402 Payments | 5 | Pay endpoints, verify receipts, scaffold endpoints — AIBTC operates its own facilitator |
| Yield Hunter | 4 | Autonomous sBTC yield farming — auto-deposits to DeFi protocols (Zest) when wallet balance exceeds threshold |
| Signing & Verification | 10 | SIP-018 structured data, Bitcoin wallet signatures, Schnorr signatures |
| ERC-8004 Identity | 7 | Cross-chain agent identity registration and reputation |
| Jingswap Auction | 15 | STX/sBTC blind auction platform |
| Nostr | 7 | Decentralized social messaging |
| Stacks Market | 11 | Prediction market trading |

**Total: 300+ tools across 30+ categories.**

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| NETWORK | `mainnet` or `testnet` (env var, not CLI flag) | `mainnet` |
| API_URL | x402 API base URL — any of the three production endpoints | `https://x402.biwas.xyz` |
| CLIENT_MNEMONIC | Alternative path: pre-configured 24-word BIP-39 wallet mnemonic. The recommended default is the encrypted credential store (agent creates wallet, master password protects it on disk). Use this env var only when you need a pre-existing mnemonic imported at startup. | (none) |
| HIRO_API_KEY | Stacks API rate limit upgrade from [platform.hiro.so](https://platform.hiro.so) | (optional) |

## Networks

Bitcoin mainnet, Bitcoin testnet, Stacks mainnet, Stacks testnet.
```

---

### FILE: skills/mcp-servers/aibtc-bitcoin-mcp/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: aibtc-mcp-server
- **Source**: https://github.com/aibtcdev/aibtc-mcp-server
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

### FILE: skills/ai-crypto/aibtcdev-skills/SKILL.md

```markdown
---
name: aibtcdev-skills
description: "TypeScript skill library with 30+ self-contained modules for autonomous Claude Code agents on Bitcoin L1 + Stacks L2, covering wallets, DeFi, ordinals, x402 payments, ERC-8004 identity, and AI agent news."
---

# aibtcdev Skills Library

A collection of 30+ Bun-based TypeScript skill modules for autonomous AI agents operating in the Bitcoin ecosystem. Provides a nearly complete mapping to the AIBTC MCP server — same capabilities, optimized for Claude Code's agent architecture.

Signature is identity — skills that interact on-chain sign with the agent's key, enabling cryptographic proof of authorship as a core primitive for services, payments, and inter-agent trust.

## Install

```bash
git clone https://github.com/aibtcdev/skills.git
cd skills
bun install
```

## Skills by Domain

**Bitcoin L1:** btc, ordinals, ordinals-p2p, signing, taproot-multisig

**Stacks L2:** stx, sbtc, styx, tokens (SIP-010 fungible token standard), nft (SIP-009 non-fungible token standard), bns (Bitcoin Name System), stacking (Proof-of-Transfer / PoX), query

**DeFi:** bitflow (Bitflow DEX swaps), defi (ALEX DEX + Zest Protocol lending), stacks-market (prediction markets / price feeds), stacking-lottery, stackspot, dual-stacking, pillar (WebAuthn/passkey smart wallet), yield-hunter (autonomous DeFi yield farming), yield-dashboard

**ERC-8004 Identity:** identity (register/lookup), reputation (score/attest), validation (verify agents)

**Payments:** x402 (pay/verify/request), credentials (encrypted key store)

**Agent Intelligence:** aibtc-news (signals/briefs), aibtc-news-classifieds, aibtc-news-deal-flow, aibtc-news-protocol, onboarding, nostr, business-dev, ceo

**Wallet:** wallet (create/import/balance), settings

## Usage Pattern

Each skill is self-contained with a consistent structure:

- **SKILL.md** — Orchestrator context: what the skill does, CLI syntax, composability, data schemas. Loaded into the dispatch context when a task references this skill.
- **AGENT.md** — Subagent briefing: detailed execution instructions. Passed to subagents for heavy work delegation, never loaded into the orchestrator's own context.
- **CLI** — Every skill exposes commands via a consistent interface: `bun run skills/<name>/cli.ts <command> [--flags]`. All actions are CLI-first — if a capability doesn't have a CLI command, it doesn't exist yet.

This pattern enables lean orchestration: the orchestrator reads SKILL.md for context, delegates to subagents that receive AGENT.md for execution depth.

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| NETWORK | `mainnet` or `testnet` | `testnet` |
| HIRO_API_KEY | Optional, stored at `~/.aibtc/config.json` from [platform.hiro.so](https://platform.hiro.so) | (none) |

Wallet password required for transaction skills (not stored in env).

## Mainnet-only Skills

bitflow, defi (Zest/ALEX), stacks-market, stacking-lottery, dual-stacking

## Note on Tool Count

The repository contains 30+ skill directories, each with its own SKILL.md. The `bun install` output showing "91 installs across 92 packages" refers to npm dependencies, not skill count.
```

---

### FILE: skills/ai-crypto/aibtcdev-skills/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: aibtcdev-skills
- **Source**: https://github.com/aibtcdev/skills
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

### FILE: skills/payments/stacks-x402-relay/SKILL.md

```markdown
---
name: stacks-x402-relay
description: "Stacks x402 payment facilitator and transaction sponsor relay — supports x402 v2 transactions, general sponsored transactions via API key/signature, and sponsored x402 payments. One of two facilitators on Stacks."
---

# Stacks x402 Sponsor Relay

A relay service that performs three functions for AI agents on Stacks L2:

1. **x402 v2 transaction support** — Process x402 payment protocol transactions on Stacks
2. **General transaction sponsorship** — Sponsor any Stacks transaction via API key or cryptographic signature, enabling gasless L2 operations for agents
3. **Sponsored x402 payments** — Combine sponsorship with x402 payment flow for fee-free protocol payments

AIBTC operates one of two x402 facilitators in the Stacks ecosystem. The other is [stacksx402.com](https://stacksx402.com) (x402Stacks).

## Production Endpoints

All three endpoints are live and verified:

| Service | URL | Environment |
|---------|-----|-------------|
| biwas | https://x402.biwas.xyz | Production (mainnet) |
| aibtc | https://x402.aibtc.com | Production (mainnet) |
| aibtc testnet | https://x402.aibtc.dev | Staging (testnet) |
| stx402 | https://stx402.com | Production (mainnet) |

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /relay | None | Submit sponsored transactions |
| POST | /sponsor | Bearer API key or signature | Sponsor + broadcast directly |
| GET | /verify/:receiptId | None | Check payment receipt status |
| POST | /access | None | Access resources with x402 receipt |
| GET | /health | None | Service status |

## Rate Limits

| Tier | Rate |
|------|------|
| Free (no key) | 10 req/min per sender address |
| Standard (API key) | 60 req/min |
| Unlimited | No limit |

## Configuration (self-hosted)

| Env Var | Description |
|---------|-------------|
| AGENT_MNEMONIC | Sponsor wallet mnemonic |
| AGENT_PRIVATE_KEY | Alternative: sponsor wallet private key |

## Networks

Stacks mainnet and testnet.
```

---

### FILE: skills/payments/stacks-x402-relay/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: stacks-x402-relay
- **Source**: https://github.com/aibtcdev/x402-sponsor-relay
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

### FILE: skills/identity/aibtc-erc8004-indexer/SKILL.md

```markdown
---
name: aibtc-erc8004-indexer
description: "Cloudflare D1 indexer that tracks ERC-8004 agent identity registry events on Stacks mainnet, providing a queryable REST API for agent registration data. Coming soon."
---

# AIBTC ERC-8004 Indexer

> **Status: Coming soon.** The indexer is built and ready for deployment but not yet live. It will be brought online shortly.

A Cloudflare Worker that indexes ERC-8004 Agent Identity Registry events from Stacks mainnet into a D1 (SQLite) database. Updates every 6 hours via cron. Monitors the identity-registry-v2 contract.

ERC-8004 is the de-facto standard for on-chain agent identity, with 100,000+ agents registered across 30+ EVM chains. This indexer brings that identity layer to Stacks — enabling cross-chain agent verification via the same standard.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /agents | List registered agents (supports owner filtering) |
| GET | /agents/:id | Individual agent details |
| GET | /stats | Indexing stats and agent counts |
| GET | /health | Service status |

## Example Queries

```bash
# List all registered agents
curl https://erc8004.aibtc.com/agents

# Get a specific agent by ID
curl https://erc8004.aibtc.com/agents/1

# Filter by owner address
curl https://erc8004.aibtc.com/agents?owner=SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B
```

## Deploy (Self-Hosted)

```bash
git clone https://github.com/aibtcdev/erc-8004-indexer.git
cd erc-8004-indexer
bun install
wrangler deploy
```

Optional: set admin API key via `wrangler secret put ADMIN_KEY`.

## Networks

Stacks mainnet (identity-registry-v2 contract).
```

---

### FILE: skills/identity/aibtc-erc8004-indexer/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: aibtc-erc8004-indexer
- **Source**: https://github.com/aibtcdev/erc-8004-indexer
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

### FILE: skills/social/aibtc-agent-news/SKILL.md

```markdown
---
name: aibtc-agent-news
description: "Cloudflare Worker platform for AI agent-authored Bitcoin economic signals, classifieds, and correspondent reports — with Bitcoin wallet signature verification and beat-based editorial structure."
---

# AIBTC Agent News

A Cloudflare Worker + D1 platform where AI agents file economic signals, publish classifieds, and deliver correspondent reports about the Bitcoin ecosystem. All content is cryptographically signed with Bitcoin wallet signatures, tying every signal to a verified agent identity.

## Core Concepts

- **Signals** — Data-backed economic observations filed to editorial beats (e.g., ordinals, DeFi, macro). Each signal includes headline, claim, evidence, implication, sources, and agent disclosure.
- **Classifieds** — Agent-published listings (services, skills, requests) with signature-verified authorship.
- **Correspondents** — Registered agent-reporters assigned to beats, with reputation tracked by signal quality scores.

## API

Hosted at [aibtc.news](https://aibtc.news).

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/signals | List signals (filter by beat, agent, date) |
| POST | /api/signals | File a new signal (requires wallet signature) |
| GET | /api/classifieds | List classifieds |
| PATCH | /api/classifieds/:id | Update a classified (header-based auth) |
| GET | /api/correspondents | List registered correspondents |
| GET | /api/leaderboard | Signal quality scores and rankings |

## Filing a Signal

Signals require: `beat_slug`, `btc_address`, `headline`, `sources` (array of `{url, title}`), `tags`, and `disclosure` (model, tools, skills used). Signals are auto-signed with the agent's Bitcoin wallet before submission.

## Rate Limits

- 60 minutes cooldown per signal per beat
- 6 signals per day per agent

## Networks

Bitcoin mainnet (wallet signatures), Stacks mainnet (agent identity resolution).
```

---

### FILE: skills/social/aibtc-agent-news/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: aibtc-agent-news
- **Source**: https://github.com/aibtcdev/agent-news
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

### FILE: skills/ai-crypto/loop-starter-kit/SKILL.md

```markdown
---
name: loop-starter-kit
description: "Fork-ready autonomous agent loop template for building durable AI agents on Bitcoin — provides the core dispatch/sensor architecture used by AIBTC agents."
---

# Loop Starter Kit

A minimal, fork-ready template for building autonomous AI agents that run in a continuous loop. Provides the core architectural pattern used by AIBTC agents: sensor-driven task detection, priority-based dispatch, and durable execution with automatic recovery.

## Architecture

- **Sensors** — Fast, no-LLM detection layer. Each sensor monitors an external signal source and queues tasks when conditions are met.
- **Dispatch** — LLM-powered execution layer. Picks the highest-priority pending task, loads relevant context, and executes via Claude Code subprocess.
- **Task Queue** — SQLite-backed universal queue connecting sensors to dispatch. Everything is a task.

## Quick Start

```bash
git clone https://github.com/aibtcdev/loop-starter-kit.git
cd loop-starter-kit
bun install
cp .env.example .env  # configure your API keys
bun run start
```

## Use Cases

- Autonomous Bitcoin/Stacks agents
- Scheduled on-chain operations
- Market monitoring and signal detection
- Multi-agent fleet coordination

## Runtime

Bun (TypeScript). No Node.js dependency.
```

---

### FILE: skills/ai-crypto/loop-starter-kit/SOURCE.md

```markdown
# Source Attribution

- **Original Author**: aibtcdev
- **Original Slug**: loop-starter-kit
- **Source**: https://github.com/aibtcdev/loop-starter-kit
- **Website**: https://aibtc.com
- **License**: MIT
- **Classification**: OFFICIAL
```

---

## Changes from v1

| # | Feedback | Change |
|---|----------|--------|
| 1 | BTC L1 → Bitcoin L1, STX → Stacks | Network names used throughout; asset names (BTC, STX) only for the asset itself |
| 2 | Skills count: 35 → 30+ | Approximate count (matches MCP tool categories; each has a CLI) |
| 3 | MCP tool count: 150+ → 300+ | Approximate (accounts for missed server.registerTool entries and skill-mappings gaps) |
| 4 | Usage pattern section empty | Filled: SKILL.md + AGENT.md + consistent CLI pattern explained |
| 5 | x402 relay: three functions | Described: x402 v2 tx, general sponsorship, sponsored x402 |
| 6 | x402: three production endpoints | Listed all four URLs (3 mainnet + 1 testnet), all verified live |
| 7 | x402: one of two facilitators | Noted stacksx402.com / x402Stacks as the other |
| 8 | Ordinals: parent/child | Added: 3 dedicated tools for parent/child inscriptions |
| 9 | Runes | Clarified: rune metadata parsed within inscription queries, no dedicated rune-only tools |
| 10 | Pillar Wallet: webauthn/passkey | Added: WebAuthn/passkey signing (handoff model) + direct agent mode |
| 11 | Yield Hunter framing | Reframed: autonomous DeFi yield farming app using wallet + protocols |
| 12 | CLIENT_MNEMONIC purpose | Clarified as optional/alt-path; default is encrypted credential store with agent + master password |
| 13 | OFFICIAL classification | Changed from COMMUNITY to OFFICIAL, added aibtc.com website |
| 14 | erc-8004-indexer: coming soon | Kept in draft with prominent "Coming soon" banner |
| 15 | agent-news | Added as `social/aibtc-agent-news` — signal filing platform |
| 16 | loop-starter-kit | Added as `ai-crypto/loop-starter-kit` — autonomous agent template |
| 17 | Signature as identity | Made prominent theme in MCP description + skills library |
| 18 | Mempool: L1 or L2 | Noted in tool categories |
| 19 | SIP-010/SIP-009/Stacking/PoX/BNS as standards | Each now labeled as both contract and standard |
| 20 | ALEX/Zest/Bitflow as DeFi elements | Explicitly grouped under DeFi in skills library |
| 21 | Testnet: env var not CLI flag | Corrected: `NETWORK=testnet` env var |
| 22 | Replace BIP-137/BIP-322 language | All references changed to 'wallet signatures' or 'Bitcoin signatures' |
| 23 | Runes: canonical inscriptions package | GitHub issue opened to spec Paul Millr's package as canonical + implementation |
| 24 | Tool count precision | Changed 254 → 300+ (not exact — accounts for gaps) |
| 25 | Skills count precision | Changed 36 → 30+ (matches MCP tool categories) |
| 26 | CLIENT_MNEMONIC default path | Reframed as optional alt-path; encrypted credential store is recommended default |

## PR Approach

5 PRs filed (erc-8004-indexer deferred — not yet live):
1. `feat/add-aibtc-bitcoin-mcp`
2. `feat/add-aibtcdev-skills`
3. `feat/add-stacks-x402-relay`
4. `feat/add-aibtc-agent-news`
5. `feat/add-loop-starter-kit`
