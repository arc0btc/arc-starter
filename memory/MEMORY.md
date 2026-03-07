# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-05 19:17Z*

---

## Status (2026-03-05)

Arc v5 on fresh VM. **Budget:** $200/day. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 63 total, **43 sensors active** (as of 2026-03-06). Model and priority are decoupled. Tasks set `model:` explicitly (opus/sonnet/haiku). Priority reflects urgency only. Fallback: P1-4→opus, P5-7→sonnet, P8+→haiku — but always prefer explicit model.

**Current state:** All systems healthy. AIBTC Ordinals Business beat active (8,200 sats sBTC available for 82+ messages). Architecture review complete. Pipeline: 396 cycles/24h at $0.087/cycle. Safety layers functional (syntax guard + post-commit health check + worktree isolation).

**Cost watch:** Yesterday (2026-03-05) hit $197.75/$200 — near daily cap. Monitor for multi-day trend. Today at $34.25 (17%) with cycle still active.

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

**Known agents:** Topaz Centaur (Spark), Fluid Briar, Stark Comet, Secret Mars. X402 capable (100 sats/msg).

**Repos:** arc0btc primary (`arc-starter`, `arc0me-site`, `arc0btc-worker`). aibtcdev collaborative. **Escalations:** whoabuddy for Stacks/Bitcoin/strategy.

**Key paths:** `~/.aibtc/wallets/`, `~/.aibtc/credentials.enc` (AES-256-GCM), `github/aibtcdev/skills/`.

## Topic Files

- **[patterns.md](patterns.md)** — Operational patterns: architecture safety, sensor design, task routing, PR review feedback, integration sync strategies
- **[archive.md](archive.md)** — Historical: aibtcdev/skills v0.12.0 release, on-chain balances (2026-03-01), GitHub restrictions resolution

---

## Recent Completions

**2026-03-05:**
- Task #1314 — Multiple web UI/brand narrative updates (whoabuddy review)
- Task #1371 — Budget & cost tracking escalation (completed decision needed task)

**2026-03-03:**
- Task #655 ✅ — AIBTC brief auto-queue (score-based gate with hook-state dedup)
- Task #666 ✅ — 3-tier model routing (P1-4 Opus, P5-7 Sonnet, P8+ Haiku)
- Task #654 ✅ — agent-engagement skill (collaboration detection + x402 messaging CLI)
- Task #653 ✅ — Architect sensor SHA tracking (redundancy elimination)
- Task #708 ✅ — upstream aibtcdev/skills v0.12.0 review (business-dev + ceo skills)

## ERC-8004 State (Audited 2026-03-07, Task #2027)

**Arc IS agent 1 on mainnet.** Owner: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`. Confirmed on-chain. Research reports (tasks #1991, #2013) incorrectly claimed registration was missing — memory failure, not code gap.

**Skills:** 3 wrappers (`erc8004-identity`, `erc8004-reputation`, `erc8004-validation`) delegate to `github/aibtcdev/skills/`. All have full CRUD CLIs.

**Bugs found & fixed:**
- ~~Network env var missing in reputation/validation wrappers~~ → Fixed (was defaulting to testnet)
- `get-last-id` returns "no agents registered" despite agent 1 existing → upstream bug
- `get-summary` (reputation + validation) fails to parse when no data exists → upstream empty-data handling bug

**Real gaps (not false alarms):** No URI set (domain verification blocked), no wallet linked, no reputation sensor yet.

## Site Skill Mappings (Task #1960)

`arc0me-site` is a **repo directory** (`github/arc0btc/arc0me-site`), NOT a skill name. Using it in a task's `skills` array is an invalid reference. Use:
- arc0.me blog work → `blog-publishing`, `blog-deploy`
- arc0btc.com site/infra work → `arc0btc-site-health`, `arc0btc-monetization`

## X Platform Agent Learnings (Task #1463)

- **Content rewriting beats splitting.** When content doesn't fit the medium, rewrite shorter rather than restructure. Pattern applies to Discord, Nostr, Bluesky, SMS — any character-limited platform.

- **Dedup check prevents credibility death spiral.** Repetition looks like automation, killing perceived agency. Solution: 24h lookback dedup before posting.

- **Voice rules distill across platforms.** Universal principles + platform constraints = platform-specific AGENT.md. Scales to new platforms without re-deriving fundamentals.
