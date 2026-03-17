# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions. Bulk DELETE operations may appear incomplete until WAL is checkpointed; force explicit checkpoint or service restart to finalize cleanup.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** When iterating architecture, consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns.
- **Architectural constraint paradox detection:** When a system component monitors itself (e.g., dispatch queuing recovery for dispatch stall), identify the loop and propose infrastructure that breaks it: external watchdog, out-of-band signaling, or bypass logic.
- **Interface + registry pattern for multi-impl systems:** When multiple implementations exist with if/else chains in core code, extract a clean interface + registry. Each implementation owns its own timeout, retry, and output parsing.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup: verify completion + block recent:** Mark state "done" only after verifying task completion in DB (`completedTaskCountForSource()`). Also dedup against recently-completed tasks — pending-only checks miss immediate re-queues after completion.
- **Sensor threshold recalibration when operational baselines shift:** When a fix changes patterns (e.g., cadence fix → daily posting jumps 1→10), thresholds tuned for old baseline become noise generators. Re-tune in a follow-up task.
- **Dedup key scope: entity-based, not reason-based:** Dedup evaluation must be uniform across all event reasons for the same entity (PR ID, contact ID). Reason-scoped dedup misses events for already-seen entities.
- **Multi-item dedup: check against newest item:** Compare against `Math.max(...timestamps)`, not oldest. Newer arrivals after an earlier reply get skipped otherwise.
- **Capability outage → sentinel + gate all downstream sensors:** On suspension, API exhaustion, or account ban, write a sentinel file and check it in every affected sensor. Prevents cascading failures and child-task explosion.
- **Proactive health sensors:** Add sensors for: (1) skill underperformance (>10 samples, <70% completion in 7 days), (2) cost-per-skill rolling average deviations >3×, (3) aggregate operational state (6h or 15min cadence). Converts reactive incident response into preventive tuning.
- **API contract validation in live sensors:** Validate expected API fields early and fail explicitly if diverged. Silently producing zero tasks when expected work exists is dangerous. Pattern: parse → validate fields upfront → log diagnostic + return "error" if missing/renamed. Example: aibtc.news renamed `streak.current`→`current_streak`; sensor silently skipped 5 days because `undefined > 0` evaluated false.
- **Sensor diagnostic writes to topical memory:** When sensors encounter recurring failures (auth, credential, API), write diagnostic context to topical memory files for FTS5 indexing.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Content-type routing:** Presentation/audience-facing work routes to Opus minimum. Retrospective tasks need Sonnet minimum (P7) — Haiku timeout insufficient for reading records + extracting patterns.
- **Timeout escalation on mid-tier saturation:** If a Sonnet task (P5-7) times out after 15+ min, task exceeds mid-tier depth — escalate to Opus (P3-4) or decompose. Prevents retry loops on fundamentally too-complex work.
- **Priority-based phase sequencing with explicit validation gates:** Use priority gaps to enforce phase sequence, but add explicit validation gates between phases. Phase N+1 never starts until Phase N validates.
- **Specification feedback triage:** PRD/spec reviews should structure feedback as blockers (must-resolve before Phase N starts) vs. recommendations (Phase N+1 enhancements). Clarifies scope, prevents Phase 0 creep.
- **Tiered improvement planning from audits:** Organize into tiers (T1=this week, T2=two weeks, T3=backlog) and queue as priority-ranked tasks (T1→P3, T2→P5, T3→P8).
- **State-machine-driven task chaining replaces ad-hoc sensors:** Replace sensor-triggered task lists with state machines that auto-transition on completion. Benefits: better cost attribution, automatic retry tracking, declarative flow, explicit terminal states.
- **Single template + context configuration for feature tiers:** Use one state machine template with a context field to gate behavior across stakeholder tiers. Graduation = context change, not template swap.

## Task Chaining & Precondition Gates

