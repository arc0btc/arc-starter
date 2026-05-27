---
name: arc-peer-inbox
description: File-based inter-agent inbox — Stop hook writes task results to inbox/<peer>/, sensor consumes inbox/arc/. Lifted from hcom hooks-to-db pattern.
tags:
  - inbox
  - messaging
  - hooks
  - agent-to-agent
---

# arc-peer-inbox

File-based inter-agent messaging layer, lifted from hcom's hook-to-db pattern.
No new infra — uses Arc's existing Claude Code hooks + sensor machinery.

## Architecture

```
Arc dispatch cycle ends (Stop hook)
  → .claude/hooks/inbox-write.sh
  → reads ARC_TASK_ID, queries task source + result_summary from db/arc.sqlite
  → if source matches :thread:<peer>: writes inbox/<peer>/<ts>.md

Peer agents (local or via git push)
  → write files to inbox/arc/<ts>.md

arc-peer-inbox sensor (1-min cadence)
  → scans inbox/arc/*.md for unprocessed files
  → creates P3/sonnet task per file
  → moves processed files to inbox/arc/processed/
```

## Directory Layout

```
inbox/
  arc/               ← messages TO Arc (sensor reads these)
    processed/       ← archived after task creation (not gitignored)
  <peer-btc-addr>/   ← messages FROM Arc TO that peer (hook writes these)
```

## File Format

YAML frontmatter + plain text body:

```markdown
---
task_id: 17842
status: completed
ts: 2026-05-27T21:00:00Z
from: arc
peer: bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm
---

Reviewed PR #42 — approved with one suggestion: add error handling in ...
```

## Hook: .claude/hooks/inbox-write.sh

- Fires on `Stop` (end of each dispatch cycle)
- Reads `$ARC_TASK_ID` from environment (set by dispatch.ts)
- Queries `db/arc.sqlite` for task source, status, result_summary
- Extracts peer from source pattern: `sensor:aibtc-inbox-sync:thread:<btc_addr>`
- Writes to `inbox/<peer>/<ts>.md` only on `completed` or `failed` status

## Peer Detection Patterns

Currently supported source patterns:
- `sensor:aibtc-inbox-sync:thread:<btc_addr>` — aibtc.com platform inbox thread

To add a new peer source pattern, extend the grep in `inbox-write.sh`.

## Sensor Behavior

- Cadence: 1 minute (fastest sensor cadence)
- Dedup: `pendingTaskExistsForSource(sensor:arc-peer-inbox:<filename>)` — no double-queue
- Archive: processed files move to `inbox/arc/processed/` (not deleted — audit trail)
- Tasks created: P3, sonnet, skills=[arc-peer-inbox, contacts]

## Cross-Machine Delivery

This is **local IPC by default** — inbox/ shares a filesystem with the dispatch process.

For cross-machine delivery (Arc ↔ quasar-garuda on different hosts):
- Option A: Peer pushes a file to Arc's git repo via PR (git-native, auditable)
- Option B: Peer POSTs to a future `inbox/` HTTP endpoint (not yet built)
- Option C: Use existing aibtc.com inbox (BIP-137/x402) — already operational

Option C remains the production path for external agents. This file inbox is for
intra-session subagent coordination and local tooling pipelines.

## SubagentStop (Future)

For within-cycle subagent results (CLAUDE_CODE_WORKFLOWS=1), `SubagentStop` hook
can write subagent output to `inbox/<subagent-name>/<ts>.md` so the parent agent
can pick it up mid-session via file read. Not yet wired — stop hook covers the
current single-dispatch-per-cycle model.
