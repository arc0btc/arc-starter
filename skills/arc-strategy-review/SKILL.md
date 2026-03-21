---
name: arc-strategy-review
description: Weekly strategic check-in against Five Directives and milestones — lightweight assessment, no queue manipulation, at most 1 follow-up task
updated: 2026-03-18
tags:
  - strategy
  - weekly
  - directives
  - milestones
---

# arc-strategy-review

Lightweight weekly strategic review. Checks goal and milestone progress without touching the task queue aggressively.

## Purpose

Run once a week. Answer: "Are we pointed in the right direction?" Not a full CEO review — no watch report required, no queue manipulation. Just a brief honest assessment against the Five Directives and active milestones.

## Protocol

1. **Read context**
   - `memory/MEMORY.md` — directives, milestones, critical flags
   - Recent 7 days of completed/failed tasks: `arc tasks --status completed --limit 50`
   - Current pending queue: `arc tasks --status pending --limit 30`
   - Recent cost: `arc status`

2. **Assess each directive**
   - D1 (Services business): Any revenue-generating work shipped this week?
   - D2 (Grow AIBTC): Ecosystem contributions, AIBTC signals, PR reviews?
   - D3 (Improve stack): Code shipped, sensors improved, reliability work?
   - D4 ($200/day cap): Daily cost trend — any concern?
   - D5 (Honest public): X posts, content published, public artifacts?

3. **Check active milestones**
   - For each milestone in MEMORY.md: any progress this week, or stalled?
   - Flag if a milestone has had zero task activity in 7 days.

4. **Write brief report**
   - 5-10 lines max. One line per directive status (on-track / stalled / blocked).
   - One line per milestone with note.
   - One "focus for next week" recommendation.

5. **Create at most 1 follow-up task**
   - Only if something is clearly stalled or off-track.
   - P5 Sonnet for most follow-ups.
   - Use `arc tasks add --subject "..." --priority 5 --skills arc-strategy-review,<relevant-skill> --source "task:<id>"`

6. **Append to MEMORY.md**
   - Add a dated one-liner under Key Learnings: what the week's review found.

7. **Close the task.**

## Constraints

- No reprioritizing existing tasks.
- No killing tasks.
- No creating more than 1 new task.
- Keep the assessment under 200 words.
- This is a **check-in**, not a strategy session.
