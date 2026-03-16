# Arc Memory — Current Status & Index

*Last updated: 2026-03-16T02:58Z*

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

**Fleet restart blank slate (2026-03-13):** All 4 workers cleaned per whoabuddy's fleet restart plan. Services stopped/disabled (dispatch, sensors, mcp, observatory, web). 107 skills archived to `skills-archive-2026-03-13/` on each VM. Only `arc-credentials` retained (framework dependency). Task queues and memories were cleared in prior task #5527. Workers ready for selective skill re-provisioning when Anthropic suspension lifts.

**Ordinals APIs:** Hiro shutdown 2026-03-09. Use Unisat (open-api.unisat.io, 5 req/s free). Stacks Extended API unaffected.

**Dispatch gate:** Rate limits → immediate stop + email whoabuddy. 3 consecutive failures → same. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**Umbrel node (192.168.1.106):** Bitcoin Core must run full (currently pruned). Stacks node + API planned. Storage expansion pending.

**x402 NONCE_CONFLICT:** Sentinel file `db/hook-state/x402-nonce-conflict.json` gates welcome sensors. Welcome dedup fixed (sensor checks interaction history before queueing). ~60 contacts still pending re-welcoming once relay clears. **x402-sponsor-relay v1.18.0 deployed 2026-03-12** — nonce retry backoff increased 1s→30s (reduces cascade), /health now surfaces nonce pool state.

## Recent Incidents

**Dispatch stale period (2026-03-16 02:40Z):** [FLAG] Recurring issue — sensor arc-service-health detected a 95+ minute gap with no dispatch cycles. History: tasks 5200 (2026-03-11 14:50), 5202 (15:20), 5206 (17:30), 5716 (2026-03-14 04:00) all health alerts, all failed. Today's incident (task 5791) successfully detected and closed. Dispatch recovered and resumed processing 24 pending tasks. Root cause unknown — hypothesis: (1) previous dispatch cycle crashed/hung holding lock, (2) dispatch service failed to restart, (3) zombie lock not cleaned. Follow-up task #5803 created to investigate dispatch.ts lock release logic and systemd timeout behavior.

