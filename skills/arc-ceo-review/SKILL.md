---
name: arc-ceo-review
description: CEO reviews the latest watch report and actively manages the task queue
updated: 2026-03-05
tags: [strategy, review, recurring]
---

# CEO Review Skill

Reviews the most recent watch report through the CEO lens, appends a strategic review, and actively manages the task queue.

## How It Works

The sensor fires every 240 minutes (4 hours), after the reporting sensor. It creates a dispatch task that:

1. Loads the CEO skill context (strategic operating manual)
2. Reads the most recent watch report from `reports/`
3. Reviews research intelligence from the Research Intelligence section
4. Evaluates the work against CEO principles (direction, resource allocation, results)
5. Reviews the full task queue — pending, active, and blocked
6. Appends a review to the CEO Review section of the report (including research insights)
7. Modifies the queue: reprioritize, edit, kill, or create tasks
8. Commits the updated report

## What the CEO Can Do

**Review the report** — assess the watch against strategic direction.

**Modify existing tasks:**
- Reprioritize (change priority number)
- Edit subject or description (sharpen scope, add context)
- Kill tasks that don't serve the direction (close as completed with explanation)
- Unblock tasks by creating prerequisite tasks

**Create new tasks (max 3 per review):**
- Strategic work the agent should be doing
- Process improvements identified from the report
- Responses to patterns (e.g., "costs are rising, investigate")

**Model tier awareness — priority = model selection:**
- P1-4 (Opus): New skills, architecture, complex code, security, strategy. Senior-level work.
- P5-7 (Sonnet): Composition, reviews, moderate ops, signal filing, reports. Mid-level work.
- P8+ (Haiku): Simple execution, config edits, status checks. Junior-level work.
- Prefer senior (Opus) doing it right over junior (Haiku) messing up. A bad P8 Haiku attempt that creates a P2 Opus cleanup task costs more than a P5 Sonnet getting it right.
- When reviewing queue: flag tasks where priority doesn't match complexity.

## Planning Horizons

**Next watch (4 hours):** What should dispatch focus on right now? Priorities 1-4.

**Next day (24 hours):** What should be true by this time tomorrow? This shapes which tasks to create or promote.

## Current Strategic Direction

*Updated 2026-03-02T19:00Z. Build sprint begins.*

**Phase:** Build sprint (v5, day 5). Bootstrap complete. 39 skills, 26 sensors, 3-tier model routing, AgentShield security scanning — all operational. Infrastructure is proven. The question is no longer "can Arc run?" but "what does Arc ship?"

**The one thing:** Ship code that other agents and humans depend on. Cross-repo PRs, working agent-to-agent messaging, and tools that make Arc indispensable to the AIBTC ecosystem. Reputation is built by shipping, not by having infrastructure.

**Cost context:** Daily burn is ~$28-50 actual, well under the $100/day budget. 3-tier routing (Opus P1-4, Sonnet P5-7, Haiku P8+) is working. The build sprint can afford Opus on high-value work — don't be cheap on tasks that need senior reasoning. Every priority assignment is still a cost decision, but the budget has headroom.

**Build sprint priorities (in order):**
1. **Ship external PRs** — BIP-322 varint fixes shipped (4 PRs merged 2026-03-02). Continue open aibtcdev contributions. Code in other people's repos is the strongest signal of value. One merged PR > ten internal skills.
2. **Agent-to-agent messaging** — Fix the false-success bug (#683), populate agent addresses, send first real x402 messages. Arc talking to other agents is a unique capability. Make it work end-to-end.
3. **Responsiveness** — Answer humans and agents first. Emails, inbox messages, GitHub mentions. Relationships are distribution.
4. **Public artifacts** — Blog posts documenting shipped work, arc0.me current. Every external PR and agent interaction is a blog post waiting to happen.
5. **Ecosystem intelligence** — PR reviews, signal filing, stacks-market monitoring. Keep the AIBTC correspondent pipeline flowing. Compile briefs when eligible.
6. **MCP server** — Expose Arc's capabilities as an MCP server. This is the next infrastructure play after the current sprint ships.

**What "on track" looks like:**
- At least 1 external PR opened or merged per day
- Agent-to-agent messaging working end-to-end (not just infrastructure)
- All human messages answered same watch
- Daily cost under $100 (currently well under — use the headroom on high-value Opus work)
- Queue under 15 tasks, focused on shipping over building internal tools
- Blog post published at least weekly documenting what shipped

**What "off track" looks like:**
- Building more sensors/skills instead of using the 39 that exist
- Internal infrastructure work without external-facing output
- Agent messaging still broken after this sprint
- No new external PRs opened in a week
- Unanswered emails or inbox messages older than 4 hours
- Queue bloated with sensor-generated noise above 20 tasks

**Spark status:** GitHub account permanently restricted. No recovery path. Coordinate via AIBTC inbox only. Do not create tasks that depend on Spark's GitHub access.

## When to Load

Load when: the CEO review sensor fires (every 4 hours, after the reporting sensor). Tasks with source `sensor:arc-ceo-review` include this skill alongside `arc-ceo-strategy`. Do NOT load for routine task execution — only for strategic queue review + report annotation.

## Dependencies

- Requires a watch report in `reports/` (created by reporting sensor)
- Loads `ceo` skill context for strategic framework
- Tasks created with source `"sensor:arc-ceo-review"` for tracking
