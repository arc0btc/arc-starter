---
name: reporting
role: subagent-briefing
---

# Reporting — Subagent Briefing

This skill generates two report variants. Check the task description to determine which variant to produce.

---

## Watch Report (HTML)

You are generating an HTML watch report. Accurate, concise, on-brand. Output is a self-contained `.html` file styled with Arc's dark-first gold-accent design system.

### 1. Determine the reporting period

Check for the most recent report in `reports/`:
```bash
ls -t reports/*_watch_report.* 2>/dev/null | grep -m1 .
```

Period starts at the previous report's timestamp (or 4 hours ago if none). Period ends now (UTC).

### 2. Gather data

Run these in parallel where possible:

**Tasks:**
```bash
arc tasks --status completed --limit 50
arc tasks --status failed --limit 10
arc tasks --status blocked --limit 10
arc tasks --limit 20
```
Filter to tasks within the reporting period.

**Cycle log** (via bun -e): total cycles, cost_usd, api_cost_usd, tokens_in, tokens_out.

**Git:**
```bash
git log --oneline --since="{{period_start}}" --until="{{period_end}}"
```

**Partner activity:**
```bash
gh api "/users/whoabuddy/events" --jq '[.[] | select(.type == "PushEvent" and .created_at >= "{{period_start}}" and .created_at <= "{{period_end}}")] | .[] | "\(.repo.name) — \(.payload.commits | length) commit(s): \(.payload.commits | map(.message | split("\n")[0]) | join("; "))"'
```

**Prediction markets:**
```bash
arc skills run --name stacks-market -- portfolio
arc skills run --name stacks-market -- positions
```

**Sensor state:** Read `db/hook-state/*.json` files for sensor run counts.

### 3. Generate the HTML report

Read the template at `templates/status-report.html`. Replace all `{{placeholders}}` with real data.

**Key rules:**
- **Summary:** 2-3 sentences max. What happened, key outcome, health status.
- **Tasks table:** One row per completed task. Subject column should be short (truncate to ~40 chars if needed).
- **Failed/blocked:** Only include if they exist. Otherwise omit the section entirely.
- **Prediction Markets:** Show positions from `arc skills run --name stacks-market -- portfolio`. If no positions, show: `<p class="empty">No open positions. Budget: {{budget}} STX ({{exposure}} deployed).</p>`. If positions exist, show one `.market-card` per position with title, side, cost basis, current price, and P&L percentage.
- **Git:** One `.commit` div per commit. Hash in `.hash` span, message after.
- **Queue:** One `.queue-item` per pending task. Include `.pri-tag` with priority. Use `.blocked` class for blocked tasks.
- **Observations:** 2-4 items max. Patterns, efficiency, what worked or didn't. One `.obs` div each. No throat-clearing.
- **CEO Review:** Leave the HTML comments in place. The ceo-review task fills this.
- **Partner activity:** If whoabuddy had GitHub activity, mention it in the summary or observations. Don't create a separate section.
- **Sensor activity:** Roll into summary or observations if noteworthy. Don't create a separate section.
- **Research:** Only mention in observations if a new research report was created this period.

**Total target: 80-120 lines of filled HTML content** (excluding the template chrome). Shorter is better.

### 4. Write and commit

Write to: `reports/{period_end_ISO8601}_watch_report.html`

```bash
git add reports/
git commit -m "docs(report): watch report {period_end_ISO8601}"
```

### 5. Close the task

```bash
arc tasks close --id {task_id} --status completed --summary "Watch report: {N} tasks completed, ${cost} spent, report at reports/{filename}"
```

### Style reference

The template uses Arc's brand system. When generating HTML content:
- Monetary values: use `class="cost"` (monospace, gold-dark)
- Task IDs: use `class="id"` (monospace, gray)
- Priority tags: use `class="pri-tag"` (gold pill)
- Positive P&L: `class="positive"` (green)
- Negative P&L: `class="negative"` (vermillion)
- Empty states: `class="empty"` (italic gray)

---

## Overnight Brief (Markdown)

You are generating a consolidated overnight brief. Accurately summarize all agent activity from the overnight window (8pm–6am PST) into a concise morning briefing.

### 1. Determine the reporting period

The overnight window is fixed:
- **Start:** Previous day 8pm PST (04:00 UTC)
- **End:** Today 6am PST (14:00 UTC)

Check for the last report/brief in `reports/` to avoid overlap:
```bash
ls -t reports/*_watch_report.* reports/*_overnight_brief.* 2>/dev/null | head -3
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

---

## Guidelines (Both Variants)

- Be accurate. Don't embellish or minimize.
- Numbers over prose. "$1.38" beats "roughly one dollar".
- Concise > comprehensive. If a section has nothing interesting, one line is fine.
- For watch reports: leave the CEO Review section empty — that's filled by a separate task.
- For overnight briefs: frame as morning briefing — lead with the headline, then details. Highlight anything needing CEO attention at the top.
- Include specific numbers — task IDs, costs, token counts.
