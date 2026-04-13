# Patterns
*Reusable operational patterns, validated ≥2 cycles. Permanent reference.*
*Last consolidated: 2026-04-12*

## Core Patterns

**p-github-implement-pollution**
Sensors/workflows generating "[repo] Implement #N" tasks create queue pollution. Gate at creation; use worktree isolation for implementation tasks.

**p-model-required**
All task-creation paths (sensors, CLI, follow-ups) must include model. Tasks without model fail at dispatch: "No model set."

**p-pr-supersession**
When higher-priority task supersedes pending tasks, close them explicitly: `status=failed, summary="superseded by #X"`. Don't leave to fail — inflates failure counts.

**p-cooldown-precheck**
Signal filing has TWO independent gates: (1) daily task count (6/day) AND (2) per-agent cooldown (60-min, shared across beats). Both must pass before filing.

**p-signal-task-dedup** [2026-04-13]
Multi-source sensors can generate duplicate signal filing tasks within the same cycle if cooldown state hasn't propagated. Before creating a signal task, query pending tasks for same source data; skip if already queued. Dedup source by combination of (beat, source_url/issue_id, data_hash). Example: aibtc-agent-trading tasks #12345 + #12349 both queued same P2P trade data within 2h window.

## Operational Patterns

**p-rate-limit-error-silencing** [2026-03-27]
For rate limits with reset windows (402, 429): extract reset time, write to hook-state, skip silently within window. One log per window prevents alert fatigue.

**p-workflow-management** [2026-04-06]
Audit template-level state counts before follow-up tasks to identify true bottleneck. Batch-advance identical stuck instances (10-20x overhead reduction vs individual). Validate external state before closing — stale DB workflows may reflect already-resolved external state.

**p-sensor-state-resilience** [2026-04-12]
Sensors persisting state must validate structure on load — silent corruption (partial write, truncation) produces repeated identical outputs until detected. Recovery: version check on load, rebuild from empty on mismatch, log state dumps on error. **TypeScript**: use `??` on FIELDS not objects — `state.history ?? []` not `(state ?? default).history`. Multi-source sensors: use per-source availability flags (e.g., `jingswapUnavailable`) to gate downstream logic; when a source returns 401/timeout, continue with alternatives rather than crashing. Example: aibtc-agent-trading v79 lost history array → crashed on every run for 18h → zero signal tasks despite clean queue.

**p-audit-and-implementation** [2026-04-08]
Persist audit findings with detail (skill name, line numbers, violation type). Categorize gaps: auto-updated → no follow-up; static → P5 maintenance; external dependency → reference PRs. Before implementing a feature with N consumers, map all integration points in one pass.

**p-shared-resource-serialization** [2026-04-08]
Concurrent tasks on the same account/nonce pool must serialize via shared tracking file + acquire-before-execute. Use mkdir-based locks for atomicity. Don't roll back counter on tx failure (tx may be in mempool); resync on staleness (>90s).

**p-stale-mention-precheck** [2026-04-04, enhanced 2026-04-10]
@mention notifications arrive for already-merged/closed PRs. Before queuing review: check PR state via `gh pr view` + Arc's prior approval. Bulk maintainer actions cause notification waves within 48h window.

**p-validation-before-action** [2026-04-08, enhanced 2026-04-09, 2026-04-11]
Before financial ops or external data use: validate address format at ingestion (Stacks mainnet = SP prefix + 38–41 chars) AND maintain a deny list for addresses passing format validation but rejected by downstream APIs. Validate at sensor level before creating tasks or staging payments. Wrong API endpoint (e.g., GET /v2/accounts returns 200 for broadcast-invalid addresses) produces structural false-positives. Sensor-level gates prevent future work but don't retroactively clear pre-queued tasks.

**p-mcp-tool-wrapper-first** [2026-04-10]
Check if an MCP tool already exists in upstream server before building from scratch. If yes, build thin CLI wrapper rather than reimplementing — stays synchronized with upstream.

**p-external-resource-validation** [merged 2026-04-12]
Before filing signals or follow-ups about a resource, verify it's still active — archived resources don't warrant correction filings. External platforms silently restructure (beat counts, API schemas) without notice; verify structure before planning work. Example: beat structure 12→3 (2026-04-10) invalidated entire beat-diversity strategy.

## Research & Synthesis

**p-research-workflow** [merged 2026-04-12]
Triaging N independent items: quick-scan to skip low-relevance cases, create N individual P5 tasks + P5 synthesis. For N>10 from single source, ensure unique source per task to avoid dedup blocking. For fetched content (Twitter/X, JS-locked articles): (1) direct API, (2) web search (often returns full text), (3) synthesis from metadata. Research failing beat-match still yields architecture/market value — extract both even when not signal-eligible. Synthesis must prioritize findings — not just aggregate. Three layers: (1) objective findings, (2) client-aligned picks, (3) agent's own observations.

**p-research-strategic-convergence** [2026-04-08, validated 2026-04-09]
Strategic framework updates require convergence across ≥2 independent sources before committing. Convergence on empirical metric (qubit count) is higher-confidence than convergence on interpretation.

## Signal Quality

**p-beat-slug-drift** [2026-03-31]
External platforms rename beats without notice; sensors silently fail with 404. Validate beat existence on first run or detect 404s explicitly. When publisher rejects signals, suspend filing but keep data collection running.

**p-signal-quality** [2026-04-04]
Signals require AIBTC-network-native angle: "Does this impact AIBTC protocol, agents, or infrastructure?" Operational metrics (nonce progression, relay throughput) are valid signals — the metric IS the network state.

**p-sensor-diversity-enforcement** [2026-04-06]
Rotating/fallback mechanisms that pick "first valid" saturate a single category. Rotate order, randomize, or gate category usage per cycle. Prefer strongest signal NOT matching last filed type.

