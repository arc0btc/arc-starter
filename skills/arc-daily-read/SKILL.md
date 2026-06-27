---
name: arc-daily-read
description: Arc's Daily Read — daily named first-person beat with real-data chart, inter-day continuity, amplification email hook. Posts once daily at UTC 13:00. P3 of arc-demand-distribution quest.
updated: 2026-06-27
tags: [social, distribution, daily-read, reach, amplification]
disallowed-tools: []
---

# Arc's Daily Read

Daily, named, first-person beat. One real-data chart (generated from Arc's own distilled_artifacts pipeline). One "what changed" line. Same time every day (UTC 13:00). Character with memory: carries a tracked thesis forward each beat.

**This is NOT:** decorative AI art, a cron job with no continuity, a $9 cold ask.  
**This IS:** the FREE tier of the value ladder — the awareness hook that earns follows and routes soft free-room joins.

## How It Works

1. **Chart generation:** SQL query on `distilled_artifacts` table — weekly counts by type, rendered as ASCII sparkline. Zero AI art. Reproducible by anyone with DB access.
2. **Beat composition:** 4 tweets — root (data first, edition stamp second) → reply-2 (so-what call) → reply-3 (thesis continuity / "what I got wrong") → CTA (follow + free-room join with `?a=x-human`).
3. **Posting:** via existing X client (skills/social-x-posting/cli.ts), honoring DAILY_TWEET_CAP=6 and kill switch. Checks cap BEFORE posting; defers if <4 slots remain.
4. **Amplification email:** fires AFTER posting — sends ready-to-amplify draft + tweet URL to whoabuddy@gmail.com via existing email worker API. Non-blocking; failure logged, posting is not blocked.
5. **Logging:** inserts row into `daily_read_log` table in db/arc.sqlite.

## CLI

```bash
# Compose without posting (shows the 4-tweet beat)
bun ~/arc-starter/skills/arc-daily-read/cli.ts compose --dry-run

# Show the ASCII chart from live distilled_artifacts data
bun ~/arc-starter/skills/arc-daily-read/cli.ts chart

# Post (with dry-run flag = show cap check + beat, do NOT post to X)
bun ~/arc-starter/skills/arc-daily-read/cli.ts post --dry-run

# Post live (only when authorized — check cap first)
bun ~/arc-starter/skills/arc-daily-read/cli.ts post

# Show today's beat status
bun ~/arc-starter/skills/arc-daily-read/cli.ts status
```

## Schema

`daily_read_log` table created on first run (idempotent):
- `edition_n` (PK): sequential edition number, starts at 1
- `beat_source`: dedup key prefix `daily-read:N`
- `tweet_id`: root tweet ID once posted
- `root_tweet_url`: full URL for amplification email
- `thesis_carried`: the tracked claim carried INTO this beat
- `what_got_wrong`: correction from prior beat (null if first beat or no correction)
- `chart_data`: JSON of the weekly chart data used
- `amplification_email_sent`: 0/1
- `amplification_email_sent_at`: ISO8601
- `organic_reach_snapshot`: JSON with follower_count at post time
- `posted_at`: when the beat posted
- `created_at`: row creation

## Reach-Proof Carry-Forward

**Target:** ≥10 consecutive daily beats at UTC 13:00, with impressions/post + follower-delta measured vs P2 baseline (51 followers on 2026-06-27, 0 external engagement).

**Confirm hypothesis:** ≥15 net followers + ≥1 external RT within 7 days of Edition 1.  
**Refute hypothesis:** <5 net followers after 10 beats with ≥1 operator amplification fired.

**Status:** Edition 1 queued for next 13:00 UTC slot. Reach proof explicitly carried forward — 10 beats cannot fit this quest window.

## Files

| File | Purpose |
|------|---------|
| SKILL.md | This file |
| cli.ts | Chart generation, beat composition, posting, email hook |
| sensor.ts | Time-gate sensor — fires dispatch task once/day at UTC 13:00 |
