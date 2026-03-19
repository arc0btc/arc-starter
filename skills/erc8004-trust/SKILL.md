---
name: erc8004-trust
description: ERC-8004 trust score aggregation — compute a composite 0-100 trust score for an agent by combining on-chain reputation feedback and validation scores.
effort: high
updated: 2026-03-07
tags:
  - erc8004
  - reputation
  - validation
  - read-only
---

# Trust Score Skill

Aggregates ERC-8004 reputation and validation summaries into a single composite trust score. Fetches both sources in parallel, normalizes each to a 0-100 range, and applies a weighted combination (40% reputation, 60% validation). Read-only — no wallet required.

## CLI Commands

```
arc skills run --name erc8004-trust -- compute-trust-score --agent-id <id>
```

## Subcommands

### compute-trust-score

Fetches reputation and validation summaries for an agent and returns a composite trust score.

Options:
- `--agent-id` (required) — Agent ID to score (non-negative integer)

Output fields:
- `trustScore` — Composite 0-100 score (rounded to 2 decimal places)
- `confidence` — Data confidence level: `low` (< 5 points), `medium` (5-19), `high` (20+)
- `formula` — Scoring formula applied (varies if only one source has data)
- `reputation` — Reputation component: `totalFeedback`, `summaryValue`, `summaryValueDecimals`, `normalizedScore`
- `validation` — Validation component: `count`, `avgResponse`, `normalizedScore`
- `warnings` — Non-fatal fetch errors (e.g., one source unavailable)
- `network` — Network queried

## Score Formula

```
reputationNormalized = clamp(summaryValue / 10^decimals, -100, 100) mapped to [0, 100]
trustScore = reputationNormalized * 0.4 + avgResponse * 0.6
```

If only one data source is available, it contributes 100% of the score.

## Confidence Levels

| Level  | Total data points |
|--------|-------------------|
| low    | 0-4               |
| medium | 5-19              |
| high   | 20+               |

Total data points = `totalFeedback` (reputation) + `count` (validations).

## When to Load

Load when computing or comparing agent trustworthiness. Pair with `erc8004-identity` to resolve agent IDs from addresses. Does not require a wallet — all queries are read-only.

## Requires

- `erc8004-reputation` skill (upstream data)
- `erc8004-validation` skill (upstream data)

## Notes

- Both reputation and validation failures are tolerated; a partial score is returned with `warnings`
- If both sources fail, the command exits with `success: false`
- Network defaults to `mainnet`; override with `NETWORK` env var
