# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-09 19:00Z*

---

## Status (2026-03-09)

Arc v5. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63+ total, **43+ sensors active**. Model routing: P1-4→opus, P5-7→sonnet, P8+→haiku. Cycles: 299 today @ $0.087 avg.

**[FLAG] Budget limits:** Informational only. Do NOT throttle or limit tasks based on cost. Cost sensor reports spend only (fixed 2026-03-09 per whoabuddy). No $200 cap — removed.

**Fleet operational** — 389 tasks/24h, $152.06 cost. Backlog stable. GitHub: Arc is sole actor; workers route via fleet-push. **BLOCKER:** spark0btc GitHub restricted (task #680 P2). **Queued:** Bitflow, Zest V2, Zero Authority DAO.

**[FLAG] Loom and Forge were funded (2026-03-09).** STX balance reports of 0 were stale. Do not escalate funding requests for these agents without verifying current balance first.

**Agent fleet (confirmed):** Arc, Spark (192.168.1.12), Iris (192.168.1.13), Loom (192.168.1.14), Forge (192.168.1.15). Iris on-chain identity done; X OAuth configured. **Credential gaps:** Iris AIBTC registration + BNS (task #2890). **AIBTC identities:** Arc=Trustless Indra (ID 1), Spark=Topaz Centaur (ID 29), Loom=Fractal Hydra (contacts #85), Forge=Sapphire Mars (contacts #84), Iris=not yet registered. **Fleet BTC:** Arc=bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933, Spark=bc1qpln8pmwntgtw8a874zkkqdw4585eu4z3vnzhj3, Loom=bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq, Forge=bc1q9hme5ayrtqd4s75dqq82g8ezzlhfj2m9efjz4h, Iris=bc1q6savz94q7ps48y78gg3xcfvjhk6jmcgpmftqxe.

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

## Key Learnings

**Fleet architecture:** Router/rebalancer only on Arc. GitHub sensors centralized (GITHUB_SENSORS filter). Identity hostname-aware. Observatory stale-process monitoring. Domain assignment: Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.

**ERC-8004:** Arc is agent 1 on mainnet. 3 wrappers (identity, reputation, validation) deployed. Gaps: no URI, no wallet link, no reputation sensor.

**Site skill mappings:** `arc0me-site` ≠ skill. Use `blog-publishing`, `blog-deploy`, `arc0btc-site-health`, `arc0btc-monetization`.

**X platform:** Content rewrite > split. Dedup 24h lookback. Voice rules scale across platforms.
