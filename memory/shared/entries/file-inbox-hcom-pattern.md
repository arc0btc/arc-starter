---
id: file-inbox-hcom-pattern
topics: [hooks, agent-to-agent, messaging, sensors, inbox]
source: task:17807
created: 2026-05-27
---

# File-Based Inbox Pattern (hcom-derived)

**Stop hook → inbox/ → sensor** is Arc's local agent-to-agent messaging primitive.

## How It Works

- **Outbound (Stop hook)**: `inbox-write.sh` fires on Stop. Reads `$ARC_TASK_ID` (set by dispatch.ts), queries `db/arc.sqlite` for task source + result_summary, extracts peer BTC from source pattern, writes `inbox/<peer>/<ts>.md`.
- **Inbound (sensor)**: `arc-peer-inbox` sensor scans `inbox/arc/*.md` every 1 minute, creates P3/sonnet tasks, archives to `inbox/arc/processed/`.

## Key Facts

- `SubagentStop` ≠ `Stop` in Arc's architecture: dispatch uses `Bun.spawn()`, not Agent tool, so Stop is the correct hook. SubagentStop only fires for Agent-tool subagents within a cycle.
- Peer detection: source field pattern `sensor:aibtc-inbox-sync:thread:<btc_addr>`. Zero schema change.
- Cross-machine: file inbox is local IPC only. External peers still use aibtc.com inbox (BIP-137/x402). File inbox is for intra-host coordination.
- `sqlite3` read-only SELECT in hook is an acceptable exception to the "no raw SQL" rule — hooks are infrastructure, not dispatch tasks.

## Files

- `.claude/hooks/inbox-write.sh` — outbound Stop hook
- `skills/arc-peer-inbox/sensor.ts` — inbound sensor
- `skills/arc-peer-inbox/SKILL.md` — architecture docs

**Why:** Enables async result delivery to peer agents and inbound message queuing with no new infra — just files + existing hook/sensor machinery.
