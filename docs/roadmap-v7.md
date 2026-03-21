# Arc v7 Roadmap

*Created: 2026-03-21 by whoabuddy + Claude*
*Status: Draft — iterate as quests complete*

---

## Purpose

This is the master roadmap for Arc v7. It consolidates findings from the v6 audit, v6 roadmap review, High Output Management research, RFC/ARC proposal process, evolution review, and strategic sprint review into a single sequenced plan. Each item is cross-referenced to its source so decisions are traceable.

As quests complete, update task IDs and status inline. This doc is the living reference — no more searching across emails, task results, and research reports.

---

## Source Index

| # | Document | Location | Date | Key Contribution |
|---|----------|----------|------|-----------------|
| S1 | Strategic Sprint Review | `research/2026-03-05T01:25:00Z_strategic_sprint_review.md` | Mar 5 | "Depth over breadth." Context pressure, missing analytics, sensor fragmentation |
| S2 | Evolution Review | `research/2026-03-11_arc-evolution-review.md` | Mar 11 | Architecture validation (tk, autoresearch). SpaceX 5 principles. Tiered context, eval loop, solo+delegation |
| S3 | v6 Roadmap (task #6699) | DB: tasks #6699-6722 (23 subtasks, all completed) | Mar 18 | 5-phase execution: Foundation, Revenue/DeFi, Fleet, Intelligence, Ecosystem. ~$20.80 total |
| S4 | HOM Research | DB: tasks #6755→#6758→#7158, emails #751-#828 | Mar 18 | Grove frameworks mapped to Arc. 5 gaps: task description quality, output quality signals, skill health, stagger charts, leading indicators |
| S5 | HOM Follow-up Thread | DB: emails #816-#828 | Mar 19 | Actionable gaps stripped of fleet items. Tasks #7401-7403, #7440 queued and completed |
| S6 | RFC Language Thread | DB: emails #751-#858 | Mar 18-20 | RFC 2119 idea → evolved to ARC proposal process (BIP/SIP-style governance) |
| S7 | v6 Deep Dive Audit | `reports/2026-03-20T01-30Z_arc_v6_deep_dive_audit.md` | Mar 20 | 7-agent parallel audit. B+ rating. 22 prioritized action items across 3 tiers |
| S8 | ARC-0000 | `docs/proposals/ARC-0000.md` | Mar 20 | Formalized proposal process. Status: Active |
| S9 | ARC-0100 | `docs/proposals/ARC-0100.md` | Mar 20 | Formalized repo reorg as first ARC. Status: Draft |
| S10 | Quest Repo Reorg | `docs/quest-repo-reorg.md` | Mar 20 | 5 sequential quests to split arc-starter. Ready-to-paste init commands |
| S11 | DB Migration Protocol | `templates/db-migration-protocol.md` (task #7746) | Mar 20 | Three-phase protocol: prep/review → execute+snapshot → integrity check |
| S12 | Cost Tracking PRD | `db/projects/7115-cost-tracking-overhaul-prd.md` | Mar 18 | Claude Max plan makes per-token cost fields fictional. Full inventory of affected code |
| S13 | v6 Full Roadmap Review | DB: email #802, task #6722 | Mar 18 | v7 priorities: unblock fleet, ship revenue, deepen ERC-8004, reduce sensor volume, test memory-as-training |

---

## HOM Gap Resolution Tracker

These gaps were identified by mapping Grove's *High Output Management* to Arc (S4, S5). Track resolution here.

| # | Grove Gap | Arc Status | Resolution | Source |
|---|-----------|-----------|------------|--------|
| G1 | Task description quality (TRM signals) | Partially resolved | AGENT.md audit done (#7402). 6 fix tasks queued (#7453-7458). Sensor description enrichment still needed | S4, S5 |
| G2 | Output quality signals | Resolved | `result_quality` (1-5) field added to tasks table (#7403). `arc tasks close --quality N` flag. 7d rolling stats in `arc status` | S4, S5 |
| G3 | Skill health monitoring | Audited, gaps identified | 9 existing health systems found (#7440). Gaps: no sensor-watchdog, no external dependency checks, no unified health CLI | S4, S5 |
| G4 | Stagger charts / leading indicators | Open | No predictive metrics. Only trailing indicators (cost, task count, failure rate). Needs sensor-level trend detection | S4 |
| G5 | Strategic task injection | Partially resolved | `arc-strategy-review` skill created (#6715). Weekly cadence. Reactive volume still crowds D1/D2 work | S2, S4 |

---

## Strategy: Build New First

**Principle:** Do not modify arc-starter while it's running 455 tasks/day and 87 sensors. Build the clean engine as a new repo, prove it works by spinning up a fresh agent, then migrate Arc and the fleet once validated.

**Sequence:**
1. Analyze arc-starter (read-only) → produce classification + extraction plan
2. Build `aibtc-agent` engine in a new repo (arc-starter untouched)
3. Spin up first new agent → validate on blank VM
4. Migrate Arc to instance model (only after engine is proven)
5. Bring fleet online using the same engine

This avoids the risk of breaking Arc's live operations during the reorg.

---

## Roadmap Phases

### Phase 1: Classify & Extract (Quests 1-4)

Build the engine as a new repo. Arc-starter stays untouched and running throughout.
Original quest plan in `docs/quest-repo-reorg.md`. Formalized as ARC-0100. Resequenced below for build-new-first strategy.

| Quest | Slug | Goal | Model | Priority | Task ID | Status |
|-------|------|------|-------|----------|---------|--------|
| Q1 | `skill-classification` | Analyze arc-starter (read-only). Classify all 121 skills into shared/arc-specific/runtime-builtin/delete. Cross-reference with `aibtcdev/skills`. Produce migration manifest at `docs/skill-classification.json` | Opus | P3 | workflow #518 | Planning |
| Q2 | `runtime-extraction` | Create clean `aibtcdev/aibtc-agent` repo in a separate directory. Extract generic engine code from arc-starter. Rename CLI to `aibtc-agent`. Remove personality coupling. Build `init` + `skills add`. Fix dependency inversion, skill name validation, and parseFlags dedup as part of the clean extraction (not in-place modification) | Opus | P3 | — | Not started |
| Q3 | `engine-validation` | Spin up a fresh agent using the new engine. Blank VM test: `aibtc-agent init` → `aibtc-agent skills add` → services install → sensors run → dispatch completes a task. Target: <5 minutes from clone to working agent | Opus | P3 | — | Not started |
| Q4 | `arc-migration` | Create `arc0btc/arc` instance repo. Move Arc's personality, memory, and Arc-specific skills into it. Wire `aibtc-agent` as submodule. Boot Arc from new structure. Verify zero downtime, zero data loss. Rollback plan: arc-starter still intact | Opus | P3 | — | Not started |

**What changed from the original plan:**
- Old Q1 (`repo-cleanup`) is **absorbed into Q2** — the audit findings (dependency inversion, skill validation, ghost skills, parseFlags dedup) get fixed during extraction rather than in-place modification of arc-starter
- Old Q2 (`skill-classification`) becomes **new Q1** — analysis first, no code changes
- Old Q3 (`runtime-extraction`) becomes **new Q2** — builds in a separate directory
- **New Q3** (`engine-validation`) — explicit validation step before touching Arc
- Old Q4 (`instance-separation`) becomes **new Q4** (`arc-migration`) — only after engine is proven
- Old Q5 (`upstream-skills`) deferred to Phase 5 — not blocking

**Depends on:** Nothing. This is the starting point.
**Unlocks:** All subsequent phases. A proven engine means fleet agents can safely sync updates.
**Detail:** See `docs/quest-repo-reorg.md` for original phase breakdowns (adapt for build-new-first approach).

---

### Phase 2: Post-Split Hardening

These quests address debt quantified by the v6 audit (S7) that was explicitly deferred from Phase 1. They target the engine repo (`aibtcdev/aibtc-agent`) after extraction.

| Quest | Slug | Goal | Model | Source |
|-------|------|------|-------|--------|
| Q6 | `web-ts-split` | Split `web.ts` (3,273 lines) into domain modules: router, api-dashboard, api-services, api-fleet. Extract `DailyRateLimiter` class (-120 lines). Merge handleAsk/handleVoiceAsk (-100 lines). Extract paid-service handler pattern (-570 lines) | Opus | S7 §2.1, §7.1 |
| Q7 | `bun-native-migration` | Migrate 113 `node:fs` calls to Bun APIs (`Bun.file()`, `Bun.write()`, `.exists()`). Add lint rule to prevent regression | Sonnet | S7 §6.1 |
| Q8 | `pre-public-security-gate` | Auth on dashboard write endpoints, restrict CORS to trusted origins, security headers (CSP, X-Frame-Options), timing-safe comparisons, persist rate limits to SQLite. **Gate: must complete before any Cloudflare Tunnel exposure** | Opus | S7 §3.2, §8 |

**Depends on:** Q3 (runtime-extraction) — these changes target the engine repo.
**Unlocks:** Public dashboard access (Q8), cleaner maintenance (Q6, Q7).

**Audit cross-reference (S7 §8):**

| Audit Item | Quest | Audit Tier |
|------------|-------|------------|
| Validate skill names (regex) | Q2 (built into extraction) | Tier 1: Do Now |
| Harden .env permissions | Q2 (engine default) | Tier 1: Do Now |
| Fix ghost skills | Q2 (built into extraction) | Tier 1: Do Now |
| Archive fleet skills | Q1 (classification) | Tier 1: Do Now |
| Consolidate MEMORY.md | Q4 (arc-migration) | Tier 1: Do Now |
| Split web.ts | Q6 | Tier 2: Do Soon |
| Extract DailyRateLimiter | Q6 | Tier 2: Do Soon |
| Deduplicate parseFlags | Q2 (built into extraction) | Tier 2: Do Soon |
| Move credentials to src/ | Q2 (built into extraction) | Tier 2: Do Soon |
| Add `PRAGMA foreign_keys = ON` | Q12 (Phase 4) | Tier 2: Do Soon |
| Add MemoryMax to systemd | Q2 (engine default) | Tier 2: Do Soon |
| Migrate node:fs to Bun | Q7 | Tier 3: Do Later |
| Merge redundant skills | Q1 (classification) | Tier 3: Do Later |
| Task result_detail pruning | Q12 (Phase 4) | Tier 3: Do Later |
| Schema version tracking | Q12 (Phase 4) | Tier 3: Do Later |

---

### Phase 3: Operational Excellence

Derived from the evolution review (S2), HOM research (S4/S5), and v6 roadmap review (S13). These make Arc smarter per cycle rather than adding new capabilities.

| Quest | Slug | Goal | Model | Source |
|-------|------|------|-------|--------|
| Q9 | `tiered-context-profiles` | Implement Full/Standard/Minimal context loading by model tier. Haiku tasks skip SOUL.md + MEMORY.md. Save ~3K tokens/dispatch on P8+ tasks | Opus | S2 §3.4, S1 §3.1, S7 §5.5 |
| Q10 | `dispatch-eval-loop` | Close the feedback loop: post-completion eval (did it commit? pass syntax? get reopened within 24h?). Feed high-scoring patterns into memory, low-scoring into improvement tasks. Builds on `result_quality` field from #7403 | Opus | S2 §5.3, S4 G2 |
| Q11 | `cost-tracking-overhaul` | Implement PRD at `db/projects/7115`. Fix fictional dollar amounts from API-rate calculation on flat-rate plan. Update all 5 src files, 3 web dashboards, 6 sensors that consume cost data | Sonnet | S12 |

**Depends on:** Q3 (these can target engine or instance, but cleaner post-split).
**Unlocks:** Smarter dispatch (Q9), self-improving loop (Q10), honest cost reporting (Q11).

**HOM gap resolution:**
- Q9 addresses G5 (strategic injection) — cheaper Haiku cycles = more budget for strategic Opus work
- Q10 addresses G2 (output quality) and G4 (leading indicators) — eval scores become a predictive signal
- Q11 addresses honest measurement (Grove: "you can't improve what you can't measure")

---

### Phase 4: Platform Maturation

Infrastructure hardening that makes the engine reliable enough for other agents to depend on.

| Quest | Slug | Goal | Model | Source |
|-------|------|------|-------|--------|
| Q12 | `db-schema-hardening` | `PRAGMA foreign_keys = ON`. Schema version tracking via `schema_migrations` table (S11). Task `result_detail` pruning strategy (archive after 30d). CHECK constraints on status/priority columns. `MemoryMax=4G` on dispatch systemd unit. Clean dead tables (roundtable, consensus). DB migration protocol from #7746 | Opus | S7 §1.5, S2 §3.1, S11 |
| Q13 | `sensor-consolidation` | Audit 87 sensors for overlap. Cache sensor discovery list (invalidate on skills/ mtime change). Add dead-sensor detection (100+ consecutive skips → alert). Archive 15 never-dispatched skills. Implement sensor-watchdog (G3 gap) | Sonnet | S1 §3.4, S7 §4, S4 G3 |
| Q14 | `parseflags-dedup` | Export shared `parseFlags` from `src/utils.ts`. Update 42 skill CLIs to import it. Add shared `createCliLogger`. Remove ~800 lines of duplication | Sonnet | S7 §7.1 |

**Depends on:** Q3 (engine repo must exist). Q14 can start during Phase 1 if needed.
**Unlocks:** Reliable multi-agent deployment (Q12), cleaner sensor stack (Q13), DRY skill CLIs (Q14).

**HOM gap resolution:**
- Q13 addresses G3 (skill health) and G4 (stagger charts via trend detection on sensor skip rates)

---

### Phase 5: Revenue & Growth

Derived from v6 roadmap review (S13), directives D1 (services business) and D2 (grow AIBTC), and the revenue audit in `db/projects/6699.md`.

| Quest | Slug | Goal | Model | Source |
|-------|------|------|-------|--------|
| Q15 | `monitoring-as-a-service` | Productize Arc's 74 sensors into a paid agent monitoring service. PR for ALB already on `feat/monitoring-service` branch (#6792). x402 payment integration. Agent-facing: site health, deploy status, uptime. Revenue target: first paid service | Opus | S3 (P2 revenue), S13, task #7190 |
| Q16 | `fleet-lean-restart` | When Anthropic suspension lifts: API key per agent (not shared OAuth), lean provisioning (zero inherited personality), clean identity boundaries (no git-reset-hard sync). Applies to engine: `aibtc-agent init` should handle this cleanly | Opus | S2 §4, S3 (P3 fleet), S13 |
| Q17 | `task-description-enrichment` | Complete G1 resolution: enrich sensor-generated task descriptions across top 20 skills. Remaining AGENT.md fixes from #7453-7458. Sensor templates that include context, expected output, and scope boundaries | Sonnet | S4 G1, S5, task #7402 |

**Depends on:** Q3 + Q4 (fleet restart needs the instance model). Q15 can start now (branch exists).
**Unlocks:** D1 revenue (Q15), fleet scalability (Q16), better Opus efficiency (Q17).

**HOM gap resolution:**
- Q17 completes G1 (task description quality / TRM signals)
- Q16 applies Grove's "task-relevant maturity" — new agents start supervised (Sonnet-only), graduate to Opus

---

### Phase 6: Ecosystem & Standards

Longer-horizon items that build on a stable, split codebase.

| Quest | Slug | Goal | Model | Source |
|-------|------|------|-------|--------|
| Q18 | `arc-proposal-governance` | Resolve ARC-0000 open questions: where do ARCs live post-split? Minimum review period? Fleet agent proposal rights? Implement RFC 2119 language in CLAUDE.md and SKILL.md files per original RFC thread idea | Sonnet | S6, S8 |
| Q19 | `stagger-charts` | Implement Grove's stagger chart concept: forecast-vs-actual on task throughput, cost, and quality per week. Surface in `arc status` and web dashboard. Leading indicator for D4 cap breaches | Opus | S4 G4 |
| Q20 | `experiment-eval` | Evaluate `src/experiment.ts` (334 lines). If unused, delete. If useful, integrate properly. Also evaluate dead tables: `roundtable_*`, `consensus_*`, `market_positions`, `skill_versions` | Sonnet | S7 §7.3, S2 §3.1 |

**Depends on:** Phase 2+ (clean engine).
**Unlocks:** Governance clarity (Q18), predictive ops (Q19), reduced dead code (Q20).

---

## Already Completed (Referenced Work)

These items from the source documents have already been resolved. Listed here to prevent re-queuing.

| Item | Task ID | Status | Source |
|------|---------|--------|--------|
| AGENT.md audit (top 20 skills) | #7402 | Completed | S5 |
| Output quality signal (`result_quality` field) | #7403 | Completed | S4 G2 |
| Skill health monitoring audit | #7440 | Completed | S4 G3 |
| x402 knowledge base draft | #7401 | Completed | S5 |
| DB migration protocol RFC | #7746 | Completed | S6 |
| ARC proposal process + template | #7730 | Completed | S6 |
| Cost tracking PRD (research) | #7115 | Completed (research only) | S12 |
| Monitoring service deploy | #7190 | Completed | S3 |
| Defi-bitflow sensor tuning | #7687 | Completed | Competition |
| Disclosure fix verification | #7688 | Completed | Competition |
| Ordinals signal diversity | #7689 | Completed | Competition |
| v6 roadmap (all 23 subtasks) | #6699-6722 | All completed | S3 |
| ALB registration (trustless-indra) | #7189 | Completed | S3 |
| Nostr-WoT trust integration | #7793 | Completed | Memory |
| Workflow architecture validation | #7794 | Completed | Memory |

---

## Decision Log

Track key decisions made during roadmap execution here.

| Date | Decision | Context | Made By |
|------|----------|---------|---------|
| 2026-03-21 | Build-new-first: do not modify arc-starter during reorg. Build engine as new repo, prove it with a fresh agent, migrate Arc last | Arc running 455 tasks/day — in-place modification too risky | whoabuddy |
| 2026-03-20 | All skills from submodules (no default skills in engine) | RFC thread email #857 | whoabuddy |
| 2026-03-20 | ARC proposals live in instance repo until different maintainer | RFC thread email #857 | whoabuddy |
| 2026-03-20 | DB migrations use 3-phase protocol (prep → execute+snapshot → integrity) | RFC thread email #857, task #7746 | whoabuddy + Arc |
| 2026-03-20 | Start as blank slate, not fork | RFC thread email #857 | whoabuddy |
| 2026-03-18 | v7 priorities: fleet, revenue, ERC-8004, sensor volume, memory-as-training | v6 review email #802 | Arc |
| 2026-03-19 | Strip fleet items from HOM gaps — focus on solo-agent improvements first | Email #816 | whoabuddy |

---

## How to Use This Document

1. **Starting a quest:** Run the `arc skills run --name quest-create -- init` command from `docs/quest-repo-reorg.md` (Q1-Q5) or write new ones following the same pattern. Update the Task ID column in this doc.
2. **Completing a quest:** Update Status column. Add any decisions to the Decision Log. If the quest surfaced new work, add it to the appropriate phase.
3. **Adjusting the plan:** This is a living document. Reorder quests, add new ones, or defer items as priorities shift. The Source column ensures you can always trace back to *why* something was planned.
4. **Cross-referencing:** Use Source Index codes (S1-S13) to find the original analysis. Use Task IDs to find execution context in the DB.

---

*This roadmap consolidates: 1 audit report, 2 ARC proposals, 1 quest plan, 1 evolution review, 1 sprint review, 1 HOM research report, 1 cost PRD, 2 email threads (12+ messages), and 23 completed v6 subtasks into a single actionable plan.*
