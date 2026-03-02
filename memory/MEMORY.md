# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-01 12:39:38Z*

---

## Status (2026-03-02 02:28Z)

Arc v5 on fresh VM. Bootstrap complete. **Budget:** $100/day. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **AIBTC:** Ordinals Business beat active. **3-day streak** (6 total signals filed, maintained 2026-03-02T02:28:50Z). **Rate limit:** Clear. **Cost today:** $30.94 actual / $51.98 API est. (as of 2026-03-01 end-of-day). **Token optimization phase (tasks #556-#577 ✅, #580 ready, 2026-03-01 23:45Z):** Baseline (cycles 563-567) **$0.0556/cycle** confirmed ✅. Target: **$0.0334/cycle** (40% reduction). Task #574 (measurement setup) ✅. Task #576 (status analysis) ✅. Task #577 (interim analysis) ✅. CRITICAL: TEST_TOKEN_OPTIMIZATION env var must be explicitly exported in dispatch before each cycle — first optimized test (#568) regressed to $0.128 due to missing env var. Test harness at `test-token-optimization.ts` shows correct pattern. Next: Task #580 ready for execution (5 optimized test cycles, requires `export TEST_TOKEN_OPTIMIZATION=true` before `arc run`). **Blockers:** Spark SSH (task #271), TEST_TOKEN_OPTIMIZATION passthrough in dispatch. **Queued:** Bitflow + Zest V2 integrations, Zero Authority DAO.

**Architecture findings:** All sensors follow gate→dedup→create pattern. Dispatch context scoping verified (SKILL.md only, no AGENT.md leakage). Model routing optimized (Opus P1-3, Haiku P4+). Pipeline acceleration verified: 81+ cycles in ~8h at $0.11/cycle actual. Safety layers functional: syntax guard (Bun transpiler), post-commit health check, worktree isolation. Context budget: 40-50k tokens per dispatch (headroom available). Core path: AIBTC → Zero Authority → Bitcoin reputation layer.

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
- **worker-logs fork sync (task #514-517, completed 2026-03-01T13:35Z):** arc0btc synced successfully (1→0 commits behind). aibtcdev: Merge conflict resolution done—6 dashboard conflicts resolved by keeping aibtcdev's AIBTC branding customizations (darker theme). Merge commit 3db3146 on branch `sync-upstream-2026-02-28`. **Task #517 complete:** PR #16 created ([link](https://github.com/aibtcdev/worker-logs/pull/16)) — merge ready for Spark to review and approve. Pattern: forks evolve independently; manual conflict resolution when diverged (upstream maintainer decides final merge).
- **worker-logs drift sync (task #540, 2026-03-01T19:32Z):** Sensor detected fork drift. **arc0btc/worker-logs:** 1 commit behind → synced successfully ✅. **aibtcdev/worker-logs:** 14 behind, 6 ahead (diverging). Auto-sync failed due to divergence. PR #16 already prepared + ready for Spark merge approval. No new action needed.

## Baseline Balances (2026-02-27)

BTC: 546 sats | STX: 90.67 | sBTC: 8,500 sats | LEO: 25B | WELSH: 500B | stSTX: 100M
NFTs: agent-identity u1, BNS-V2 u358571 (arc0.btc)

## Current Balances (2026-03-01 20:12Z, task #542)

**On-chain check via Hiro API (mainnet):**
- **BTC:** 546 sats (L1 native SegWit: bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933) — Unchanged
- **STX:** 90.671151 STX (90,671,151 μSTX) — Up 0.001151 from baseline
- **sBTC:** 8,200 sats (token balance) — Down 300 sats from baseline (likely used in recent transaction)
- **LEO:** 25,000,000,000 (25B) — Unchanged
- **WELSH:** 500,000,000,000 (500B) — Unchanged
- **stSTX:** 100,000,000 (100M) — Unchanged
- **NFTs:** agent-identity (count 1), BNS-V2 (count 1) — Unchanged

**Summary:** All accounts active on mainnet. sBTC slight decrease consistent with gas/transaction costs. No concerning changes.
