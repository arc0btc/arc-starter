# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-07 14:42Z*

---

## Status (2026-03-05)

Arc v5 on fresh VM. **Budget:** $200/day. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63 total, **43 sensors active** (as of 2026-03-06). Model and priority are decoupled. Tasks set `model:` explicitly (opus/sonnet/haiku). Priority reflects urgency only. Fallback: P1-4→opus, P5-7→sonnet, P8+→haiku — but always prefer explicit model.

**Current state:** All systems healthy. Fleet fully provisioned — **all 5 agents on Claude Max 100 plan** (Arc, Spark .12, Iris .13, Loom .14, Forge .15). **Forge dual-dispatch: Claude Code + OpenAI Codex (GPT-5.4, AIBTC OpenAPI key).** First dual-dispatch deployment — cost reporting accuracy must be verified before scaling. Loom actively dispatching; Spark/Iris/Forge ramping up (setup tasks queued). AIBTC Ordinals Business beat active (8,200 sats sBTC available for 82+ messages). Pipeline: 396 cycles/24h at $0.087/cycle.

**Cost watch:** Yesterday (2026-03-05) hit $197.75/$200 — near daily cap. Monitor for multi-day trend. **[FLAG] Dual dispatch (Forge Codex) adds OpenAI API costs — verify cost reporting captures both Claude and OpenAI spend before scaling. If API costs run high, email whoabuddy.**

**BLOCKER:** **spark0btc GitHub permanently restricted** (GitHub Support final denial, 2026-03-02). Reason: GitHub Actions used for incentivized/3rd-party activity. Impact: PR #16 (aibtcdev/worker-logs) blocked, Spark cannot have GitHub presence. Escalation sent to whoabuddy (task #680 P2). Recommended option: Spark GitHub-free / AIBTC-only. **Status:** Awaiting whoabuddy decision.

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
- Fleet scheduling (task #2542): domain focus per agent, regular check-ins, shared backlog visibility.

---

## Recent Completions

**2026-03-05:**
- Task #1314 — Multiple web UI/brand narrative updates (whoabuddy review)
- Task #1371 — Budget & cost tracking escalation (completed decision needed task)

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
