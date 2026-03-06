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
- **Sensor dedup at platform integration layer (task #1633 ✅):** When multiple sensors watch the same external system (GitHub mentions + issue monitor both reading GitHub), dedup must happen at the *event source*, not downstream output. Dedup at ingestion layer prevents double-posts and preserves sensor independence. Pattern: GitHub event dedup → queue → each sensor consumes independently.

## Sensor Scaling & Infrastructure

- **43+ sensors threshold: monitoring the monitors becomes necessary (task #1633 ✅):** When sensor count exceeds ~40, explicit health monitoring of the sensor infrastructure itself shifts from optional to critical. Worker-logs-monitor skill deployment indicates this is the inflection point where sensor state visibility is required to prevent silent failures or cascading issues.

- **Zero failures at 67 completions validates safety layers (task #1633 ✅):** Overnight brief cycle: 67 tasks completed, 0 failures across 81 cycles. Safety infrastructure (syntax guard + post-commit health check + worktree isolation) prevented cascading failures in high-volume execution. Pattern holds: safety layers pay dividends at scale.

## Feed Monitoring & Dedup Strategies

- **Keyword rotation for API rate smoothing (task #1462 ✅):** APIs with per-action rate limits (e.g., X free tier: 1 search/15min) benefit from rotating keyword cycles rather than batching. Structure as "one keyword per cycle" (e.g., 6 keywords = full rotation ~90min) to respect limits while maintaining steady ecosystem coverage. Avoids thundering-herd collisions and keeps dispatch load predictable.
- **Rolling window dedup for high-frequency feeds (task #1462 ✅):** For external feeds with thousands of items, rolling window collection (e.g., 500 tweet IDs in hook state) is more efficient than timestamp gates (AIBTC brief pattern). Window prevents unbounded state growth and naturally ages out old items. Choice: timestamp gate for low-frequency sensors, rolling window for continuous monitoring.
- **Engagement thresholds as signal filter (task #1462 ✅):** Social media monitoring sensors should filter by engagement (likes, RTs, replies) rather than filing every result. Pattern (5+ likes, 2+ RTs, or 3+ replies) is tuned to X feed noise floor, but generalizes: social signal quality correlates with engagement. Filters downstream work and improves task signal-to-noise.

## Task & Model Routing

- **3-tier model routing (task #666 ✅):** P1-4 → Opus (senior), P5-7 → Sonnet (mid), P8+ → Haiku (junior). Priority doubles as model selector + urgency flag.
- **Token optimization:** Hardcoded for P4+ tasks (MAX_THINKING_TOKENS=10000, AUTOCOMPACT=50). Provides session stability + thinking budget preservation.
- **Pipeline acceleration:** 81+ cycles in ~8h at $0.11/cycle actual. Verified 2026-03-02.
- **Heartbeat P1 tension:** Known design: simple task at Opus tier for budget bypass. Trade-off between cost efficiency and model alignment.
- **Cost lever: model selection > cycle count (task #1367 ✅):** Opus-tier tasks consumed 59% of 7-day budget despite being minority of cycles. Single task #1284 cost $17.44. Downgrading one high-value sensor from Opus→Sonnet saves more than eliminating 50 Haiku tasks. Model choice is the primary cost driver.
- **Sensor cost governance at design time (task #1367 ✅):** Review sensors ($25.60/day: compliance, CEO, context, architecture) became cost sink because intervals were set without budget awareness. Solution: explicit cost tier per sensor at creation (P8 sensors only?) + interval governance during review, not tactical downgrades.
- **Dispatch-level cost caps > tactical downgrades (task #1367 ✅):** Budget overrun ($617/wk vs $200 target) requires structural fix, not task-by-task optimization. Hard cost cap at dispatch (e.g., $40/day hard stop) prevents runaway regardless of queue state. Tactical changes (convert task X from Opus→Sonnet) require human decisions; caps are bulletproof.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary (2026-03-06, tasks #1392-#1413):** When a task chain hits a blocker that requires external human action (e.g., "whoabuddy must send sats"), the correct response is ONE escalation task then stop. Tasks #1392-#1413 generated 6 failed tasks because retry/monitor tasks kept spawning after #1397 already identified the external dependency. Pattern: detect human-required blocker → escalate once → set `blocked` or `failed` with clear summary → do NOT create monitor/retry chain waiting for external state to change.

- **Monitor tasks need exit conditions, not just failure modes:** "Monitor wallet until X" tasks without a funding-confirmed signal will always fail. If the precondition has no delivery timeline (wallet funding by human), monitoring is noise. Create a single `blocked` task with `result_summary` explaining the dependency; let the human trigger the next step.

## X API Authentication

- **arc-link-research X tweet fetch requires OAuth 1.0a access_token (2026-03-06, task #1627):** `loadXCreds()` in `skills/arc-link-research/cli.ts` requires `x/access_token` and `x/access_token_secret` credentials. Only `x/bearer_token` + consumer keys are currently stored. Result: `loadXCreds()` returns null → tweet lookup falls back to unauthenticated fetch → fails with auth error. Fix: add bearer-token fallback for read-only tweet lookups (X API v2 supports bearer token for `/tweets/:id`), OR store access_token/access_token_secret.

## Integration Patterns

- **Wallet-aware skill runner pattern (task #1391 ✅):** Stateful singletons (wallet manager) hold unlock state in memory; subprocess isolation breaks this. Solution: dedicated runner (deposit-runner.ts) unlocks the singleton, overrides process.argv, monkey-patches the CLI parser to run within the same process, then locks on exit. This pattern applies whenever state must persist across orchestration boundaries.

- **Cross-repo skill deployment (task #1391 ✅):** Split skills into upstream (pure SDK binding, no wallet logic) + local (wallet-aware wrapper). Upstream lives in aibtcdev/skills (shared ecosystem); local runs arc-starter (wallet access). Read-only commands pass through to upstream; stateful ops stay local. Keeps ecosystem clean while enabling wallet-dependent operations.

- **Smart contract output ordering is strict spec (task #1549 ✅):** L2 smart contracts (e.g., Styx bridge) enforce specific output positions in their txs. OP_RETURN must be output 0, not output 1—not a suggestion but a contract requirement. When integrating with smart contracts, output order becomes part of the spec and must be validated before deployment. Applies to any bridge or L2 skill.

- **Wrapper repo bugs duplicate silently (task #1549 ✅):** When aibtcdev/skills code is consumed by other repos (e.g., aibtc-mcp-server), bugs exist in both copies without visibility. Fixing upstream doesn't auto-fix the wrapper. Pattern: grep all known consumers (existing repos + in-flight PRs) when fixing cross-repo bugs to ensure comprehensive coverage. Saves debugging cycles on future bug reports.

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

## Cache & API Patterns

- **Dedup-counting via pre-check (task #1459 ✅):** When caching API results, check existence before adding: `if (!cache[id]) { newCount++ } then cache[id] = entry`. Prevents double-counting when successive API calls return overlapping results. Pattern applies to any result aggregation with accumulating stats.
- **ISO-8601 timestamps for future invalidation (task #1459 ✅):** Store `fetched_at` as ISO-8601 string in cache entries. Enables future sensor logic to age out entries based on timestamp without a separate TTL field. Just compare strings: `if (now - entry.fetched_at > threshold)`.
- **OAuth 1.0a query params in signature (task #1459 ✅):** For GET requests, query params must be included in OAuth signature base. Pass `queryParams` to the signing function and include in `paramString` calculation. Common pitfall: forgetting to sign query params causes 401 errors.

## Publishing & Multi-Platform Patterns

- **Encoding choice affects rendering as platform-specific failure mode (task #1691 ✅):** When publishing to multiple blockchain explorers (e.g., `text/plain;charset=utf-8` vs `text/markdown`), verify how each platform renders different MIME types. Example: markdown renders as raw text on ordinals.com, while plain text renders universally. Encoding is not aesthetic—it's a rendering contract. Pattern: test each encoding on target platform before publishing canonical content. Prevents silent rendering failures where content appears corrupted due to platform mismatch.

## Execution & Decision Gating

- **Governance decisions as execution blockers (task #1691 ✅):** When a task identifies that execution requires an organizational decision (e.g., multisig vs single deployer for collection), escalate to the decision-maker and stop—do NOT create monitoring/retry chains. Governance blockers are distinct from missing-info or transient failures. Pattern: detect decision blocker → escalate once with full context → set task to `blocked`/`failed` with actionable summary → wait for human decision trigger. Complements "Stop chain at human-dependency boundary" pattern by providing proactive blocking criteria.

## Engagement & Budget Patterns

- **Early budget validation (task #1460 ✅):** Enforce budget checks BEFORE API calls, not after. Prevents wasted API quota and gives immediate feedback. Applies to any rate-limited API where cost is per-request (X API likes, posts, etc.). Pattern: `checkBudget(action)` runs first; only then call the API. If budget fails, user sees error immediately without consuming quota.
- **ISO date string for daily resets (task #1460 ✅):** Use `new Date().toISOString().slice(0, 10)` to get YYYY-MM-DD for daily budget resets. Automatically resets at UTC midnight without cron. Deterministic across distributed processes (all read the same date string). Pattern applies to any daily-reset quota (social engagement, API calls, etc.).
- **Corrective actions are unbudgeted (task #1460 ✅):** Unlike/unretweet are free — they're undo operations, not new engagement. Budget constraints apply to creation (post, reply, like, retweet); corrective actions (unlike, unretweet) have no budget check. Design insight: you pay once to engage, free to fix mistakes. Applies to any engagement system where editing/undoing should be encouraged.

## Deployment & Verification (Static Sites)

- **Multi-layer verification catches distinct bug classes (task #1604 ✅):** Health alerts detect SHA drift (version/infrastructure), verify steps catch routing/content issues (application runtime). The 404 on a valid post slug is a different problem than version mismatch—requires investigation separate from deployment sync. Pattern: infrastructure drift + application validation = independent layers, independent failures, independent fixes.

## Contacts & Enrichment Patterns

- **Privacy marking for human operators (task #1675 ✅):** When linking human operators to agent contacts, use `[PRIVATE]` markers in notes to prevent accidental doxxing of associated people. Applies across ecosystem contact enrichment work.

- **Milestone tracking for capability verification (task #1675 ✅):** Contact value grows from capability timelines (e.g., "first onchain swap using Bitflow," 2026-03-06) not just static facts. Milestones prove integration success and enable tracking agent progression across cycles.

## Git & Publishing Patterns

- **Asymmetric branch detection (task #1678 ✅):** Use bidirectional `rev-list --count` (`main..v2` AND `v2..main`) to detect whether branches are linearly progressed or diverged. Both > 0 means divergence (non-fast-forward); only one > 0 means linear progression. Essential for any skill managing branch relationships — prevents silent corruption by distinguishing "main is behind" from "main has diverged."

- **Graceful failure with diagnostic clarity (task #1678 ✅):** When an operation cannot proceed (e.g., non-FF merge), refuse the action with a specific, actionable message: "main has N commit(s) not in v2. Resolve divergence manually before publishing." Do not attempt complex recovery. The diagnostic clarity is the service — it prevents silent corruption and tells the user exactly what's blocking progress.

- **State discovery before action (task #1678 ✅):** Two-phase pattern for distributed operations: `status` command reveals branch state without modification, `publish` command re-validates state before acting. Prevents race conditions where branch state changes between decision and execution. Applies to any workflow where state must be checked immediately before irreversible action.

- **Sensor task description as actionable context (task #1678 ✅):** When a sensor queues a task, include actionable details in the task description: commit count, HEAD SHA, exact CLI command to execute, expected behavior. Prevents context-switching friction for humans or downstream dispatch cycles — everything needed to understand and execute is already in the task text.

- **Conflict resolution reveals branch purpose (task #1682 ✅):** When branches diverge intentionally (e.g., `main` = public starter template with generic placeholders, `v2` = operational Arc with actual config), conflict resolution patterns encode hierarchy. If all conflicts resolve the same way (keeping one branch's content), that branch is the source of truth and the other is derivative. Merge the behind branch into the ahead branch to keep active development canonical.

- **Intentional divergence as architectural feature (task #1682 ✅):** Multi-purpose repos (publish working code + ship starter template) naturally diverge. Rather than keeping branches in sync, accept divergence as intentional: published branches can be cleaned/simplified; working branches carry full operational state. Treat conflicts during merge as confirmation of separation of concerns, not as a problem to be prevented.

## Task Composition & Scoping

- **Research-first pattern for infrastructure requests (task #1724 ✅):** When a trusted stakeholder requests complex infrastructure work (agent network spinup, multi-component integration), precede implementation with a scoped research task that maps components and validates architecture. Example: whoabuddy requests agent network → reply with scope → queue P3/Opus research task (VM provisioning, credentials, messaging bus, web integration, runtime) → implementation tasks follow. This prevents misdirected effort and ensures implementation aligns with architectural decisions.

## Retrospective Task Infrastructure (tasks #1730, #1736)

- **Haiku retrospectives produce quality institutional memory.** 93 retrospective tasks: 96% contained real learnings, patterns.md grew from 40→137 lines with reusable operational patterns. Demonstrates Haiku tier can synthesize and generalize—not just execute simple work. Retrospective overhead (9.7% of parent task cost, ~$0.08/retro) is justified.

- **Topic file partitioning prevents knowledge bloat.** Directing retrospectives to write patterns.md instead of MEMORY.md prevents scope creep in the main memory file. MEMORY.md exceeded its 200-line limit anyway; patterns.md became the appropriate container for operational knowledge. Pattern: separate concerns at filesystem level to enforce context boundaries.

- **Prompt-level routing prevents wasteful generation (task #1736 ✅).** Instead of generating to a default location and filtering post-hoc, encoding the destination in the system prompt ("write ONLY to patterns.md") prevents off-topic generation. Applies broadly: multi-destination systems (API endpoints, memory, logs) should route at the source. Eliminates downstream filtering overhead.

- **Read-before-write dedup prevents log bloat (task #1736 ✅).** Rather than append-only + 24h dedup (task #1730), read patterns.md first, check for existing similar patterns, and update in-place. Prevents variants of the same pattern from accumulating. Pattern applies to any knowledge system: structure dedup as state-aware updates, not as post-write filtering.

- **Tighter filter = higher reuse likelihood (task #1736 ✅).** Changing the capture gate from "any learning" to "reusable patterns that would change future task execution" reduced noise and increased signal. Fewer, actionable entries beat many generic ones. Applies to institutional memory: specificity gates are as important as the capture mechanism itself.

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences — escalate to whoabuddy.
- **Dispatch resilience:** Two safety layers protect agent from self-inflicted damage (syntax guard + post-commit health check).
