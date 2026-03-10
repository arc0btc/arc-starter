# AIBTC Tuesday Presentation — Research Data

*Compiled: 2026-03-10 10:17 UTC by Task #4249*

---

## 1. Arc at a Glance

| Metric | Value |
|--------|-------|
| Version | Arc v5 |
| Identity | arc0.btc (BNS), Trustless Indra (AIBTC ID 1) |
| Stacks address | SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B |
| Bitcoin address | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| X handle | @arc0btc |
| Skills | 100+ installed |
| Sensors | 66 active |
| Total tasks (all time) | 4,244 |
| Running since | 2026-02-01 (first day of having a home) |

---

## 2. This Week's Numbers (7-day ending 2026-03-10)

### Task Volume

| Status | Count |
|--------|-------|
| Completed | 3,937 (all time) |
| Completed (this week) | 3,171 |
| Failed | 58 (all time) |
| Blocked | 62 |
| Pending | 186 |
| Active | 1 |

### Completed Tasks by Source (this week)

| Source | Count |
|--------|-------|
| Follow-up (task-generated) | 1,265 |
| Sensor-generated | 1,040 |
| Other | 719 |
| Human-created | 147 |

### Cost & Compute

| Metric | This Week | Today |
|--------|-----------|-------|
| Dispatch cycles | 2,442 | 448 |
| Actual cost (Claude Code) | $1,063.22 | $137.69 |
| API-estimated cost | $1,726.86 | $223.51 |
| Avg cost per cycle | $0.435 | — |
| Tokens in | 970M | 111.9M |
| Tokens out | 8.9M | 1.1M |

### Model Routing (3-tier)

| Priority | Model | Role |
|----------|-------|------|
| P1-4 | Opus | Senior — architecture, deep reasoning, complex code |
| P5-7 | Sonnet | Mid — composition, reviews, moderate ops |
| P8+ | Haiku | Junior — simple execution, config, status checks |

### Git Activity (7 days)

| Metric | Count |
|--------|-------|
| Total commits | 1,495 |
| Meaningful commits (non-auto) | 399 |

---

## 3. Fleet Status

### 5 Agents, 5 VMs

| Agent | IP | Role | AIBTC Identity |
|-------|-----|------|----------------|
| **Arc** | 192.168.1.10 | Fleet orchestrator, AIBTC ambassador | Trustless Indra (ID 1) |
| **Spark** | 192.168.1.12 | Protocol/on-chain, DeFi, news | Topaz Centaur (ID 29) |
| **Iris** | 192.168.1.13 | Research, content, X pipeline | Not yet registered |
| **Loom** | 192.168.1.14 | Code quality, CI/CD, integrations | Fractal Hydra |
| **Forge** | 192.168.1.15 | Infrastructure, deployments, security | Sapphire Mars |

### Fleet Performance (24h snapshot, 2026-03-09)

| Agent | Completed | Failed | Success Rate | Cost |
|-------|-----------|--------|--------------|------|
| Spark | 81 | 8 | 84.4% | $23.34 |
| Iris | 116 | 6 | 89.9% | $23.63 |
| Loom | 80 | 3 | 96.3% | $16.37 |
| Forge | 73 | 5 | 93.9% | $20.12 |
| **Fleet total** | **350** | **22** | **91.4%** | **$83.46** |
| Arc (separate) | 253 | — | — | — |

### Fleet Infrastructure Built This Week

- **fleet-sync** — Git commit sync across agents
- **fleet-router** — Load-balanced task routing with overflow paths
- **fleet-rebalance** — Work-stealing rebalancer
- **fleet-push** — Change-aware code deployment with per-agent rollback
- **fleet-deploy** — Canary deployment pipeline
- **fleet-health** — Circuit-breaker health monitor (15min cadence)
- **fleet-escalation** — Blocked task escalation with email
- **fleet-dashboard** — Real-time fleet task/cost aggregation
- **fleet-memory** — Cross-agent learning collection
- **fleet-comms** — Agent mesh chat + silence detection
- **fleet-handoff** — Agent-to-agent partial task transfers
- **fleet-consensus** — 3-of-5 consensus protocol for high-impact decisions
- **fleet-broadcast** — Send tasks to all agents simultaneously
- **fleet-collect** — Gather results from all agents by topic
- **fleet-exec** — Parallel SSH command execution
- **arc-observatory** — Fleet live feed, cross-agent task board, Bitcoin Faces, Model Arena

