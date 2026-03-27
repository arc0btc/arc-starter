# ARC-0003: DB Migration Protocol

| Field | Value |
|-------|-------|
| ARC | 0003 |
| Title | DB Migration Protocol |
| Author | Arc, whoabuddy |
| Status | Draft |
| Created | 2026-03-20 |
| Requires | — |
| Replaces | — |

---

## Context

Arc stores all operational state in a SQLite database (`db/arc.sqlite`). The schema currently spans 14 tables across core dispatch (tasks, cycle_log), communication (email_messages, aibtc_inbox_messages, fleet_messages), workflows, market positions, monitoring, dependencies, service logs, and governance (roundtable, consensus).

Today, schema evolution is handled inline in `src/db.ts:initDatabase()`:

- Initial tables use `CREATE TABLE IF NOT EXISTS` — safe and idempotent.
- Column additions use a `addColumn()` helper that catches "duplicate column name" errors — safe but untracked.
- No migration versioning, ordering guarantees, rollback mechanism, or integrity validation exists.

This works for a single developer iterating on one instance. It breaks when:

1. **Skills ship as submodules.** A skill may add tables or columns. Without versioning, there's no way to know which migrations a given instance has applied.
2. **Blank-slate provisioning.** New agent instances need to go from zero to current schema reliably. The current approach works only because all DDL runs on every startup — but this becomes fragile as migration count grows and includes data transforms.
3. **Data-altering migrations.** Column renames, type changes, or data backfills can't be expressed as `addColumn()` calls. These require ordered execution and rollback capability.
4. **Instance divergence.** Multiple instances sharing the same codebase but running independently can drift into incompatible schema states with no way to detect or reconcile.

## Motivation

The cost of the current approach increases with every table and every agent instance. A failed migration today silently corrupts state or — worse — succeeds partially, leaving the database in an undefined state that only surfaces as runtime errors hours later.

The cost of this proposal is low: it formalizes what's already implicit (ordered DDL execution) and adds safety rails (manifests, rollback, alerts) that prevent the class of bugs that are hardest to debug in a 24/7 autonomous system.

If we do nothing: each new skill that touches the schema is a gamble. Each `addColumn()` call is technical debt that compounds.

## Proposal

### Migration file format

Migrations live in `db/migrations/` as numbered TypeScript files:

```
db/migrations/
  0001_initial_schema.ts
  0002_add_task_model_column.ts
  0003_add_monitored_endpoints.ts
  ...
```

Each migration exports a standard interface:

```typescript
import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  up(db: Database): void;
  down(db: Database): void;
}
```

Example:

```typescript
import type { Database } from "bun:sqlite";
import type { Migration } from "../../src/migrate.ts";

export default {
  version: 2,
  name: "add_task_model_column",
  up(db: Database): void {
    db.run("ALTER TABLE tasks ADD COLUMN model TEXT");
  },
  down(db: Database): void {
    // SQLite doesn't support DROP COLUMN before 3.35.0.
    // For destructive rollbacks, rebuild the table without the column.
    // For non-destructive rollbacks, this can be a no-op with a comment.
    // Bun's SQLite is >= 3.38, so DROP COLUMN works.
    db.run("ALTER TABLE tasks DROP COLUMN model");
  },
} satisfies Migration;
```

**Rules:**

- `version` MUST match the numeric prefix of the filename.
- `up()` MUST be idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`).
- `down()` MUST exist. If a migration is truly irreversible (data deletion), `down()` throws with a clear message explaining why.
- Migrations MUST NOT import application code. They operate on raw SQL only. Application types and helpers change over time; migration files are frozen at the point of creation.
- One logical change per migration. Don't combine table creation with data backfill.

### Version tracking table

A new `schema_migrations` table tracks applied migrations:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now')),
  schema_hash TEXT NOT NULL,
  row_manifest TEXT NOT NULL
);
```

- `version`: matches the migration file's numeric prefix.
- `schema_hash`: SHA-256 of the full `sqlite_master` DDL after applying the migration. Enables drift detection.
- `row_manifest`: JSON object of `{ table_name: row_count }` captured immediately after migration. Enables integrity comparison.

### Three-phase execution

Every migration run follows three phases. The entire run is wrapped in a SQLite transaction.

#### Phase 1: Prep / Review

Before executing any migration:

1. **Discover** pending migrations: scan `db/migrations/`, compare against `schema_migrations` table. Identify the ordered set of unapplied migrations.
2. **Validate** each pending migration:
   - File parses without error (`Bun.build` or dynamic import).
   - `version` field matches filename prefix.
   - Both `up()` and `down()` are defined functions.
   - `version` is strictly greater than the highest applied version (no gaps, no reordering).
3. **Capture pre-migration manifest**: schema hash + row counts for all tables.
4. **Log** the planned migration set to `service_logs` (level: `info`, service: `migration`).

If validation fails, the run aborts. No migrations execute. A **P1 alert task** is created:

```
arc tasks add --subject "Migration validation failed: [reason]" --priority 1 --skills arc-skill-manager
```

#### Phase 2: Execute + Snapshot

For each pending migration, in version order:

1. **Begin transaction** (if not already in one — SQLite supports savepoints for nested transactions).
2. **Execute** `migration.up(db)`.
3. **Capture post-migration snapshot**:
   - `schema_hash`: SHA-256 of `SELECT sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name`.
   - `row_manifest`: `SELECT name FROM sqlite_master WHERE type='table'` then `SELECT COUNT(*) FROM <table>` for each.
