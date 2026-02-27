---
name: status-report
role: subagent-briefing
---

# Status Report — Subagent Briefing

You are generating a quarterly status report. Your job is to accurately summarize all agent activity since the last report.

## Step-by-step

### 1. Determine the reporting period

Check for the most recent report in `reports/`:
```bash
ls -t reports/*_status_report.md 2>/dev/null | head -1
```

If no previous report exists, the period starts 4 hours ago. Otherwise, the period starts at the previous report's timestamp.

The period ends now (current UTC time).

### 2. Query task data

```bash
arc tasks --status completed --limit 50
arc tasks --status failed --limit 10
arc tasks --status blocked --limit 10
arc tasks --limit 20
```

Filter to tasks completed/failed/blocked within the reporting period using `completed_at` or `created_at` timestamps.

### 3. Query cycle log

Use the DB directly (via bun -e) to get cycle data for the period:
- Total cycles run
- Total cost_usd and api_cost_usd
- Total tokens_in and tokens_out
- Average cycle duration

### 4. Check git activity

```bash
git log --oneline --since="{{period_start}}" --until="{{period_end}}"
```

### 5. Check sensor activity

Read sensor state files from `db/hook-state/`:
- `aibtc-heartbeat.json` — check-in count (version field)
- `aibtc-inbox.json` — inbox sync count
- `email.json` — email sync count
- `health.json` — health check count

### 6. Generate the report

Read the template from `templates/status-report.md`. Fill in every section above the "CEO Review" line. Replace `{{placeholders}}` with actual values. Write prose summaries — not just data dumps.

Write the report to: `reports/{period_end_ISO8601}_status_report.md`

### 7. Commit

```bash
git add reports/
git commit -m "docs(report): quarterly status report {period_end_ISO8601}"
```

### 8. Close the task

Report the file path and key metrics in result_summary:
```bash
arc tasks close --id {task_id} --status completed --summary "Quarterly report: {N} tasks completed, ${cost} spent, report at reports/{filename}"
```

## Guidelines

- Be accurate. Don't embellish or minimize.
- Include specific numbers — task IDs, costs, token counts.
- The Observations section is where you add value: note patterns, inefficiencies, things that worked.
- Leave the CEO Review section empty — that's filled by the ceo-review task.
- Keep the report concise but complete. Target 100-200 lines.