- **Recommendations require code + procedure completeness:** Behavior/process changes are incomplete without both code delivery AND execution procedure updates (CLAUDE.md, review checklists).
- **Research aggregation for synthesis clarity:** When multiple research sources feed a synthesis task, aggregate all findings to a single scratchpad location. Prevents data loss; allows downstream tasks to reference one canonical location.
- **External resource disambiguation in task handoff:** Use fully-qualified identifiers (`owner/repo` slug, full URL) not project names alone. Load relevant SKILL.md via `--skills`. Prevents models from confusing similarly-named resources.
- **Resource state + capability verification before acting:** Check current state (wallet, config, balance, existing capability) before queuing follow-ups or prerequisite tasks. Stale premises generate large task chains; missing capability checks create false prerequisites.
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. No monitoring chains waiting for external state.
- **Secret provisioning is operator-only:** Agents can load from creds store but cannot provision. Provide exact `arc creds set` CLI command + close without escalation.
- **Simplify during capability audits:** When auditing code for capability state, run `/simplify` on affected paths in parallel. Couples verification with code health improvements in a single cycle.
- **402 CreditsDepleted: communicate, block, gate sensor:** Reply with specific error, write sentinel, create one pending task. Without a gate, sensors cascade new failures continuously.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Scratchpad context capping in child task families:** Cap scratchpad context at ~2k tokens in dispatch; auto-summarize on task close.
- **Infrastructure resource audit before self-hosted capability decisions:** When recommending self-hosted vs. external APIs, audit system resources (RAM, CPU, GPU) against component requirements first. Prevents runtime failures due to undersized infrastructure. Example: 3.8GB/2vCPU insufficient for Whisper+Kokoro; browser APIs recommended instead.
- **Phase gating on infrastructure availability, not just completion:** Capabilities requiring different infrastructure tiers (Phase 1: browser APIs on existing hardware vs. Phase 2: ML models on GPU) should be explicitly gated on resource provisioning. Build/test Phase 1 independently without Phase 2 dependencies.

## Integration Patterns

- **Signature verification: data-format-driven algorithm priority:** For multi-algorithm crypto verification, determine primary vs. fallback based on data format (address type, signature structure) not static priority.
- **Defensive field parsing for volatile API contracts:** Use compatibility layers that try multiple field names (newer first, then legacy) or detect API version upfront. Document breaking changes and mutation dates in SKILL.md. Pattern: `current_streak ?? data.current ?? 0` instead of direct access.
- **Constraint explicitness in specifications prevents implementation divergence:** Implicit constraints (budget caps, rate limits, ordering dependencies) in specs cause ambiguity. Enumerate ALL constraints with concrete values—not "reasonable rate limit" but "100 req/min."
- **Direct deployment via native platform tooling:** When target platform provides native deployment (e.g., wrangler → Cloudflare) that bypasses GitHub-push requirements, use it.
- **Credentials — three rules:** (1) Never pass secrets via CLI flags — use env vars or credential store. (2) Sensor, CLI, and creds store must use identical service/key names — mismatches cause silent failures. (3) Validate at health-check time; `getCredential()` returns Promises, always `await`; validate storage format.
- **Dual-endpoint auth models + cascading fallback:** Some APIs use different auth headers per endpoint class. When service API keys are missing, use admin key as fallback. Document both schemes and endpoint-auth matrix in SKILL.md.
- **HTTP response validation before parsing:** Always check `.ok` before calling `.json()`. Pattern: `if (!response.ok) throw new Error(...)` before `.json()`.
- **Fetch boilerplate consolidation + parallelization:** When 3+ files repeat the same fetch + credential lookup + validation pattern, extract a shared helper. Use `Promise.allSettled()` for independent API calls within integrations — reduces latency ~50% without adding retry complexity.
- **Aggregation query scope must match visualization intent:** Filter to intended scope explicitly (context, folder, timeframe, grouping). Normalize output format consistently before aggregation (numbers via `fmtNum()`, dates ISO-8601, dedup by canonical key).
- **Skill name resolution validation before dispatch:** Typos in `arc skills run --name X` fail silently. Validate skill names against `arc skills` or directory before use.
- **Framework dependencies in bulk cleanup:** Audit `src/` and `templates/` for imports from `skills/`. Core dependencies must be preserved in a keep-list before archiving skills.
- **Header-based protocol versioning audits:** Document version-specific breaking changes at the transport layer separately from endpoint changes: header name changes, value format migrations, required vs. optional headers.
- **End-to-end integration dogfooding for fix verification:** When verifying integration fixes, send/deploy a live test artifact. Local test passes + code review do not guarantee the integration layer (SMTP worker, HTTP middleware, encoder) handles data correctly.
- **Task result_summary as authoritative extraction source:** When extracting user-facing content from completed tasks, prefer `result_summary` over reconstructed values. Ensures downstream presentations reflect what the agent actually reported.
- **Email infrastructure constraints on sending:** Email routing systems restrict outbound sends to pre-verified allowlists. Route through SMTP relay for external sends.
- **Skill assembly before credential activation:** Build complete skill while waiting for credentials. Sensor gracefully skips when token is missing.

## Claims, Git & State

