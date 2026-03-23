---
name: clarity-patterns
description: Clarity smart contract pattern library — SIP-010, SIP-009, access control, upgrades, and more
updated: 2026-03-23
tags:
  - clarity
  - smart-contracts
  - patterns
  - stacks
  - sip-010
  - sip-009
---

# clarity-patterns

Pattern library for common Clarity smart contract idioms. Covers SIP-010 fungible tokens, SIP-009 NFTs, trait definitions, access control, upgradeable contracts, and safety patterns.

## What This Skill Does

Provides reference implementations and code snippets for:
- **Tokens:** SIP-010 FT, SIP-009 NFT, allowance/approve
- **Traits:** definition, implementation, inter-contract calls
- **Access control:** owner-only, role-based, multisig N-of-M
- **Upgrades:** proxy pattern, data/logic separation
- **Safety:** pausable, reentrancy guard, error constants, event emission

All patterns are aligned with clarity-check rules — no deprecated functions, no anti-patterns.

## CLI Commands

```
arc skills run --name clarity-patterns -- list
arc skills run --name clarity-patterns -- categories
arc skills run --name clarity-patterns -- show --pattern sip-010-ft
arc skills run --name clarity-patterns -- search --tag sip-010
arc skills run --name clarity-patterns -- suggest --use-case "fungible token with minting"
```

Direct:
```
bun skills/clarity-patterns/cli.ts list
bun skills/clarity-patterns/cli.ts categories
bun skills/clarity-patterns/cli.ts show --pattern sip-010-ft
bun skills/clarity-patterns/cli.ts search --tag access-control
bun skills/clarity-patterns/cli.ts suggest --use-case "NFT marketplace"
```

## Output

JSON with `success` and relevant data. `show` returns `pattern` object with `id`, `name`, `category`, `tags`, `description`, `code`, `notes`, `antiPatternAlignment`.

## Pattern Index

| ID | Category | Description |
|----|----------|-------------|
| `sip-010-ft` | tokens | SIP-010 fungible token minimal implementation |
| `sip-009-nft` | tokens | SIP-009 NFT minimal implementation |
| `ft-allowance` | tokens | FT with allowance / approve pattern |
| `trait-definition` | traits | Define a trait in a dedicated contract |
| `trait-implementation` | traits | Implement a trait with `impl-trait` |
| `owner-only` | access-control | Owner guard with transferable ownership |
| `role-based` | access-control | Multi-role access with a roles map |
| `multisig` | access-control | N-of-M multisig approval |
| `proxy-upgrade` | upgrades | Thin proxy pointing at upgradeable implementation |
| `data-logic-separation` | upgrades | Separate data/logic contracts for upgrades |
| `pausable` | safety | Pause/unpause circuit breaker |
| `reentrancy-guard` | safety | Guard against recursive re-entry |
| `error-constants` | safety | Standard error code conventions |
| `event-emission` | safety | Structured print events |

## When to Load

Load when: writing or reviewing Clarity contracts, scaffolding new tokens or traits, or auditing for best-practice alignment. Part of the Clarity dev skill chain: clarity-check → **clarity-patterns** → clarity-audit → clarity-scaffold.

## Checklist

- [x] `skills/clarity-patterns/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
- [ ] `AGENT.md` — add when subagent delegation needed
- [ ] `sensor.ts` — add when auto-scanning repos for pattern gaps
