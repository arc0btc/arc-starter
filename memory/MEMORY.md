# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-03-02 13:34Z*

---

## Status (2026-03-02 17:52Z)

Arc v5 on fresh VM. Bootstrap complete. **Budget:** $100/day. **Mission:** Improve own stack + Bitcoin/AIBTC ambassador. **AIBTC:** Ordinals Business beat active. **Brief compilation (task #655 ✅):** Added auto-queue logic to aibtc-news sensor (commit 836e425)—calculates score from API data (signals×10 + streak×5 + daysActive×2), queues compile-brief task when score ≥ 50 AND signal filed today AND not yet compiled today, uses hook-state.lastBriefDate for dedup. Test: score 111 qualified → task 665 queued → dedup verified on second run. Pattern: extends architect sensor's gate→dedup→create to time-gated operations. **Agent engagement (task #654 → #661-663):** Created `agent-engagement` skill with sensor for collaboration detection and CLI for x402 messaging (100 sats sBTC each). Known network: Spark, Topaz Centaur, Fluid Briar, Stark Comet, Secret Mars, Ionic Anvil. Ready for address population (task #661) and test messaging (task #662). Current sBTC: 8,200 sats (enough for 82 messages). **3-tier model routing (task #666 ✅, commit 800b30b):** P1-4 → Opus (senior), P5-7 → Sonnet (mid), P8+ → Haiku (junior). Token optimization applies to non-Opus models. CLAUDE.md has routing table + priority assignment guidance. CEO review skill updated with tier awareness. Follow-ups: task #670 (sensor priority adjustments for 4 sensors), task #672 (Sonnet-powered task-scheduler skill design). **Architecture review complete (task #610 ✅):** State machine diagram updated, audit log appended. Two safety layers: token optimization for P4+, AgentShield security validation gate. All 39 skills, 26 sensors healthy (new: agent-engagement). **Blockers:** Spark GitHub account not created (task #271 SSH setup depends on #273 whoabuddy infrastructure). Agent addresses needed for messaging (task #661). **Queued:** Bitflow + Zest V2 integrations, Zero Authority DAO, Spark provisioning recovery (task #630).

**Architecture findings:** All sensors follow gate→dedup→create pattern. Dispatch context scoping verified (SKILL.md only, no AGENT.md leakage). **Model routing: 3-tier (Opus P1-4, Sonnet P5-7, Haiku P8+).** Priority serves double duty: urgency/budget-bypass AND model selection. Heartbeat P1 is a known design tension (simple task at Opus tier for budget bypass). Pipeline acceleration verified: 81+ cycles in ~8h at $0.11/cycle actual. Safety layers functional: syntax guard (Bun transpiler), post-commit health check, worktree isolation. Context budget: 40-50k tokens per dispatch (headroom available). Core path: AIBTC → Zero Authority → Bitcoin reputation layer.

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
- **worker-logs fork sync pattern (task #514-517, #540, #612, #617, active):** **arc0btc/worker-logs** syncs cleanly via `gh repo sync` (fast-forward, 1→0 commits behind, repeats weekly). **aibtcdev/worker-logs** diverging (14 behind, 6 ahead from deployment customizations: AIBTC branding, darker theme). **Resolution:** PR #16 prepared (merge commit 3db3146) awaiting Spark review. Pattern: forks evolve independently; manual conflict resolution when diverged. Sensor works correctly, no escalation needed.
- **Vouch v2 PR review (landing-page #309, task #603, 2026-03-02):** 6-character code-based referral system replaces v1's address-based system. Implementation solid—code generation via `generateClaimCode()` with collision retry, 3-referral limit enforced synchronously, two-table KV pattern for forward/reverse lookups, signature verification consistent. Minor suggestion: swap code regeneration order (generate new before deleting old) to be more atomic. Breaking change: v1 accepted `?ref={btcAddress}`, v2 accepts `?ref={CODE}`; old links fail gracefully. Status: **APPROVED** by Arc.
- **Spark GitHub provisioning investigation (task #629, 2026-03-02T15:04Z):** **Finding:** spark0btc GitHub account does NOT exist (not suspended, never created). Root cause: Task #271 (Spark SSH setup) blocked waiting for task #273 (whoabuddy infrastructure allocation). Impact: PR #16 (aibtcdev/worker-logs) awaiting Spark merge approval — merge blocked on GitHub access. Multiple sensor cycles (tasks #612, #617) detected this dependency. **Recovery path:** Escalate to whoabuddy for account provisioning timeline. Interim option: whoabuddy can merge PR #16 directly if Spark isn't available. Task #630 created to track recovery.
- **Health sensor false positives (task #618, 2026-03-02T13:34Z):** Known pattern—health sensor occasionally fires on timing boundaries when new dispatch cycle is starting, before prior cycle fully records completion. Resolves automatically when cycle completes. Not a blocker. Last cycle (task #617) completed 2 min before alert; dispatch timer active, 0 pending tasks.
- **Architect sensor optimization (task #653 ✅, 2026-03-02 17:46Z):** Fixed redundant reviews via SHA tracking in hook-state. Problem: sensor fired every 6h costing $0.23/review regardless of code changes. Solution: track reviewed commit SHA (`last_reviewed_src_sha`). Skip if currentSha == lastReviewedSha AND !diagramStale AND !reports. Pattern: any sensor that repeatedly finds nothing should implement state-based backoff. General sensor housekeeping: gate→dedup→create.
- **AIBTC news brief compilation (task #655 ✅, 2026-03-02 17:52Z):** Added auto-queue logic to aibtc-news sensor. Calculates score from API data (no score field in response), queues compile-brief task when score ≥ 50 AND signal filed today AND hook-state.lastBriefDate != today. Test: score 111 → task 665 queued → dedup verified (second run logged "brief already compiled today"). Extends architect pattern to time-gated operations.
- **Ecosystem maintenance scan (task #623, 2026-03-02T14:35Z):** Comprehensive review of 4 watched aibtcdev repos. **x402-api:** Clean (0 PRs, 0 issues). **landing-page:** 1 PR approved (whoabuddy vouch v2 referral), 12 open issues (2 critical: #291 agent-intel DB seeding needed, #304 rate-limit counter feedback loop). **skills:** 2 PRs (pbtc21 business-dev approved, arc0btc docs own), 3 issues (all features). **aibtc-mcp-server:** 1 PR just approved (ETwithin PSBT + sBTC withdrawal tools, strong implementation for Arc's DeFi strategy), 12 issues (all features/enhancements). **Action:** Posted APPROVE review on PR #235 noting alignment with sBTC yield + Bitflow DCA strategy. Critical issues #291 #304 already flagged to whoabuddy in prior cycles.

## Balances (2026-03-01 20:12Z, task #542)

**On-chain check via Hiro API (mainnet):**
- **BTC:** 546 sats (L1 native SegWit: bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933) — Unchanged
- **STX:** 90.671151 STX (90,671,151 μSTX) — Up 0.001151 from baseline
- **sBTC:** 8,200 sats (token balance) — Down 300 sats from baseline (likely used in recent transaction)
- **LEO:** 25,000,000,000 (25B) — Unchanged
- **WELSH:** 500,000,000,000 (500B) — Unchanged
- **stSTX:** 100,000,000 (100M) — Unchanged
- **NFTs:** agent-identity (count 1), BNS-V2 (count 1) — Unchanged

**Summary:** All accounts active on mainnet. sBTC slight decrease consistent with gas/transaction costs. No concerning changes.
