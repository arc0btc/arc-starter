# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-02-28 23:45Z*

---

## Status (2026-03-01 00:20Z)

Arc v5 on fresh VM. Bootstrap complete. **Budget:** $100/day (whoabuddy directive: don't over-optimize early). **Mission:** Improve own stack + Bitcoin/AIBTC ambassador on L1+L2. **AIBTC:** Ordinals Business beat active (1 signal filed 2026-02-28T21:06:49Z, streak=1). **Rate limit (task #401→#404):** Window expires 2026-03-01T01:07:24.776Z (47 min). Task #401 hit early, closed as blocked. Task #404 queued to attempt filing post-window-expiry. No signal queued yet — awaiting rate limit relief. **X:** setup done (task #382). **Blockers:** Spark SSH (task #271). **Queued:** Bitflow + Zest V2 integrations, Zero Authority DAO collaboration (reputation layer).

**Week summary:** 29 skills deployed, worktree isolation verified, workflows + reputation templates live, sensor audit clean (23/25 healthy). Core path: AIBTC → Zero Authority → Bitcoin reputation layer.

## Agent Network & Keys

**AIBTC agents:** Topaz Centaur (spark0btc), Fluid Briar, Stark Comet, Secret Mars. Can send paid inbox (100 sats sBTC). GitHub = coordination; AIBTC = attention + bounties.

**Identity:** Git `224894192+arc0btc@users.noreply.github.com` | Email `arc@arc0.me` (personal), `arc@arc0btc.com` (professional) | BTC `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` | STX `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

**Key paths:** `~/.aibtc/wallets/`, `~/.aibtc/credentials.enc` (AES-256-GCM), `github/aibtcdev/skills/` (reference toolkit)

**Repos:** arc0btc primary (`arc-starter`, `arc0me-site`, `arc0btc-worker`). aibtcdev collaborative (skills, erc-8004-stacks, agent-news, etc). **Whoabuddy:** escalate for deep context on Stacks/Bitcoin/strategy.

## Patterns & Learnings

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **BIP-322 signing** — Arc uses P2WPKH (requires btcAddress verification).
- **Worktrees isolation (task #300 ✅):** Dispatch creates isolated branches + Bun transpiler validates syntax. Prevents agent bricking.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.

## Baseline Balances (2026-02-27)

BTC: 546 sats | STX: 90.67 | sBTC: 8,500 sats | LEO: 25B | WELSH: 500B | stSTX: 100M
NFTs: agent-identity u1, BNS-V2 u358571 (arc0.btc)
