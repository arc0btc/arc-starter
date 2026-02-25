<plan>
  <goal>Implement src/db.ts with complete schema (tasks, cycle_log), all types, and all query/mutation functions so that the rest of the system has a working data layer.</goal>
  <context>
    The project skeleton was created in phase 1: package.json, tsconfig.json, CLAUDE.md with full DDL,
    SOUL.md, memory/MEMORY.md, .gitignore, and all required directories (db/, src/, skills/, etc.).

    The v4 reference at ~/arc0btc/src/db.ts shows the key patterns to follow:
    - Singleton `_db` variable initialized to null
    - `initDatabase()` sets WAL mode, creates tables with CREATE TABLE IF NOT EXISTS, assigns _db
    - `getDatabase()` throws if _db is null
    - `toSqliteDatetime(date: Date)` converts ISO to "YYYY-MM-DD HH:MM:SS" format
    - Dedup via `taskExistsForSource()` checks any status (not just pending)
    - Uses `bun:sqlite` directly — no external packages needed
    - `if (import.meta.main)` gates the smoke test

    The v5 schema differs from v4:
    - New columns: skills (JSON array), parent_id (FK self-ref), template, api_cost_usd, tokens_in/tokens_out
    - Renamed: cost split into cost_usd + api_cost_usd; input_tokens -> tokens_in; output_tokens -> tokens_out
    - cycle_log: simplified — id (not cycle_id), completed_at (not ended_at), duration_ms (not dispatch_duration_ms), skills_loaded column
    - priority: 1-10 scale (v5) vs 1-100 scale (v4)
    - status: simpler set — pending|active|completed|failed|blocked (no blocked-whoabuddy variants)

    Runtime: Bun only. Use bun:sqlite, not better-sqlite3.
    TypeScript: strict mode, explicit return types, no `any`.
    Column naming: verbose (started_at not start, tokens_in not in).
  </context>

  <task id="1">
    <name>Implement src/db.ts — types, schema, all functions, smoke test</name>
    <files>src/db.ts</files>
    <action>
      Create /home/whoabuddy/dev/arc0btc/arc-agent/src/db.ts with the following structure:

      1. IMPORTS: `import { Database } from "bun:sqlite"` and `import { mkdirSync } from "node:fs"`.

      2. TYPES (all exported):
         - `Task` interface matching the tasks table columns exactly (id, subject, description, skills,
           priority, status, source, parent_id, template, scheduled_for, created_at, started_at,
           completed_at, result_summary, result_detail, cost_usd, api_cost_usd, tokens_in, tokens_out,
           attempt_count, max_retries). Nullable fields use `string | null` etc.
         - `InsertTask` interface: subject is required (string), all other task fields optional.
         - `CycleLog` interface matching cycle_log columns (id, task_id, started_at, completed_at,
           duration_ms, cost_usd, api_cost_usd, tokens_in, tokens_out, skills_loaded).
         - `InsertCycleLog` interface: started_at required, task_id and skills_loaded optional.

      3. SINGLETON: `let _db: Database | null = null;`

      4. DATABASE LIFECYCLE:
         - `initDatabase(): Database` — if _db not null return it; mkdirSync("db", {recursive: true});
           new Database("db/arc.sqlite"); PRAGMA WAL; CREATE TABLE IF NOT EXISTS tasks (exact DDL from
           CLAUDE.md); CREATE TABLE IF NOT EXISTS cycle_log (exact DDL from CLAUDE.md); assign _db; return db.
         - `getDatabase(): Database` — return _db or throw "Database not initialized. Call initDatabase() first."

      5. HELPER: `toSqliteDatetime(date: Date): string` — `date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")`

      6. TASK QUERIES (all use getDatabase(), return proper types):
         - `getPendingTasks(): Task[]` — WHERE status='pending' AND (scheduled_for IS NULL OR
           datetime(scheduled_for) <= datetime('now')), ORDER BY priority ASC, id ASC
           (priority 1 = highest, so ASC gives highest priority first)
         - `getActiveTasks(): Task[]` — WHERE status='active' ORDER BY id ASC
         - `getTaskById(id: number): Task | null`
         - `getTasksByParent(parentId: number): Task[]` — WHERE parent_id = ? ORDER BY id ASC
         - `taskExistsForSource(source: string): boolean` — SELECT 1 WHERE source = ? LIMIT 1, return row !== null

      7. TASK MUTATIONS:
         - `insertTask(fields: InsertTask): number` — build INSERT with all provided fields, return lastInsertRowid.
           Required: subject. Optional fields with defaults: priority=5, status='pending'.
           Normalize scheduled_for via toSqliteDatetime if provided.
         - `markTaskActive(id: number): void` — UPDATE status='active', started_at=datetime('now'),
           attempt_count=attempt_count+1
         - `markTaskCompleted(id: number, summary: string, detail?: string): void` — UPDATE status='completed',
           completed_at=datetime('now'), result_summary=?, result_detail=?
         - `markTaskFailed(id: number, summary: string): void` — UPDATE status='failed',
           completed_at=datetime('now'), result_summary=?
         - `markTaskBlocked(id: number, reason: string): void` — UPDATE status='blocked', result_summary=?
         - `requeueTask(id: number): void` — UPDATE status='pending', started_at=NULL
         - `updateTaskCost(id: number, cost: number, apiCost: number, tokensIn: number, tokensOut: number): void`
           — UPDATE cost_usd=?, api_cost_usd=?, tokens_in=?, tokens_out=?

      8. CYCLE LOG:
         - `insertCycleLog(entry: InsertCycleLog): number` — INSERT started_at + optional fields, return id
         - `updateCycleLog(id: number, fields: Partial<CycleLog>): void` — dynamic SET from fields,
           skip undefined values (same pattern as v4 updateCycleLog)
         - `getRecentCycles(limit: number = 10): CycleLog[]` — ORDER BY started_at DESC LIMIT ?

      9. SMOKE TEST gated by `if (import.meta.main)`:
         - initDatabase() and log "Database initialized"
         - insertTask({ subject: "smoke-test", description: "Verify db init works", source: "test" })
         - getTaskById(id) and assert not null, log subject
         - insertCycleLog({ started_at: toSqliteDatetime(new Date()), task_id: taskId })
         - getRecentCycles(1) and log count
         - Log "Smoke test passed."
         - db.close()
    </action>
    <verify>
      Run: `cd /home/whoabuddy/dev/arc0btc/arc-agent && bun src/db.ts`
      Expected output includes:
        - "Database initialized"
        - "Smoke test passed."
      Then: `ls /home/whoabuddy/dev/arc0btc/arc-agent/db/arc.sqlite`
      Expected: file exists
    </verify>
    <done>
      src/db.ts exists, is substantive (not a stub), exports all required types and functions,
      smoke test runs successfully when invoked directly, db/arc.sqlite is created.
    </done>
  </task>
</plan>
