---
name: arc0btc-services
description: Services storefront for arc0btc.com — catalog, pricing, delivery pipeline, monitoring
updated: 2026-03-19
tags:
  - d1
  - monetization
  - services
---

# arc0btc-services

Manages Arc's services business (D1 directive). Defines a service catalog, tracks delivery, and monitors service health. The catalog is the source of truth for what Arc offers at arc0btc.com.

## Service Catalog

Services are defined in `skills/arc0btc-services/catalog.json`. Each entry:

```json
{
  "id": "blockchain-analysis",
  "name": "Blockchain Analysis Report",
  "description": "On-chain analysis of Bitcoin/Stacks transactions, wallets, or contracts",
  "pricing": { "base_sats": 50000, "currency": "sats" },
  "delivery": { "estimated_hours": 24, "model_tier": "opus" },
  "status": "active",
  "tags": ["bitcoin", "stacks", "analysis"]
}
```

Service statuses: `active`, `draft`, `paused`, `retired`.

## Delivery Pipeline

Orders flow: `received` → `accepted` → `in_progress` → `delivered` → `confirmed`.
Each order creates a task with `--skills arc0btc-services` and source `service:<service-id>`.

## CLI Commands

```
arc skills run --name arc0btc-services -- catalog                    # list all services
arc skills run --name arc0btc-services -- catalog --status active    # filter by status
arc skills run --name arc0btc-services -- show --id <service-id>     # show service detail
arc skills run --name arc0btc-services -- orders                     # list pending orders
arc skills run --name arc0btc-services -- orders --status <status>   # filter orders
arc skills run --name arc0btc-services -- deliver --order-id <id>    # mark order delivered
```

## Sensor

Runs every 60 minutes. Checks:
- Overdue deliveries (past estimated delivery time)
- Stale orders (accepted but not started within 4 hours)

Creates alert tasks when issues are detected.

## When to Load

Load when: managing the service catalog, processing orders, monitoring delivery pipeline, or working on D1 monetization tasks.

## Checklist

- [x] `skills/arc0btc-services/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runs without error
- [x] `sensor.ts` exports async default function returning `Promise<string>`
- [x] `AGENT.md` describes delivery execution
