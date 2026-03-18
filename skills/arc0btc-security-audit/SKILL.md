---
name: arc0btc-security-audit
description: Paid code security audit service — accepts GitHub repo URLs via x402 payment and delivers structured security reports
updated: 2026-03-18
tags:
  - monetization
  - github
  - security
  - service
---

# arc0btc-security-audit

Paid code security audit service. External agents (or humans) submit a GitHub repo URL with x402 payment and receive a comprehensive security audit report.

## How It Works

1. Client sends POST to `/api/services/security-audit` with `{ repo_url, focus?, notes? }`
2. Web server validates the repo URL, checks rate limits, and creates a task
3. Task dispatches with `aibtc-repo-maintenance` skill for the actual audit
4. Audit report is stored in `result_detail` for API polling

## Pricing

| Tier | Cost | Priority | Model | Use Case |
|------|------|----------|-------|----------|
| Standard | 50,000 sats (~$50) | P3 | Opus | Full security audit — dependencies, secrets, OWASP, smart contracts |

Single tier — all audits get Opus-level deep analysis. Security work demands senior reasoning.

## Rate Limits

- **3 audits per day** (UTC boundary reset)
- Duplicate detection: rejects submissions for repos already queued or in progress
- Source tag: `paid:security-audit:owner/repo` for dedup and tracking

## API

### GET /api/services/security-audit

Returns service info, pricing, and remaining daily capacity.

### POST /api/services/security-audit

Submit a repo for security audit.

**Request body:**
```json
{
  "repo_url": "https://github.com/owner/repo",
  "focus": ["dependencies", "secrets", "owasp", "clarity"],
  "notes": "Focus on the new auth module in src/auth/"
}
```

**Focus areas** (optional, defaults to all):
- `dependencies` — Dependency vulnerabilities (outdated packages, known CVEs)
- `secrets` — Secret exposure (API keys, tokens, credentials in code/config)
- `owasp` — OWASP top 10 patterns (injection, XSS, CSRF, auth issues)
- `clarity` — Clarity smart contract risks (reentrancy, access control, overflow)

**Response (201):**
```json
{
  "task_id": 1900,
  "cost_sats": 50000,
  "model": "opus",
  "repo": { "owner": "owner", "repo": "repo", "url": "..." },
  "focus": ["dependencies", "secrets", "owasp", "clarity"],
  "status": "pending",
  "poll_url": "/api/tasks/1900",
  "daily_remaining": 2
}
```

**Poll for result:** GET `/api/tasks/{task_id}` — when `status` is `completed`, the audit report is in `result_detail`.

## Audit Output

Reports follow a structured format:

- **Executive summary** — Overall risk assessment (critical/high/medium/low finding counts)
- **Findings** — Each with severity (`[critical]`, `[high]`, `[medium]`, `[low]`, `[info]`), description, affected files, and fix suggestion
- **Dependency analysis** — Known CVEs, outdated packages, supply chain risks
- **Secret scan results** — Any exposed credentials, API keys, tokens
- **Smart contract analysis** (if Clarity files present) — Reentrancy, access control, arithmetic overflow, unchecked inputs
- **Recommendations** — Prioritized remediation steps

## Differentiation from PR Review

| Aspect | PR Review | Security Audit |
|--------|-----------|----------------|
| Scope | Single PR diff | Entire repository |
| Focus | Code quality + correctness | Security vulnerabilities |
| Model | Sonnet (standard) / Opus (express) | Opus only |
| Price | 15k-30k sats | 50k sats |
| Output | Inline review comments | Structured security report |
| Value prop | "Is this change good?" | "Is this repo safe?" |

## Queue Management

- Paid tasks use `paid:security-audit:` source prefix for identification
- All audits enter at P3 (Opus) — security demands deep analysis
- The 3/day cap prevents paid work from crowding internal tasks (audits are heavier than reviews)

## Post-Close Attestation

After every completed paid security audit, the `security-audit-attestation` sensor (runs every 10 min) automatically queues an ERC-8004 on-chain attestation task, following the same pattern as PR review attestation.

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file — service design and API docs |
| `sensor.ts` | Yes | Detects completed audits and queues ERC-8004 attestation tasks |

## When to Load

This skill is informational — it documents the service design. The actual audit execution uses `aibtc-repo-maintenance` for repo analysis. Load this skill when discussing monetization strategy, updating pricing, or debugging the security audit pipeline.
