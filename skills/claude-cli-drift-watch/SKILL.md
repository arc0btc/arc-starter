---
name: claude-cli-drift-watch
description: Monthly read-only check for claude CLI installed-vs-npm-latest version drift
tags:
  - meta
  - sensors
  - claude-cli
disallowed-tools: [Edit, Write, NotebookEdit, Bash]
---

# claude-cli-drift-watch

Read-only monthly sensor. Compares the installed `claude --version` against the latest
version published on npm (`@anthropic-ai/claude-code`). If the installed version is more
than `DRIFT_THRESHOLD_VERSIONS` (minor+patch component count) behind latest, it queues a
low-priority informational task — comparison only, **no binary swap, no upgrade attempt**.

## Why This Exists

`arc-dispatch.service` sets `DISABLE_UPDATES=1` by design (`src/services.ts:134`) with no
compensating periodic-update mechanism, so drift accumulates silently. #21901-#21905 found
the installed CLI 32 versions behind npm latest with no earlier warning. This sensor closes
that blind spot without re-triggering the self-upgrade task-queue paradox found in #21905
(a dispatch task cannot safely swap the binary it's currently running inside of) — it only
*reports* drift, and leaves any actual upgrade decision to a human-triggered or out-of-band
action. See `memory/shared/entries/self-upgrade-task-queue-paradox.md`.

## How It Works

1. Runs `claude --version` locally (subprocess, read-only) to get the installed version.
2. Fetches `https://registry.npmjs.org/@anthropic-ai/claude-code/latest` (public, no auth).
3. Parses both as semver, diffs numerically.
4. If drift exceeds threshold, queues one low-priority task (dedup via `createTaskIfDue`,
   30-day interval) with both version strings in the subject — no action taken.

## Configuration

- `INTERVAL_MINUTES` = 43200 (30 days) — this is a drift-*detection* sensor, not a live check.
- `DRIFT_THRESHOLD_VERSIONS` = 5 — flag only once drift is a real gap, not routine lag.

## Checklist

- [x] `skills/claude-cli-drift-watch/SKILL.md` exists with valid frontmatter (name, description, tags)
- [x] Frontmatter `name` matches directory name (claude-cli-drift-watch)
- [x] SKILL.md is under 2000 tokens
- [x] `sensor.ts` exports an async default function returning `Promise<string>`
- [x] Read-only: `disallowed-tools: [Edit, Write, NotebookEdit, Bash]` (sensor.ts runs its own subprocess/fetch directly at the runtime level — no skill CLI, no human/agent Bash use needed)
