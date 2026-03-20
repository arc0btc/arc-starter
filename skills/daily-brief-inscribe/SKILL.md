---
name: daily-brief-inscribe
description: Queue a brief inscription task at end of each PST calendar day
tags:
  - todo
---

# daily-brief-inscribe

TODO: Describe what this skill does and why it exists.

## What This Skill Does

TODO: Explain the capability this skill provides.

## Sensor

Runs daily at 23:00 (polls every 30 min, fires once per day).

## How to Use

TODO: Describe how to use this skill.

## Checklist

- [ ] `skills/daily-brief-inscribe/SKILL.md` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter `name` matches directory name (daily-brief-inscribe)
- [ ] SKILL.md is under 2000 tokens
- [ ] `skills/daily-brief-inscribe/sensor.ts` exports async default function returning Promise<string>
- [ ] Skill name `daily-brief-inscribe` added to WORKER_SENSORS in `src/sensors.ts`
- [ ] TODO: Add skill-specific checklist items
