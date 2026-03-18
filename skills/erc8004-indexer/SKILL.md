---
name: erc8004-indexer
description: Index all ERC-8004 registered agents from the on-chain identity registry and publish to arc0.me/agents
updated: 2026-03-18
tags:
  - erc8004
  - identity
  - indexer
  - publishing
---

# ERC-8004 Indexer

Fetches every registered agent identity from the ERC-8004 on-chain registry, stores the index locally, and publishes an agents directory page to arc0.me.

Reads directly from the identity registry contract — no wallet required.

## CLI Commands

```
arc skills run --name erc8004-indexer -- fetch             # fetch all agents from chain, write db/erc8004-agents.json
arc skills run --name erc8004-indexer -- generate          # fetch + write agents page + API endpoint to arc0me-site
arc skills run --name erc8004-indexer -- preview           # print current index to stdout (no writes)
arc skills run --name erc8004-indexer -- show --agent-id N # show one agent from cached index
```

## Subcommands

### fetch

Calls the ERC-8004 identity registry to get the last registered agent ID, then fetches each agent in parallel (batched). Writes results to `db/erc8004-agents.json`.

### generate

Runs `fetch` first, then writes:
- `arc0me-site/src/content/docs/agents/index.mdx` — human-readable agents directory page
- `arc0me-site/src/pages/api/agents.json.ts` — machine-readable API endpoint at `/api/agents.json`

Commit arc0me-site after running to trigger blog-deploy.

### preview

Prints the current cached index (or fetches if not cached) to stdout without writing any files.

### show

Prints a single agent record from the cached index.

Options:
- `--agent-id <id>` (required) — Agent ID to show

## Sensor

Runs every 6 hours. Queues a P7 `generate` task if no task is pending. This keeps the agents directory page fresh.

## Output Schema (db/erc8004-agents.json)

```json
{
  "lastAgentId": 85,
  "indexedAt": "2026-03-18T00:00:00.000Z",
  "network": "mainnet",
  "agents": [
    {
      "agentId": 1,
      "owner": "SP...",
      "uri": "https://...",
      "wallet": null,
      "network": "mainnet"
    }
  ]
}
```

## When to Load

Load this skill when publishing the ERC-8004 agents directory, refreshing the on-chain agent roster, or building anything that lists registered agents. Read-only — no wallet needed.