---

## 4. Key Features Shipped This Week

### Infrastructure & Architecture
- **3-layer GitHub gate** — Pre-dispatch + DB guard + broadened interceptor to stop worker escalation loops (zero LLM cost)
- **Fleet identity system** — Per-agent SOUL.md, hostname-aware dashboards, Bitcoin Face avatars
- **Identity guard sensor** — Detects identity drift across fleet, narrowed markers to avoid false positives
- **Fleet-self-sync death spiral fix** — Pre-read identity sources before `git reset --hard`, multiple backup layers
- **Dual-SDK dispatch** — Codex CLI + OpenRouter adapters (Forge runs GPT-5.4 via OpenRouter)
- **Dispatch resilience** — Circuit breaker, exponential backoff, robust error classification, TOCTOU lock fix
- **Per-sensor 90s timeout** — Prevents entire sensor service from hanging on a single HTTP call

### On-Chain & Bitcoin
- **Bitcoin Taproot multisig (QuorumClaw)** — M-of-N coordination with automated invite/proposal monitoring
- **ERC-8004 on mainnet** — Agent identity (#1), reputation, validation wrappers deployed
- **Styx skill** — BTC→sBTC conversion via Styx protocol
- **Stacks payments sensor** — Watch blockchain for STX payment orders
- **AIBTC heartbeat** — All 5 agents check in every 5 minutes with signed proofs
- **BNS registration** — bns-runner for wallet-unlocked name registration
- **Multi-wallet support** — Spark is first multi-wallet agent (primary + legacy)

### DeFi Integrations
- **defi-bitflow** — Bitflow DEX skill with DCA automation + high-spread sensor
- **defi-zest** — Zest Protocol yield farming (supply, withdraw, claim)
- **defi-stacks-market** — Prediction market trading and intelligence
- **dao-zero-authority** — DAO proposal detection + governance participation

### Social & Content
- **X integration** — Full posting, reply, like, search, timeline reading, ecosystem monitoring
- **Brand voice calibration** — Audited Feb 2026 posts, distilled voice guidelines
- **Blog publishing pipeline** — Create → quality gate → deploy → auto-deploy to Cloudflare Workers
- **Content quality gate** — 4-criterion check for blog posts, X posts, AIBTC signals
- **arXiv research** — Automated paper digests on LLM/agent research

### Web & Dashboards
- **Observatory (port 4000)** — Fleet live feed, agent cards with Bitcoin Faces, iframes to each agent's dashboard
- **Web dashboard (port 3000)** — Skills page, Sensors page, Identity page, Activity Feed with filters/search
- **POST /api/tasks** — Cross-agent task creation via REST API
- **Accessibility** — ARIA labels, aria-live regions, text alternatives for color status

### Monetization
- **Ask Arc service** — /api/ask endpoint with tiered pricing and rate limiting
- **Paid PR review** — x402 payment-gated service with rate limiting
- **arXiv research feed** — x402-powered research digest publishing

### Operational
- **Compliance review** — Structural and naming audits across all skills/sensors
- **Context review** — Audit whether tasks load the right skills
- **Failure triage** — Recurring failure pattern detection with escalation
- **Ops review** — Task creation vs completion rate tracking
- **Dispatch evals** — Post-dispatch quality scoring
- **Skill effectiveness tracking** — Correlate SKILL.md versions with dispatch outcomes

---

## 5. Notable Commits (highlights from 399 meaningful commits)

### Features (feat)
- `feat(dispatch): add 3-layer GitHub gate to permanently stop worker escalations`
- `feat(identity-guard): add identity drift detection sensor`
- `feat(fleet): add authenticated REST API for cross-agent task management`
- `feat(arc-observatory): add cross-agent task board and goal tracking`
- `feat(fleet-consensus): add 3-of-5 consensus protocol for high-impact decisions`
- `feat(fleet): implement work-stealing rebalancer (Phase 1+2)`
- `feat(arc-observatory): add fleet live feed — real-time merged task stream`
- `feat(dispatch): add Codex CLI dispatch adapter for dual-SDK routing`
- `feat(bitcoin-wallet): add stx-send CLI command for STX transfers`
- `feat(defi-bitflow): add Bitflow DEX skill with DCA CLI + high-spread sensor`
- `feat(defi-zest): add Zest Protocol yield farming skill`
- `feat(styx): add BTC→sBTC conversion skill via Styx protocol`
- `feat(arc-remote-setup): add SSH-based VM provisioning skill for agent fleet`
- `feat(quorumclaw): add QuorumClaw multisig coordination skill`
- `feat(arc-introspection): add daily introspection sensor`
- `feat(erc8004-reputation): add incoming reputation monitor sensor`

### Fixes (fix)
- `fix(fleet-self-sync): resolve identity backup/restore death spiral`
- `fix(fleet-self-sync): prevent identity contamination loop in backup/restore`
- `fix(web-dashboard): eliminate XSS via JS-string injection in onclick handlers`
- `fix(dispatch): close TOCTOU race by acquiring lock before task selection`
- `fix(dispatch): detect truncated stream-JSON as error`
- `fix(sensors): switch Promise.all to Promise.allSettled for fault isolation`
- `fix(compliance): resolve 226 naming violations across 58 skills`

---

## 6. Architecture Summary

```
arc-starter/
├── src/
│   ├── cli.ts          — CLI entry point (`arc` command)
│   ├── dispatch.ts     — LLM-powered task execution (lock-gated, 30min cycles)
│   ├── sensors.ts      — Parallel sensor runner (1min timer, per-sensor cadence)
│   ├── db.ts           — SQLite schema + task queue
│   ├── web.ts          — Web dashboard (port 3000)
│   └── services.ts     — systemd/launchd service installer
├── skills/             — 100+ skills (SKILL.md + optional AGENT.md + sensor.ts + cli.ts)
├── memory/             — Persistent memory (MEMORY.md, versioned by git)
├── templates/          — Task templates for recurring patterns
├── db/arc.sqlite       — SQLite database (tasks, cycle_log)
└── bin/arc             — CLI wrapper
```

### Core Loop
1. **Sensors** fire every 1 minute → detect signals → create tasks
2. **Dispatch** picks highest-priority pending task → marks active → runs Claude Code subprocess → records results
3. **Fleet** coordination via SSH + REST APIs + shared task queue patterns

### Key Design Principles
- Everything is a task
- CLI-first: every action expressible as `arc` command
- Skills as knowledge containers (lean orchestrator, detailed subagent briefings)
- Context budget: 40-50k tokens per dispatch
- Archive over delete
- Conventional commits, strict TypeScript, Bun runtime

---

## 7. Milestones & What's Next

### Completed This Week
- Fleet operational (5 agents, 5 VMs, 91.4% success rate)
- Observatory live dashboard
- 3-layer GitHub gate (structural fix for escalation loops)
- Identity guard + fleet-self-sync death spiral resolved
- ERC-8004 on mainnet (identity, reputation, validation)
- DeFi skill suite (Bitflow, Zest, Stacks Market, DAO)
- Dual-SDK dispatch (Claude + Codex/GPT-5.4)
- 100+ skills, 66 sensors

### Queued
- Bitflow DCA automation
- Zest V2 yield farming (awaiting mainnet launch)
- Zero Authority DAO active participation
- ERC-8004 gaps: URI, wallet link, reputation sensor
- Iris AIBTC registration + BNS
- Contacts sync to all fleet agents
- API key migration (replace OAuth across fleet)

---

## 8. Identity & On-Chain Presence

| Property | Value |
|----------|-------|
| BNS name | arc0.btc |
| AIBTC identity | Trustless Indra (ID 1) |
| ERC-8004 agent ID | #1 on mainnet |
| Bitcoin (L1) | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| Stacks (L2) | SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B |
| X | @arc0btc |
| Email | arc@arc0.me / arc@arc0btc.com |
| Bitcoin Face | SVG avatar from bitcoinfaces.xyz |
| Signing | BIP-340/342 (Bitcoin), SIP-018 (Stacks) |

---

*Ready for slide-building phase. Follow-up task should consume this file to generate HTML presentation.*
