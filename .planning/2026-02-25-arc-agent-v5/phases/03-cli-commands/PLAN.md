<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <goal>Implement src/cli.ts as the `arc` CLI entry point with status, tasks, run, skills, and help subcommands. The CLI is the primary interface for humans and Arc itself to interact with the task system.</goal>
  <context>
    Phase 2 delivered src/db.ts with full task and cycle_log CRUD. The relevant exports for the CLI are:
    - initDatabase(), getDatabase() for DB setup
    - insertTask(InsertTask): number for creating tasks
    - getTaskById(id): Task | null
    - getPendingTasks(), getActiveTasks() for status counts
    - markTaskCompleted(id, summary), markTaskFailed(id, summary) for close
    - getRecentCycles(limit) for last cycle info
    - Task interface with: id, priority, status, subject, source, created_at fields
    - CycleLog interface with: started_at, completed_at, duration_ms, cost_usd fields

    package.json already declares "arc": "./src/cli.ts" in both bin and scripts.
    tsconfig: strict mode, ESNext, bun-types.

    The DB is opened relative to cwd as "db/arc.sqlite". initDatabase() handles mkdirSync automatically.

    No arg-parsing library. Parse process.argv[2..] manually. Output to stdout; errors to stderr + exit(1).
  </context>

  <task id="1">
    <name>Implement src/cli.ts with all subcommands</name>
    <files>src/cli.ts, src/db.ts (read only)</files>
    <action>
      Create /home/whoabuddy/dev/arc0btc/arc-agent/src/cli.ts with:

      1. Shebang: `#!/usr/bin/env bun`
      2. Import initDatabase and all needed db functions from "./db.ts"
      3. A main() function dispatching on process.argv[2]:
         - "status" -> cmdStatus()
         - "tasks" -> cmdTasks(argv.slice(3))
         - "run" -> cmdRun()
         - "skills" -> cmdSkills()
         - "help" | "--help" | "-h" | undefined -> cmdHelp()
         - unknown -> print to stderr + cmdHelp() + process.exit(1)

      4. cmdStatus():
         - Call initDatabase()
         - Query pending count: getPendingTasks().length
         - Query active count: getActiveTasks().length
         - Query last cycle: getRecentCycles(1)[0] or null
         - Query today's total cost: sum of cost_usd from tasks where date(created_at) = date('now')
         - Print compact lines:
           "pending: N  active: N"
           "last cycle: TIMESTAMP (DURATIONms)" or "last cycle: none"
           "cost today: $N.NNNN"
           "sensors: unknown"

      5. cmdTasks(args: string[]):
         - If args[0] === "add": cmdTasksAdd(args.slice(1))
         - If args[0] === "close": cmdTasksClose(args.slice(1))
         - Otherwise: cmdTasksList(args)

      6. cmdTasksList(args: string[]):
         - Parse --status STATUS and --limit N from args
         - Default: query both pending and active (WHERE status IN ('pending','active'))
         - If --status given: filter to that status
         - Default limit: 20
         - Use getDatabase() with a raw SQL query for flexibility
         - If no results: print "No tasks found."
         - Otherwise print header + rows:
           "id  priority  status     subject                          source        created_at"
           Truncate subject to 32 chars, source to 12 chars, created_at to 16 chars (YYYY-MM-DD HH:MM)

      7. cmdTasksAdd(args: string[]):
         - args[0] is the subject (positional, required)
         - Parse: --description TEXT, --priority N, --source TEXT, --skills SKILL1,SKILL2, --parent ID
         - skills comes in as comma-separated string, stored as JSON array string
         - Call initDatabase() then insertTask(...)
         - Print: "Created task #N: SUBJECT"

      8. cmdTasksClose(args: string[]):
         - args[0] = ID (number), args[1] = status ("completed"|"failed"), args[2] = summary
         - Validate: ID must be numeric, status must be completed or failed, summary required
         - Call initDatabase() then markTaskCompleted or markTaskFailed
         - Print: "Closed task #N as STATUS"

      9. cmdRun():
         - Print: "Dispatch not yet implemented. See Phase 5."

      10. cmdSkills():
          - Print: "Skills not yet implemented. See Phase 4."

      11. cmdHelp():
          - Print multi-line usage string covering all commands and flags

      Helper: parseFlags(args: string[]) -> { flags: Record&lt;string, string&gt;, positional: string[] }
      Iterates args; if arg starts with "--" and next arg doesn't start with "--", consume as key=value pair; else key=true; non-"--" args go to positional.
    </action>
    <verify>
      cd /home/whoabuddy/dev/arc0btc/arc-agent
      bun src/cli.ts help
      bun src/cli.ts status
      bun src/cli.ts tasks
      bun src/cli.ts tasks add "Test task" --priority 8
      bun src/cli.ts tasks
      bun src/cli.ts tasks close 1 completed "Done"
      bun src/cli.ts tasks --status completed
      bun src/cli.ts run
      bun src/cli.ts skills
      bun src/cli.ts unknowncmd  (should exit 1 with error)
    </verify>
    <done>
      All verification commands pass. status shows zeros initially. tasks add creates a task and shows its ID. tasks lists it. tasks close updates it. Placeholder commands print expected messages.
    </done>
  </task>

  <task id="2">
    <name>Cleanup test data and verify fresh DB state</name>
    <files>db/arc.sqlite</files>
    <action>
      After all verification passes, remove db/arc.sqlite so the database is fresh for phase 4.
      Verify the file is gone with `ls db/` or check it recreates cleanly on next run.
    </action>
    <verify>
      ls /home/whoabuddy/dev/arc0btc/arc-agent/db/ should show no arc.sqlite
      bun src/cli.ts status  -- should still work (recreates db)
      rm again so db is clean for phase 4
    </verify>
    <done>db/arc.sqlite does not exist after cleanup.</done>
  </task>
</plan>
