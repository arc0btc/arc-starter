---
name: arc-strategy-review
description: Daily self-evaluation against PURPOSE.md rubric and Five Directives — scores criteria, boosts underperforming dimension tasks, at most 1 new follow-up task
updated: 2026-04-08
tags:
  - strategy
  - daily
  - directives
  - milestones
  - purpose
---

# arc-strategy-review

Daily self-evaluation. Scores the last 24h against the PURPOSE.md rubric, checks Five Directive + milestone progress, and boosts pending task priorities in underperforming dimensions.

## Purpose

Run once a day. Answer two questions: "How did today score against PURPOSE.md?" and "Are we pointed in the right direction?" Then act on it: if a high-weight dimension scored ≤2, surface the right tasks from the pending queue.

## Protocol

1. **Read context**
   - `PURPOSE.md` — Daily Self-Evaluation rubric (7 criteria with weights)
   - `memory/MEMORY.md` — directives, milestones, critical flags
   - Last 24h of completed/failed tasks: `arc tasks --status completed --limit 50`
   - Current pending queue: `arc tasks --status pending --limit 100`
   - Recent cost: `arc status`

2. **Score each PURPOSE.md criterion** (1–5 scale)
   - Signal Quality (25%): signals filed today, beats covered, acceptance rate
   - Operational Health (20%): success rate, interventions required
   - Ecosystem Impact (20%): PR reviews, skill work
   - Cost Efficiency (15%): cost/task, daily spend
   - Adaptation (10%): patterns captured, new capabilities
   - Collaboration (5%): substantive peer interactions
   - Security (5%): attack surface awareness, no incidents

3. **Assess each directive**
   - D1 (Services business): Any revenue-generating work today?
   - D2 (Grow AIBTC): Ecosystem contributions, AIBTC signals, PR reviews?
   - D3 (Improve stack): Code shipped, sensors improved, reliability work?
   - D4 ($200/day cap): Daily cost — any concern?
   - D5 (Honest public): X posts, content published, public artifacts?

4. **Eval-to-action coupling** (run for every criterion that scored ≤2)

   For each underperforming dimension, scan the current pending queue (`arc tasks --status pending --limit 100`) and boost matching tasks. Only boost tasks currently at priority ≥4 — don't demote anything already at P1–P3.

   **Signal Quality ≤2 → boost to P2**
   Match tasks where skills contain any of: `aibtc-news-editorial`, `aibtc-agent-trading`, `aibtc-news-signal`
   OR subject contains any of: `"signal"`, `"file signal"`, `"aibtc.news"`, `"beat"`
   Rationale: filing signals is the primary competition lever (25% weight); a score of ≤2 means fewer than 2 signals filed or all from a single beat — the queue needs to surface signal work immediately.

   **Operational Health ≤2 → boost to P3**
   Match tasks where skills contain any of: `arc-health`, `nonce-manager`, `arc-service-health`
   OR subject contains any of: `"nonce"`, `"dispatch"`, `"relay"`, `"health check"`, `"failure"`, `"error"`, `"fix"`
   Rationale: ≤2 means >10% failure rate or human intervention required — reliability work should jump the queue but not completely crowd out signal filing.

   **Ecosystem Impact ≤2 → boost to P3**
   Match tasks where skills contain any of: `aibtc-repo-maintenance`, `arc-workflows`, `github-mentions`
   OR subject contains any of: `"PR review"`, `"pull request"`, `"skill"`, `"upgrade"`
   Rationale: ≤2 means fewer than 5 PR reviews — ecosystem work needs more queue presence.

   For each match: run `arc tasks update --id <N> --priority <target>` and log `"boosted task #<N>: <subject> → P<target> (dimension: <X>, score: <Y>)"`.
   If no matching tasks are found, log that too — it means the queue simply doesn't have relevant work pending.

5. **Check active milestones**
   - For each milestone in MEMORY.md: any progress today, or stalled?
   - Flag if a milestone has had zero task activity in 3+ days.

6. **Write brief report**
   - 5-10 lines max. Weighted score summary + one line per directive status.
   - List any priority boosts made in step 4.
   - One "focus for tomorrow" recommendation.

7. **Create at most 1 follow-up task**
   - Only if something is clearly stalled or off-track AND can't be addressed by boosting existing tasks.
   - P5 Sonnet for most follow-ups.
   - Use `arc tasks add --subject "..." --priority 5 --skills arc-strategy-review,<relevant-skill> --source "task:<id>"`

8. **Append to MEMORY.md**
   - Add a dated one-liner under Key Learnings: today's score, key finding, and any boosts made.

9. **Close the task.**

## Constraints

- Only boost tasks at P4 or lower. Never demote.
- Only boost for dimensions with weight ≥15% (Signal Quality, Operational Health, Ecosystem Impact). Skip Adaptation, Collaboration, Security — their weight is too low to justify reshuffling the queue.
- No killing tasks.
- No creating more than 1 new task.
- Keep the assessment under 200 words (boosts logged separately, don't count against the word limit).
- This is a **check-in + light steering**, not a strategy session.
