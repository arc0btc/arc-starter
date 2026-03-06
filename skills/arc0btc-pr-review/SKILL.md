---
name: arc0btc-pr-review
description: Paid PR review service — accepts GitHub PR URLs via x402 payment and delivers structured code reviews
updated: 2026-03-06
tags:
  - monetization
  - github
  - service
---

# arc0btc-pr-review

Paid PR review service. External agents (or humans) submit a GitHub PR URL with x402 payment and receive Arc's informed code review.

## How It Works

1. Client sends POST to `/api/services/pr-review` with `{ pr_url, tier?, notes? }`
2. Web server validates the PR URL, checks rate limits, and creates a task
3. Task dispatches with `aibtc-repo-maintenance` skill for the actual review
4. Review is posted as a GitHub comment AND stored in `result_detail` for API polling

## Pricing

| Tier | Cost | Priority | Model | Use Case |
|------|------|----------|-------|----------|
| Standard | 15,000 sats (~$15) | P5 | Sonnet | Normal review — correctness, style, suggestions |
| Express | 30,000 sats (~$30) | P3 | Opus | Priority review — deep analysis, security, architecture |

## Rate Limits

- **5 reviews per day** (UTC boundary reset)
- Duplicate detection: rejects submissions for PRs already queued or in progress
- Source tag: `paid:pr-review:owner/repo#number` for dedup and tracking

## API

### GET /api/services/pr-review

Returns service info, pricing tiers, and remaining daily capacity.

### POST /api/services/pr-review

Submit a PR for review.

**Request body:**
```json
{
  "pr_url": "https://github.com/owner/repo/pull/123",
  "tier": "standard",
  "notes": "Focus on security implications of the new auth flow"
}
```

**Response (201):**
```json
{
  "task_id": 1850,
  "tier": "standard",
  "model": "sonnet",
  "cost_sats": 15000,
  "pr": { "owner": "owner", "repo": "repo", "number": 123, "url": "..." },
  "status": "pending",
  "poll_url": "/api/tasks/1850",
  "daily_remaining": 4
}
```

**Poll for result:** GET `/api/tasks/{task_id}` — when `status` is `completed`, the review is in `result_detail`.

## Review Output

Reviews follow the aibtc-repo-maintenance format:
- Severity labels: `[blocking]`, `[suggestion]`, `[nit]`, `[question]`
- Inline `suggestion` blocks for concrete fixes
- Security and correctness analysis
- Signed by Arc (cryptographic signature when available)

## Queue Management

- Paid tasks use `paid:pr-review:` source prefix for identification
- Standard tier enters at P5 (Sonnet) — interleaves with normal work
- Express tier enters at P3 (Opus) — gets priority dispatch
- The 5/day cap prevents paid work from crowding internal tasks

## Files

| File | Present | Purpose |
|------|---------|---------|
| `SKILL.md` | Yes | This file — service design and API docs |

## When to Load

This skill is informational — it documents the service design. The actual review execution uses `aibtc-repo-maintenance`. Load this skill when discussing monetization strategy, updating pricing, or debugging the PR review pipeline.
