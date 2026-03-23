---
name: clarity-check
description: Clarity contract syntax and pattern validation CLI
updated: 2026-03-23
tags:
  - clarity
  - smart-contracts
  - validation
  - stacks
---

# clarity-check

Static analysis tool for Clarity smart contracts. Validates syntax patterns, detects deprecated functions, and flags common anti-patterns without requiring a Stacks node or clarinet.

## What This Skill Does

Scans `.clar` files for:
- **Deprecated functions:** `define-fungible-token` (use `define-ft`), `ft-mint-event?`/`nft-mint-event?` (removed in Clarity 3)
- **Anti-patterns:** unbounded `fold`/`map` over user input, missing `asserts!`/`try!` on inter-contract calls, raw `unwrap-panic` in public functions
- **Style issues:** inconsistent naming (camelCase vs kebab-case), overly long function bodies

## CLI Commands

```
arc skills run --name clarity-check -- check --file path/to/contract.clar
arc skills run --name clarity-check -- check --dir path/to/contracts/
arc skills run --name clarity-check -- deprecations --file path/to/contract.clar
arc skills run --name clarity-check -- summary --dir path/to/contracts/
```

Direct:
```
bun skills/clarity-check/cli.ts check --file contract.clar
bun skills/clarity-check/cli.ts check --dir contracts/
bun skills/clarity-check/cli.ts deprecations --file contract.clar
bun skills/clarity-check/cli.ts summary --dir contracts/
```

## Output

JSON with `success`, `file`, `issues[]` (each: `rule`, `severity`, `line`, `message`, `suggestion`).

Severities: `error` (deprecated/removed functions), `warning` (anti-patterns), `info` (style).

## When to Load

Load when: reviewing Clarity contracts, auditing .clar files, or building/testing Stacks smart contracts. Part of the Clarity dev skill chain: clarity-check → clarity-patterns → clarity-audit → clarity-scaffold.

## Checklist

- [x] `skills/clarity-check/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
- [ ] `AGENT.md` — add when subagent delegation needed
- [ ] `sensor.ts` — add when auto-detection of .clar files in PRs needed
