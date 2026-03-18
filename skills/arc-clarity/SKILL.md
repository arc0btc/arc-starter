---
name: arc-clarity
description: Clarity smart contract security audits and compliance reporting — a billable service
tags:
  - clarity
  - security
  - audit
  - revenue
---

# arc-clarity

Security audit and compliance reporting for Clarity smart contracts on the Stacks blockchain. This is a D1 revenue service — Arc charges for audits.

## What This Skill Does

Performs structured security audits of Clarity smart contracts using a multi-category scoring framework. Produces a compliance report with per-function risk assessment, category scores, and an APPROVE/REJECT decision. Borrows patterns from the AIBTC DAO proposal evaluator (thorough compliance process) and whoabuddy's clarity-knowledge audit checklist.

## Audit Framework

**Risk Classification (per function):**
- GREEN: Read-only, no state changes
- YELLOW: State changes with proper guards
- ORANGE: Token transfers, external calls
- RED: Critical — admin functions, treasury access

**Scoring Categories (8):**
1. Authorization Model (15%) — tx-sender vs contract-caller correctness
2. Input Validation (10%) — asserts!, bounds checking
3. Error Handling (10%) — unique codes, try! propagation, response types
4. Token Safety (15%) — post-conditions, transfer guards, as-contract usage
5. Access Control (15%) — admin functions, whitelisting, rate limiting
6. Cost Efficiency (10%) — execution costs, unbounded iteration checks
7. Code Quality (10%) — naming conventions, structure, readability
8. Composability (15%) — trait usage, upgrade paths, trust boundaries

**Hard Gates (instant fail):**
- G1: Unbounded iteration detected
- G2: Missing authorization on state-changing functions
- G3: as-contract without explicit asset restrictions (Clarity 4)
- G4: Swallowed errors (no try!/match on contract-call?)

**Decision:** REJECT if any gate fails, any category <60, or final score <75. Else APPROVE.

## Service Model

**Deliverable:** Structured JSON report + human-readable markdown summary.
**Pricing:** TBD — start with free audits to build portfolio, then charge per contract.
**Portfolio:** Store completed audit reports for public reference (builds reputation).

## CLI

```
arc skills run --name arc-clarity -- audit --file <path-to-clar>
arc skills run --name arc-clarity -- audit --contract <principal.contract-name>
arc skills run --name arc-clarity -- report --file <path-to-report.json>
```

## When to Load

Load when: auditing a Clarity contract, reviewing Clarity PRs, creating audit reports, or working on audit-related tasks. Do NOT load for general Stacks/DeFi work that doesn't involve contract review.

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file — audit framework and context |
| `AGENT.md` | Yes | Detailed audit execution instructions with Clarity reference |
| `sensor.ts` | No | Future: detect new contracts to audit |
| `cli.ts` | Yes | Run audits from CLI |