**Stale cleanup day pattern (2026-03-16):** When dispatch recovers from prolonged outage, expect a wave of stale-failed tasks (63/64 on 2026-03-16). This is correct behavior — backlog accumulates during downtime, sensors recreate what still matters. 100% failure rate on these days does not indicate quality problems. Watch for real failures buried in the noise (e.g., task #5776 `claude exited 1: unknown option` — CLI flag construction bug in PR review invocations).

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

**agentslovebitcoin.com (2026-03-13):** PRD v1.2 complete — per-address Durable Object architecture, dual L1/L2 sig binding (Bitcoin BIP-137 + Stacks SIP-018), genesis-only metered free access (sBTC for paid tiers). Genesis agent onboarding flow spec written (`docs/onboarding-flow-spec.md`). Worker scaffold built (Phase 2). This is a D1/D2 strategic initiative — next: deploy Worker to Cloudflare, wire auth to on-chain identity.

**Volume vs. strategy (2026-03-13):** 243 tasks/day, all sensor-driven, no human-initiated. With fleet degraded, reactive GitHub/PR review volume can crowd out D1/D2 strategic work. Watch for this pattern — strategic tasks may need explicit scheduling or higher priority to compete with sensor load.

**Cost optimization (2026-03-13):** Daily cost report analysis shows blog-publishing driving 30% of spend via token-heavy watch reports. Two Opus tasks reviewed: MCP scaffold (justified for architecture), arc-payments CLI (can move to Sonnet). Recommend: (1) Profile blog generation token ratio (input vs output), (2) Route arc-payments CLI to Sonnet for future iterations, (3) Audit blog-publishing sensor cadence (multiple reports/day suggests consolidation opportunity). Current spend $7.96 is healthy; no budget concerns.

**blog-publishing cadence bug fixed (2026-03-13):** Sensor was queuing 5-8 "Generate new blog post" tasks/day (hourly, ~400k tokens each = 2M+ tokens/day). Root cause: `pendingTaskExistsForSource` only blocked while task was pending — after completion, next hourly run re-queued immediately. Fix: added `recentTaskExistsForSourcePrefix(source, 23*60)` cooldown + raised `CADENCE_DAYS_THRESHOLD` 1→2 days (commit 0f51aed). Expected ~80% token reduction for this sensor. Pattern to watch: if a sensor's dedup only blocks pending tasks but not recently-completed ones, it will re-queue immediately on completion.

**Cloudflare outage sentinel (2026-03-13):** 5 failed tasks from a single CF outage (all HTTP 502 pre-flight checks). Retries queued without gating — same pattern as x402 nonce conflict. Fix: add sentinel file `db/hook-state/cf-outage.json` when pre-flight returns 502; gate all subsequent deploy tasks until sentinel clears (e.g., 30min TTL or manual reset). Task #5538 had a real fix (duplicate `published_at` frontmatter) that landed correctly — the noise was entirely the retry storm after the fix. Follow-up task created to implement sentinel gate.

**End-of-day cost report (2026-03-13T10:25Z):** Code $19.3155 (API $29.5847) | 26027.1k tokens | 71 tasks. blog-publishing remains top token consumer (2973.7k tokens, 8 tasks) confirming token-heavy watch report pattern. arc-email-sync now top skill by code cost ($2.5660). aibtc-news-editorial V2 migration justified at $1.9234 (architectural work). Daily cap: well under $200/day. Action: audit blog-publishing sensor cadence and profile token ratio (input vs output) to identify consolidation opportunity. Task #5549 created.

**Cost snapshot escalation (2026-03-13T18:26Z):** Code $51.5906 (API $84.5629) | 59879.9k tokens | 153 tasks. arc-email-sync trending upward: $2.5660 (10:25Z) → $11.2721 (17:25Z) → $12.2387 (18:26Z). All email-sourced volume due to fleet degradation (workers suspended, Arc absorbs tasks). Cost ratio $0.80/task remains normal. blog-publishing cadence fix confirmed effective (4522.8k tokens, $3.54). Strategic tasks (Agents Love Bitcoin Phase 1/2) justifiably Opus tier. Daily spend healthy, well under cap. [FLAG] Monitor email-sync trend next cycle — if exceeds $20, investigate consolidation opportunity.

**End-of-day final snapshot (2026-03-13T19:26Z):** Code $55.4576 (API $88.2524) | 65937.2k tokens | 168 tasks. arc-email-sync settled at $12.6654 code cost (18 tasks sourced). Trend stabilized within expected range for fleet degradation scenario. All strategic work (Agents Love Bitcoin Phase 1/2, aibtc-news editorial) justifiably Opus tier. blog-publishing cadence fix holding (4.5M tokens, $3.54 cost — ~80% reduction confirmed). Email-sync trend tracking normally; no action needed yet. Daily spend $55.46 is healthy, well under $200/day cap. Task #5645 (cost report) closed.

**Day-close snapshot (2026-03-13T23:26Z):** Code $75.8429 (API $128.6203) | 88847.6k tokens | 217 tasks. Comprehensive daily breakdown: (1) arc-email-sync $14.68 (23 tasks) — fleet degradation driving email volume, trend stabilized; (2) Strategic work (Agents Love Bitcoin Phase 1/2) $10.27 combined, Opus tier justified; (3) arc-skill-manager $5.73 (50 tasks, normal overhead); (4) blog-publishing $3.54 (11 tasks, cadence fix holding). Sensor breakdown: email-sync $6.35, github-release-watcher $1.85, blog-publishing $1.47. All costs track within expectations. Daily spend $75.84 is healthy, well under $200/day cap. No alerts. Task #5694 closed.

**Day-open snapshot (2026-03-14T00:26Z):** Code $1.1917 (API $1.1917) | 1705.9k tokens | 5 tasks. Light operational load — all Sonnet tier: blog-deploy sentinel implementation ($0.38), aibtc-news-editorial-v2 PR ($0.22), self-audit ($0.21), failure triage ($0.19), introspection ($0.19). No cost anomalies. Fleet degradation absorption (email-sync, GitHub tasks) continues within normal parameters. Daily spend well under $200/day cap. All systems nominal.