4. **Record** in `schema_migrations`:
   ```sql
   INSERT INTO schema_migrations (version, name, applied_at, schema_hash, row_manifest)
   VALUES (?, ?, datetime('now'), ?, ?)
   ```
5. **Commit savepoint**.

If `up()` throws:

1. **Rollback** the savepoint.
2. **Abort** the entire migration run (don't attempt remaining migrations).
3. **Create P1 alert task** with the error message and stack trace.
4. **Log** to `service_logs` (level: `error`).

#### Phase 3: Integrity Check

After all migrations in the batch complete:

1. **Capture final manifest**: schema hash + row counts.
2. **Compare** against the expected state (the snapshot from the last migration in the batch).
3. **If mismatch**:
   - Execute `down()` for each migration in the batch, in reverse order.
   - Verify rollback restored the pre-migration manifest.
   - Create P1 alert task: `"Migration integrity check failed: [details]"`.
   - Log the full diff (expected vs. actual manifest) to `service_logs`.
4. **If match**: migration run is successful. Log completion.

### Integration with dispatch

Migrations run at **`initDatabase()` time**, before any dispatch cycle or sensor run. This means:

- Migrations block startup. A failed migration prevents dispatch from running — this is intentional. Better to halt than to run against a corrupt schema.
- The migration runner replaces the current inline `addColumn()` calls. Existing migrations are consolidated into `0001_initial_schema.ts`.
- Sensors and dispatch see a consistent schema on every run.

### Integration with skills

Skills that need schema changes:

1. Ship a migration file in their skill directory: `skills/<name>/migrations/NNNN_description.ts`.
2. The migration runner discovers these alongside `db/migrations/` and merges them into the global version sequence.
3. Skill migrations MUST use version numbers in a reserved range to avoid collisions. Convention: core migrations use `0001-4999`, skill migrations use `5000-9999` with a skill-specific offset.

**Alternative (simpler):** Skills submit migration files to `db/migrations/` during installation. The migration runner only looks in one place. This avoids the complexity of multi-directory discovery and version range allocation.

The simpler approach is recommended for initial implementation. Multi-directory discovery can be added later if skill count warrants it.

### CLI integration

```
arc db status                  # show current schema version, pending migrations
arc db migrate                 # run pending migrations (prep + execute + check)
arc db rollback [--to N]       # roll back to version N (default: previous version)
arc db manifest                # print current schema hash + row counts
```

### Rollback constraints

SQLite limitations affect rollback fidelity:

- **DROP COLUMN** requires SQLite >= 3.35.0. Bun bundles >= 3.38, so this works.
- **Data loss** on rollback is expected for additive migrations (new tables, new columns). The `down()` function drops what `up()` added. Data in those columns/tables is lost.
- **Data-transform migrations** (backfills, renames) require `down()` to reverse the transform. If reversal would lose data, `down()` MUST throw rather than silently corrupt.
- **Irreversible migrations** are permitted but MUST be explicitly marked. `down()` throws `new Error("Irreversible: [reason]")`. The rollback runner stops at irreversible boundaries and alerts.

## Backward Compatibility

**Nothing breaks.** The migration is from implicit (inline DDL) to explicit (migration files). The transition:

1. Consolidate all existing `CREATE TABLE` and `addColumn()` calls into `0001_initial_schema.ts`.
2. On first run with the new system, `schema_migrations` table is created. If the database already exists (has tables), migration `0001` is marked as applied without re-executing (bootstrap detection: if `tasks` table exists, version 1 is already applied).
3. Subsequent migrations proceed normally.

Existing databases are unaffected. New databases get the same schema through the migration chain. No data loss, no downtime.

## Alternatives Considered

**1. Continue with `addColumn()` pattern.**
Rejected: no versioning, no rollback, no integrity checks. Adequate for prototyping, inadequate for a 24/7 autonomous agent.

**2. Use an ORM migration framework (Drizzle, Prisma).**
Rejected: adds a dependency for a problem that's solvable with ~200 lines of TypeScript. Arc's schema is simple enough that raw SQL migrations are clearer and more portable. ORMs also obscure the actual DDL, making integrity checks harder.

**3. Store migrations in the database itself (as SQL text).**
Rejected: migrations should be version-controlled in git, not stored in the database they modify. The database tracks *which* migrations have been applied; the migration *code* lives in the repo.

**4. Use sequential timestamps instead of numeric prefixes.**
Rejected: numeric prefixes enforce a strict total order. Timestamps allow parallel migration creation that can collide. Numeric prefixes make version gaps and reordering immediately visible.

## Open Questions

1. **Skill migration versioning**: Should skills use a reserved numeric range (5000+), or should all migrations live in `db/migrations/` with a flat sequence? The flat approach is simpler but requires coordination when multiple skills add migrations.

2. **Automatic vs. manual execution**: Should migrations auto-run on startup (current proposal) or require explicit `arc db migrate`? Auto-run is simpler for autonomous operation but more dangerous for irreversible migrations.

3. **Test harness**: Should the migration runner support a `--dry-run` flag that validates and simulates without committing? Useful for CI but adds complexity.

## References

- `src/db.ts` — Current schema initialization and inline migrations
- `templates/arc-proposal.md` — ARC proposal format
- Task #7745 — Parent task: email reply to whoabuddy about DB migration flow
- Task #7746 — This RFC drafting task
- SQLite ALTER TABLE documentation: column additions, DROP COLUMN (>= 3.35.0)
- Arc CLAUDE.md — Architecture reference (task queue, dispatch, sensors, skills)
