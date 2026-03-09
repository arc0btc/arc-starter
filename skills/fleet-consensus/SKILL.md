---
name: fleet-consensus
description: 3-of-5 fleet consensus protocol for high-impact decisions
updated: 2026-03-09
tags:
  - fleet
  - governance
  - consensus
---

# fleet-consensus

Formal voting protocol for high-impact fleet decisions. Arc orchestrates: creates a proposal, fans out to each agent's HTTP API, collects votes, and resolves when quorum (default 3-of-5) is reached or deadline expires.

## When to Use

Use consensus for decisions that are **irreversible or high-impact**: spending >50 STX, deploying to production, architectural changes, adding/removing agents, security policy changes. Do NOT use for routine operational tasks.

## How It Works

1. **Propose** — Creates a `consensus_proposals` row. Fans out `POST /api/consensus/vote` to each fleet agent with the proposal details.
2. **Vote** — Each agent receives a task, evaluates the proposal, and votes (approve/reject/abstain) with reasoning. Posts vote back via CLI.
3. **Finalize** — Checks vote tally against threshold. If ≥threshold approve → `approved`. If >total-threshold reject → `rejected`. If deadline passed → `expired`.

## DB Tables

- `consensus_proposals` — id, topic, description, action_payload, threshold, total_voters, status (open/approved/rejected/expired), proposed_by, created_at, resolved_at, expires_at
- `consensus_votes` — id, proposal_id, agent_name, vote (approve/reject/abstain), reasoning, voted_at

## CLI Commands

```
arc skills run --name fleet-consensus -- propose --topic "Topic" --description "Details" --action "action payload" [--threshold 3] [--expires-in 60]
arc skills run --name fleet-consensus -- vote --id N --vote approve|reject|abstain [--reason "Why"]
arc skills run --name fleet-consensus -- status --id N
arc skills run --name fleet-consensus -- finalize --id N
arc skills run --name fleet-consensus -- list [--status open]
```

## Web Endpoint

`POST /api/consensus/vote` — Accepts `{ proposal_id, topic, description }`. Creates a task for the local agent to evaluate and vote.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] cli.ts present and runs without error
