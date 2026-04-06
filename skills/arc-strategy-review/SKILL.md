---
name: arc-strategy-review
description: Daily self-evaluation against PURPOSE.md rubric and Five Directives — lightweight assessment, no queue manipulation, at most 1 follow-up task
updated: 2026-04-06
tags:
  - strategy
  - daily
  - directives
  - milestones
  - purpose
---

# arc-strategy-review

Daily self-evaluation. Scores the last 24h against the PURPOSE.md rubric and checks Five Directive + milestone progress without touching the task queue aggressively.

## Purpose

Run once a day. Answer two questions: "How did today score against PURPOSE.md?" and "Are we pointed in the right direction?" Not a full CEO review — no watch report required, no queue manipulation. Just a brief honest assessment.

## Protocol

1. **Read context**
   - `PURPOSE.md` — Daily Self-Evaluation rubric (6 criteria with weights)
   - `memory/MEMORY.md` — directives, milestones, critical flags
   - Last 24h of completed/failed tasks: `arc tasks --status completed --limit 50`
   - Current pending queue: `arc tasks --status pending --limit 30`
   - Recent cost: `arc status`

2. **Score each PURPOSE.md criterion** (1–5 scale)
   - Signal Quality (25%): signals filed today, beats covered, acceptance rate
   - Operational Health (20%): success rate, interventions required
   - Ecosystem Impact (20%): PR reviews, skill work
   - Cost Efficiency (15%): cost/task, daily spend
   - Growth (10%): patterns captured, new capabilities
   - Collaboration (10%): substantive peer interactions

3. **Assess each directive**
   - D1 (Services business): Any revenue-generating work today?
   - D2 (Grow AIBTC): Ecosystem contributions, AIBTC signals, PR reviews?
   - D3 (Improve stack): Code shipped, sensors improved, reliability work?
   - D4 ($200/day cap): Daily cost — any concern?
   - D5 (Honest public): X posts, content published, public artifacts?

4. **Check active milestones**
   - For each milestone in MEMORY.md: any progress today, or stalled?
   - Flag if a milestone has had zero task activity in 3+ days.

5. **Write brief report**
   - 5-10 lines max. Weighted score summary + one line per directive status.
   - One "focus for tomorrow" recommendation.

6. **Create at most 1 follow-up task**
   - Only if something is clearly stalled or off-track.
   - P5 Sonnet for most follow-ups.
   - Use `arc tasks add --subject "..." --priority 5 --skills arc-strategy-review,<relevant-skill> --source "task:<id>"`

7. **Append to MEMORY.md**
   - Add a dated one-liner under Key Learnings: today's score and key finding.

8. **Close the task.**

## Constraints

- No reprioritizing existing tasks.
- No killing tasks.
- No creating more than 1 new task.
- Keep the assessment under 200 words.
- This is a **check-in**, not a strategy session.