- **Dependency-ordered PR merging:** Identify dependency graph and merge in topological order (independent first, then dependents). Catches conflicts early.
- **Live deployment divergence + fix timing synchronization:** Audits must check live site AND source HEAD. `exit 0` from deploy tools doesn't guarantee CDN served the update — fetch live URL to verify. Queue dependent tasks only after fix is deployed live.
- **Task completion verification for external artifacts:** Verify artifact is visible in its destination AND contents match intent (real data, not placeholders). Task execution success ≠ artifact visibility ≠ artifact correctness.
- **Reviews and feedback must post back to source:** When completing reviews on external resources (PRD gists, PRs, specs), post full analysis back to the original location. Local-only completion leaves stakeholders blind.
- **Proof over assertion:** Verify infrastructure claims against authoritative sources (on-chain queries, direct API calls) before publishing. Cross-check identity claims against registries.

## Email & Coordination Patterns

- **Email response completeness + async handoff:** Upon email-driven requests: (1) acknowledge delays transparently, (2) confirm ALL technical decisions explicitly, (3) create follow-up task with complete scope in description — not external references, (4) mark message read after task creation.
- **Batch coordination for task families:** Create one task with unified batch logic rather than N individual per-recipient tasks. Prevents queue fragmentation.
- **Email state marking on task queue:** Mark email as read/processed immediately after task creation. Prevents email-sync sensor from re-triggering on the same message.
- **Trusted partner handling:** For requests from whoabuddy, skip external confirmation but always verify capability/skill state AND resource/artifact state before queuing. Respond directly with code/artifact analysis rather than queuing research tasks.
- **GitHub issue externalization for collaborative findings:** When reviewing code in a stakeholder's repository, create GitHub issues directly for discovered problems. Externalizes findings to their tracker instead of losing them in internal memory.
- **Honest reporting when data is incomplete:** Respond with substantive analysis from existing knowledge + communicate gaps transparently. Queue verification tasks for confirmed gaps.
- **Memory correction verification before update:** When receiving corrections about stale memory entries, verify each claim's current state before updating (code search, git log, config inspection). Update only entries confirmed stale.
- **Multi-item feedback consolidation:** Queue ONE consolidated follow-up task (not N separate tasks) with all items as a numbered checklist. Route critical items at +1-2 priority tiers; group cosmetic items.
- **Stakeholder presentation metric filtering:** For non-technical stakeholders, strip internal operational details and reframe operational challenges as outcomes. Focus on progress, not infrastructure internals.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Operational cadence:** Three-tier check-in: heartbeat (15min) → ops review (4h) → daily brief (24h). When cadence changes, all time-based thresholds scale proportionally.
- **Worker cleanup sequence before restart:** (1) Clear task database, (2) Reset MEMORY.md to template, (3) Remove hook-state sensor files, (4) Verify SOUL.md, credentials, code intact.

## Operational Rules

- **Named constant alignment audit:** Verify code constants match runtime values and all threshold references use the constant. Search for all hardcoded literals matching the constant value and replace with the constant identifier.
- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **Dispatch bottleneck diagnosis:** Zero dispatch cycles → check `db/dispatch-lock.json` and gate-state files first. Gate investigation is 2min, logic investigation is 30min.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Stale lock detection + recovery:** Always check PID liveness via `isPidAlive(PID)` before alerting; old timestamp + live process = healthy lock.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Free-tier-first recommendations:** Prefer free solutions before paid options. GitHub native security tools (Dependabot, CodeQL, Secret Scanning) solve 80% of security concerns at zero cost.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free.
- **Cost tracking:** Track per-cycle cost baseline by priority tier (sensor-reactive ~$0.29, strategic P2-4 ~$0.38+). Budget limits don't throttle dispatch.
- **Research scope binding prevents creep:** Define explicit boundaries upfront for retrospectives: date ranges, entity scope, what "complete" means. Prevents open-ended data gathering.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Failure metric distortion sources:** Bulk cleanup operations and stale recovery waves (>60min outage) produce high failure rates that are not quality signals. Filter before alerting.
- **Reactive task volume can starve strategic priorities:** Schedule strategic tasks (D1/D2 directives) at P1-3 to prevent queuing indefinitely behind sensor tasks.
- **Memory-driven rule validation:** Before implementing rules for recurring failures, query topical memory to validate scope. Prefer adaptive feedback loops over static rules.
- **Bulk social media operations: forward-only constraint:** Bulk historical content syndication appears spammy and damages brand perception. Constrain to new content only; skip historical backlogs.
- **Hierarchical content dedup for syndication:** Parse source references embedded in child task subjects to identify parent-child relationships. Exclude child-syndication tasks from independent content sections.
- **Multi-item feedback routing:** Classify each element (capability building, config, analysis, planning) and route: capability building→P3/Opus, analysis→P5/Sonnet, config→P6/Sonnet. Communicate mapping as summary table.
