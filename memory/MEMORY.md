# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-09 19:00Z*

---

## Status (2026-03-09)

Arc v5. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63+ total, **43+ sensors active**. Model routing: P1-4→opus, P5-7→sonnet, P8+→haiku. Cycles: 299 today @ $0.087 avg.

**[FLAG] Budget limits:** Informational only. Do NOT throttle or limit tasks based on cost. Cost sensor reports spend only (fixed 2026-03-09 per whoabuddy). No $200 cap — removed.

**Fleet operational** — 389 tasks/24h, $152.06 cost. Backlog stable. GitHub: Arc is sole actor; workers route via fleet-push. **BLOCKER:** spark0btc GitHub restricted (task #680 P2). **Queued:** Bitflow, Zest V2, Zero Authority DAO.

**Agent fleet (confirmed):** Arc, Spark (192.168.1.12), Iris (192.168.1.13), Loom (192.168.1.14), Forge (192.168.1.15). Iris on-chain identity done; X OAuth configured. **Credential gaps:** Iris AIBTC registration + BNS (task #2890). **AIBTC identities:** Arc=Trustless Indra (ID 1), Spark=Topaz Centaur (ID 29), Loom=Fractal Hydra (contacts #85), Forge=Sapphire Mars (contacts #84), Iris=not yet registered. **Fleet BTC:** Arc=bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933, Spark=bc1qpln8pmwntgtw8a874zkkqdw4585eu4z3vnzhj3, Loom=bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq, Forge=bc1q9hme5ayrtqd4s75dqq82g8ezzlhfj2m9efjz4h, Iris=unknown.

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
- **`../research/`** — Active reports. Auto-archived after 30 days. Sensor: `arc-research-decay` (24h).

---

## [FLAG] Escalation Checklist — Exhaust Fleet Tools First

Before setting `status=blocked` or escalating to whoabuddy, verify:

1. **Can another agent handle it?** Use `fleet-handoff --agent <name>` or `POST /api/tasks` to delegate. "Cannot target specific VMs" is false — fleet-handoff, fleet-broadcast, and POST /api/tasks all work.
2. **Is this a funding request?** Arc has 80 STX and full wallet tooling (`stx-send`, BNS ops). Route STX/funding requests to Arc, not human.
3. **Does it need sBTC, or just BIP-137?** Free inbox operations (read/reply) use BIP-137 signatures — no x402, no sBTC required. Check before assuming payment is needed.
4. **Is there an existing skill CLI?** Check `arc skills` before concluding a capability is missing.
5. **Is this truly irreversible or >100 STX?** If yes → escalate. If no → proceed autonomously.

Valid escalation reasons: irreversible action, >100 STX spend, human judgment required, explicit permission needed. Everything else: use fleet tools and proceed.

## [FLAG] Self-Sufficiency Principle — Ask HOW, Not TO DO

**Workers ask Arc for guidance, not execution.** When stuck, the right pattern is:
- Use `fleet-handoff` or `fleet-task-sync` to ask Arc **how to solve it yourself**
- Arc responds with instructions, CLI commands, or context — not by doing the work
- The worker then executes independently

**Arc is the orchestrator, not the bottleneck.** If Arc does everything, the fleet doesn't scale. Workers should:
1. Read their own SKILL.md files and contacts before asking anyone
2. Use `arc skills` to discover what they already have
3. Try the obvious approach first — most tasks are solvable with existing tools
4. Ask Arc for HOW only after exhausting local options
5. Never escalate to whoabuddy what Arc (or another agent) can answer

**Team maturity goal:** Each agent progressively takes over key functionality in its domain. Arc continues orchestrating but the team isolates and owns their areas. Build fast, ship fast, work fast — with meaning.

---

## Key Learnings

**Fleet architecture:** Router/rebalancer only on Arc. GitHub sensors centralized (GITHUB_SENSORS filter). Identity hostname-aware. Observatory stale-process monitoring. Domain assignment: Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.

**ERC-8004:** Arc is agent 1 on mainnet. 3 wrappers (identity, reputation, validation) deployed. Gaps: no URI, no wallet link, no reputation sensor.

**Site skill mappings:** `arc0me-site` ≠ skill. Use `blog-publishing`, `blog-deploy`, `arc0btc-site-health`, `arc0btc-monetization`.

**X platform:** Content rewrite > split. Dedup 24h lookback. Voice rules scale across platforms.
