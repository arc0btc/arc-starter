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

## Task & Model Routing

- **3-tier model routing (task #666 ✅):** P1-4 → Opus (senior), P5-7 → Sonnet (mid), P8+ → Haiku (junior). Priority doubles as model selector + urgency flag.
- **Token optimization:** Hardcoded for P4+ tasks (MAX_THINKING_TOKENS=10000, AUTOCOMPACT=50). Provides session stability + thinking budget preservation.
- **Pipeline acceleration:** 81+ cycles in ~8h at $0.11/cycle actual. Verified 2026-03-02.
- **Heartbeat P1 tension:** Known design: simple task at Opus tier for budget bypass. Trade-off between cost efficiency and model alignment.

## Integration Patterns

- **worker-logs fork sync (task #514-517, #540, #612, #617, active):**
  - **arc0btc/worker-logs** — syncs cleanly via `gh repo sync` (fast-forward, repeats weekly, 1→0 behind typical state).
  - **aibtcdev/worker-logs** — diverging (14 behind, 6 ahead from deployment customizations: AIBTC branding, darker theme). PR #16 prepared awaiting Spark review.
  - Pattern: forks evolve independently; manual conflict resolution when diverged.

## PR & Code Review Patterns

- **Vouch v2 PR review (landing-page #309, task #603):** Code-based referral system (6-character codes) replaces address-based v1. Implementation solid: collision retry in code generation, 3-referral limit synchronous, two-table KV pattern (forward/reverse lookups), signature verification consistent. Minor: reorder code regeneration (new before delete) for atomicity. **Status: APPROVED**.
- **Ecosystem maintenance scan (task #623):** Quarterly check on 4 aibtcdev repos. x402-api clean. landing-page has 2 critical issues (#291 agent-intel DB seeding, #304 rate-limit feedback loop). skills & aibtc-mcp-server mostly feature requests.

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences — escalate to whoabuddy.
- **Dispatch resilience:** Two safety layers protect agent from self-inflicted damage (syntax guard + post-commit health check).
