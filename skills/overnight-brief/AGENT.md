---
name: overnight-brief
role: subagent-briefing
---

# Overnight Brief — Subagent Briefing

You are generating a consolidated overnight brief. Your job is to accurately summarize all agent activity from the overnight window (8pm–6am PST) into a concise morning briefing.

## Step-by-step

### 1. Determine the reporting period

The overnight window is fixed:
- **Start:** Previous day 8pm PST (04:00 UTC)
- **End:** Today 6am PST (14:00 UTC)

Check for the last report/brief in `reports/` to avoid overlap:
```bash
ls -t reports/*_watch_report.md reports/*_overnight_brief.md 2>/dev/null | head -3
```

### 2. Query task data

```bash
arc tasks --status completed --limit 100
arc tasks --status failed --limit 20
arc tasks --status blocked --limit 10
arc tasks --limit 30
```

Filter to tasks completed/failed/blocked within the overnight window using timestamps.

### 3. Query cycle log

Use bun -e to get cycle data for the overnight window:
- Total cycles run
- Total cost_usd and api_cost_usd
- Total tokens_in and tokens_out
- Average cycle duration
- Success/failure rate

### 4. Check git activity

```bash
git log --oneline --since="{{period_start}}" --until="{{period_end}}"
```

### 5. Check partner activity (whoabuddy)

```bash
gh api "/users/whoabuddy/events" --jq '[.[] | select(.type == "PushEvent" and .created_at >= "{{period_start}}" and .created_at <= "{{period_end}}")] | .[] | "\(.repo.name) — \(.payload.commits | length) commit(s): \(.payload.commits | map(.message | split("\n")[0]) | join("; "))"'
```

```bash
gh api "/users/arc0btc/events" --jq '[.[] | select(.type == "PushEvent" and .created_at >= "{{period_start}}" and .created_at <= "{{period_end}}")] | .[] | "\(.repo.name) — \(.payload.commits | length) commit(s): \(.payload.commits | map(.message | split("\n")[0]) | join("; "))"'
```

### 6. Check sensor activity

Read sensor state files from `db/hook-state/` and note overnight run counts.

### 7. Generate the brief

Read the template from `templates/overnight-brief.md`. Fill in every section. Write clear, concise prose — this is a morning briefing, not a data dump. The CEO wants to know:

- What got done overnight
- What failed and why
- What's queued up for today
- Any issues needing attention
- Cost and efficiency summary

Write the brief to: `reports/{period_end_ISO8601}_overnight_brief.md`

### 8. Commit

```bash
git add reports/
git commit -m "docs(report): overnight brief {period_end_ISO8601}"
```

### 9. Close the task

```bash
arc tasks close --id {task_id} --status completed --summary "Overnight brief: {N} tasks completed, {M} failed, ${cost} spent — reports/{filename}"
```

## Guidelines

- Be accurate. Don't embellish or minimize.
- Frame it as a morning briefing — lead with the headline, then details.
- Highlight anything that needs CEO attention at the top.
- Include specific numbers — task IDs, costs, token counts.
- Keep it concise. Target 80-150 lines. The CEO reads this with coffee.
