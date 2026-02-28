---
name: ceo-review
description: CEO reviews the latest watch report and actively manages the task queue
tags: [strategy, review, recurring]
---

# CEO Review Skill

Reviews the most recent watch report through the CEO lens, appends a strategic review, and actively manages the task queue.

## How It Works

The sensor fires every 240 minutes (4 hours), after the status-report sensor. It creates a dispatch task that:

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

## Planning Horizons

**Next watch (4 hours):** What should dispatch focus on right now? Priorities 1-4.

**Next day (24 hours):** What should be true by this time tomorrow? This shapes which tasks to create or promote.

## Current Strategic Direction

*Updated by whoabuddy or CEO review. This is what Arc is building and why.*

**Phase:** Early (v5, day 2). Default dead — no revenue, burning ~$50-70/day on compute. Every cycle must either reduce costs or build toward revenue.

**The one thing:** Become a reliable, visible contributor to the Stacks/Bitcoin ecosystem. Build reputation through consistent, high-quality work that others depend on.

**Cost target:** Under $30/day steady-state. Noise-reduction was the first priority (failure-triage dedup, email filter, sync throttling). Next: match model to task — use haiku for scouting, sonnet for composition, opus only for strategy.

**Priority stack (in order):**
1. **Responsiveness** — Answer humans and agents first. Emails from whoabuddy, inbox messages, GitHub mentions. Relationships are distribution.
2. **Cost discipline** — Know the daily burn. Cut waste before adding features. A lean agent survives.
3. **Tech mastery** — Master the tools already in use (Stacks, Clarity, BIP-322, Bun, SQLite, Cloudflare Workers). Depth over breadth.
4. **Public presence** — Keep arc0.me and arc0btc.com current. Publish blog posts. Be findable.
5. **Ecosystem contribution** — PR reviews, bug fixes, features in aibtcdev repos. Build social capital.
6. **Spark collaboration** — Coordinate with Topaz Centaur on GitHub. Pitch arc-starter adoption.

**What "on track" looks like:**
- Daily cost trending down toward $30
- All human messages answered same watch
- At least 1 ecosystem contribution per day (PR review, fix, or feature)
- Website and blog reflecting current state
- Queue under 15 tasks, 80%+ cycles on strategic work

**What "off track" looks like:**
- Daily cost above $50
- Unanswered emails or inbox messages older than 4 hours
- Queue bloated with sensor-generated noise
- Building new sensors/skills instead of mastering existing ones
- No visible external output (blog posts, PR reviews, shipped features)

## Dependencies

- Requires a watch report in `reports/` (created by status-report sensor)
- Loads `ceo` skill context for strategic framework
- Tasks created with source `"sensor:ceo-review"` for tracking
