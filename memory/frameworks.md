# Arc Decision Frameworks

*Structured decision logic for recurring situations. Load via `arc-memory` skill.*
*Updated: 2026-03-18*

---

## Framework 1: Task Priority Assignment

**Question:** What priority should I assign this task?

```
Is this a security issue or irreversible action?
  YES → P1 (Opus, escalate if >100 STX)
  NO ↓

Does this require building new code / architecture decisions / deep reasoning?
  YES → P1-4 (Opus)
    - New skill or sensor from scratch → P2
    - Architecture refactor → P2
    - Complex debugging with unknown root cause → P3
    - Security audit → P2
  NO ↓

Does this require careful judgment, composition, or moderate complexity?
  YES → P5-7 (Sonnet)
    - PR review → P6
    - Blog / report generation → P6
    - Operational task with trade-offs → P5
    - Signal filing / categorization → P7
    - Retrospective / pattern extraction → P7
  NO ↓

Is this simple execution — read state, mark complete, config edit, status check?
  YES → P8+ (Haiku)
    - Mark task read/complete → P9
    - Config value update → P8
    - Health status check → P8
    - Memory consolidation → P9
```

**Heuristic:** "Could a junior dev do this in <30 min without judgment?" → P8+. "Does it need careful framing?" → P5-7. "Does it need architecture thinking?" → P1-4.

---

## Framework 2: Fleet Routing

**Question:** Who should execute this task?

```
Does the task require git push / PR / gh CLI / GitHub Actions?
  YES → fleet-handoff --agent arc (absolute, no exceptions)

Is the task DeFi / protocol / on-chain Stacks work?
  YES → Spark (when operational, IP: 192.168.1.12)
  FLEET DEGRADED → execute locally or queue as pending

Is the task research / X / social media analysis?
  YES → Iris (when operational, IP: 192.168.1.13)
  FLEET DEGRADED → execute locally or queue as pending

Is the task CI/CD / testing / integration?
  YES → Loom (when operational, IP: 192.168.1.14)
  FLEET DEGRADED → queue with note in result_summary

Is the task infra / deploy / VM management?
  YES → Forge (when operational, IP: 192.168.1.15)
  FLEET DEGRADED → route to Forge (has OpenRouter fallback)

Default: Arc handles locally.
```

**Fleet status check:** Before routing, verify agent is operational (`arc skills run --name fleet-health`). Do not route to agents whose status is unverified.

---

## Framework 3: Failure Triage

**Question:** A task or integration has failed. What do I do?

```
Is the error 403 / 401 / permission denied?
  → Fail immediately. Never retry. Log the specific endpoint + response.
  → If credential is missing: provide exact `arc creds set` command to whoabuddy, close blocked.
  → If credential exists but rejected: check expiry, raise to whoabuddy once.

Is the error a rate limit (429 / retry_after)?
  → Parse retry_after → add 5min buffer → `arc tasks update --id N --scheduled-for DATETIME`
  → Do NOT retry immediately. One reschedule, not a loop.

Is the external service returning errors (5xx / timeout)?
  → Write sentinel file at `db/hook-state/<service>-down.json`
  → Gate all downstream sensors that depend on this service
  → Create ONE notification task (P5) for whoabuddy
  → Close current task as failed with clear root cause

Is the error a code bug in a sensor or skill?
  → Reproduce with minimal repro case
  → Fix in a worktree branch (include `arc-worktrees` skill)
  → Validate with `bun build --no-bundle` before commit
  → DO NOT run full test suites in dispatch

Is the state ambiguous / external system inconsistent?
  → Fetch authoritative state (on-chain query, direct API call)
  → Document discrepancy in result_summary
  → Escalate ONCE if >100 STX at risk
  → Gate sensor, don't poll — opaque external state won't self-resolve
```

---

## Framework 4: Task Decomposition

**Question:** Should I decompose this task, and how?

**Decompose when:**
- Task spans ≥3 distinct API domains (e.g., chain query + email + GitHub)
- Task requires both LLM reasoning AND sensor/code changes
- Any single subtask would exceed 40k token context budget
- Clear dependency chain: A must complete before B starts

**Keep atomic when:**
- Single API domain with linear execution steps
- Expected duration <20 min at assigned model tier
- No blocking dependencies on external confirmation

**How to decompose:**
1. Identify the natural I/O boundary (not implementation steps)
2. Create subtasks with `--parent <id>` and `--source "task:<id>"`
3. Assign skills to each subtask explicitly (`--skills name1,name2`)
4. Priority escalates for blocking subtasks (parent P5 → blocking child P3)
5. Close parent as "completed" only after all children complete

---

## Framework 5: Memory / Pattern Extraction

**Question:** What belongs in patterns.md vs MEMORY.md vs SKILL.md?

```
Is this a reusable operational pattern (applies to ≥3 future task types)?
  → patterns.md, under the most specific applicable section

Is this agent-specific state (wallet, current project, recent learnings)?
  → MEMORY.md

Is this decision logic for a specific skill domain?
  → That skill's SKILL.md

Is this architectural context needed at every dispatch?
  → CLAUDE.md (via PR, only when architectural)
```

**Pattern extraction criteria:**
- **Reusable:** would change how ≥3 future task types are approached
- **Actionable:** changes what you DO, not just what you know
- **Validated:** observed in ≥2 distinct task cycles
- **Specific:** names the context (sensor, integration, fleet) not just the principle

**When to run retrospective:**
- After any task that required ≥3 retries or a revert
- After discovering a systemic bug (not one-off)
- After completing a milestone or major feature
- Weekly via arc-memory sensor (automatic)

---

## Framework 6: Cost / Model Optimization

**Question:** Is this task costing more than it should?

```
Is the task P8+ but running on Sonnet or Opus?
  → Re-examine priority assignment. Likely mis-prioritized.

Is the task >$1.00 cost?
  → Acceptable for P1-4 Opus tasks with complex reasoning
  → Flag for review if P5-7 Sonnet; likely needs decomposition
  → Never acceptable for P8+ Haiku tasks

Is blog-publishing generating multiple tasks/day?
  → Audit sensor cadence; consolidate to max 1 watch report/day
  → Watch reports are token-heavy (30% of daily spend)

Is a sensor creating >10 tasks/day?
  → Chain-reaction follow-up pattern; audit dedup logic
  → Verify completedTaskCountForSource() checks are working
```

**Daily cost target:** <$10/day normal ops. >$15 → investigate. >$20 → audit today.
