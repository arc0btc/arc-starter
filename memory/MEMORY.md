# Arc Memory — Current Status & Index

*Last updated: 2026-03-13T10:25Z*

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy).

## Fleet Roster

| Agent | IP | Bitcoin | Role |
|-------|-----|---------|------|
| Arc | 192.168.1.10 | bc1qlezz2... | Orchestrator |
| Spark | 192.168.1.12 | bc1qpln8... | AIBTC/DeFi |
| Iris | 192.168.1.13 | bc1q6sav... | Research/X |
| Loom | 192.168.1.14 | bc1q3qa3... | CI/CD |
| Forge | 192.168.1.15 | bc1q9hme... | Infra |

## Critical Flags (2026-03-11)

**FLEET DEGRADED:** Workers (Spark, Iris, Loom, Forge) suspended by Anthropic for account use violations. Arc is sole executor. Forge has OpenRouter fallback. whoabuddy appealing. Do NOT route to workers.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

**Dispatch gate:** Rate limits → immediate stop + email whoabuddy. 3 consecutive failures → same. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**Umbrel node (192.168.1.106):** Bitcoin Core must run full (currently pruned). Stacks node + API planned. Storage expansion pending.

**x402 NONCE_CONFLICT:** Sentinel file `db/hook-state/x402-nonce-conflict.json` gates welcome sensors. Welcome dedup fixed (sensor checks interaction history before queueing). ~60 contacts still pending re-welcoming once relay clears. **x402-sponsor-relay v1.18.0 deployed 2026-03-12** — nonce retry backoff increased 1s→30s (reduces cascade), /health now surfaces nonce pool state.

## Fleet Architecture

- GitHub sensors centralized (Arc-only). Pre-dispatch gate routes GitHub tasks to Arc.
- OAuth: Workers use ANTHROPIC_API_KEY (OAuth unreliable across VMs).
- Identity drift: Mnemonic never shared. Fleet-sync backup/restore fixed.
- Welcome dedup: Verify completion in DB, not task creation.
- Monitoring: Arc's 74 sensors unaffected. Worker sensors down during suspension.

## Key Learnings

**Sentinel file pattern:** For 402/CreditsDepleted or transient gate conditions, write sentinel (e.g. `db/x-credits-depleted.json`) and gate all downstream callers. Check before runtime failure.

**Welcome sensor bug:** Never mark state on creation. Use `completedTaskCountForSource()` verification. Chain-reaction follow-ups: 62% of volume — audit if >600/day.

**Agent identities:** Arc=Trustless Indra (1), Spark=Topaz Centaur (29), Loom=Fractal Hydra (85), Forge=Sapphire Mars (84), Iris=not yet registered (task #2890).

**Site mapping:** `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X dedup: 24h window, rewrite > split. Hub posting discontinued.

**Auth cascade pattern:** OAuth token expiry causes a wave of consecutive auth-error failures before recovery. Mitigation: ANTHROPIC_API_KEY fallback now in dispatch.ts (task #5215). When a cascade happens, whoabuddy refreshes OAuth; dispatch auto-recovers.

**Model field fix (2026-03-12):** Resolved — `updateTask(task.id, { model: cycleModelLabel })` added to dispatch.ts (commit 6dfb32d). Backfilled 1660 historical tasks from cycle_log. ~1182 older tasks remain NULL (pre-date model tracking or never dispatched).

**Zero Authority DAO monitoring (2026-03-12):** Sensor removed (no on-chain contracts exist yet). CLI + daos.json config ready at `skills/dao-zero-authority/`. Standing instruction: rebuild sensor.ts and re-enable polling when Zero Authority deploys contracts on Stacks. Task #5369 completed as infrastructure-ready.

**arc-payments rename (2026-03-12):** `stacks-payments` → `arc-payments`. Now monitors both STX token_transfer and sBTC SIP-010 contract_call (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). PR review sensor accepts both old and new source prefixes for backwards compat. Hook state key is now `arc-payments` (cold-start safe, dedup handles reprocessing).

**SkillMaintenanceMachine (2026-03-12):** Added `skill-maintenance` state machine for email-signal→audit→fix pattern. Reduces ad-hoc handling when recurring skill failures surface via email. Lives in `skills/arc-workflows/` state machine registry.

**agentslovebitcoin.com (2026-03-12):** Aligned with whoabuddy on 4-phase long-horizon plan. Phase details in email thread. This is a D1/D2 strategic initiative — monitor for follow-up tasks.

**Volume vs. strategy (2026-03-13):** 243 tasks/day, all sensor-driven, no human-initiated. With fleet degraded, reactive GitHub/PR review volume can crowd out D1/D2 strategic work. Watch for this pattern — strategic tasks may need explicit scheduling or higher priority to compete with sensor load.

**Cost optimization (2026-03-13):** Daily cost report analysis shows blog-publishing driving 30% of spend via token-heavy watch reports. Two Opus tasks reviewed: MCP scaffold (justified for architecture), arc-payments CLI (can move to Sonnet). Recommend: (1) Profile blog generation token ratio (input vs output), (2) Route arc-payments CLI to Sonnet for future iterations, (3) Audit blog-publishing sensor cadence (multiple reports/day suggests consolidation opportunity). Current spend $7.96 is healthy; no budget concerns.

**Cloudflare outage sentinel (2026-03-13):** 5 failed tasks from a single CF outage (all HTTP 502 pre-flight checks). Retries queued without gating — same pattern as x402 nonce conflict. Fix: add sentinel file `db/hook-state/cf-outage.json` when pre-flight returns 502; gate all subsequent deploy tasks until sentinel clears (e.g., 30min TTL or manual reset). Task #5538 had a real fix (duplicate `published_at` frontmatter) that landed correctly — the noise was entirely the retry storm after the fix. Follow-up task created to implement sentinel gate.

**End-of-day cost report (2026-03-13T10:25Z):** Code $19.3155 (API $29.5847) | 26027.1k tokens | 71 tasks. blog-publishing remains top token consumer (2973.7k tokens, 8 tasks) confirming token-heavy watch report pattern. arc-email-sync now top skill by code cost ($2.5660). aibtc-news-editorial V2 migration justified at $1.9234 (architectural work). Daily cap: well under $200/day. Action: audit blog-publishing sensor cadence and profile token ratio (input vs output) to identify consolidation opportunity. Task #5549 created.