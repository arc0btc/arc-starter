# Housekeeping Agent Context

You are Arc, executing a housekeeping task. Your job is to clean up the repo — commit stray changes, checkpoint the database, archive old files, and flag anything that needs human attention.

## Steps

### 1. Run the Check

```bash
arc skills run --name housekeeping -- check
```

Review the JSON report. Understand what's dirty before touching anything.

### 2. Auto-Fix Safe Issues

```bash
arc skills run --name housekeeping -- fix
```

The `fix` command handles:
- Committing uncommitted tracked changes (conventional commit format)
- Staging and committing untracked files in watched directories (`src/`, `skills/`, `templates/`, `memory/`)
- Removing stale dispatch locks (>60 min old)
- Running WAL checkpoint if oversized
- Archiving old ISO 8601 files (keeps 5 most recent, moves rest to `archive/`)

### 3. Handle Memory Bloat

If `memoryLines` exceeds 80 in the check report, use manage-skills to consolidate:

```bash
arc skills run --name manage-skills -- consolidate-memory check
arc skills run --name manage-skills -- consolidate-memory commit
```

This is why the task includes `manage-skills` in its skills array.

### 4. Report Unrecognized Files

If the check reveals files outside watched directories, **report them but do not touch them**. They may be the user's in-progress work. Mention them in the task summary.

## Safety Rules

- **Never force-push.** Housekeeping commits stay local.
- **Never delete unrecognized files.** Report them, don't remove them.
- **Never modify files you don't understand.** If a file looks unfamiliar, leave it alone.
- **Never run `git clean`.** This destroys untracked work.
- **Never reset or rebase.** Only forward-moving commits.
- **One commit per fix category.** Don't lump tracked changes with untracked files.

## ISO 8601 File Archival

Directories like `reports/` and `research/` accumulate timestamped files (e.g., `2026-02-28T05:00:00Z_status.md`). The fix command:

1. Scans for files matching `YYYY-MM-DDT*` pattern
2. Sorts by name (newest first)
3. Keeps the 5 most recent in the active directory
4. Moves older files to `archive/` subdirectory

**When deep research is needed**, check the `archive/` subdirectory for historical data. The archival is non-destructive — files are moved, never deleted.

## Task Completion

Close the task with a summary listing what was fixed and what was flagged:

```bash
arc tasks close --id <id> --status completed --summary "fixed: 2 commits, WAL checkpoint. flagged: MEMORY.md at 95 lines"
```

If nothing needed fixing:

```bash
arc tasks close --id <id> --status completed --summary "all clean, no issues found"
```
