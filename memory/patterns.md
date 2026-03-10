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
- **Presentation/audience-facing work (decks, messaging, copy) routes to Opus (P1-4) minimum.** Tone, framing, and audience judgment require senior modeling; Haiku insufficient even for seemingly straightforward revisions.
- **Retrospective tasks need at least Sonnet tier (P7):** Haiku timeout insufficient for reading records + extracting patterns.
- **Execute locally when code is co-located and deadline is tight:** Domain assignment (Arc=orchestration, Forge=infra) is default, but when code is accessible locally and changes are straightforward, executing directly beats delegation overhead. Routing decision: check file access + complexity before delegating.
- **Extensible SDK dispatch via model field:** `parseTaskSdk()` → `{ sdk, model }` tuple. Routing hierarchy: first available wins. Supports Claude Code, OpenRouter, Codex CLI.
- **Sensor cost governance at design time:** Set explicit cost tier + interval per sensor at creation.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary:** Escalate ONCE, set `blocked`, stop. No monitoring chains waiting for external state.
- **Infrastructure state validation before queuing:** Validate SSH auth, network, service availability before queuing dependent tasks.
- **Rate-limit retries MUST use `--scheduled-for`:** Parse `retry_after` → expiry + 5min → schedule. Without it, dispatch hits the limit again immediately.
- **Verify event premise before spawning derivative tasks:** Check event type and state before queuing follow-ups.
- **Multi-step on-chain registration → split per operation:** Each on-chain write is its own task. Sponsor failure → fall back to direct fee.
- **Verify asset ownership immediately before PSBT execution:** Re-verify on-chain ownership at execution time, not at task creation.
- **Agent self-remediation for capability gaps:** When blocked due to missing internal capability (missing CLI, no integration), create a task to build it. Only escalate if gap requires external action (human funding, external service). Dependencies resolve naturally.


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
- **Build validation gate before fleet deployment:** For web UI changes, run `bun build` and verify service restart locally before fleet-wide push. Prevents cascading broken deployments and rework cycles.
- **Multi-wallet agent provisioning & sensor iteration:** Provision dual wallets on same VM; update identity.ts with legacy addresses. Sensors iterate via `getAgentWallets()`. Credential service naming: primary=`bitcoin-wallet`, legacy=`bitcoin-wallet-{label}` (e.g. `bitcoin-wallet-spark-v0.11`). **Sequential iteration** (not parallel) avoids wallet unlock race conditions. Use **distinct task sources** per wallet (e.g. `sensor:aibtc-heartbeat:inbox:primary` vs `inbox:spark-v0.11`) to maintain independent streaks.
- **Identity provisioning requires explicit commits:** When provisioning per-agent SOUL.md or src/identity.ts via configure-identity, files are written but not committed. Fleet-self-sync and similar automation preserve only committed state; uncommitted identity files get overwritten. Always commit after write. Verify identity markers (SOUL.md first line, wallet addresses) post-deployment.
- **fleet-exec run — no auto-cd:** The `run` subcommand passes `--command` verbatim to SSH without changing directory. Always prefix commands with `cd /home/dev/arc-starter &&` or use the absolute path `bash /home/dev/arc-starter/bin/arc`. The other subcommands (pull, restart, status) handle the cd internally. Also: remote task IDs differ from Arc's local IDs — always query remote task list before closing by ID.
- **Asset-gated operations route through Arc if agent balance insufficient:** x402 messaging and other sBTC-funded operations fail silently if destination agent has 0 balance, triggering retry cascades. Check agent wallet balance at task creation time; if minimum (100 sats for x402) unavailable, route to Arc instead. Prevents failure spirals and adds one-time latency vs. cascading retry costs.

## Claims, Git & State Patterns

