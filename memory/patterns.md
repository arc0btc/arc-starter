# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **BIP-322 signing** — Arc uses P2WPKH (requires btcAddress verification).
- **Worktrees isolation (task #300 ✅):** Dispatch creates isolated branches + Bun transpiler validates syntax. Prevents agent bricking.
- **Syntax guard (Bun transpiler)** — Validates all staged .ts files before commit. Syntax errors block merge; follow-up task created.
- **Post-commit health check** — After src/ changes, snapshots service state. Reverts if service dies, restarts, creates follow-up task.
- **Context budget:** 40-50k tokens per dispatch (headroom available).

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors follow this: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation. Prevents redundant work.
- **Architect sensor optimization (task #653 ✅):** SHA tracking in hook-state for code-change dedup. Skip review if currentSha == lastReviewedSha AND !diagramStale AND !reports. Saves $0.23/cycle on repeated findings.
- **AIBTC brief compilation (task #655 ✅):** Score-based auto-queue (signals×10 + streak×5 + daysActive×2). Hook-state.lastBriefDate prevents same-day re-queue. Pattern extends to all time-gated operations.
- **Health sensor false positives:** Occasional timing edge when dispatch starts before prior cycle fully records. Self-resolves automatically. Not a blocker.
- **Pagination field nesting in API discovery (task #1445 ✅):** When building sensors against paginated APIs, never assume `total`, `page`, or `count` are at response root — they're often nested in `pagination` or `meta` objects. Verify actual JSON structure. Sensor that assumes wrong nesting stops early and misses data.
- **Deduplication logic masks pre-existing state (task #1445 ✅):** A sensor's normal dedup flow (address matching) can hide unexpected pre-existing DB state. First-run validation should explicitly check for empty DB, not rely on dedup feedback. "0 created" can mean either "already synced" or "DB is stale" — context matters.

## Task & Model Routing

- **3-tier model routing (task #666 ✅):** P1-4 → Opus (senior), P5-7 → Sonnet (mid), P8+ → Haiku (junior). Priority doubles as model selector + urgency flag.
- **Token optimization:** Hardcoded for P4+ tasks (MAX_THINKING_TOKENS=10000, AUTOCOMPACT=50). Provides session stability + thinking budget preservation.
- **Pipeline acceleration:** 81+ cycles in ~8h at $0.11/cycle actual. Verified 2026-03-02.
- **Heartbeat P1 tension:** Known design: simple task at Opus tier for budget bypass. Trade-off between cost efficiency and model alignment.
- **Cost lever: model selection > cycle count (task #1367 ✅):** Opus-tier tasks consumed 59% of 7-day budget despite being minority of cycles. Single task #1284 cost $17.44. Downgrading one high-value sensor from Opus→Sonnet saves more than eliminating 50 Haiku tasks. Model choice is the primary cost driver.
- **Sensor cost governance at design time (task #1367 ✅):** Review sensors ($25.60/day: compliance, CEO, context, architecture) became cost sink because intervals were set without budget awareness. Solution: explicit cost tier per sensor at creation (P8 sensors only?) + interval governance during review, not tactical downgrades.
- **Dispatch-level cost caps > tactical downgrades (task #1367 ✅):** Budget overrun ($617/wk vs $200 target) requires structural fix, not task-by-task optimization. Hard cost cap at dispatch (e.g., $40/day hard stop) prevents runaway regardless of queue state. Tactical changes (convert task X from Opus→Sonnet) require human decisions; caps are bulletproof.

## Integration Patterns

- **Wallet-aware skill runner pattern (task #1391 ✅):** Stateful singletons (wallet manager) hold unlock state in memory; subprocess isolation breaks this. Solution: dedicated runner (deposit-runner.ts) unlocks the singleton, overrides process.argv, monkey-patches the CLI parser to run within the same process, then locks on exit. This pattern applies whenever state must persist across orchestration boundaries.

- **Cross-repo skill deployment (task #1391 ✅):** Split skills into upstream (pure SDK binding, no wallet logic) + local (wallet-aware wrapper). Upstream lives in aibtcdev/skills (shared ecosystem); local runs arc-starter (wallet access). Read-only commands pass through to upstream; stateful ops stay local. Keeps ecosystem clean while enabling wallet-dependent operations.

- **worker-logs fork sync (task #514-517, #540, #612, #617, active):**
  - **arc0btc/worker-logs** — syncs cleanly via `gh repo sync` (fast-forward, repeats weekly, 1→0 behind typical state).
  - **aibtcdev/worker-logs** — diverging (14 behind, 6 ahead from deployment customizations: AIBTC branding, darker theme). PR #16 prepared awaiting Spark review.
  - Pattern: forks evolve independently; manual conflict resolution when diverged.

## PR & Code Review Patterns

- **Vouch v2 PR review (landing-page #309, task #603):** Code-based referral system (6-character codes) replaces address-based v1. Implementation solid: collision retry in code generation, 3-referral limit synchronous, two-table KV pattern (forward/reverse lookups), signature verification consistent. Minor: reorder code regeneration (new before delete) for atomicity. **Status: APPROVED**.
- **Ecosystem maintenance scan (task #623):** Quarterly check on 4 aibtcdev repos. x402-api clean. landing-page has 2 critical issues (#291 agent-intel DB seeding, #304 rate-limit feedback loop). skills & aibtc-mcp-server mostly feature requests.

## Claims & Verification Patterns (task #1431 ✅)

- **Live deployment divergence:** Audits of public claims must check both deployed live site AND source code HEAD. Single-layer checks miss drifts. Task #1431 found counts on live site (61/36) already fixed in repo HEAD (60/39), but audit caught both issues. Pattern: keep deployment in sync with source via CI/CD gates, or expect verification failures.

- **Single source of truth for derived values:** Skill/sensor counts appeared in 3 places with different values (live 61/36, PR #2 claimed 63/26, actual 60/39). Root cause: hardcoded values in multiple locations drift independently. Solution: compute counts from authoritative source (actual skill/sensor directories) and render dynamically everywhere, or commit generated snapshots to source control with hooks that fail if manual edits create divergence.

- **Proof over assertion:** Claims without verifiable evidence fail audit. Task #1431 caught unsigned blog posts, unverified MCP server claims, broken GitHub links. Pattern: anything Arc claims capability for must be traceable to proof (specific GitHub repos, sensor names in codebase, signed posts, config files). "We built X" is a claim; "see X in skills/x/sensor.ts" is proof.

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences — escalate to whoabuddy.
- **Dispatch resilience:** Two safety layers protect agent from self-inflicted damage (syntax guard + post-commit health check).
