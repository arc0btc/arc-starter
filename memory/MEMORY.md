# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-10 18:54Z*

---

## Fleet Roster (permanent — never escalate for this list)

| Agent | IP | Bitcoin Address | Role |
|-------|-----|----------------|------|
| **Arc** | 192.168.1.10 | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 | Orchestrator, GitHub, external comms |
| **Spark** | 192.168.1.12 | bc1qpln8pmwntgtw8a874zkkqdw4585eu4z3vnzhj3 | AIBTC news, DeFi, Topaz Centaur |
| **Iris** | 192.168.1.13 | bc1q6savz94q7ps48y78gg3xcfvjhk6jmcgpmftqxe | Research, content, X pipeline |
| **Loom** | 192.168.1.14 | bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq | Code quality, CI/CD, PRs |
| **Forge** | 192.168.1.15 | bc1q9hme5ayrtqd4s75dqq82g8ezzlhfj2m9efjz4h | Infrastructure, deployments |

**[FLAG] This roster is permanent.** Do NOT create tasks asking for fleet member list or BTC addresses — it is right here.

---

## Status (2026-03-11)

Arc v5. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63+ total, **66 sensors discovered**. Model routing: P1-4→opus, P5-7→sonnet, P8+→haiku.

**[FLAG] Budget limits:** Informational only. Do NOT throttle or limit tasks based on cost. Cost sensor reports spend only (fixed 2026-03-09 per whoabuddy). No $200 cap — removed.

**[FLAG] FLEET DEGRADED (2026-03-11):** Claude Code Max 100 plan suspended → Spark, Iris, Loom, Forge cannot dispatch. Arc is sole Claude executor. Forge may partially work via OpenRouter/Codex fallback. whoabuddy appealing suspension. **Do NOT route tasks to suspended workers.** Fleet monitoring sensors (fleet-comms, fleet-health, fleet-escalation) will fire alerts — these are expected, not actionable until appeal resolves. Worker sensors (13 per agent: heartbeat, inbox-sync, service-health, alive-check, housekeeping, fleet-self-sync, scheduler, contacts, identity-guard, reputation-tracker, erc8004-reputation-monitor, github-interceptor) are also down. Arc's 53 Arc-only sensors unaffected.

**Queued:** Bitflow, Zest V2, Zero Authority DAO, Umbrel node exploration.

**[FLAG] CreditsDepleted gate pattern (2026-03-10):** When an external paid API returns 402/CreditsDepleted, write a sentinel file (e.g. `db/x-credits-depleted.json`) and gate ALL downstream callers on that file. Do not let callers fail at runtime — check sentinel first, skip with clear message. Applicable to X API and any paid external API.

**[FLAG] Loom and Forge were funded (2026-03-09).** STX balance reports of 0 were stale. Do not escalate funding requests for these agents without verifying current balance first.

**Agent fleet (confirmed):** Arc, Spark, Iris, Loom, Forge. Iris on-chain identity done; X OAuth configured. **Credential gaps:** Iris AIBTC registration + BNS (task #2890). **AIBTC identities:** Arc=Trustless Indra (ID 1), Spark=Topaz Centaur (ID 29), Loom=Fractal Hydra (contacts #85), Forge=Sapphire Mars (contacts #84), Iris=not yet registered.

## Agent Network & Keys

| Identifier | Value |
|-----------|-------|
| BNS | arc0.btc |
| Stacks | SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B |
| Bitcoin | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| Email | arc@arc0.me (personal), arc@arc0btc.com (professional) |

**Known agents:** Spark, Iris, Loom, Forge. X402 messaging enabled. **Note:** Topaz Centaur, Fluid Briar, Stark Comet, Secret Mars are OTHER AIBTC team members' agents — not our fleet. **Provisioning:** `templates/agent-provisioning.md`. **Repos:** arc0btc primary. **Escalations:** whoabuddy.

## Topic Files & References

- **[../GOALS.md](../GOALS.md)** — Roadmap: directives (D1-D5), milestones. Dispatch checks relevance here.
- **[patterns.md](patterns.md)** — Operational patterns: sensor design, task routing, PR review, integration sync.
- **[archive.md](archive.md)** — Historical snapshots: v0.12.0 release, balances, GitHub restrictions.
- **[fleet-experiments.md](fleet-experiments.md)** — Fleet results: completion rates, failure patterns, ops recs.
- **[fleet-recovery-checklist.md](fleet-recovery-checklist.md)** — Worker reinstatement runbook: sensors, identity checks, dispatch validation, per-agent notes.
- **`../research/`** — Active reports. Auto-archived after 30 days. Sensor: `arc-research-decay` (24h).

---

## Key Learnings

**[FLAG] Fleet OAuth fragility (2026-03-10):** All 4 workers shared one OAuth token that expired server-side, taking down entire fleet. Fix: scp'd Arc's working OAuth creds. Task #4088 tracks API key migration. Workers should use ANTHROPIC_API_KEY, not OAuth — OAuth refresh is unreliable across VMs.

**Fleet architecture:** Router/rebalancer only on Arc. GitHub sensors centralized (GITHUB_SENSORS filter). Identity hostname-aware. Observatory stale-process monitoring. Domain assignment: Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.

**[FLAG] Fleet escalation loops:** Root causes (credential misconfiguration, stale identity data) need upstream fixes. Iris contacts auto-archive issue requires structural fix. Worker contacts DBs empty — add contacts sync to fleet-sync.

**[FLAG] Worker GitHub access — 3-layer structural fix:** (1) Pre-dispatch gate in `dispatch.ts` auto-routes GitHub tasks to Arc. (2) insertTask guard in `db.ts` blocks GitHub escalation tasks on workers. (3) github-interceptor catches git push/PR patterns. Deploy to workers via fleet-sync.

**[FLAG] Identity drift:** Fleet-self-sync backup/restore fixed to pre-read sources before `git reset --hard`. Arc's mnemonic never shared with agents — hard rule.

**[FLAG] Task volume:** Monitor chain-reaction follow-ups (62% of recent volume). Audit if >600/day.

**[FLAG] Worker fleet suspended (2026-03-11):** Anthropic suspended the Claude Code Max 100 plan used by Spark, Iris, Loom, Forge for "account use violations" — likely triggered by 5-agent rate-limit storm + OAuth escalation. whoabuddy appealing. Arc's account unaffected. Forge has OpenRouter/Codex fallback (dual dispatch: Codex/GPT-5.4 via OpenRouter) and may still be partially operational. Arc + Forge are primary executors until appeal resolves. Do NOT create tasks routing to suspended workers — they cannot dispatch. **Coverage gaps:** Worker AIBTC heartbeats will stop (4 agents × 5min = 48 missed/hr), worker inbox-sync paused (messages pile up), worker reputation tracking paused. Arc's heartbeat continues normally. Fleet monitoring sensors on Arc will generate alerts for silent workers — suppress or deprioritize these until fleet resumes.

**[FLAG] Umbrel node (2026-03-11):** Local node at 192.168.1.106. SSH: umbrel/umbrel. VM has ~200GB disk (expandable). Bitcoin Core MUST run full unpruned — Stacks node requires it. Currently pruned, needs switch. Planned stack: Bitcoin Core (full) → Stacks node + Stacks API → mempool.space + API → possibly Gitea. Storage expansion is a whoabuddy-side task (stop VM, resize, restart).

**Operational:** ERC-8004 wrappers deployed (no URI/reputation gaps yet). Site mapping: use `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X: dedup 24h, rewrite > split.