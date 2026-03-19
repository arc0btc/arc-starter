# fleet-sync — Subagent Briefing

You are syncing code, config, and contacts across Arc's fleet of agents via SSH. This is infrastructure work — mistakes can corrupt agent state or break running services.

## Fleet Agents

| Agent | IP | Role |
|-------|----|------|
| spark | 192.168.1.12 | AIBTC/DeFi |
| iris | 192.168.1.13 | Research/X |
| loom | 192.168.1.14 | CI/CD |
| forge | 192.168.1.15 | Infra |

Arc (192.168.1.10) is always the source of truth. Sync is one-directional: Arc → workers.

## Commands

All commands accept `--agent <name|all>` (default: `all`).

### claude-md
Pushes `CLAUDE.md` to agents. Compares MD5 checksums first — skips agents already in sync.
```
arc skills run --name fleet-sync -- claude-md [--agent <name|all>]
```

### skills
Syncs skill directories via tar-over-SSH. Each agent has assigned skills (specialization matrix in cli.ts) plus shared infrastructure skills. Without `--skill`, syncs all assigned skills. With `--skill`, syncs only that one.
```
arc skills run --name fleet-sync -- skills --agent <name|all> [--skill <name>]
```

### contacts
Exports Arc's agent contacts and imports them on each worker. Re-activates archived fleet-peer contacts.
```
arc skills run --name fleet-sync -- contacts [--agent <name|all>]
```

### status
Read-only. Shows CLAUDE.md hash comparison and skill presence per agent. Safe to run anytime.
```
arc skills run --name fleet-sync -- status [--agent <name|all>]
```

### full
Runs claude-md + skills + contacts in sequence. The standard "bring everyone up to date" command.
```
arc skills run --name fleet-sync -- full [--agent <name|all>]
```

### git-status
Read-only. Compares HEAD commit on Arc vs each agent. Reports `IN SYNC`, `BEHIND`, or `UNREACHABLE`. Also shows dirty working tree state and branch name.
```
arc skills run --name fleet-sync -- git-status [--agent <name|all>]
```

### git-sync (notify-only, DEFAULT)
The safe path. Creates a git bundle from Arc's local refs, SCPs it to drifted agents, then creates a P3 task on each agent's local queue. The worker applies the update itself with full local context (dirty state, running services).
```
arc skills run --name fleet-sync -- git-sync [--agent <name|all>]
```
Workers receive a task with instructions to: `git fetch <bundle> && git checkout <branch> && git reset --hard <commit> && bun install`.

### git-sync --force-push (EMERGENCY ONLY)
Arc directly applies the bundle on each agent: stashes uncommitted work, fetches bundle, hard resets to Arc's commit, runs `bun install`. **This discards any local changes on the worker.**
```
arc skills run --name fleet-sync -- git-sync --agent <name> --force-push
```

## Safety Rules

1. **Always run `git-status` first** before any git-sync operation. Understand what's drifted and why.
2. **Default to notify-only git-sync.** Workers have local context (dirty state, running services, in-progress work) that Arc doesn't see. Let them apply updates safely.
3. **Never use `--force-push` unless:**
   - The worker cannot self-update (dispatch broken, services crashed)
   - You have confirmed via `git-status` that the worker has no important uncommitted changes
   - The task explicitly requests emergency sync
4. **Prefer `--agent <name>` over `--agent all`** for git-sync operations. Sync one agent at a time so failures are isolated.
5. **Use `--agent all` freely for read-only commands** (status, git-status) and config sync (claude-md, skills, contacts, full).
6. **Check fleet suspension state.** If `db/fleet-suspended.json` exists, agents listed there are suspended. The sensor auto-skips them. You should too — don't sync to suspended agents unless the task specifically asks you to.

## Interpreting git-status Output

```
Arc (local): main @ 403181d5e1 [dirty]

  [spark] main @ 9ecad88d3a — BEHIND
  [iris]  main @ 403181d5e1 — IN SYNC
  [loom]  UNREACHABLE
  [forge] main @ 403181d5e1 [dirty] — IN SYNC
```

- **BEHIND**: Agent's HEAD differs from Arc's. Needs git-sync.
- **IN SYNC**: Same commit. No action needed.
- **UNREACHABLE**: SSH connection failed. Check if VM is running.
- **[dirty]**: Uncommitted changes in working tree. Be cautious with force-push — it stashes but doesn't preserve stash reliably.

## Credentials

SSH access uses `vm-fleet / ssh-password` from the encrypted credential store. Retrieved via `arc creds get --service vm-fleet --key ssh-password`. The CLI handles this automatically — you don't need to pass credentials manually.

## Sensor Behavior

The sensor runs every 30 minutes:
- Skips all work if `db/fleet-suspended.json` indicates full fleet suspension
- Skips individual suspended agents
- Compares each reachable agent's HEAD against Arc's
- Creates a P4 task (with `fleet-sync` skill) if any agent has drifted
- Uses stable task subjects (no commit hash) for dedup

## Common Workflows

**Routine sync after Arc commits new code:**
1. `git-status` — see who's behind
2. `git-sync` — notify drifted agents (they self-update)

**Sync config/skills after CLAUDE.md or skill changes:**
1. `full --agent all` — pushes CLAUDE.md + skills + contacts

**Sync a single new skill to one agent:**
1. `skills --agent spark --skill defi-bitflow`

**Emergency recovery (worker can't self-update):**
1. `git-status --agent spark` — confirm state
2. `git-sync --agent spark --force-push` — direct reset (last resort)

## Gotchas

- `full` does NOT include git-sync. It only syncs CLAUDE.md, skills, and contacts. Git sync is always a separate, deliberate operation.
- Only committed code is synced via git-sync. Uncommitted local changes on Arc are not included in the bundle.
- The skill specialization matrix is hardcoded in `cli.ts` (AGENT_SKILLS constant). If a new skill needs syncing, update the matrix.
- Bundle transfer can be slow for large repos. The CLI shows bundle size after creation.
- If SCP fails but no task is created, the CLI cleans up the remote bundle automatically.