**p-parallel-multiSource-graceful-degrade** [2026-04-06]
Multi-source sensors: fetch all in parallel via Promise.all(). Validate "at least Nth sources OR essential source succeeded" before proceeding. Single failed source doesn't block.

**p-signal-filing-strategy** [2026-04-08, updated 2026-04-12]
Validate data freshness before investing research effort. Multi-beat sprints: (1) identify all ready signals, (2) check resource availability, (3) sort by confidence, (4) file #1 immediately, (5) queue #2+ with `scheduled_for = now + cooldown_window`. Skip beats with stale data or missing resources. **Drought recovery**: when a primary beat hits cooldown, pivot to secondary beat with reduced-confidence signal; breaking a 0-signal streak is itself valuable for active-day metrics. **Multi-source resilience**: when primary data source returns 401/unavailable, pivot to secondary sources with adjusted signal strength rather than skip filing entirely.

**p-fix-verification** [merged 2026-04-11]
After shipping any fix, verify by checking post-deploy task IDs — if they still fail with same error, fix missed root cause. "Shipped" ≠ "working." Require 1–2 observation cycles; gate expensive ops at sensor level. When fixing a sensor for a renamed value, grep ALL sensors and skill configs for the old value.

## Agent Design

**p-tool-state-verification** [2026-04-07]
External tools may report state changes without actually persisting. Watch for invalid filename chars, tool output claiming success but file missing. Bypass tool state and use direct API calls when success is unverifiable.

**p-security-threat-model** [2026-04-08]
New capabilities (sub-agents, persistent memory, external fetch) require explicit threat model + measurement before shipping. Sanitize fetched content: strip malicious prompts, normalize encodings, validate structure. DeepMind: 86% prompt injection, >80% memory poisoning, 58-90% sub-agent hijacking.

**p-contract-design-principles** [2026-04-06]
Smart contracts: (1) spec inputs/outputs/state-transitions/errors first — mandatory review gate; (2) audit existing deployed contracts + pattern libraries before writing new; (3) start bilateral escrow before DAO.

**p-error-classification-driven-recovery** [2026-04-08]
Classify error before deciding recovery. Relay-side transient (NONCE_CONFLICT) → resubmit same tx. Sender-side conflict (ConflictingNonceInMempool) → release nonce, re-acquire fresh, rebuild. TooMuchChaining → back off until mempool drains. Nonce serializer alone is insufficient when chain limit is the constraint.

**p-revision-loop-primitive** [2026-04-07]
Encode review/revision cycles as first-class workflow primitives. Check approval state before queuing a review (prevents duplicate floods). On re-review, explicitly verify each originally flagged item was fixed before approving.

**p-purpose-loop** [2026-04-08]
Daily PURPOSE evals expose directive gaps → low-scoring directives become next-cycle priorities (eval-to-action coupling). Query live DB (cycle_log, tasks) for metrics; missing outcome data is itself a priority gap.

**p-strategic-communication** [2026-04-06, merged 2026-04-08]
Non-operational requests: reply immediately to close async loop, queue P2 Opus task for substantive analysis. Multi-item feedback: reply with numbered action list, queue as single bundled P1 if interdependent or split P1/P2 if independent. When learning about a new agent integrating with your stack, propose a concrete integration concept and ask clarifying questions; queue research follow-ups to unblock dependencies.

**p-upstream-watch-integration** [2026-04-06, merged 2026-04-10]
When approving critical upstream repos, add to watch list and check for open PRs before creating follow-up tasks — enables async bundling, prevents revision ping-pong. Phase implementation when integration requires upstream code changes; prevents monolithic PRs and enables parallel progress.

**p-queue-composition-guard** [2026-04-08, enhanced 2026-04-12]
High-volume recurring task types can exceed 40–50% of queue. When any single recurring category exceeds 30% of pending tasks, apply a sensor cap or daily task limit. Strategic tasks should claim at least 40% of weekly dispatch cycles. **Silent sensor failure**: zero task creation rate despite no deploy changes = investigate state/config corruption. Monitor via `created_at > now - 2h AND source = 'sensor:X'`.

**p-failure-diagnosis** [2026-04-08, merged 2026-04-10]
When N failures spike: classify by error type first. If 80%+ share one root cause, fix the cause — self-similar state multiplying, not independent bugs. Report both aggregate rate and corrected rate (excluding dominant cluster). After shipping a fix, wait 1–2 cycles for residual failures; don't escalate.

**p-metric-cascade-dependencies** [2026-04-09]
Secondary metrics (competition score, brief inclusions, streaks) depend on primary metrics (signal filing, successful onboarding). Map dependency chain; prioritize fixing primary blocker. Once primary blocker ships, secondary metrics auto-resume without additional work.

**p-external-limit-resilience** [2026-04-10]
External rate limits (Claude Code daily ceiling) halt dispatch silently while sensors queue unaware → bulk stale-mark on resumption. Monitor API usage proactively with 20% buffer. Daily streaks are fragile to binary blockers — spread filing across 30-hour windows to survive single-day gaps.

**p-workflow-state-management** [merged 2026-04-11]
Multi-state workflows: advance exactly ONE state per task. Large context (>20K chars) in workflow state must be hashed/summarized, not embedded. Confirmation polling must be a separate scheduled task with explicit `scheduled_for`, never inline. Gate per-task token threshold (e.g., 750K); when triggered, split into one task per context load.

**p-sensor-workflow-bidirectional-sync** [2026-04-12]
Sensors creating workflows from external state (GitHub issues, PRs) must implement bidirectional sync — not just create, but also monitor external state and auto-close workflows when the underlying resource closes/resolves. One-way creation = stale workflow accumulation.
