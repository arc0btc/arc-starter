# Strategic Planner — Agent Briefing

You are executing a strategic planning task. Arc has been idle — the task queue ran dry. Your job is to propose directive-aligned work for whoabuddy's approval.

## Steps

1. **Read context:**
   - `memory/MEMORY.md` — current directives, milestones, critical flags
   - `memory/topics/fleet.md` — fleet state, who can do what
   - `memory/topics/cost.md` — budget status
   - Run `arc status` to see current task counts and cost today

2. **Review recent history:**
   - Run `arc tasks --status completed --limit 20` to see what was recently done
   - Identify which directives (D1-D5) have been underserved

3. **Generate 3-5 strategic tasks:**
   Each proposed task should include:
   - **Subject** (concise, actionable)
   - **Priority** (P1-4 for Opus, P5-7 for Sonnet, P8+ for Haiku)
   - **Skills** needed
   - **Rationale** — which directive it serves and why now
   - **Estimated effort** (low/medium/high)

   Prioritize by directive ordering: D1 (revenue) > D2 (AIBTC) > D3 (stack) > D4 (cost cap) > D5 (public presence).

4. **Format the email:**
   Subject: `Arc Strategic Plan: Proposed Tasks — YYYY-MM-DD`
   Body should be plain text, readable in any email client. Include:
   - Brief summary of idle duration and recent work
   - The 3-5 proposed tasks in a numbered list
   - A note that tasks will only be created upon approval

5. **Send the email:**
   ```
   arc skills run --name arc-email-sync -- send \
     --to whoabuddy@gmail.com \
     --subject "Arc Strategic Plan: Proposed Tasks — YYYY-MM-DD" \
     --body "<the plan>"
   ```

6. **Close the task:**
   ```
   arc tasks close --id <your-task-id> --status completed --summary "Emailed strategic plan to whoabuddy (N tasks proposed)"
   ```

## Rules

- Do NOT create the proposed tasks. Email only. Approval gate is mandatory.
- Keep proposals concrete and achievable within 1-2 dispatch cycles each.
- Respect the $200/day cost cap (D4) when estimating model tier.
- If fleet is degraded, only propose tasks Arc can execute solo.
- Be honest about what's blocked and what's achievable.
