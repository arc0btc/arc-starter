---
name: agent-health
description: External health monitor for Loom (Rising Leviathan). Analyzes pre-gathered cycle metrics, task failures, git activity, and gate state to classify agent health and send email alerts.
updated: 2026-04-06
tags: [sensor, monitoring, health]
---

# Agent Health Monitor

## Purpose

This skill is loaded by Haiku tasks created by the `agent-health` sensor running on Arc (Trustless Indra). Arc SSHes into Loom every 2 hours, gathers all relevant data, and bakes it into the task description as a structured data block.

**Your only job as Haiku:** read the pre-gathered data, classify health status (GREEN / YELLOW / RED), and send an email if anything needs attention. You do not need to SSH anywhere or query any databases -- everything is already in the task description.

## Data Block Format

The task description will contain a block structured like this:

```
=== AGENT HEALTH DATA: Loom (Rising Leviathan) ===
Checked: {ISO timestamp}
Period: last {N} hours

## Cycle Metrics
cycles_checked: N
total_tokens_in: N
total_cost_usd: N.NN
avg_tokens_per_cycle: N
avg_cost_per_cycle: N.NN
max_tokens_in_single_cycle: N
max_cost_single_cycle: N.NN
spike_cycles: [{started_at, tokens_in, cost_usd, model, duration_ms, task_subject}]

## Task Failures
failed_sources: [{source, count, last_subject}]
retry_storms: [{source, count, subjects}]

## Git Activity
commits_since_last_check: N
watched_path_commits: [{hash, date, message, files_changed}]

## Gate State
dispatch_gate: {status, consecutive_failures, stopped_at, stop_reason}
watchdog: {last_ran, last_alert_at, last_result}

## Thresholds
tokens_in_per_cycle: 1000000
cost_per_cycle_usd: 3.00
daily_cost_usd: 100
failed_source_repeat_count: 5
pending_task_age_hours: 4
=== END DATA ===
```

## Analysis Instructions

Work through these steps in order:

### Step 1: Compare Each Metric Against Its Threshold

Check each of the following, noting which are within bounds and which exceed thresholds:

| Metric | Threshold | Signal |
|--------|-----------|--------|
| max_tokens_in_single_cycle | 1,000,000 | RED if exceeded |
| max_cost_single_cycle | $3.00 | RED if exceeded |
| total_cost_usd (for period) | $100/day equivalent | YELLOW if on pace to exceed |
| failed_source repeat count | 5 occurrences | RED if any source exceeds this |
| watched_path git commits | any non-trivial changes | YELLOW if behavior-critical code changed |
| pending task age | 4 hours | YELLOW if any task pending longer |
| dispatch_gate status | "open" | RED if stopped or closed |

### Step 2: Apply Known Noise Filters

Skip the following when counting failures (these sensors create/fail tasks as normal operation):
- `sensor:treasury-health`
- `sensor:service-health`
- `sensor:service-health:stale-lock`

Do not flag these sources as retry storms even if their counts are high.

### Step 3: Classify Overall Status

- **GREEN**: All metrics within thresholds, no watched-path commits, gate open
- **YELLOW**: At least one metric in warning range, OR non-trivial watched-path commits, OR any pending task past age threshold
- **RED**: Any threshold critically exceeded, OR dispatch gate stopped, OR retry storm detected from a non-noise source

If multiple signals exist, use the worst classification.

### Step 4: Decide Whether to Send Email

- **GREEN**: Do not send email. Mark the task complete with a one-line "all clear" note.
- **YELLOW**: Send email to whoabuddy@gmail.com with subject `[Loom Health] YELLOW - {brief reason}`.
- **RED**: Send email to whoabuddy@gmail.com with subject `[Loom Health] RED - {brief reason}`.

### Step 5: Compose Email Body

For YELLOW emails, include:
- Overall status classification
- Which metrics triggered the warning
- Relevant data points (not the full dump, just what's relevant)
- Suggested investigation steps

For RED emails, include:
- Overall status classification (urgent)
- Which thresholds were exceeded and by how much
- Full data for the flagged metrics (paste the relevant sections from the data block)
- Immediate action items (e.g., "check if Loom is running a token spiral", "inspect recent git commits to src/")

### Step 6: Send Email Using arc-email-sync

Use the `arc-email-sync` skill to send the email:
- To: whoabuddy@gmail.com
- From: arc@arc0.me (default)
- Subject: as defined above
- Body: as composed above

## Email Quick Reference

| Status | Action | Subject Pattern |
|--------|--------|-----------------|
| GREEN | No email, note "all clear" | (none) |
| YELLOW | Send warning email | `[Loom Health] YELLOW - {reason}` |
| RED | Send urgent email | `[Loom Health] RED - {reason}` |

## Sensor Behavior

This SKILL.md is loaded by tasks created by `sensor.ts` in the `agent-health` skill, running on Arc.

- **Cadence:** every 120 minutes
- **Source:** `sensor:agent-health:loom`
- **Model:** haiku
- **Skills loaded:** `["agent-health", "arc-email-sync"]`
- **Data gathering:** The sensor gathers ALL data via SSH + `bun --eval` SQLite queries. This skill file is only loaded for Haiku analysis -- zero additional data gathering needed.

## Checklist

- [ ] SKILL.md exists with valid frontmatter
- [ ] sensor.ts creates tasks with correct skills array: `["agent-health", "arc-email-sync"]`
- [ ] Haiku analyzes data block and classifies GREEN / YELLOW / RED
- [ ] Email sent only on YELLOW or RED (GREEN = silent all-clear)
- [ ] No tool calls needed from Haiku (all data pre-gathered by sensor)
- [ ] Noise sources (treasury-health, service-health) excluded from failure counts
