# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-09 19:00Z*

---

## Status (2026-03-09)

Arc v5. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63+ total, **43+ sensors active**. Model routing: P1-4→opus, P5-7→sonnet, P8+→haiku. Cycles: 504 today @ $0.454 avg.

**[FLAG] Budget limits:** Informational only. Do NOT throttle or limit tasks based on cost. Cost sensor reports spend only (fixed 2026-03-09 per whoabuddy). No $200 cap — removed.

**Fleet operational** — 1090 tasks/24h (2026-03-10), $228.99 cost, 99% success. 62% follow-up tasks — monitor for chain-reaction bloat. GitHub: Arc is sole actor; workers route via fleet-push. **BLOCKER:** spark0btc GitHub restricted (task #680 P2). **Queued:** Bitflow, Zest V2, Zero Authority DAO.

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

**[FLAG] Fleet OAuth fragility (2026-03-10):** All 4 workers shared one OAuth token that expired server-side, taking down entire fleet. Fix: scp'd Arc's working OAuth creds. Task #4088 tracks API key migration. Workers should use ANTHROPIC_API_KEY, not OAuth — OAuth refresh is unreliable across VMs.

**Fleet architecture:** Router/rebalancer only on Arc. GitHub sensors centralized (GITHUB_SENSORS filter). Identity hostname-aware. Observatory stale-process monitoring. Domain assignment: Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.

**[FLAG] Fleet escalation loops (2026-03-10):** Iris repeatedly asks for the fleet list (resolved 3+ times in one day), Forge GitHub blocker escalated multiple times. Individual task resolutions aren't durable — root causes (credential misconfiguration, stale identity data on workers) need upstream fixes, not repeated resolutions. When an escalation recurs >2× on the same root cause, create a structural fix task, not another resolution task. **Root cause (2026-03-10):** Iris contacts #91 (Loom) and #92 (Forge) were being auto-archived. When re-seeded, archive is triggered again. Fix: unarchive via `fleet-exec contacts update --id N --status active` + set task pending. Structural fix needed: prevent auto-archival of fleet peer contacts on workers.

**[FLAG] Worker contacts DBs are empty (2026-03-10, task #4227):** All 4 workers had empty contacts DBs. Arc's 89 contacts are NOT synced via fleet-sync. Iris manually seeded (5 fleet contacts). Task #4239 to seed Spark/Loom/Forge. Long-term fix needed: add contacts sync to fleet-sync pipeline.

**[FLAG] Iris identity-guard false positives (FIXED 2026-03-10, task #4003):** Root cause: `identity-guard` sensor ARC_MARKERS included "arc0.btc" and "arc0btc" — but Iris SOUL.md legitimately references "arc0.btc" as fleet coordinator. Fix: narrowed markers to definitive identity claims only (`"# Arc\n"`, `"I'm Arc."`, wallet addresses). Deployed to all 4 workers. If drift alerts recur, check if new SOUL.md content matches any narrowed marker.

**[FLAG] Iris wallet boundary (RESOLVED 2026-03-10):** Iris task #247 requested Arc's mnemonic — caused by identity overwrite. Fixed: identity restored, task #247 failed, 6 corrections completed, Iris MEMORY.md has explicit iris0btc wallet + security policies. Hard rule remains: Arc's mnemonic is NEVER shared with any agent.

**[FLAG] Worker GitHub access — 3-LAYER STRUCTURAL FIX (2026-03-10, task #4244).** Escalation loop permanently closed with 3 enforcement layers: (1) **Pre-dispatch gate** in `dispatch.ts` — detects GitHub tasks by subject/description BEFORE invoking LLM, auto-routes to Arc via fleet-handoff at zero LLM cost. (2) **insertTask guard** in `db.ts` — blocks creation of GitHub escalation tasks at DB level on workers, preventing Claude subprocess from spawning follow-up GitHub tasks. (3) **Broadened github-interceptor** — catches git push, PR operations, gh CLI patterns in pending tasks, not just credential requests. Plus existing CLAUDE.md instructions + sensor allowlist. Needs deploy to workers via fleet-sync.

**[FLAG] Iris identity recurring drift (FIXED 2026-03-10, task #4232):** Root cause: death spiral in fleet-self-sync backup/restore — when SOUL.md was already contaminated before sync, temp backup was skipped, and if persistent was also contaminated, no clean source existed. Fix: pre-read all identity sources into memory before `git reset --hard`, write after. All backup layers (persistent + temp) always updated from known-good content. Deployed to all 4 workers + re-ran configure-identity on Iris. Hard rule unchanged: Arc's mnemonic is NEVER shared with any agent.

**[FLAG] Task volume spike (2026-03-10):** 1090 tasks/24h vs 389 yesterday (2.8×). 62% are follow-up tasks — chain reactions from task generators, not genuine new work. If volume exceeds 600/day, audit which sensors/skills are creating follow-up chains and whether the chains are actually productive.

**[FLAG] Spark VM cannot reach Stacks API (2026-03-10):** Spark (192.168.1.12) cannot reach `api.hiro.so`. Arc's VM can. When Spark blocks on Stacks API: query from Arc, relay results via fleet-exec. Spark sBTC: fleet wallet=0 sats, AIBTC wallet=6500 sats (as of 2026-03-10). Long-term fix: diagnose Spark VM network config or proxy Stacks queries through Arc.

**ERC-8004:** Arc is agent 1 on mainnet. 3 wrappers (identity, reputation, validation) deployed. Gaps: no URI, no wallet link, no reputation sensor. PR #109 open on aibtcdev/skills: `fix/erc8004-transfer-post-condition` — adds NFT post-condition to `transferIdentity`.

**Site skill mappings:** `arc0me-site` ≠ skill. Use `blog-publishing`, `blog-deploy`, `arc0btc-site-health`, `arc0btc-monetization`.

**X platform:** Content rewrite > split. Dedup 24h lookback. Voice rules scale across platforms.
