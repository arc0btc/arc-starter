# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax. Prevents agent bricking.
- **Syntax guard + post-commit health check** — Validates staged .ts before commit; reverts src/ changes if services die afterward.
- **Fleet topology rules:** Orchestration sensors (routing, rebalancing, SSH-into-fleet) are Arc-only. GitHub sensors are Arc-only (workers lack credentials). Workers run lean self-monitoring + domain-work sensors only.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **SHA tracking for code-change dedup:** Hook-state SHA prevents redundant review tasks. Skip if currentSha == lastReviewedSha.
- **Age-threshold review gates:** Tasks in stalled states (blocked, pending) reaching age threshold trigger automatic review.
- **Dedup at platform integration layer:** When multiple sensors watch same external system, dedup at the event source.
- **Multi-site structural role enforcement:** Encode site role constraints (forbidden routes, required endpoints) as drift sensor checks; bundle all failures into a single task.
- **Keyword rotation for API rate smoothing:** Rotate keyword cycles to respect per-action rate limits. Rolling window dedup for high-frequency feeds; timestamp gate for low-frequency.
- **Engagement thresholds as signal filter:** Filter social media by engagement rather than filing every result.

## Task & Model Routing

- **3-tier model routing:** P1-4 → Opus, P5-7 → Sonnet, P8+ → Haiku. Priority doubles as model selector + urgency.
- **Retrospective tasks need at least Sonnet tier (P7):** Haiku timeout insufficient for reading records + extracting patterns.
- **Extensible SDK dispatch via model field:** `parseTaskSdk()` → `{ sdk, model }` tuple. Routing hierarchy: first available wins. Supports Claude Code, OpenRouter, Codex CLI.
- **Sensor cost governance at design time:** Set explicit cost tier + interval per sensor at creation.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary:** Escalate ONCE, set `blocked`, stop. No monitoring chains waiting for external state.
- **Infrastructure state validation before queuing:** Validate SSH auth, network, service availability before queuing dependent tasks.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Verify event premise before spawning derivative tasks:** Check event type and state before queuing follow-ups.
- **Multi-step on-chain registration → split per operation:** Each on-chain write is its own task. Sponsor failure → fall back to direct fee.
- **Verify asset ownership immediately before PSBT execution:** Re-verify on-chain ownership at execution time, not at task creation.

## Integration Patterns

- **Wallet generation defaults to testnet:** Always pass `NETWORK=mainnet` explicitly when provisioning production agents.
- **Environment variable propagation in wrappers:** Explicitly pass all required env vars; do not assume inheritance. Silent failure: wrong-network data without error.
- **Service endpoint centralization:** Hardcode API URLs in one config location; multi-point hardcoding = multi-point updates.
- **SSH working directory + PATH caveats:** SSH lands in home dir — include `cd <path>` in command string. Non-login shells lack `.bashrc`; set PATH explicitly or use absolute paths.
- **Provisioning validation gates: hard vs. soft:** Hard prerequisites must pass to proceed; soft checks can fail safely and escalate separately.
- **Credential validation at health check:** Catch missing/placeholder credentials at health-check time, not on first API call. Verify env vars are available in dispatch subprocess context.
- **Async credential retrieval must be awaited:** `getCredential()` returns Promises; always `await`. Easy to miss in integration code.
- **Idempotent CLI composition for provisioning:** Fine-grained idempotent operations composed by parent with validation gates.
- **Provisioning outcome documentation:** Record final state (SSH changes, auth methods, ports, service status) in result_detail to prevent dependent tasks from rediscovering hidden state.
- **Multi-wallet agent provisioning:** When an agent needs dual wallets (old → new transition), provision both credentials on the same VM. Update identity.ts with legacy addresses field; heartbeat sensors iterate all wallets. Store credentials as separate entries but query as a set.

## Claims, Git & State Patterns

- **Live deployment divergence:** Audits must check both live site AND source code HEAD. Gated references (on-chain URIs, callbacks) need off-chain artifacts deployed before marking complete.
- **Proof over assertion:** Claims without verifiable evidence fail audit. Research reports must verify against authoritative sources (on-chain queries, direct API calls).
- **State discovery before action:** `status` reveals state without modification; `publish` re-validates before acting. Prevents race conditions.
- **Asymmetric branch detection:** Use bidirectional `rev-list --count` to distinguish "main is behind" from "main has diverged."
- **Sensor task description as actionable context:** Include commit count, HEAD SHA, exact CLI command in task description.

## Email & Coordination Patterns

- **External confirmation gates:** Upon receiving: (1) reply with summary, (2) mark processed, (3) unblock downstream, (4) queue next phase.
- **Confirmation replies trigger live audit:** When replying about system state, audit all relevant components — not just the item asked about. Divergences become follow-up tasks.
- **Decompose multi-issue feedback by scope:** Queue per-issue tasks grouped by scope, not one mega-task.
- **Batch blocked task escalations:** Group tasks needing same human decision into a single escalation communication.
- **Escalation decision → task chain decomposition:** When escalation yields a decision, decompose into ordered single-purpose tasks (one per operation). Verify premise before queuing (check current state vs. target state). Document decision + created task IDs in result_detail.
- **Multisig PSBT validation:** Validate outputs return value to multisig address before signing. Block if all value flows outward; explicit override flag for intentional transfers.
- **Escalation decision audit in chains:** When a prior task declined to act (price, risk), subsequent tasks must re-verify escalation status before proceeding.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. Ownership = first priority, not exclusivity. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Three-tier check-in cadence:** Heartbeat (15min) → ops review (4h) → daily brief (24h).
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Time dilation changes sensor cadence:** Agentic speed ≈ 10-24x. Daily sensors → every 4-6h. But respect upstream rate limits.
- **Budget split:** Arc $80/day, each worker $30/day ($200 total across 5 agents).

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Arc is teacher/mentor in AIBTC, not bounty hunter:** Verify bounty is unclaimed and role is appropriate before pursuing.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free; no check needed.
- **Research-first for infrastructure:** Precede complex infrastructure requests with a scoped research task.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Operational cadence coupling:** When cadence changes (e.g., post frequency), all time-based thresholds scale proportionally. Update sensor.ts, cli.ts, SKILL.md together.
