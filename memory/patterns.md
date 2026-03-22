# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*
*Last updated: 2026-03-22T02:32Z*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax before commit; reverts src/ changes if services die post-commit.
- **Security gate code review — fail-open + validation + boundaries.** Audit for: (1) fail-open bugs, (2) input validation + parsing safety, (3) null/boundary conditions, (4) auth vs authz separation — routes may pass authentication but skip authorization. Trace handler through service through data validation. (Validated: #7416, #7757)
- **Fleet topology rules:** Orchestration + GitHub sensors are Arc-only. Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers; use explicit gates over timers:** Consolidate first. Use on/off sentinel files + human notification instead of arbitrary cooldowns.
- **DB migration three-phase pattern: prep/review → execute+snapshot → integrity check+auto-rollback.** Protects operational continuity. (Validated: #7745)

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All sensors: interval gate (`claimSensorRun`), entity-based dedup (hook-state or `completedTaskCountForSource()`), then task creation. Dedup source key must be stable across sensor renames (use domain slug prefix, e.g., `welcome:` not `sensor:aibtc-welcome:`). Dedup mode: 'any' for once-per-lifetime entities; 'pending' for re-engagement; `pendingTaskExistsForSource()` for retryable ops. (Validated: #7438, #8000, #8002)
- **Resource-constrained task queuing:** For daily caps or hard rate limits, check shared utility (e.g., `isDailySignalCapHit()`) before `insertTask()`. Saturation-skip gates: when system already at capacity, `return "skip"` at sensor level rather than queuing rejectable tasks. (Validated: #7806, #8002)
- **Sentinel gates + self-healing:** Write sentinel files to gate during transient crises. Implement periodic self-healing: check underlying service health; if restored, auto-clear sentinel. **CAVEAT: structural health checks (endpoint reports no errors) ≠ operational health (actual transactions succeed).** Relay `/health` can report healthy while x402 submission still fails — validate operational capability (test transaction), not just circuit breaker status. Cap queue creation per cycle (e.g., 3/run) when clearing backlogs after sentinel release to prevent flood. Without cooldown between clears, sensors create loops: clear → tasks fail → rewrite sentinel → 30min later repeat. (Validated: #7907, #7908, #8000, #8115)
- **Consolidate or cap redundant domain sensors:** When >2 sensors monitor the same domain, consolidate into one with per-repo routing. Reduce lookback window atomically post-consolidation. Dispatch-created retry tasks bypass sensor dedup — use `--parent <original_id>` to prevent accumulation outside rate limits. (Validated: #7386, #7397, #8000)
- **Category rotation to prevent signal flooding:** When hitting daily cap, rotate through data categories via hook-state index. Fetch 2 categories/run from a 4-8 item list to ensure diversity. (Validated: #7689)
- **Sensor health visibility:** Dark periods (5+ days) indicate infrastructure failure. Add weekly sensor health roll-call; monitor skill CLI/API drift via periodic health checks. (Validated: #7175)
- **Disaggregate success rates by code path to detect path-specific breakage:** When observing partial success (some tasks complete, some fail), always disaggregate by outcome before diagnosing. A task batch with 8/27 completion may hide a critical path where 0/25 succeed (e.g., x402-requiring paths all fail, while legacy-BTC paths all succeed). Aggregate metrics mask path-specific systemic issues. In retrospectives, slice by code path, not just task status. (Validated: #8115)
- **Workflow instances for multi-phase sensors:** Sensors generating recurring multi-phase task chains (e.g., alert → triage → retrospective, or health-check → queue-fix → verify) should create `WorkflowInstance` objects (via state machine library) instead of bare tasks. This enables automatic phase dedup, proper ordering, and tracks entity state across cycles. Bare task chains are unordered and can accumulate duplicates; workflow instances prevent this. (Validated: #8151)

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Presentation/audience-facing work routes to Opus minimum.** Tone, framing, and audience judgment require senior modeling.
- **Retrospective tasks need Sonnet tier (P7) minimum.** Haiku timeout insufficient for reading records + extracting patterns.
- **Business-critical time-bound work escalates tier regardless of complexity.** Deadline <48h AND business impact >$1000 → Opus minimum. Business consequence overrides complexity-based routing. (Validated: #7815)
- **Optional feature graceful degradation:** Design tasks so missing optional capability skips the feature without blocking core work.
- **Task description quality feeds Opus efficiency:** Sensors generating minimal/generic descriptions force Opus to infer scope. Quarterly AGENT.md review of top-20 skills improves outcomes. (Validated: #7344)

## Task Chaining & Precondition Gates

- **Multiple related tasks hit source dedup: use --parent instead.** Approval-blocking work routes to P1 Opus minimum. (Validated: #7410)
- **Task supersession must close superseded tasks explicitly:** When a higher-priority task makes lower-priority pending tasks redundant (same subject/scope), close them with `status=failed, summary="superseded by task #X"` before completing your own work. Explicit closure prevents confusing audit trails and inflated failure counts. Do not leave superseded tasks to fail independently. (Validated: #8118)
- **Stop chain at human-dependency boundary:** Escalate once, set `blocked`, stop. Secret provisioning is operator-only; provide exact `arc creds set` CLI command + close.
- **Verify event premise before spawning derivative tasks:** Check current state before queuing follow-ups. Cross-cycle verification: use persistent artifacts (git history, source files, DB records), not memory. Arc has no inter-session task memory; filesystem/git is authoritative. (Validated: #7735)
- **Task source attribution:** Set source (`task:<parent_id>`) for derived tasks — source=null bypasses domain constraints. Commitments to validation/audits materialize as queued tasks immediately; unqueued intentions dissolve. (Validated: #7141, #7437)
- **402 CreditsDepleted: communicate, block, gate sensor.** Reply, write sentinel, create one pending task. Gate prevents cascading failures.
- **Pre-dispatch gates execute pre-queue, not post.** If execution still occurs after gate filtering, the gate is running post-queue — audit gate context to block the DB write, not just filter at dispatch time. (Validated: #7651)
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.

## Integration Patterns

- **Credential patterns:** Never pass secrets via CLI flags. Use identical service/key names across sensor/CLI/creds layers. Validate at health-check time, not first API call. `getCredential()` returns Promises — always `await`. (Validated: #7140)
- **API version/auth migration requires coordinated client updates:** Update all callers simultaneously. Protocol model changes require state guards: migrate config, API client, CLI, and docs together. Add phase/state gates to prevent operations in the wrong cycle state. (Validated: #7140, #7783)
- **Canonical metadata inventory:** Export asset metadata (skills, sensors, APIs) as queryable JSON; version-control it. Skills with 5+ extra files beyond baseline indicate over-specialization — queue P8 scope review. (Validated: #8065)
- **Component lifecycle via 4-bucket classification:** For meta-audits of reusable components (skills, sensors, templates), classify into: "shared" (portable), "agent_specific" (Arc-coupled), "runtime_builtin" (core engine), "delete" (unused). Validate via: (1) scan source for hardcoded agent refs (wallet addresses, fleet names), (2) cross-reference 30-day usage frequency, (3) map upstream equivalents. Unused 30+ days + zero refs = delete-safe. High usage + agent refs present = needs parameterization before sharing. (Validated: #8086)
- **Feature branch patterns:** Check remote branch for existing implementations before starting. Layer new modules alongside existing code paths — extend, don't replace. (Validated: #7221, #7390)
- **Batch external registry contributions in parallel:** Implement all items locally, verify conventions, file all PRs simultaneously. Parallel filing enables one-pass maintainer feedback and eliminates queue bottlenecks. (Validated: #7885)
- **Shared CLI-wrapper helpers for cross-skill safety gates:** Implement shared verification checks once (e.g., trust-gate.ts); domain skills import. Optional `--flag` params enable graceful degradation; add `--force` override for exceptional cases. (Validated: #7793)
- **Parameterize agent-specific references in shared components:** When a component is classified "shared" but contains hardcoded agent identities (wallet addresses, fleet member names, whoabuddy trust rules), extract to config file or CLI flags. Presence of agent refs blocks sharing — refactor first. Confirmed examples: defi-zest (hardcoded ARC_ADDRESS), arc-workflows (whoabuddy in PSBT signing). (Validated: #8086)
- **Comparative inventory methodology: relationship-type classification drives consolidation decisions.** When comparing local vs upstream component inventories, classify each mapping with relationship type (equivalent/extension/orthogonal/specialization/different-tools). Use relationship type to drive decisions: equivalent→consider replacement, extension→contribute feature back, orthogonal→document and keep separate, different-tools→investigate naming confusion. Catalog unmatched upstream components by adoption readiness (maintenance currency + documentation completeness + integration cost). (Validated: #8089)
- **Protocol evaluation framework:** (1) real production volume, (2) implementation landscape, (3) production examples, (4) academic backing. Volume reality often contradicts narrative. Verify protocol philosophy alignment before committing. (Validated: #7289)
- **MCP tool architecture:** Separate tools from service logic. Thin tools delegate to thick service methods. Register in both index.ts and skill-mappings.ts. (Validated: #7367, #7382)
- **Required-field defaults in CLI/API integration:** Provide sensible defaults for required downstream fields. After fixing integration issues, create immediate test task to verify end-to-end before requeuing dependents. (Validated: #7681, #7683)

## Claims, Git & State

- **Live deployment divergence:** Check live site AND source HEAD. Services don't auto-reload — `systemctl restart <service>` after code commits. (Validated: #7339)
- **Proof over assertion:** Verify claims against authoritative sources before publishing. DB-validated data for financial reports. (Validated: #7175)
- **Circuit breaker state latch bug pattern:** State setters must be conditional on whether the condition *still exists*, not just the triggering event. Unconditional setters latch the breaker open despite service recovery. (Validated: #7914)
- **Code review blocking verification:** Verify original concerns exist in current code. Scan diffs → trace call stack (handler/service/data layers) → verify fix spans all layers. Self-authored PRs: provide detailed review but do not self-approve; delegate merge to another maintainer. (Validated: #7417, #7757, #7418)
- **CI comment dedup:** When CI systems already post comments on a PR, Arc must not add its own review comments — creates confusing "self-review" appearance. Let CI speak; only respond if PR author explicitly requests feedback. (Validated: #7898)
- **Explicit blocking/suggestion labels in reviews:** Mark each item [blocking] or [suggestion]. Blocking = must fix before merge. Suggestions = nice-to-have. (Validated: #7757)
- **Numbered review feedback for re-review efficiency:** Structure initial feedback with numbered items (e.g., "1. LIMIT 500 2. Error boundary 3. Migration comment"). On re-review, verify each item without re-auditing the full PR—fast feedback loops encourage author commits; re-review verification is straightforward. (Validated: #8157)

## Email & Coordination Patterns

- **External confirmation gates + draft-first:** Verify current state before queuing. Queue draft separately → approval → publish. Follow stakeholder direction on duplicates. (Validated: #7398)
- **Stakeholder request decomposition:** Decompose into triage (same cycle) + execution tasks (appropriate model tier). Stakeholder-directed architecture overrides defaults — document in result_summary and SKILL.md. (Validated: #7446, #7436)
- **Urgent stakeholder emails: immediate reply + escalation queue.** Acknowledge + state action plan; don't silently queue. Email closure gate: don't mark task complete until follow-up task is queued. (Validated: #7752, #7800)
- **Infrastructure health verification before escalation:** Verify live endpoint health before escalating. Self-healing may have resolved the issue. Operator-reported mismatch (healthy service + blocked gate) signals a state latch issue, not service failure. Ask which agent encountered the issue and when — distinguishes fleet-wide from agent-local problems. (Validated: #7905, #7907, #7910)
- **Approval + downstream request = skip intermediate review:** Approval + execution request in same message → queue single P3+ delegation task for both. Claim-verification for accuracy-critical drafts: decompose into targeted claims, spawn parallel research subagents, verify via live endpoints. (Validated: #7883, #7866)
- **Asset-first review gate:** Commit audit/proposal to version control; send stakeholder a pointer to the file. Avoids email size limits and creates durable record. (Validated: #7479)
- **Time-sensitive interrupts → identify systemic root cause:** After resolving time-sensitive interrupt, queue P3+ follow-up for the systemic issue that created it. Prevents repeat interrupts from same root cause. (Validated: #7873)

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors. >20 pending → redistribute. Periodic task triage clears 10-20%. (Validated: #7175)

## Quest & Complex Analysis

- **Multi-phase quest structure for 100+ item reviews:** For large architectural audits, structure as multi-pass quest: (1) triage/scoping, (2) validation/normalization, (3) cross-reference/relationship-mapping, (4) synthesis/enrichment, (5) manifest/summary. Each phase commits artifacts; next phase builds on prior output. Enables research parallelization and avoids context bloat. (Validated: #8086–#8090)

## Operational Rules

- **Retrospective queue gatekeeping:** High-level reviews shape the task queue. result_summary must include queue actions: killed X stale tasks, queued Y next-phase tasks. Distinguish structural from operational issues. Check for bulk-kill events before treating anomalous failure counts as incidents. (Validated: #7348, #7651)
- **Event-driven infrastructure readiness:** For time-bound events, validate infrastructure + external dependencies, close stale work, queue quality audit, then hand off to autonomous sensor operation. Critical-path external dependencies missing with <48h to deadline → escalate as P2 human-action task, separate from technical fixes. (Validated: #7717, #7835, #7861)
- **Cross-sensor parity check for shared gates:** When multiple sensors share rate-limits/daily caps, audit pre-check logic before time-bound events. Verify in actual sensor code, not just docs. Inconsistency causes unpredictable failures during high-stakes periods. (Validated: #7835, #7839)
- **Sensor disabling on unresolved backlog:** >50 pending tasks from blocked sensor → disable with `return "skip"` + bulk-close backlog + P3 root-cause task. Disabling stops feedback loops more effectively than pre-checks. (Validated: #7991)
- **Unreliable data sources trigger replacement, not retries:** 2+ consecutive failures → P3 source-replacement task with alternate source + validation approach. (Validated: #7861)
- **Failure rule:** Root cause first, no retry loops. Persistent external blocker → mark failed, create P8 follow-up task. (Validated: #6456)
- **Fleet hardware: CPU-only.** All 5 VMs are VMware instances. No GPU, no audio. Fail immediately for GPU-required tasks. (Validated: #6509)
- **High-risk tasks:** Include `worktrees` skill for src/ changes. Escalate irreversible actions, >100 STX spend, or uncertain consequences to whoabuddy.
- **Infrastructure prerequisites gate production deployment:** Validate code compiles, commit changes, create follow-up listing missing infrastructure. Prevents silent failures. (Validated: #7190)
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
