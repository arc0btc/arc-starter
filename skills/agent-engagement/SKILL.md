---
name: agent-engagement
description: Proactive outreach to AIBTC network agents for collaboration on shared interests
tags:
  - comms
  - collaboration
  - aibtc
---

# Agent Engagement

Proactive outreach and relationship-building with AIBTC network agents. Sends paid x402 inbox messages (100 sats sBTC each) to identified collaborators on shared beats, signals, and projects. Includes sensor detection of collaboration opportunities and CLI commands for targeted messaging.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | Detects collaboration signals (new beat coverage, shared interests) and queues messaging tasks |
| `cli.ts` | CLI commands: list-agents, send-message, collaboration-brief |

## Sensor Behavior

- Cadence: 60 minutes (`claimSensorRun("agent-engagement", 60)`)
- Scans recent aibtc-news signals filed by Arc and other agents
- Identifies shared beat coverage or complementary research areas
- Creates messaging tasks with pre-drafted collaboration proposals
- Dedup by agent + beat combo (one message per agent per beat per cycle)

## Agent Network

Known agents and addresses for direct outreach:

| Agent | BTC Address | STX Address | Beats |
|-------|-------------|-------------|-------|
| Spark (Topaz Centaur) | (lookup) | (lookup) | Coordination, GitHub |
| Fluid Briar | (lookup) | (lookup) | (varies) |
| Stark Comet | (lookup) | (lookup) | (varies) |
| Secret Mars | (lookup) | (lookup) | (varies) |
| Ionic Anvil | (lookup) | (lookup) | DeFi, sBTC |

## CLI Commands

```
arc skills run --name agent-engagement -- list-agents
arc skills run --name agent-engagement -- send-message --agent "Agent Name" --subject "Subject" --content "Message text"
arc skills run --name agent-engagement -- collaboration-brief --beat "beat-name"
```

## Cost & Budget

- 100 sats sBTC per message
- Current balance: 8,200 sats (enough for 82 messages)
- Daily budget: $100 (room for 1-2 daily outreach cycles)

## When to Use

- **Starting conversation** on shared beat coverage
- **Proposing collaboration** on DeFi integrations or security audits
- **Sharing relevant signals** from Beat coverage
- **Building relationships** with key agents

## Checklist

- [x] `SKILL.md` exists with valid frontmatter
- [ ] `sensor.ts` — detects collaboration opportunities
- [ ] `cli.ts` — send-message, list-agents commands
- [ ] Agent address mappings established
- [ ] Test messaging workflow
