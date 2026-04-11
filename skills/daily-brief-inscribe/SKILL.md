# Daily Brief Inscribe

Manages the lifecycle of inscribing daily briefs onto Bitcoin L1. Uses the `daily-brief-inscription` workflow template to coordinate multi-step inscription flows as single-state-per-task operations.

## Token Spiral Prevention

This skill exists because the original inscription workflow caused 1.25-1.8M token spikes when a single task advanced multiple states in one session, loading 33K+ chars of brief content at each step.

**Hard rules:**
1. Each task advances **exactly ONE state transition**, then exits
2. Brief content is **NEVER** stored in workflow context — only `dataHash` (SHA-256) + `briefSummary` (max 200 chars)
3. Confirmation polling **always** spawns a separate scheduled task — never polls inline
4. Workflow context must stay under **2KB total**

## Workflow States

```
pending → brief_fetched → balance_ok → committed → commit_confirmed → revealed → confirmed → completed
```

| State | Task | Model | Action |
|-------|------|-------|--------|
| `pending` | Fetch brief, compute hash | sonnet | Store dataHash + briefSummary in context |
| `brief_fetched` | Check wallet balance | haiku | Verify sufficient funds for commit+reveal |
| `balance_ok` | Build + broadcast commit tx | sonnet | Store commitTxid in context |
| `committed` | Check commit confirmation | haiku | If unconfirmed, schedule follow-up (15min) |
| `commit_confirmed` | Build + broadcast reveal tx | sonnet | Store revealTxid in context |
| `revealed` | Check reveal confirmation | haiku | If unconfirmed, schedule follow-up (15min) |
| `confirmed` | Record inscription on aibtc.news | haiku | Call inscribe-brief CLI |
| `completed` | Terminal | — | — |

## Creating a Workflow Instance

```bash
arc skills run --name arc-workflows -- create \
  --template daily-brief-inscription \
  --instance-key "brief-inscription:2026-04-11" \
  --context '{"date":"2026-04-11","walletAddress":"bc1q...","network":"mainnet"}'
```

Context must include:
- `date` — Brief date (YYYY-MM-DD)
- `walletAddress` — Bitcoin address for inscription
- `network` — "mainnet" or "testnet"

Context must **NOT** include full brief text. The `pending` task fetches the brief and stores only `dataHash` + `briefSummary`.

## Dependencies

- **aibtc-news-classifieds** — `get-brief` (fetch), `inscribe-brief` (record)
- **bitcoin-wallet** — Balance check, commit/reveal transactions
- **arc-workflows** — Workflow state management
