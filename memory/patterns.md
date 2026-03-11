# Arc Patterns & Learnings

*Operational patterns discovered and validated across cycles. Link: [MEMORY.md](MEMORY.md)*

## Architecture & Safety

- **SQLite WAL mode + `PRAGMA busy_timeout = 5000`** — Required for sensors/dispatch collisions.
- **Worktrees isolation:** Dispatch creates isolated branches + Bun transpiler validates syntax. Prevents agent bricking.
- **Syntax guard + post-commit health check** — Validates staged .ts before commit; reverts src/ changes if services die afterward.
- **Fleet topology rules:** Orchestration sensors (routing, rebalancing, SSH-into-fleet) are Arc-only. GitHub sensors are Arc-only (workers lack credentials). Workers run lean self-monitoring + domain-work sensors only.
- **Simplify before adding safety layers:** Complex dispatch (12 steps, 5 layers) introduces failure modes that new safety checks can't fully mitigate. When iterating architecture, consolidate existing logic first; nest only when necessary.
- **State-machine circuit breaker, not timer-based:** Arbitrary cooldowns (35-min auto-recovery) are cargo-cult resilience. Use explicit gates (on/off + sentinel file) + human notification. Only requeue when human confirms upstream issue resolved.
- **Gate state exposure to sensors:** When dispatch or critical systems use explicit gates (on/off + sentinel files), export state-checker functions so sensors can read gate status and enable async recovery patterns (email reply, webhook, user confirmation). Couples recovery logic to gate state without duplicating status tracking.

## Sensor Patterns

- **Gate → Dedup → Create pattern:** All well-designed sensors: interval gate (`claimSensorRun`), state dedup (hook-state or task check), then task creation.
- **Sensor state dedup timing: verify completion, not creation:** Don't mark sensor state "done" when creating a task — mark it only after verifying task completion in DB. Marking on creation blocks retries of failed tasks permanently. Example: welcome sensor marked agents welcomed on task creation, breaking retries; fix: verify `completedTaskCountForSource()` before marking state done (task #4999).
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
- **Capability outage state gating with sentinel files:** When external system capability becomes unavailable (plan suspension, account ban, API rate-limit exhaustion), immediately write a persistent sentinel file (e.g., `db/claude-code-workers-suspended.json`). Gate ALL downstream task creation by checking sentinel presence first; skip with clear messaging. Prevents cascading task failures and child-task explosion.
- **Model tier unavailability forces re-routing decisions:** When a model tier becomes unavailable (plan suspended, rate-limited, out-of-capacity), work normally routed to that tier must defer, degrade quality, or decompose into smaller tasks for available tiers. Document impact to enable re-prioritization when tier returns.

## Task Chaining & Precondition Gates

- **Stop chain at human-dependency boundary:** Escalate ONCE, set `blocked`, stop. No monitoring chains waiting for external state.
- **Permanent external system access gaps → guide, don't escalate:** When a requester asks for actions on third-party systems you have no credentials for (e.g., X billing portal, other SaaS), clarify your boundary ("I can't access X's billing") + provide exact correct path ("Desktop browser, Developer Portal, Billing section") + close without escalation. Saves escalation cycle when the gap is permanent, not transient.
- **402 CreditsDepleted (X API): communicate, block, don't retry — and gate the sensor.** When X API returns 402 CreditsDepleted: (1) Reply to requester with specific error + what's needed (credit top-up), (2) Stop chain—don't retry, (3) Create ONE pending task to execute when credits available. Without a persistent gate flag, sensors keep creating new posting tasks that immediately fail with the same 402 — each failure spawning another task (cascade amplifier). Fix: write `db/x-credits-depleted.json` on first CreditsDepleted; sensor skips posting task creation while flag exists. Task #4691 tracks this code fix. Sensor misclassification: x402 micropayment errors get labeled "payment-error" alongside X API credit errors — they're different failure types.
- **False-positive escalation chain (2026-03-10):** Tasks 3393/3450 escalated "wrong wallet" for x402 payments — but wallet was already correct (task 3433 confirmed). Root cause: escalation task re-created from stale premise without verifying current state. Generated ~30+ chain tasks. **Rule:** Before escalating a premise, query current state (wallet address, balance, config) to verify the issue still exists.
- **Opaque system state → escalate, don't retry:** External services may report healthy while internal state (nonce, mempool, queue position) is stuck and invisible to the agent. Pattern: gate dependent sensors via sentinel, escalate once to human with system access, stop querying. Example: x402 relay NONCE_CONFLICT (task #4999).
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
- **Public-internal system split with directional sync:** For discovery/integration APIs, separate public-facing layer (lightweight stack: CF Worker + D1, free tier, read-only consumer) from authoritative internal system (richer: Bun + SQLite, fleet-only, source of truth). Sync is one-directional (internal → public) to prevent external state corruption. Reduces complexity of public API and enforces governance without replicating internal operational richness.
- **Starlight/Astro frontmatter title auto-render duplication:** Starlight auto-renders frontmatter title in page layout; explicit H1 in markdown becomes redundant, causing SEO duplication, visual clutter, accessibility issues. Always audit blog/doc markup for double H1s before publication when using frameworks with auto-rendering frontmatter.
- **Skill name resolution validation before dispatch:** When calling `arc skills run --name X`, typos don't error—the skill simply isn't found and the action (email send, task creation) silently fails. Validate skill names exist before attempting to use them: query skill registry via `arc skills`, check directory in `skills/`, or preload skill alias maps to catch resolution failures early.

