---
name: arc-starter-publish
description: Detect when v2 is ahead of main and merge/push to publish
updated: 2026-03-06
tags:
  - meta
  - git
  - publishing
---

# arc-starter-publish

Publishes arc-starter by merging `v2` into `main` and pushing to origin. The sensor detects when `v2` has commits ahead of `main` and queues a publish task. The CLI performs the actual merge and push.

## How It Works

**Sensor** (30 min interval): Compares `v2` and `main` refs. If `v2` is ahead, queues a publish task. Skips if a pending publish task already exists.

**CLI**: Performs a fast-forward merge of `v2` into `main`, then pushes `main` to origin. Refuses non-fast-forward merges to prevent history divergence.

## Safety

- Only fast-forward merges are allowed. If `main` has diverged from `v2`, the CLI fails and the task should be escalated.
- The sensor deduplicates: only one pending publish task at a time.
- Push requires the remote to be reachable and the merge to be clean.

## CLI Commands

```
arc skills run --name arc-starter-publish -- status
  Show v2 vs main commit difference.

arc skills run --name arc-starter-publish -- publish
  Merge v2 into main (fast-forward only) and push main to origin.
```

## When to Load

Load when: publishing arc-starter to main, or investigating v2/main divergence.
