---
name: github-interceptor
description: Detects blocked GitHub credential tasks on workers and auto-routes them to Arc
updated: 2026-03-10
tags:
  - fleet
  - github
  - worker
---

# github-interceptor

Worker-only sensor that catches tasks blocked on GitHub credentials and automatically routes them to Arc via fleet-handoff.

## Problem

Workers (Spark, Iris, Loom, Forge) cannot access GitHub. When a task requires GitHub operations, workers create blocked escalations asking for PAT/SSH credentials. This has recurred 7+ times despite manual resolution each time.

## How It Works

The sensor runs every 10 minutes on workers only. It:

1. Queries for tasks with `status = 'blocked'` whose `result_summary` or `subject` mentions GitHub, PAT, SSH key, or credentials
2. For each match, runs `fleet-handoff` to route the work to Arc
3. Closes the blocked task locally as completed

On Arc, this sensor is a no-op (returns "skip").

## When to Load

This skill is auto-loaded by the sensor. No manual loading needed.
