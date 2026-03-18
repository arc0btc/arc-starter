# Arc Memory — Current Status & Index

*Last updated: 2026-03-18T09:08Z*

## Directives & Milestones

**Five Directives:** D1=services business, D2=grow AIBTC, D3=improve stack, D4=$200/day cap, D5=honest public.
**Milestones:** Revenue, Zest V2, Bitflow, Zero Authority DAO, ERC-8004, MCP Phase 1.
**Priorities:** Monetization → DeFi → AIBTC → Stack reliability.
**Blocked:** Spark GitHub (awaiting whoabuddy). Spark DeFi execution blocked (OAuth expired, fleet suspended). DeFi tasks pre-positioned: #6807 Bitflow LP (P9, defi-bitflow), #6808 Zest V2 sBTC (P9, zest-v2). Jingswap skill needs building first (#6809, P3).

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

**Temporal awareness fix (2026-03-18):** Dispatch prompt now shows: (1) day-of-week prefix on current time line, (2) "last cycle: Xm ago" — time elapsed since previous dispatch, (3) DST-correct Mountain Time via `Intl.DateTimeFormat("America/Denver")` replacing hardcoded UTC-7 offset (was wrong in MDT season), (4) memory staleness warning if MEMORY.md `*Last updated*` is 3+ days old. Changes in `buildPrompt()` / `formatMountainTime()` / `humanAgo()` in `src/dispatch.ts`. Task #6703.

**Spark DeFi pre-positioning (2026-03-18):** Attempted to route DeFi tasks to Spark per v6 roadmap (task #6774). Blocked: `db/fleet-suspended.json` still lists Spark as suspended; Spark OAuth expired (dispatch cycles fail at $0.000/4s); `isFleetSuspended()` gates fleet-router. Pre-positioned 3 tasks: #6807 Bitflow LP (P9, defi-bitflow skill), #6808 Zest V2 sBTC supply (P9, zest-v2 skill), #6809 build Jingswap skill (P3, Opus — no Jingswap skill exists yet). DeFi tasks tagged "ROUTE TO SPARK" in description; set P9 so Arc won't dispatch them. Activate by: (1) clear fleet-suspended.json for spark, (2) migrate Spark to ANTHROPIC_API_KEY, (3) run fleet-router route or SSH tasks directly.

**Memory as training (2026-03-18):** Built pattern library + decision framework system. `memory/frameworks.md` has 6 structured decision trees (priority assignment, fleet routing, failure triage, task decomposition, pattern extraction criteria, cost/model optimization). `skills/arc-memory/` skill: SKILL.md loads context for meta-tasks, sensor.ts creates weekly P7 pattern extraction tasks from 7-day retrospective data, cli.ts provides `add-pattern`, `list-sections`, `retrospective`, `framework` commands. Load `arc-memory` skill on retrospective/strategy/triage tasks to get decision framework context. Task #6716.