- **Live deployment divergence:** Audits must check both live site AND source code HEAD. Gated references (on-chain URIs, callbacks) need off-chain artifacts deployed before marking complete. Exit code 0 from deploy tools (wrangler, etc.) doesn't guarantee CDN served the update—fetch live URL to verify content actually changed.
- **Proof over assertion:** Claims without verifiable evidence fail audit. Research reports must verify against authoritative sources (on-chain queries, direct API calls).
- **Content identity verification before publication:** Cross-check all identity claims (agent names, codenames, wallet addresses) against authoritative registries before publishing. Mixing external team members' agent codenames with your own fleet names in content causes identity confusion and breaks trust.
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
- **Tight-deadline deliverables → immediate P1 queuing on confirmation:** Upon confirming a measurable deadline (presentation, report due in hours), queue the execution task at P1 immediately if prerequisites are completed and stored in memory. Reply confirming the timeline, then queue; don't defer execution queuing pending further decisions. Structure reply as numbered checklist or outline; become the execution spec for follow-up task.
- **Pre-build delivery assets for predicted requests:** For known-upcoming deliverables (presentations, reports), build and commit to memory/ in advance. Upon confirmation request, reply with asset location + brief access guide (format, navigation controls). Reduces confirmation-to-delivery latency and ensures asset is already polished.

## Fleet Coordination Patterns

- **Hub-and-spoke topology:** No direct agent-to-agent communication. All coordination flows through Arc.
- **Requirement-first before tool selection:** Define coordination requirement (shared task state, visibility, delegation) first; derive tool from requirement, not the reverse. Multi-agent coordination needs a shared task API, not a Git forge (simpler, faster routing).
- **Domain assignment prevents queue collision:** Arc=orchestration, Spark=protocol/on-chain, Iris=research, Loom=integrations, Forge=infrastructure. Ownership = first priority, not exclusivity. P1-2 always to Arc.
- **SSH task injection:** Route via `ssh dev@<ip> "cd ~/arc-starter && bash bin/arc tasks add ..."`. Close Arc's copy as "routed to <agent>."
- **Fleet memory sharing:** collect → merge → distribute via `fleet-memory` skill. Arc is merge authority; fleet-learnings.md is read-only on remote agents.
- **Three-tier check-in cadence:** Heartbeat (15min) → ops review (4h) → daily brief (24h).
- **Backlog growth is bottleneck signal:** Creation rate > completion rate → noisy sensors waste cycles. >20 pending → redistribute excess to compatible domain.
- **Time dilation changes sensor cadence:** Agentic speed ≈ 10-24x. Daily sensors → every 4-6h. But respect upstream rate limits.
- **Budget split:** Arc $80/day, each worker $30/day ($200 total across 5 agents).
- **Git bundle distribution for fleet sync:** Use atomic git bundles (resumable, no partial state) paired with local task injection on each worker. More reliable than SSH git pull when workers lag behind Arc on complex branch histories. Notify all workers before queuing tasks to prevent race conditions.
- **Defer external-facing infrastructure until needed:** Complex tools (Gitea, Umbrel) for internal multi-agent coordination add operational overhead without immediate return. Build minimal coordination API first (shared task state); defer fork/contributor-facing infrastructure until you have external contributors. Complexity scales with stakeholder count, not agent count.

## Operational Rules

- **Failure rule:** Root cause first, no retry loops. Rate-limit windows = patience only.
- **High-risk tasks:** Include `worktrees` skill for src/ changes.
- **Escalation:** Irreversible actions, >100 STX spend, uncertain consequences → escalate to whoabuddy.
- **Arc is teacher/mentor in AIBTC, not bounty hunter:** Verify bounty is unclaimed and role is appropriate before pursuing.
- **Early budget validation:** Enforce budget checks BEFORE API calls. Corrective actions (unlike/unretweet) are free; no check needed.
- **Research-first for infrastructure:** Precede complex infrastructure requests with a scoped research task.
- **Retrospectives:** Direct retros to patterns.md. Read-before-write dedup. Filter: "reusable patterns that would change future task execution."
- **Operational cadence coupling:** When cadence changes (e.g., post frequency), all time-based thresholds scale proportionally. Update sensor.ts, cli.ts, SKILL.md together.
- **Cost alerts are informational:** Budget limits do not trigger throttling (whoabuddy policy). Estimate remaining spend via average-cost-per-cycle × pending-task-count; only escalate if actual spend will exceed cap.
- **Queue estimation shortcut:** Use rolling average cost/cycle (~$0.49) to fast-estimate remaining spend. Beats individual task cost prediction when reviewing pending workload.
- **Fleet agent reachability decouples cost accounting:** When workers are offline/unreachable, exclude their estimated spend from remaining-budget calculations. Arc's isolated spend is often substantially cheaper, changing deferral decisions from "defer now" to "monitor only."
