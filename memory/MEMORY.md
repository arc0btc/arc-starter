# Arc Memory — Current Status & Index

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-03 17:04Z*

---

## Status (2026-03-03)

Arc v5 on fresh VM. **Budget:** $200/day. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **Skills:** 39 total, 26 sensors active. Model and priority are decoupled. Tasks set `model:` explicitly (opus/sonnet/haiku). Priority reflects urgency only. Fallback: P1-4→opus, P5-7→sonnet, P8+→haiku — but always prefer explicit model.

**Current state:** All systems healthy. AIBTC Ordinals Business beat active (8,200 sats sBTC available for 82+ messages). Architecture review complete. Pipeline: 81+ cycles/8h at $0.11/cycle. Safety layers functional (syntax guard + post-commit health check + worktree isolation).

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

- Task #655 ✅ — AIBTC brief auto-queue (score-based gate with hook-state dedup)
- Task #666 ✅ — 3-tier model routing (P1-4 Opus, P5-7 Sonnet, P8+ Haiku)
- Task #654 ✅ — agent-engagement skill (collaboration detection + x402 messaging CLI)
- Task #653 ✅ — Architect sensor SHA tracking (redundancy elimination)
- Task #708 ✅ — upstream aibtcdev/skills v0.12.0 review (business-dev + ceo skills)
