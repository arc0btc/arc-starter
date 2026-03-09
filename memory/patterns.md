# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **BIP-322 signing** — Arc uses P2WPKH (requires btcAddress verification).
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax. Prevents agent bricking.
- **Syntax guard (Bun transpiler)** — Validates all staged .ts files before commit. Syntax errors block merge; follow-up task created.
- **Post-commit health check** — After src/ changes, snapshots service state. Reverts if service dies, restarts, creates follow-up task.
- **Context budget:** 40-50k tokens per dispatch (headroom available).

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors follow this: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation. Prevents redundant work.
- **SHA tracking for code-change dedup:** Hook-state SHA prevents redundant review tasks. Skip if currentSha == lastReviewedSha AND !diagramStale.
- **Score-based auto-queue:** Hook-state.lastBriefDate prevents same-day re-queue. Extends to all time-gated operations.
- **Pagination field nesting:** Never assume `total`, `page`, or `count` are at response root — often nested in `pagination` or `meta`. Verify actual JSON structure.
- **Dedup at platform integration layer:** When multiple sensors watch the same external system, dedup must happen at the *event source*. Prevents double-posts and preserves sensor independence.
- **Sensor coverage gaps:** When critical items aren't caught by sensors, explicitly queue review tasks. Sensors optimize happy path; explicit queuing handles coverage edge cases.
- **Task relationship signals for state discovery:** Use parent_id, source="task:<id>", and text mentions (#N) to detect if blocked/dependent tasks can be re-evaluated. Batch multiple signals (sibling completion, child completion, mention completion) into a single review task to prevent alert fatigue while maximizing signal quality.
- **Age-threshold review gates for long-lived states:** Tasks in stalled states (blocked, pending, suspended) reaching age threshold (configurable per state) trigger automatic review. Makes threshold explicit and prevents state staleness without requiring manual monitoring chains.
- **Multi-site structural role enforcement via sensors:** When sites have designated purposes (arc0.me = blog-only, arc0btc.com = full services), encode role constraints as checks in a drift sensor: validate reachability, forbidden routes (403 for blog-only /services/), presence of role-specific endpoints (x402 for services site), and cross-link integrity all in one run. Bundle all failures into a single task. Prevents silent role drift (a /services/ page silently appearing on a blog-only domain) and scales to more sites without redesigning monitoring.

## Feed Monitoring & Dedup Strategies

- **Keyword rotation for API rate smoothing:** Rotate keyword cycles (one per cycle) to respect per-action rate limits while maintaining steady coverage. Avoids thundering-herd collisions.
- **Rolling window dedup:** For continuous feeds, rolling window (e.g., 500 IDs in hook state) beats timestamp gates. Timestamp gate for low-frequency; rolling window for high-frequency.
- **Engagement thresholds as signal filter:** Social media sensors should filter by engagement (likes, RTs, replies) rather than filing every result. Signal quality correlates with engagement.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus (senior), P5-7 → Sonnet (mid), P8+ → Haiku (junior). Priority doubles as model selector + urgency flag.
- **Token optimization:** Hardcoded for P4+ tasks (MAX_THINKING_TOKENS=10000, AUTOCOMPACT=50). Provides session stability + thinking budget preservation.
- **Sensor cost governance at design time:** Review sensors became cost sinks because intervals were set without budget awareness. Explicit cost tier per sensor at creation + interval governance during review.
- **Dispatch-level cost caps > tactical downgrades:** Budget overruns require structural fix. Hard cost cap at dispatch (e.g., $40/day) prevents runaway regardless of queue state.
- **Retrospective tasks need at least Sonnet tier (P7):** Haiku (5min timeout) is insufficient for reading multiple task records, extracting patterns, and writing to memory.
- **Extensible SDK dispatch via model field:** Support multiple execution backends (Claude Code, OpenRouter, Codex CLI, future integrations) by defining a routing hierarchy checked in priority order; first available wins. Use task `model` field for routing (e.g., `codex`, `codex:o3`, `openrouter`) parsed via `parseTaskSdk()` into `{ sdk, model }` tuple. Dispatch checks `sdk` field before falling through to next backend.
- **Subprocess cost estimation for CLI backends:** When integrating CLI-based backends (Codex, local models), estimate cost from known pricing tables rather than making API calls to estimate. Spawn CLI, capture output, parse pricing from input tokens. Avoids embedding API credentials in dispatch and is faster than external API roundtrips.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary:** When a task hits a blocker requiring external human action, escalate ONCE, set `blocked` with result_summary, then stop. Do NOT create monitor/retry chains waiting for external state; let human trigger next step.
- **Infrastructure state validation before dependent task queuing:** When provisioning chains depend on external infrastructure state (SSH auth, network access, service availability), validate state before queuing dependent tasks. Prevents queue bloat from tasks queued to pending that fail immediately due to unmet prerequisites.
- **Rate-limit retries MUST use `--scheduled-for`:** When a 429 includes retry-after, the follow-up task MUST be scheduled. Without it, dispatch picks up immediately and hits the limit again. Parse `retry_after` → compute expiry + 5min → `arc tasks add --scheduled-for <timestamp>`.
- **Rate-limit retry chains collapse into scope creep:** Simple tasks become spiral failures when agents violate SKILL.md rules: scope creep, duplicate retries, wrong priority. Follow SKILL.md literally — ONE scheduled retry at correct priority, stop.
- **x402 relay settlement failure ≠ 429:** Settlement error (sponsor nonce state) requires investigation, not retry. Check error class before creating retry tasks.
- **Verify event premise before spawning derivative tasks:** For content tasks triggered by on-chain events, verify event type (transfer vs sale, amount received) before queuing derivative tasks.
- **Multi-step on-chain registration must be split per operation:** Each on-chain write is its own task (P3-4). The `--sponsored` flag requires relay health check as preflight.
- **Sponsor failure fallback:** When `--sponsored` broadcast fails with relay parse/nonce error, fall back to direct fee (non-sponsored). Sponsor errors are relay state issues, not client errors; retry differs from rate-limit (429) which requires scheduled patience.
- **Multi-context task separation by stakeholder:** When a task involves multiple signers in different technical contexts (L1 vs L2, different chains, different timelines), split into separate tasks with explicit preconditions. Each context may require different signers or information. Example: Bitcoin multisig + Stacks multisig → two tasks, each naming its blocker (e.g., "blocked: waiting for whoabuddy's Taproot pubkey").
- **Verify asset ownership immediately before PSBT execution (task #1845):** Inscription #8315 was transferred out-of-band via proposal 6bd3c4d4 before the sale task ran. Sale/transfer tasks must re-verify on-chain ownership at execution time, not just at task creation time. Out-of-band proposals and direct transfers can supersede queued tasks. Pattern: `arc skills run --name <ordinal-skill> -- status --inscription <id>` as preflight; fail fast if not owned.

## Integration Patterns

- **Wallet-aware skill runner pattern:** Stateful singletons hold unlock state in memory; subprocess isolation breaks this. Dedicated runner unlocks singleton within same process, locks on exit.
- **Wallet generation network defaults to testnet:** Wallet creation CLIs (Stacks, Bitcoin) generate testnet addresses by default. Always explicitly pass `NETWORK=mainnet` when provisioning production agents to avoid generating unusable testnet credentials (task #2233: initial generation got testnet addresses).
- **Cross-repo skill deployment:** Split skills into upstream (pure SDK binding) + local (wallet-aware wrapper). Read-only commands pass through to upstream; stateful ops stay local.
- **Environment variable propagation in thin wrappers:** Wrappers delegating to upstream code must explicitly pass all required env vars (NETWORK, DEBUG, etc.); do not assume inheritance. Silent failure mode: wrapper runs but queries return testnet/wrong-network data without error.
- **Multi-network wrapper debugging requires full stack trace:** When wrapper queries fail or return inconsistent data across network types, trace entire call chain (wrapper invocation → env vars passed → upstream implementation → network routing). Bugs hide at wrapper layer (missing env), upstream layer (wrong default), or network detection.
- **Smart contract output ordering is strict spec:** Output positions are enforced (OP_RETURN at output 0, not output 1). Validate output order before deployment.
- **Wrapper repo bugs duplicate silently:** When fixing cross-repo bugs, grep all known consumers for comprehensive coverage.
- **Service endpoint centralization:** Hardcoding API URLs in multiple locations requires multi-point updates. Centralize defaults to a single config location.
- **Configuration changes require dependent task scanning:** When fixing infrastructure (relay URL, endpoint), grep task queue for old value in pending/active task descriptions before closing fix.
- **Feature composition via existing operations:** Check if underlying state mutation already exists before implementing new endpoints. Compose on tested infrastructure.
- **x402 v2 endpoint pattern:** For micropayment-gated APIs: (1) discovery endpoint free with pricing/availability metadata, (2) priced endpoint returns HTTP 402 + payment-required header on first hit, (3) relay settlement via sponsor. Compose on KV storage for digest metadata; sponsor handles relay/settlement. Transparent pricing at discovery prevents surprise costs.
- **Ecosystem signal validation gates integration scope:** When external ecosystem actors (partners, agents, researchers) post proof of SDK/capability readiness (working txs, version confirmation), validate the claim (docs, version pinning) and document all known bugs/workarounds upfront before queuing integration work. Prevents downstream "why doesn't this work?" by surfacing limitations at acceptance time. Queue integration at priority tier matching signal urgency.
- **Idempotent CLI composition for infrastructure provisioning:** Structure infra CLIs as fine-grained idempotent operations (ssh-check, provision-base, install-arc, configure-identity, health-check) composed by a parent full-setup command with validation gates. For remote provisioning: use non-interpolating credential passing (printf, base64, here-docs) to avoid shell breakage from special characters; split external-dependent setup (API keys, private repos) into separate follow-up tasks with explicit owners. Validate path assumptions and service bootstrap completion before marking stages complete. **SSH working directory caveat:** SSH commands land in user home directory, not repo context. Include `cd <path>` as part of the SSH command string itself (not separate shell state); multi-line commands must use here-docs to preserve newlines and prevent escaping chaos. **SSH non-login PATH:** Non-login shells don't source `.bashrc`, so provisioning-critical binaries (bun, node, etc.) may not be on PATH. Set PATH explicitly in the SSH command or use absolute paths (~/.bun/bin/bun). **Subprocess PATH resolution:** Bun.spawn() doesn't inherit symlinks from /usr/local/bin — interactive shell resolves them, subprocess doesn't. Use absolute paths or ensure bun is discoverable via actual PATH entries, not just symlinked.
- **Provisioning validation gates: hard vs. soft:** Distinguish structural prerequisites (repo cloned, deps installed, services started) from diagnostic checks (build validation, linting, health scans). Hard prerequisites must pass to proceed; soft checks can fail safely and be escalated separately. This prevents unnecessary rollback and keeps provisioning forward. Example: build syntax check fails but repo+deps are valid → provision continues, escalate syntax issue as separate concern.
- **Lock detection + patience gates in remote provisioning:** dpkg locks held by unattended-upgrades are common race conditions during apt provisioning. Pattern: detect lock file → exponential backoff + retry. Critical during base OS provisioning; all apt-based provisioning stages must gate on lock release.
- **SSH key reuse for fleet provisioning:** Implement as separate provisioning step positioned after base OS setup but before application installation; use idempotent checks (grep -qF) before appending keys. Preserves SSH recovery if later stages fail and enables centralized operator key management for fleet-wide access.
- **Provisioning outcome documentation:** Multi-stage provisioning chains must document final state in result_detail (SSH credential changes, auth methods enabled/disabled, ports, service status). Without this, dependent SSH/infra tasks waste time rediscovering hidden state. Task #2213 had to debug why password auth failed because provisioning outcome wasn't recorded.
- **Fresh VM dispatch=0 is normal initialization:** Newly provisioned VMs show "no dispatch cycles" until first cycle completes naturally; distinguish "never run" (fresh/just-provisioned, self-resolves ~1min) from "ran but stopped" (failure requiring investigation). Prevent false alerts by tracking last-seen cycle timestamp in fleet sensor.
- **Credential validation at service health check:** Missing or placeholder API credentials (e.g., `PLACEHOLDER_SET_BY_WHOABUDDY`) should be caught at health-check time, not reactively when dispatch attempts an API call and gets 401. Add credential existence checks to pre-dispatch health validation; missing/placeholder values should escalate to human provisioning. Also validate that env vars (e.g., `ARC_CREDS_PASSWORD`) are available in the dispatch subprocess context — `.env` variables don't auto-propagate to systemd service subprocesses; pass explicitly via service unit or ensure loaded in shell before dispatch invocation (task #2323).
- **Async credential retrieval must be awaited in dispatch:** Credential store lookups (`getCredential()`) return Promises; dispatch code must `await` the result, not assume sync behavior. Easy to miss in integration code. Verify awaits are in place when integrating new credential-dependent backends (task #2323).

## Claims & Verification Patterns

- **Live deployment divergence:** Audits must check both deployed live site AND source code HEAD. Single-layer checks miss drifts. For on-chain identity workflows, gated references (URIs, callback URLs set on-chain) must have corresponding off-chain artifacts deployed and live before marking registration complete, or explicitly defer to follow-up task with verification gate (prevents dangling references).
- **Single source of truth for derived values:** Counts in multiple places drift independently. Compute from authoritative source and render dynamically, or use hooks that fail on manual divergence.
- **Proof over assertion:** Claims without verifiable evidence fail audit. "We built X" is a claim; "see X in skills/x/sensor.ts" is proof.
- **Automated research requires periodic verification against authoritative sources:** Research reports (sensors, scripts) making claims about external state (on-chain registration, API availability, balances) should programmatically verify against authoritative sources (on-chain queries, direct API calls) rather than trusting intermediate automation. False alarms occur when automation assumptions diverge from ground truth.

## Cache & API Patterns

- **Dedup-counting via pre-check:** Check existence before adding to prevent double-counting overlapping API results.
- **ISO-8601 timestamps for future invalidation:** Store `fetched_at` as ISO-8601 string. Enables age-out without separate TTL field.
- **OAuth 1.0a query params in signature:** For GET requests, query params must be included in OAuth signature base. Forgetting causes 401 errors.

## Publishing & Execution Patterns

- **Encoding choice affects rendering:** When publishing to multiple blockchain explorers, verify how each platform renders different MIME types. Encoding is a rendering contract, not aesthetic.
- **Governance decisions as execution blockers:** Detect decision blocker → escalate once with full context → set task to `blocked`/`failed` → wait for human trigger. Do NOT create monitoring chains.
- **Auto-generated docs navigation from file structure:** Use file-system structure as the source of truth for docs navigation (e.g., Astro's `autogenerate` option). When navigation is derived from file tree, new capability/doc files auto-appear in sidebar without manual config edits. Prevents nav drift and scales gracefully.
- **Deployment source alignment before release:** Services deployed from stale branches miss features and fail consistency checks. Pre-deployment: verify source branch is current with intended baseline (`git rev-list --count main...HEAD == 0`). If diverged, merge to main before deploying. Applies to all infrastructure deployment (wrangler, Docker, etc.).

## Scope & Role Boundaries

- **Arc is teacher/mentor in AIBTC, not bounty hunter:** Before pursuing any AIBTC bounty, verify (1) it's still unclaimed and (2) the role is appropriate. Bounties are often already grabbed by the time a task is queued.

## Engagement & Budget Patterns

- **Early budget validation:** Enforce budget checks BEFORE API calls. `checkBudget(action)` runs first; only then call API.
- **Corrective actions are unbudgeted:** Unlike/unretweet are free undo operations; no budget check needed.

## Git & Publishing Patterns

- **Asymmetric branch detection:** Use bidirectional `rev-list --count` to distinguish "main is behind" from "main has diverged." Both > 0 means non-fast-forward.
- **State discovery before action:** Two-phase pattern: `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions. For on-chain tasks, verify contract state and prerequisites (agent registered, methods callable) *before* queuing dependent sensors or follow-ups; prevents sensor-ready-but-contract-not-live states.
- **Sensor task description as actionable context:** Include commit count, HEAD SHA, exact CLI command in task description. Eliminates context-switching friction for downstream dispatch.
- **Intentional divergence as architectural feature:** Multi-purpose repos (public template vs operational branch) naturally diverge. Treat conflicts as confirmation of separation of concerns, not problems.

## Retrospective Task Infrastructure

- **Haiku retrospectives produce quality institutional memory:** 96% of 93 retros contained real learnings. Overhead (~$0.08/retro) is justified for pattern extraction.
- **Topic file partitioning prevents knowledge bloat:** Directing retrospectives to patterns.md (not MEMORY.md) enforces context boundaries at filesystem level.
- **Read-before-write dedup + tighter filters:** Read patterns.md first, update in-place rather than appending. Capture gate: "reusable patterns that would change future task execution" — specificity gates are as important as the capture mechanism.

## Email & Coordination Patterns

- **External information gates task progression:** Upon receiving external confirmation: (1) reply with summary (audit trail), (2) mark as processed, (3) unblock downstream task, (4) queue next phase.
- **Confirmation replies trigger live audit for follow-ups:** When replying to any external query about system state (fleet health, deployment status, completed work), do a live audit across all relevant components—not just the specific item asked about. Divergences discovered become separate follow-up tasks with explicit verification gates. Prevents silent drift and converts a status confirmation into discovery. (Task #2196 example: confirmed 3 items done, discovered `/services/` remnant + cross-site drift during audit, created #2198 + #2199. Task #2256 example: replying about fleet health triggered audit of all 4 agents + SOUL.md + queue state before confirming.)
- **Request clarification before scoping completion work:** When receiving "complete X" or "finish Y" requests, don't infer what "done" means. Reply with honest status assessment (what's working, what's incomplete) + explicitly ask the stakeholder to define success criteria. Prevents scope creep and misaligned expectations.
- **Decompose multi-issue feedback by scope boundary:** When receiving structured feedback with multiple distinct issues across repos/sites, queue per-issue tasks grouped by scope (not one mega-task). Enables parallel execution and prevents blocking chains. Example: 8 issues → 8 tasks organized by site + complexity, not 3 projects or 1 umbrella task.
- **Research corrections require verification audit:** When stakeholder corrects research findings (e.g., "Arc IS registered" vs. "report says it isn't"), queue a P4 audit task to verify the corrected state. Include verification plan in email reply for transparency. Prevents repeat misreporting and documents resolution path.
- **Multisig asset sales coordination:** Separate coordination from execution: identify multisig → message signers with terms → track ID for sensor monitoring → queue PSBT execution when responses arrive. **Validation protocol:** Before signing any transfer PSBT, programmatically validate that outputs return value to multisig address. Block signing if all value flows outward; provide explicit override flag (`--allow-unpaid-transfer`) for intentional transfers. Error message must show rejected outputs + amounts so operator can audit and decide. This prevents atomic swap failure = loss.
- **Escalation decision audit in task chains:** When a prior task explicitly declined to sign/execute (due to price, risk, terms), subsequent tasks on same parent chain must re-verify escalation status, not proceed automatically. Escalations are hard stops, not notifications.
- **Batch blocked task escalations by decision type:** When multiple pending tasks depend on the same stakeholder's decision, group them in a single escalation communication. Single consolidated email > separate notifications; reduces fatigue and provides holistic context (task #2109 example: 4 blocked tasks, 3 decision types, 1 email).
- **Fleet state audit before rollout authorization:** When stakeholder approves fleet-wide changes (AIBTC registration, heartbeats, config rollout), audit all agents first to discover gaps (missing files, divergent configs) before queuing implementation. Include audit findings in authorization reply so stakeholder sees complete picture (task #2258: approved AIBTC for fleet, discovered SOUL.md missing on iris/loom/forge, queued verification before implementation).

## Task Composition & Scoping

- **Research-first pattern for infrastructure requests:** When a trusted stakeholder requests complex infrastructure, precede with a scoped research task that maps components and validates architecture before implementation.
- **Expert review gates priority changes:** When domain experts (CEO, architect, domain owner) review strategy or analysis, their feedback should trigger priority/sequencing updates. Operationally urgent tasks (P4) may be strategically late-phase (P6) — expert context catches these misalignments.
- **Demand proof gates feature scaling:** New monetization features require explicit "demand validation" phase (pilot, metrics, signal proof) before Phase 2 rollout. Validation output becomes Phase 1 completion gate.
- **Fleet provisioning task decomposition:** For N homogeneous agents, use templated identity files (SOUL.md with per-agent unique paragraphs) in provisioning skill to enable identity-aware deployment. Structure as: (1) reusable provisioning skill (P1), (2) per-agent setup tasks (P2 parallel), (3) cross-cutting infrastructure (P3), (4) health/observability (P4). Identity parameterization scales fleet while preserving per-agent distinctness.
- **Multi-agent architecture decisions require topology prerequisites:** When designing fleet-wide systems (observability aggregators, credential delegation, security boundaries), defer finalizing the architecture choice until network topology is confirmed. Architecture constraints depend on actual agent connectivity model, not assumptions. Reply with options + ask clarification before queueing implementation tasks.

## Configuration & Threshold Management

- **Operational cadence coupling:** When operational cadence changes (e.g., post frequency 1/week → 1/day), all time-based thresholds scale proportionally. Update sensor.ts, cli.ts, and SKILL.md together; grep for constant name + domain context to find all instances. Document the cadence-to-threshold mapping in SKILL.md SLA.

## Fleet Coordination Patterns

*Learned 2026-03-09, Tasks #2531, #2542, #2558, #2561, #2877*

- **Hub-and-spoke topology is the baseline:** No direct agent-to-agent communication. All coordination flows through Arc. Prevents coordination storms. Future shared-visibility features (fleet-collect, fleet-broadcast) only when hub-and-spoke breaks down.

- **Fleet memory sharing: collect → merge → distribute:** Agent learnings (patterns.md) are siloed by default. `fleet-memory` skill runs 3-phase cycle: SSH-fetch patterns.md from all agents, dedup-merge new entries into `memory/fleet-learnings.md` (tagged by source agent + date), distribute back via SSH write. Dedup uses bold-key extraction (`- **Key phrase**` → normalized lowercase match). Sensor runs every 6h (hash comparison). Arc is merge authority — no peer-to-peer memory sync. fleet-learnings.md is read-only on remote agents (Arc overwrites on each distribute).

- **Domain assignment prevents queue collision:** Each agent owns a domain that shapes routing — Arc=orchestration/architecture, Spark=protocol/on-chain, Iris=research/signals, Loom=integrations, Forge=infrastructure/delivery. Ownership means first priority, not exclusivity. Routing rules: (1) skill tags match domain, (2) P1-2 always to Arc, (3) untagged to Arc for triage. GitHub-dependent tasks skip Spark unconditionally.

- **SSH task injection for cross-agent routing:** Arc routes tasks to other agents via SSH: `ssh dev@192.168.1.12 "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>" after injection. No shared database — each agent has isolated SQLite.

- **Three-tier fleet check-in cadence:** Heartbeat (15min via `fleet-health` sensor) → ops review (4h via `arc-ops-review`, tracks creation/completion rate + backlog trend) → daily brief (24h, memory consolidation + email if notable). Cadence compressed by 10-24x time dilation vs. human-day rhythms.

- **Backlog growth is the primary bottleneck signal:** When creation rate > completion rate, noisy sensors waste cycles. Threshold: if pending queue grows >2x fleet-average, rebalance load. Overflow rule: agent with >20 pending tasks redistributes excess to compatible domain with lightest backlog.

- **Time dilation changes sensor cadence math:** Agentic speed = 10-24x compression. One human day ≈ 10-24 agentic cycles. Sensor intervals designed for human-day rhythms are too slow — daily sensors should run every 4-6h, weekly reviews become daily. But respect upstream limits (GitHub API, X rate limits, RPC throttles).

- **Roundtable participation requires active dispatch:** Agent participation in multi-agent discussions (roundtable, consensus) depends on the agent actively dispatching tasks. An agent not dispatching (no active cycle, services down, queue empty) cannot participate. Symptom: "only Arc responded." Diagnosis: check fleet-status.json for other agents' cycle age before retrying roundtable.

- **Fleet-wide $0-cost anomaly = dispatch not running:** If fleet sensor shows consistent $0 cost across cycles for a given agent, first diagnosis is service down or no tasks dispatching — not a billing bug. Check `arc status` remotely before escalating.

- **Budget split for fleet:** Arc $80/day, each other agent $30/day ($200 total across 5). Apply dispatch-level cost cap per agent. If any agent approaches its cap, deprioritize optional sensor tasks for that agent's domain.

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences — escalate to whoabuddy.
- **Dispatch resilience:** Two safety layers protect agent from self-inflicted damage (syntax guard + post-commit health check).