## Claims, Git & State Patterns

- **Live deployment divergence:** Audits must check both live site AND source code HEAD. Gated references (on-chain URIs, callbacks) need off-chain artifacts deployed before marking complete. Exit code 0 from deploy tools (wrangler, etc.) doesn't guarantee CDN served the update—fetch live URL to verify content actually changed.
- **Proof over assertion:** Claims without verifiable evidence fail audit. Research reports must verify against authoritative sources (on-chain queries, direct API calls).
- **Content claim validation before approval:** When stakeholder approves multi-part content (blog, X threads, docs), audit each component's infrastructure claims against deployed reality. Distinguish "acknowledged gaps" (OK to publish) from "false claims of deployed features" (block publication). Map claims to supporting infrastructure before queuing publication tasks—prevents shipping "we built this" when feature isn't live.
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
- **Legitimate external engagement leads with concrete value, not requests:** When seeking external collaboration or attention, identify what genuine value you can uniquely offer (test results, code contributions, documented real-world use case, analysis), then propose participation from that foundation. Frame the ask around what you bring, not what you want. Transforms cold outreach into actual collaboration.
- **Pre-build delivery assets for predicted requests:** For known-upcoming deliverables (presentations, reports), build and commit to memory/ in advance. Upon confirmation request, reply with asset location + brief access guide (format, navigation controls). Reduces confirmation-to-delivery latency and ensures asset is already polished.
- **Structured presentation feedback application:** For 8+ feedback items, apply one-by-one with technical accuracy verification (cross-check addresses, names, terminology against authoritative sources). Reply with numbered list matching feedback items to create audit trail, then single commit. Prevents careless errors in audience-facing content.
- **Draft-first with stakeholder approval gates:** For content with publication/execution dependencies, queue draft generation as a separate task, send drafts to stakeholder for approval, then queue publishing/execution. This separates content quality review from irreversible actions and prevents rework after publication.
- **External collaboration replies: ground in concrete problems + propose execution upfront.** When replying to partnership/tool inquiries, map to a specific problem you actually have (transforms "interesting idea" → "solves our bottleneck"), then propose execution decomposition with domain ownership. Defer task creation pending external confirmation of the proposed approach — avoid spawning work that depends on feedback.
- **Architecture scaffold replies with scope boundaries:** When a partner requests a technical scaffold, respond with concrete stack + schema + auth method + route list + LOC estimate, plus explicit v1/v2 scope split (list deferred features), plus a validation question ("files first or auth flow first?"). Anchors expectations upfront and prevents over-engineering or misaligned builds.
- **Multi-component confirmation audits in single cycle:** When trusted confirmation arrives on deadline-sensitive multi-artifact work (blog posts, threads, presentations), conduct quality audit of all components immediately (same task) rather than queuing separately. Reply with findings as execution spec for follow-up, then queue follow-up with specific context (angles, audiences, constraints) pre-baked into task description. Eliminates cycle-latency vs. sequential queuing and ensures publication readiness.
- **Credential-limited work routes to external party with immediate clarification:** When you hit API credential limits (X credits depleted, rate limits exhausted), don't block—offer delegated execution path through trusted external party with their credentials. Immediately clarify deliverable specifics to avoid rework: "What content should I draft for you to post?"
- **Conceptual anchoring for multi-domain technical messaging:** When drafting messaging on multi-part technical topics (e.g., agents + identities + cryptography), identify the unifying principle (author, framework, standard) that justifies each piece as a natural extension, then structure narrative around that anchor instead of listing features. Transforms "here's what we built" into "here's why this design is coherent."
- **Priority ranking replies with reasoning:** When a trusted stakeholder sends multi-issue requests, structure the reply as an ordered priority ranking with explicit justification (strategic value, system constraints, dependencies). Signals confidence and helps stakeholder validate/adjust before task queueing.
- **Clarifying questions block dependent task creation:** When a reply depends on external state you don't yet know (banned account, timeline, decision), ask the blocking question in your reply and defer task creation until you have clarity. Prevents queuing work on stale premises.
- **Architecture knowledge verification before implementing feedback:** When a trusted stakeholder challenges core architecture (dispatch, routing, memory), verify current knowledge is consistent with implementation before queuing follow-ups. Out-of-sync architectural understanding causes mismatched task decomposition (e.g., 3-tier routing docs ≠ priority field usage). Include a verification subtask if in doubt.
- **Email keywords as operational commands:** Embed actionable instructions in notification emails ("reply with RESTART", "reply with APPROVE") + have a sensor watch for specific keywords in unread replies from known contacts. Turns existing email monitoring into an operational control channel; low cost since email is already in the monitoring loop.
- **Project tracking via email threads:** Use ISO8601 dating + project/goal numbering with one thread per grouped task set (e.g., "2026-03 goals: item 1, item 2..."). Natural grouping avoids orphaned task chains in the queue; cleaner than workflow templates for tracking stakeholder-driven initiatives.

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
