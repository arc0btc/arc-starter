# Fleet Scheduling Protocol

*Assignment protocol for the 5-agent fleet. Reference during dispatch and fleet coordination.*
*Created: 2026-03-09 (Task #2542)*

---

## Domain Focus

Each agent owns a domain aligned with the directives (D1-D5). Ownership means: the agent gets first priority on tasks in that domain. It does NOT mean exclusivity — any agent can pick up overflow.

| Agent | Domain | Directive | Rationale |
|-------|--------|-----------|-----------|
| **Arc** | Orchestration & architecture | D3, D4 | Lead agent. Skill/sensor/dispatch development, fleet coordination, memory consolidation, cost governance. Handles P1-3 architecture decisions. |
| **Spark** | Protocol & on-chain | D2 | No GitHub — perfect for on-chain work. Bitcoin/Stacks transactions, multisig, AIBTC ecosystem (non-GitHub), X engagement, Ordinals Business. |
| **Iris** | Research & signals | D2, D5 | Signal analysis, ecosystem scanning, research reports, blog content, email coordination, PR reviews. |
| **Loom** | Integrations | D1, D3 | New skill development, DeFi integrations (Zest V2, Bitflow), cross-repo work, API wrappers, MCP server. |
| **Forge** | Infrastructure & delivery | D1, D3 | Site development (arc0btc.com, arc0.me), CI/CD, deployment pipelines, testing infrastructure, tooling. |

### Assignment Rules

1. **Match by skill tag.** Tasks with `skills` matching an agent's domain route to that agent. Examples:
   - `stacks-js`, `bitcoin-*`, `ordinals-*`, `x-*` → Spark
   - `arc-research-*`, `blog-publishing`, `arc-email-*` → Iris
   - `zest-*`, `bitflow-*`, `arc-skill-manager` (new skills) → Loom
   - `arc0btc-site-*`, `blog-deploy`, `arc-remote-setup` → Forge
   - `fleet-*`, `arc-ops-*`, `credentials` → Arc

2. **Priority overrides domain.** P1-2 tasks always route to Arc (Opus-tier reasoning required). P8+ tasks go to whichever agent has lowest backlog.

3. **Untagged tasks go to Arc** for triage. Arc either handles them or re-routes with appropriate skills tag.

4. **GitHub-dependent tasks skip Spark.** Any task requiring GitHub API, PR creation, or repo push cannot route to Spark.

---

## Check-In Pattern

Fleet coordination happens at three cadences, aligned with agentic time dilation (10-24x compression).

### Heartbeat (every 15 minutes)
- **Mechanism:** `fleet-health` sensor (already active)
- **What:** Service status, dispatch age, disk usage, current task
- **Output:** `memory/fleet-status.json` on Arc, alerts for down agents
- **Action:** P3 alert task if agent unreachable or services down

### Status Sync (every 4 hours)
- **Mechanism:** `arc-ops-review` sensor (task #2541)
- **What:** Task creation vs completion rate, backlog trend, cost-per-cycle, fleet utilization
- **Output:** Ops review task with fleet-wide metrics
- **Action:** Rebalance if any agent's backlog grows >2x others

### Daily Brief (every 24 hours)
- **Mechanism:** Scheduled task (morning, ~06:00 UTC)
- **What:** Yesterday's completions, cost, blockers, priority queue state across fleet
- **Output:** Summary in `memory/MEMORY.md`, email to whoabuddy if notable
- **Action:** Reprioritize tasks, close stale items, consolidate memory

---

## Shared Backlog Visibility

### Current Mechanism
Each agent runs its own `arc-starter` instance with its own SQLite database. There is no shared task queue today. This is by design — isolation prevents cascade failures.

### Coordination Protocol

Since agents don't share a database, coordination works through Arc as hub:

1. **Arc is the router.** When Arc's sensors detect work, Arc creates tasks on the appropriate agent via SSH:
   ```
   ssh dev@192.168.1.12 "cd ~/arc-starter && bash bin/arc tasks add --subject 'task' --priority 5 --skills skill1"
   ```

2. **Fleet status aggregation.** The `fleet-health` sensor already SSHes into each agent and reads status. Extend to include pending task count and current domain focus.

3. **Work overflow.** If an agent's pending queue exceeds 20 tasks, Arc should redistribute excess to the agent with the lightest load in a compatible domain.

4. **No direct agent-to-agent communication.** All coordination flows through Arc. This keeps the topology simple (hub-and-spoke) and prevents coordination storms.

### Future: Shared Visibility (when needed)
- `fleet-collect` CLI: gather task summaries from all agents into a unified view
- `fleet-broadcast` CLI: push a task to all agents simultaneously
- Web dashboard aggregation: Arc's web UI pulls status from fleet

These are NOT needed now. Build only when the hub-and-spoke model breaks down.

---

## Task Routing Flow

```
Sensor detects signal
  → Creates task on Arc (default)
  → Arc dispatch picks up task
  → If task matches another agent's domain:
      → Route to that agent via SSH task creation
      → Close Arc's copy as "routed to <agent>"
  → If task is Arc's domain or P1-2:
      → Arc executes directly
```

### Routing Checklist (for dispatch)
- [ ] Does the task have a `skills` tag matching another agent's domain?
- [ ] Is the target agent healthy? (check fleet-status.json)
- [ ] Is the target agent's backlog reasonable? (<20 pending)
- [ ] Does the task require GitHub? (if yes, skip Spark)
- [ ] Is this P1-2? (if yes, keep on Arc)

---

## Cost Governance

Fleet budget: $200/day total across all agents.

| Agent | Daily Budget | Rationale |
|-------|-------------|-----------|
| Arc   | $80 | Orchestrator, handles P1-4 Opus tasks (expensive) |
| Spark | $30 | On-chain ops, moderate complexity |
| Iris  | $30 | Research, mostly Sonnet/Haiku tier |
| Loom  | $30 | Integration work, mixed tiers |
| Forge | $30 | Infrastructure, mixed tiers |

- Each agent's `arc-ops-review` sensor should track its own daily spend
- Arc's fleet-health sensor should aggregate fleet-wide cost
- If any agent exceeds its daily budget, it should defer non-critical tasks until next day
- If fleet-wide spend approaches $180 (90%), Arc creates a P2 cost alert

---

## Bootstrap Sequence

For agents still ramping up (current state as of 2026-03-09):

1. **Complete basic setup tasks** — heartbeat, whoami, health checks
2. **Install domain-relevant skills** — Arc routes skill installation tasks per domain
3. **Install domain-relevant credentials** — per Phase 5 of provisioning template
4. **Begin accepting domain tasks** — Arc starts routing real work
5. **Monitor first 24h** — watch for cost spikes, dispatch failures, skill gaps

Current fleet state:
- Spark: Bootstrap phase (P8 retros). Next: install on-chain skills
- Iris: Bootstrap phase (cost alerts). Next: install research/signal skills
- Loom: Bootstrap phase (whoami). Next: install integration skills
- Forge: Bootstrap phase (heartbeat). Next: install infra/deploy skills

---

## Anti-Patterns

- **Don't create fleet coordination tasks on fleet agents.** Fleet scheduling/routing is Arc's job. Other agents execute domain work.
- **Don't over-engineer coordination.** Hub-and-spoke through Arc is sufficient for 5 agents. Mesh protocols, consensus, work-stealing — all premature.
- **Don't duplicate sensors across fleet.** Each sensor runs on one agent. Arc's sensors cover fleet-wide concerns. Domain sensors run on domain agents.
- **Don't batch-create speculative tasks.** Task #2558 created 30+ fleet tasks speculatively. Most are premature. Create tasks when the need is concrete.
