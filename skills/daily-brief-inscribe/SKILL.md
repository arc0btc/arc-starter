---
name: daily-brief-inscribe
description: Manages Bitcoin L1 inscription lifecycle for daily briefs using script-dispatch per-state workflow pattern
updated: 2026-04-25
tags:
  - inscription
  - bitcoin
  - workflow
---

# Daily Brief Inscribe

Manages the lifecycle of inscribing daily briefs onto Bitcoin L1. Uses the `daily-brief-inscription` workflow template. All states use **script dispatch** (`model: "script"`) — no LLM context window involved, eliminating the token spiral root cause.

## Token Spiral Prevention

This skill exists because the original inscription workflow caused 1.25-1.8M token spikes (brief content appearing in tool call outputs within LLM context). The fix: convert all states to script dispatch so no LLM context window is ever loaded.

**Hard rules (still apply):**
1. Each task advances **exactly ONE state transition**, then exits
2. Brief content is cached to `db/brief-inscription-{date}.b64` (not in workflow context)
3. Confirmation polling **always** spawns a separate scheduled task — never polls inline

## Workflow States

```
pending → brief_fetched → balance_ok → committed → commit_confirmed → revealed → confirmed → completed
```

| State | Task | Model | Script handler |
|-------|------|-------|----------------|
| `pending` | Fetch brief, compute hash | script | `fetch-and-hash` |
| `brief_fetched` | Check wallet balance | script | `check-balance` |
| `balance_ok` | Build + broadcast commit tx | script | `commit-tx` |
| `committed` | Check commit confirmation | script | `check-commit` (schedules follow-up if unconfirmed) |
| `commit_confirmed` | Build + broadcast reveal tx | script | `reveal-tx` |
| `revealed` | Check reveal confirmation | script | `check-reveal` (schedules follow-up if unconfirmed) |
| `confirmed` | Record inscription on aibtc.news | script | `record-inscription` |
| `completed` | Terminal | — | — |

## CLI

```bash
arc skills run --name daily-brief-inscribe -- fetch-and-hash --workflow-id <id> --date YYYY-MM-DD
arc skills run --name daily-brief-inscribe -- check-balance --workflow-id <id> --data-size <bytes> --network mainnet|testnet
arc skills run --name daily-brief-inscribe -- commit-tx --workflow-id <id> --date YYYY-MM-DD --network mainnet|testnet
arc skills run --name daily-brief-inscribe -- check-commit --workflow-id <id> --commit-txid <txid> --network mainnet|testnet
arc skills run --name daily-brief-inscribe -- reveal-tx --workflow-id <id> --date YYYY-MM-DD --commit-txid <txid> --reveal-amount <sats> --fee-rate medium --network mainnet|testnet
arc skills run --name daily-brief-inscribe -- check-reveal --workflow-id <id> --reveal-txid <txid> --network mainnet|testnet
arc skills run --name daily-brief-inscribe -- record-inscription --workflow-id <id> --date YYYY-MM-DD --inscription-id <id>
```

## Creating a Workflow Instance

```bash
arc skills run --name arc-workflows -- create \
  --template daily-brief-inscription \
  --instance-key "brief-inscription:2026-04-11" \
  --context '{"date":"2026-04-11","network":"mainnet"}'
```

Context must include `date` (YYYY-MM-DD) and `network` ("mainnet" or "testnet"). The `walletAddress` field is no longer required — the wallet is read from the configured wallet at commit time.

## Dependencies

- **aibtc-news-classifieds** — `get-brief` (fetch), `inscribe-brief` (record)
- **bitcoin-wallet** — Wallet unlock pre-flight + BTC address lookup
- **arc-workflows** — Workflow state management
- **ordinals** (`github/aibtcdev/skills/ordinals/ordinals.ts`) — Commit and reveal transactions
