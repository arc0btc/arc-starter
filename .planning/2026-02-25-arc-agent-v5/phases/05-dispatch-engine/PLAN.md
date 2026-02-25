<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <goal>Implement src/dispatch.ts — the core dispatch loop that picks a task, resolves skill context, builds a prompt, calls claude via stream-JSON, and records results. Wire arc run in cli.ts to call runDispatch().</goal>
  <context>
    Arc-agent v5 is a task-based autonomous agent. The database (src/db.ts) exports:
    - getPendingTasks(), getActiveTasks(), getTaskById() — task queries
    - insertTask(), markTaskActive(), markTaskCompleted(), markTaskFailed(), requeueTask(), updateTaskCost() — task mutations
    - insertCycleLog(), updateCycleLog(), getRecentCycles() — cycle tracking
    - Task interface has: id, subject, description, skills (JSON string), priority, status, source, parent_id, attempt_count, max_retries, cost_usd, api_cost_usd, tokens_in, tokens_out

    The cli.ts has cmdRun() as a placeholder ("Dispatch not yet implemented. See Phase 5.").
    SOUL.md exists at arc-agent root. memory/MEMORY.md exists. skills/ directory has manage-skills/.
    db/ directory holds dispatch-lock.json when locked.

    V4 reference (dispatch-runner.ts) provides:
    - Stream-JSON parsing pattern (processLine function, lines 274-342)
    - Lock check/write/clear pattern (lines 577-609)
    - Auto-commit pattern (lines 613-669)
    - Cost calculation: (input/1M * 15) + (output/1M * 75) for Opus pricing

    Key v5 differences from v4:
    - No round-robin, no comms, no quests — just highest priority pending task
    - Skills resolved from task.skills JSON array field, not from task_source prefix
    - Single prompt builder (not separate buildCommPrompt/buildTaskPrompt)
    - Dual cost tracking: cost_usd (from stream-json total_cost_usd) + api_cost_usd (calculated)
    - Auto-commit stages: memory/, skills/, src/, templates/ — never .env or db/*.sqlite
    - DANGEROUS=true env var → add --dangerously-skip-permissions flag to claude spawn

    Priority ordering: tasks table uses priority ASC (1=highest) per getPendingTasks(). The phase goal says "priority DESC" — but getPendingTasks() already orders ASC (lower = higher priority). Just take first result.
  </context>

  <task id="1">
    <name>Implement src/dispatch.ts core dispatch engine</name>
    <files>
      src/dispatch.ts (create),
      src/db.ts (read — reference for imports and types),
      SOUL.md (read — loaded into prompt),
      memory/MEMORY.md (read — loaded into prompt)
    </files>
    <action>
      Create /home/whoabuddy/dev/arc0btc/arc-agent/src/dispatch.ts with these sections:

      1. IMPORTS: existsSync, readFileSync, unlinkSync, writeFileSync from node:fs; join from node:path;
         all needed db functions and types from ./db.ts.

      2. CONSTANTS:
         - ROOT = new URL("..", import.meta.url).pathname  (resolves to arc-agent/)
         - DB_DIR = join(ROOT, "db")
         - DISPATCH_LOCK_FILE = join(DB_DIR, "dispatch-lock.json")
         - SKILLS_DIR = join(ROOT, "skills")

      3. log(msg): timestamp-prefixed console.log

      4. COST CALCULATION:
         - calculateApiCostUsd(input_tokens, output_tokens): (input/1M * 15) + (output/1M * 75)

      5. DISPATCH LOCK (interface + 3 functions):
         - DispatchLock interface: { pid, task_id, started_at }
         - checkDispatchLock(): reads file, returns DispatchLock | null
         - isPidAlive(pid): process.kill(pid, 0), returns boolean
         - writeDispatchLock(task_id): writes lock with process.pid
         - clearDispatchLock(): unlinks file safely

      6. SKILL CONTEXT RESOLVER:
         - resolveSkillContext(skillsJson: string | null): string
         - Parse JSON array. For each skill name, read skills/<name>/SKILL.md.
         - Return concatenated "# Skill: <name>\n<content>\n" blocks.
         - Skip silently if file doesn't exist.

      7. PROMPT BUILDER:
         - buildPrompt(task: Task, recentCycles: string): string
         - Reads SOUL.md and memory/MEMORY.md from ROOT.
         - Sections (each separated by blank line):
           * "# Current Time\n<utc> / <mst>"
           * "# Identity\n<soul content>"
           * "# Memory\n<memory content>" (if non-empty)
           * "# Recent Cycles\n<recentCycles>" (if non-empty)
           * skill context blocks (from resolveSkillContext, if non-empty)
           * "# Task to Execute\nSubject: <subject>\nDescription: <description>\nPriority: <priority>\nSource: <source>\nTask ID: <id>"
           * If parent_id is non-null, append parent chain by walking up via getTaskById():
             "Parent chain:\n  #<id>: <subject> (status)\n  ..."
         - IMPORTANT: End prompt with CLI instruction block:
           "# Instructions\nUse `arc` CLI commands for all actions:\n- Close this task: arc tasks close <id> completed|failed \"summary\"\n- Create follow-up: arc tasks add \"subject\" --skills s1,s2 --parent <id>\n- Create a skill: arc skills run manage-skills create <name>\n- Update memory: edit memory/MEMORY.md directly\nDo NOT use raw SQL, direct DB writes, or ad-hoc scripts."

      8. STREAM-JSON DISPATCH:
         - dispatch(prompt, taskId): Promise<{result, cost_usd, api_cost_usd, input_tokens, output_tokens}>
         - Build claude args: ["claude", "--print", "--verbose", "--model", "opus",
           "--output-format", "stream-json", "--no-session-persistence"]
         - If Bun.env.DANGEROUS === "true", append "--dangerously-skip-permissions"
         - Bun.spawn with stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe"
         - processLine function (same pattern as v4 lines 274-342):
           * Parse JSON, skip malformed
           * type === "stream_event" + content_block_delta + text_delta → accumulate result
           * type === "assistant" + content array → accumulate text blocks (OpenRouter fallback)
           * type === "result" → extract total_cost_usd (prefer) or calculate from usage;
             capture input_tokens/output_tokens; fallback to result field if no text accumulated
         - Line-buffered reading: for await chunk in proc.stdout, split on "\n", process complete lines
         - After loop: flush lineBuffer, await proc.exited, throw on non-zero exit
         - Calculate api_cost_usd separately from tokens always
         - Return { result, cost_usd, api_cost_usd, input_tokens, output_tokens }

      9. AUTO-COMMIT:
         - commitCycleChanges(): Promise<void>
         - git add memory/ skills/ src/ templates/ (each separately if dir exists)
         - git diff --cached --quiet → if exit 0, nothing to commit, return
         - git diff --cached --name-only → count staged files
         - git commit -m "chore(loop): auto-commit after dispatch cycle [N file(s)]"
         - All git spawn calls use cwd: ROOT
         - Swallow errors (non-fatal)

      10. runDispatch(): Promise<void> — main entry:
          a. Lock check: read lock, if locked and PID alive → log and return early
          b. If stale lock (pid dead) → clear it
          c. Crash recovery: getActiveTasks() → markTaskFailed each with "crash recovery" message
          d. Pick task: getPendingTasks()[0]. If none → log "No pending tasks. Idle." and return
          e. Resolve skill context (used in prompt), log skill names loaded
          f. Build recentCycles string from getRecentCycles(10)
          g. Build prompt
          h. markTaskActive(task.id)
          i. writeDispatchLock(task.id)
          j. Log dispatch start
          k. Record cycle: insertCycleLog({ started_at, task_id: task.id, skills_loaded })
          l. Try: dispatch prompt → get result, cost_usd, api_cost_usd, tokens
          m. After dispatch: getTaskById(task.id) to check if LLM self-closed
             - If status !== 'active': log "task closed by LLM" + updateTaskCost()
             - If status === 'active': fallback close as completed with first 500 chars as summary
               + markTaskCompleted() + updateTaskCost()
          n. Catch errors: check attempt_count vs max_retries
             - If attempt_count < max_retries → requeueTask() + log retry
             - Else → markTaskFailed() + log exhausted
             - Never retry 403/401: check error message for these codes → always markTaskFailed
          o. Finally: clearDispatchLock()
          p. Update cycle log: completed_at, duration_ms, cost_usd, api_cost_usd, tokens_in, tokens_out
          q. commitCycleChanges()

      11. if (import.meta.main): initDatabase() then runDispatch()
    </action>
    <verify>
      bun build --target bun /home/whoabuddy/dev/arc0btc/arc-agent/src/dispatch.ts
      Should compile with no errors (no output or only build artifacts).
    </verify>
    <done>
      src/dispatch.ts exists, is substantive (>200 lines), exports runDispatch(),
      compiles cleanly with bun build --target bun.
    </done>
  </task>

  <task id="2">
    <name>Wire arc run in cli.ts and update arc status for dual cost tracking</name>
    <files>
      src/cli.ts (modify),
      src/dispatch.ts (read — verify runDispatch export)
    </files>
    <action>
      1. In src/cli.ts, replace the cmdRun() placeholder with:
         ```typescript
         async function cmdRun(): Promise<void> {
           const { initDatabase } = await import("./db.ts");
           const { runDispatch } = await import("./dispatch.ts");
           initDatabase();
           await runDispatch();
         }
         ```

      2. Update the main() function entry point to handle async cmdRun:
         Change `case "run": cmdRun(); break;` to `case "run": await cmdRun(); break;`
         Make main() async if needed and adjust the call at bottom.

      3. Update cmdStatus() to show both cost columns:
         Add a query for api_cost_usd today and display both:
         "cost today: $X.XXXX (actual) / $Y.XXXX (api est)"
         The existing costRow query uses cost_usd — add a second query or extend the first
         to also sum api_cost_usd.
    </action>
    <verify>
      bun /home/whoabuddy/dev/arc0btc/arc-agent/src/cli.ts run
      With no pending tasks, should print "No pending tasks. Idle." and exit 0.

      bun /home/whoabuddy/dev/arc0btc/arc-agent/src/cli.ts status
      Should compile and run showing both cost columns.
    </verify>
    <done>
      arc run calls runDispatch() (not a placeholder).
      arc status shows dual cost line.
      Both commands exit cleanly with no pending tasks.
    </done>
  </task>
</plan>
