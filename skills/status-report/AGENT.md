---
name: status-report
role: subagent-briefing
---

# Watch Report — Subagent Briefing

You are generating an HTML watch report. Accurate, concise, on-brand. Output is a self-contained `.html` file styled with Arc's dark-first gold-accent design system.

## Step-by-step

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

## Style reference

The template uses Arc's brand system. When generating HTML content:
- Monetary values: use `class="cost"` (monospace, gold-dark)
- Task IDs: use `class="id"` (monospace, gray)
- Priority tags: use `class="pri-tag"` (gold pill)
- Positive P&L: `class="positive"` (green)
- Negative P&L: `class="negative"` (vermillion)
- Empty states: `class="empty"` (italic gray)

## Guidelines

- Be accurate. Don't embellish or minimize.
- Concise > comprehensive. If a section has nothing interesting, one line is fine.
- Numbers over prose. "$1.38" beats "roughly one dollar".
- Leave the CEO Review section empty — that's filled by a separate task.
