# Fleet Recovery Checklist — Worker Reinstatement

*Prepared: 2026-03-11. Use when Anthropic reinstates the suspended Claude Code Max 100 plan.*

---

## 1. Worker Sensor Set (all agents: Spark, Iris, Loom, Forge)

Each worker runs exactly **12 sensors** (WORKER_SENSORS allowlist in `src/sensors.ts`):

| Sensor | Interval | Purpose |
|--------|----------|---------|
| `aibtc-heartbeat` | 5 min | Signed AIBTC platform check-in |
| `aibtc-inbox-sync` | ~5 min | Poll AIBTC inbox for messages |
| `arc-service-health` | ~5 min | Self-monitor: stale cycles, dead services |
| `arc-alive-check` | ~5 min | Periodic alive signal |
| `arc-housekeeping` | varies | Basic repo hygiene |
| `fleet-self-sync` | 5 min | Receive git bundle updates from Arc |
| `arc-scheduler` | 1 min | Fire scheduled tasks |
| `contacts` | varies | Contact database sync |
| `identity-guard` | 30 min | Validate SOUL.md matches hostname |
| `reputation-tracker` | 30 min | Detect peer review opportunities |
| `erc8004-reputation-monitor` | 60 min | Watch for incoming on-chain feedback |
| `github-interceptor` | 10 min | Auto-handoff GitHub work to Arc |

Everything else is Arc-only. Workers skip Arc-only sensors automatically.

---

## 2. fleet-self-sync Backup/Restore Logic — Status

**Reviewed: 2026-03-11. Logic is SOLID.**

The sensor (`skills/fleet-self-sync/sensor.ts`) uses a **pre-read, post-write** pattern:

1. **Before** `git reset --hard`: reads SOUL.md and MEMORY.md from 3 sources in priority order:
   - `~/.aibtc/SOUL.md` (persistent, set by `configure-identity`) — most reliable
   - Working copy (current repo state)
   - `/tmp/arc-soul-backup.md` (temp backup from prior sync)
2. Filters out Arc-identity contamination via `hasArcIdentityClaims()` (checks Arc's Stacks/Bitcoin addresses, "# Arc\n" heading)
3. **After** reset: writes the resolved content back to `SOUL.md`, `MEMORY.md`, persistent paths, and temp backups
4. If no clean SOUL.md found: creates P2 task `--skills arc-remote-setup` to run `configure-identity`
5. On service health check failure: rolls back to pre-sync commit AND restores identity files from the still-in-memory pre-read content (no filesystem race)

**Known gap:** If `~/.aibtc/SOUL.md` doesn't exist on a worker (first-time reinstatement), the sensor falls back to working copy. If working copy is already contaminated, it creates the P2 fix task. This is correct behavior — `configure-identity` is the fix.

---

## 3. Reinstatement Validation Checklist

Run through these steps for each worker (Spark=192.168.1.12, Iris=192.168.1.13, Loom=192.168.1.14, Forge=192.168.1.15) in order:

### Step 1: Confirm Account Access
- [ ] whoabuddy confirms reinstatement via Anthropic support
- [ ] Verify each worker can run Claude Code: `ssh <worker> "claude --version"`
- [ ] Check OAuth vs API key mode — workers should use `ANTHROPIC_API_KEY`, not OAuth (task #4088)

### Step 2: Service Health
- [ ] `ssh <worker> "systemctl --user status arc-sensors.timer arc-dispatch.timer arc-web.service"`
- [ ] If any service dead: `ssh <worker> "systemctl --user restart arc-sensors.timer arc-dispatch.timer"`
- [ ] Confirm dispatch lock isn't stale: `ssh <worker> "cat ~/arc-starter/db/dispatch-lock.json"` — delete if stale (no process at that PID)

### Step 3: Identity Integrity
- [ ] `ssh <worker> "head -5 ~/arc-starter/SOUL.md"` — verify agent's own name appears (not "Arc")
- [ ] `ssh <worker> "cat ~/.aibtc/SOUL.md | head -3"` — persistent backup should match
- [ ] If Arc identity found: `arc skills run --name arc-remote-setup -- configure-identity --agent <name>`

### Step 4: Git Sync
- [ ] `arc skills run --name fleet-sync -- git-status` — check which workers are BEHIND
- [ ] `arc skills run --name fleet-sync -- git-sync --agent all` — push Arc's latest to workers
- [ ] Verify workers applied update: re-run `git-status` until all IN SYNC

### Step 5: Skill Sync
- [ ] `arc skills run --name fleet-sync -- full --agent all` — sync CLAUDE.md + skills
- [ ] Spot-check critical skills: contacts, arc-remote-setup, fleet-self-sync, aibtc-heartbeat

### Step 6: Sensor Verification
- [ ] `ssh <worker> "bash ~/arc-starter/bin/arc sensors list"` — should show 12 sensors
- [ ] `ssh <worker> "bash ~/arc-starter/bin/arc sensors"` — run once manually, check output
- [ ] Confirm heartbeat fires: watch for AIBTC platform check-in within 10 minutes

### Step 7: Dispatch Test
- [ ] Create a P8 test task on each worker: `ssh <worker> "bash ~/arc-starter/bin/arc tasks add --subject 'Post-reinstatement health check' --priority 8"`
- [ ] `ssh <worker> "bash ~/arc-starter/bin/arc run"` — trigger dispatch manually
- [ ] Verify task completes: `ssh <worker> "bash ~/arc-starter/bin/arc tasks --status completed --limit 3"`

### Step 8: Catch-Up Work
- [ ] Check worker task queues for accumulated pending tasks: `ssh <worker> "bash ~/arc-starter/bin/arc tasks"`
- [ ] Review AIBTC inbox backlog on each worker (messages piled up during outage)
- [ ] Spark: check if aibtc.news streak needs recover (was maintaining Ordinals Business beat)
- [ ] Iris: check if X pipeline tasks queued (content was blocked)
- [ ] Loom: check for PR review backlog
- [ ] Forge: check for infrastructure/deployment tasks that may have timed out

### Step 9: Fleet Monitoring
- [ ] After all workers healthy: suppress/clear fleet-monitoring alerts Arc generated for silent workers
- [ ] Run `arc skills run --name fleet-sync -- status` for final confirmation
- [ ] Update `memory/MEMORY.md` — remove [FLAG] about fleet degraded state

---

## 4. Agent-Specific Notes

| Agent | Special Considerations |
|-------|----------------------|
| **Spark** | Multi-wallet (primary + legacy spark-v0.11). Verify both wallet keys accessible. Topaz Centaur AIBTC identity. |
| **Iris** | Identity drift worst-affected (18.7% failure rate pre-fix). Run `configure-identity` first. AIBTC not yet registered (task #2890). |
| **Loom** | Should be straightforward — code review focus, less stateful. |
| **Forge** | Dual dispatch (Claude + Codex/GPT-5.4 via OpenRouter). May have been partially operational during outage. Check OpenRouter tasks separately. |

---

## 5. Fleet Monitoring Alert Cleanup

After successful reinstatement:
- Fleet-comms, fleet-health, fleet-escalation sensors will have generated alerts for silent workers during outage — these are expected noise
- Close any pending "worker silent" or "worker not responding" tasks as `completed` with summary "Worker reinstated post-suspension"
- Do NOT close heartbeat-missed tasks from outage period as `failed` — they are informational, close as `completed`
