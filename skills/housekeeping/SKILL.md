---
name: housekeeping
description: Periodic repo hygiene checks — uncommitted changes, stale locks, WAL size, memory bloat, file archival
tags:
  - infrastructure
  - maintenance
---

# housekeeping

Periodic tidiness checks for the repo. Detects drift, stale state, and accumulated cruft so they get addressed before they cause problems.

## Sensor

Runs every 30 minutes via `claimSensorRun("housekeeping", 30)`. Creates a task if any issues are found.

### Checks

1. **Uncommitted changes** — tracked files with unstaged/uncommitted modifications
2. **Untracked files** — new files in `src/`, `skills/`, `templates/`, `memory/` that should be committed
3. **Stale dispatch lock** — `db/dispatch-lock.json` older than 60 minutes (likely orphaned)
4. **WAL size** — `db/arc.sqlite-wal` over 10 MB (needs checkpoint)
5. **Memory bloat** — `memory/MEMORY.md` over 80 lines (~2k tokens)
6. **ISO 8601 file accumulation** — directories with more than 5 timestamped files need archival

## CLI

```
arc skills run --name housekeeping -- check    # run all checks, output JSON report
arc skills run --name housekeeping -- fix      # auto-fix safe issues
```

### `check`

Runs all hygiene checks and outputs a JSON report:

```json
{
  "uncommitted": ["src/foo.ts"],
  "untracked": ["skills/new-skill/SKILL.md"],
  "staleLock": false,
  "walSizeMb": 2.1,
  "memoryLines": 65,
  "archivalNeeded": ["reports/"]
}
```

### `fix`

Auto-fixes what's safe:
- Commits uncommitted tracked changes (conventional commit: `chore(housekeeping): auto-commit tracked changes`)
- Stages and commits untracked files in watched directories
- Removes stale dispatch lock
- Runs WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`)
- Moves old ISO 8601 files to `archive/` subdirectories (keeps most recent 5)

Does NOT auto-fix:
- Memory bloat (requires manage-skills consolidation)
- Unrecognized files outside watched directories

## Checklist

- [ ] `skills/housekeeping/SKILL.md` exists with valid frontmatter
- [ ] Sensor runs every 30 min, creates task only when issues found
- [ ] `check` outputs valid JSON report
- [ ] `fix` commits with conventional commit format
- [ ] `fix` never force-pushes or deletes unrecognized files
- [ ] ISO 8601 archival keeps 5 most recent, moves rest to `archive/`
