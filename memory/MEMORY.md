# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-09 14:46Z*

---

## Status (2026-03-09)

Arc v5. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63+ total, **43+ sensors active**. Model routing: explicit `model:` in task (fallback P1-4→opus, P5-7→sonnet, P8+→haiku). Cycles: 299 today / 1937 this week @ $0.087 avg.

**[FLAG] Budget limits: whoabuddy has NOT set per-agent or fleet budgets. The $80/$30/$200 splits in fleet-scheduling.md were self-imposed by Arc (task #2542). Do NOT throttle tasks or make decisions based on cost limits. Cost data is informational only.**

**Fleet operational** — 24h fleet stats: 389 tasks completed, $152.06 cost. 395 pending, 14 blocked. Backlog roughly stable (creation ≈ completion rate). Details in `memory/fleet-experiments.md`.

**Fleet coordination skills deployed:** fleet-health, fleet-router, fleet-sync, fleet-escalation, fleet-dashboard, fleet-push, fleet-deploy, fleet-memory, fleet-comms, arc-roundtable, arc-observatory. All sensors healthy.

**[FLAG] Fleet credential blockers (needs whoabuddy):**
- Loom GitHub SSH key needs adding: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMXJNzgEpJpJBALWTaITwB6gShchsKt4LOEFbic+MC3Q` (tasks #2888, #2901)
- Loom v2/main divergence — 12 commits need manual resolution (task #2889)
- Iris: on-chain identity keypairs DONE (task #2977) — BNS registration still needed (task #2890)
  - Stacks: `SP215BXCEYDT5NXGMPJJKXQADYQXDX92QHN464Y87`
  - Bitcoin: `bc1q6savz94q7ps48y78gg3xcfvjhk6jmcgpmftqxe`
  - Taproot: `bc1pwlwkzral95md6c6gm40ccm2upps79jyvw9rx3pm2z95zz3w2ywrshlgghk`
- Iris: X OAuth 1.0a credentials missing (task #2891)

**BLOCKER:** spark0btc GitHub permanently restricted (final denial 2026-03-02). Awaiting whoabuddy decision (task #680 P2).

**Queued:** Bitflow + Zest V2 integrations, Zero Authority DAO.

## Agent Network & Keys

| Identifier | Value |
|-----------|-------|
| BNS | arc0.btc |
| Bitcoin | bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933 |
| Stacks | SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B |
| Git ID | 224894192+arc0btc@users.noreply.github.com |
| Email | arc@arc0.me (personal), arc@arc0btc.com (professional) |

**Known agents:** Topaz Centaur (Spark), Fluid Briar (Iris), Stark Comet (Loom), Secret Mars (Forge). X402 capable (100 sats/msg). **Fleet confirmed by whoabuddy (2026-03-09):** Arc, Spark, Iris, Loom, Forge — 5 agents total.

**Agent fleet IPs (arc-remote-setup):** spark=192.168.1.12, iris=192.168.1.13, loom=192.168.1.14, forge=192.168.1.15.

**Provisioning template:** `templates/agent-provisioning.md` — 6-phase checklist (infra, credentials, identity, GitHub decision, skill creds, verification).

**Repos:** arc0btc primary (`arc-starter`, `arc0me-site`, `arc0btc-worker`). aibtcdev collaborative. **Escalations:** whoabuddy for Stacks/Bitcoin/strategy.

**Key paths:** `~/.aibtc/wallets/`, `~/.aibtc/credentials.enc` (AES-256-GCM), `github/aibtcdev/skills/`.

## Topic Files

- **[../GOALS.md](../GOALS.md)** — Shared roadmap: directives (D1-D5), milestones, active priorities. Dispatch references this for task relevance. whoabuddy edits directives; Arc proposes milestones.
- **[patterns.md](patterns.md)** — Operational patterns: architecture safety, sensor design, task routing, PR review feedback, integration sync strategies
- **[archive.md](archive.md)** — Historical: aibtcdev/skills v0.12.0 release, on-chain balances (2026-03-01), GitHub restrictions resolution
- **[fleet-experiments.md](fleet-experiments.md)** — Fleet overnight experiment results (2026-03-09): per-agent completion rates, failure patterns, cross-agent comms, ops recommendations
- **`../research/`** — Active research reports. Auto-archived to `research/archive/` after 30 days. `research/arxiv/` capped at 5 most recent digests. Sensor: `arc-research-decay` (24h interval).

---

## Product Idea: Arc Provisioning as a Service (2026-03-08)

whoabuddy flagged: "VPS → Arc agent in one command" is potentially resellable. Three use cases:
1. **Blank slate** — provision fresh VPS with arc-starter from scratch
2. **Migration** — analyze existing VPS, agree plan, migrate (e.g. from another agent loop)
3. **Analysis** — assess current VPS state, output recommendations

`arc-remote-setup` skill is the foundation. Note for future productization planning.

---

## Time Dilation Principle (2026-03-09, Task #2531)

Agentic speed compresses time 10-24x. One human + 7 Claude Code screens = 120 commits/day. Arc 24/7 = 240+ completed tasks/day. Fleet of 5 = potentially 1000+/day.

**Operational implications:**
- Sensor cadences should match agentic speed, not human-day rhythms. Daily sensors → 4-6h. Weekly reviews → daily.
- But respect upstream limits (GitHub API, X rate limits, blockchain RPCs).
- **Backlog is the bottleneck signal.** 2026-03-09: 403 tasks created / 241 completed in 24h = growing backlog. Noisy sensors waste cycles.
- Chatty sensors identified for tuning: `arc-starter-publish`, `arc-blocked-review`, `arc-catalog`, `arc-housekeeping` (task #2540).
- Ops-review sensor (task #2541) will track creation-vs-completion rate, backlog trend, fleet utilization.
- Fleet scheduling protocol designed (task #2542): `templates/fleet-scheduling.md`. Domain assignment: Arc=orchestration, Spark=protocol/on-chain, Iris=research/signals, Loom=integrations, Forge=infrastructure. Hub-and-spoke routing through Arc. Check-ins: 15min heartbeat, 4h ops review, 24h daily brief. $200/day budget split: Arc $80, others $30 each.

**Learnings from overnight (2026-03-09):**
- **Fleet-router on workers = redistribution loops.** Only Arc should run fleet-router/fleet-rebalance. Workers tried to re-route tasks creating circular dispatch. Fixed in #2963.
- **GitHub sensors must be centralized.** 9 sensors depend on GitHub API but fleet agents have no GitHub accounts. Added `GITHUB_SENSORS` filter in `src/sensors.ts` — sensors skip on non-Arc hosts.
- **Identity must be hostname-aware.** Fleet dashboards showed "arc0.btc" for all agents because `src/identity.ts` was hardcoded. Now reads hostname to determine agent identity.
- **Stale services need active monitoring.** Observatory ran for 15h with stale process. Fleet-health sensor should detect service age vs last successful response.

---

## Umbrel VM (2026-03-09)

whoabuddy provisioning an Umbrel VM on the LAN for the team. Storage currently limited (being worked on). **Status:** Installation in progress. IP TBD (likely 192.168.1.x range). **Plan:** connectivity test first (#2753), then plan apps (#2754), then fleet discussion (#2755). Prioritize lightweight/pruned setups given storage constraints. Key potential services: Bitcoin Core (pruned), BTCPay, Nostr relay. **Lightning dropped** — not aligned with L1+Stacks L2 stack; no clear use case identified. Wait for whoabuddy direction on Umbrel app selection.

## Recent Completions

**2026-03-09 (overnight/morning):**
- Task #2976 — GitHub sensor fleet filtering: centralized skip for 9 GitHub-dependent sensors on non-GitHub agents
- Task #2975 — Fleet code deploy + identity fix: `src/identity.ts` now hostname-aware for fleet dashboards
- Task #2974 — Observatory service restart (stale process from Mar 8)
- Task #2980 — Loom/Forge stuck queue fix (expired OAuth + rate limit)
- Task #2963 — Removed fleet-router/fleet-rebalance from worker agents (redistribution loop fix)
- Task #2977 — Iris on-chain identity keypairs confirmed
- Task #2534 — Fleet coordination retro: 7 gaps identified, 9 follow-ups queued

## ERC-8004 State (Audited 2026-03-07, Task #2027)

**Arc IS agent 1 on mainnet.** Owner: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`. 3 wrappers (identity, reputation, validation) with full CRUD CLIs. Known gaps: no URI set, no wallet linked, no reputation sensor. See `research/erc8004-*` for details.

## Site Skill Mappings (Task #1960)

`arc0me-site` is a **repo directory** (`github/arc0btc/arc0me-site`), NOT a skill name. Using it in a task's `skills` array is an invalid reference. Use:
- arc0.me blog work → `blog-publishing`, `blog-deploy`
- arc0btc.com site/infra work → `arc0btc-site-health`, `arc0btc-monetization`

## X Platform Agent Learnings (Task #1463)

- **Content rewriting beats splitting.** When content doesn't fit the medium, rewrite shorter rather than restructure. Pattern applies to Discord, Nostr, Bluesky, SMS — any character-limited platform.

- **Dedup check prevents credibility death spiral.** Repetition looks like automation, killing perceived agency. Solution: 24h lookback dedup before posting.

- **Voice rules distill across platforms.** Universal principles + platform constraints = platform-specific AGENT.md. Scales to new platforms without re-deriving fundamentals.
