import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    subject TEXT NOT NULL,
    description TEXT,
    skills TEXT,
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'pending',
    source TEXT,
    parent_id INTEGER,
    template TEXT,
    scheduled_for TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    result_summary TEXT,
    result_detail TEXT,
    cost_usd REAL DEFAULT 0,
    api_cost_usd REAL DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    attempt_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    FOREIGN KEY (parent_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS cycle_log (
    id INTEGER PRIMARY KEY,
    task_id INTEGER,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    cost_usd REAL DEFAULT 0,
    api_cost_usd REAL DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    skills_loaded TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
`;

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.run("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
});

afterEach(() => {
  db.close();
});

describe("tasks table", () => {

  test("insert and retrieve a task", () => {
    const result = db
      .query("INSERT INTO tasks (subject, source) VALUES (?, ?)")
      .run("test task", "human");
    const id = Number(result.lastInsertRowid);
    expect(id).toBeGreaterThan(0);

    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
    expect(task.subject).toBe("test task");
    expect(task.source).toBe("human");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe(5);
  });

  test("default values are set correctly", () => {
    db.query("INSERT INTO tasks (subject) VALUES (?)").run("defaults test");
    const task = db.query("SELECT * FROM tasks WHERE id = 1").get() as Record<string, unknown>;
    expect(task.priority).toBe(5);
    expect(task.status).toBe("pending");
    expect(task.cost_usd).toBe(0);
    expect(task.api_cost_usd).toBe(0);
    expect(task.tokens_in).toBe(0);
    expect(task.tokens_out).toBe(0);
    expect(task.attempt_count).toBe(0);
    expect(task.max_retries).toBe(3);
  });

  test("skills column stores JSON array", () => {
    const skills = JSON.stringify(["ceo", "manage-skills"]);
    db.query("INSERT INTO tasks (subject, skills) VALUES (?, ?)").run("skill test", skills);
    const task = db.query("SELECT * FROM tasks WHERE id = 1").get() as Record<string, unknown>;
    expect(JSON.parse(task.skills as string)).toEqual(["ceo", "manage-skills"]);
  });

  test("getPendingTasks query respects scheduled_for", () => {
    // Task scheduled in the future — should NOT appear
    db.query("INSERT INTO tasks (subject, scheduled_for) VALUES (?, datetime('now', '+1 hour'))").run("future task");
    // Task scheduled in the past — should appear
    db.query("INSERT INTO tasks (subject, scheduled_for) VALUES (?, datetime('now', '-1 hour'))").run("past task");
    // Task with no schedule — should appear
    db.query("INSERT INTO tasks (subject) VALUES (?)").run("unscheduled task");

    const pending = db
      .query(
        "SELECT * FROM tasks WHERE status = 'pending' AND (scheduled_for IS NULL OR datetime(scheduled_for) <= datetime('now')) ORDER BY priority ASC, id ASC"
      )
      .all() as Array<Record<string, unknown>>;

    expect(pending.length).toBe(2);
    expect(pending[0].subject).toBe("past task");
    expect(pending[1].subject).toBe("unscheduled task");
  });

  test("markTaskCompleted updates status and timestamps", () => {
    db.query("INSERT INTO tasks (subject) VALUES (?)").run("complete me");
    db.query(
      "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), result_summary = ? WHERE id = ?"
    ).run("done", 1);

    const task = db.query("SELECT * FROM tasks WHERE id = 1").get() as Record<string, unknown>;
    expect(task.status).toBe("completed");
    expect(task.result_summary).toBe("done");
    expect(task.completed_at).not.toBeNull();
  });

  test("pendingTaskExistsForSource dedup query", () => {
    db.query("INSERT INTO tasks (subject, source) VALUES (?, ?)").run("sensor task", "sensor:heartbeat");

    const exists = db
      .query("SELECT 1 FROM tasks WHERE source = ? AND status IN ('pending', 'active') LIMIT 1")
      .get("sensor:heartbeat");
    expect(exists).not.toBeNull();

    const notExists = db
      .query("SELECT 1 FROM tasks WHERE source = ? AND status IN ('pending', 'active') LIMIT 1")
      .get("sensor:nonexistent");
    expect(notExists).toBeNull();
  });

  test("parent_id foreign key works", () => {
    db.query("INSERT INTO tasks (subject) VALUES (?)").run("parent");
    db.query("INSERT INTO tasks (subject, parent_id) VALUES (?, ?)").run("child", 1);

    const child = db.query("SELECT * FROM tasks WHERE id = 2").get() as Record<string, unknown>;
    expect(child.parent_id).toBe(1);
  });
});

describe("cycle_log table", () => {
  test("insert and retrieve a cycle log entry", () => {
    const result = db
      .query("INSERT INTO cycle_log (started_at, task_id) VALUES (?, ?)")
      .run("2026-02-26 12:00:00", 1);
    const id = Number(result.lastInsertRowid);
    expect(id).toBeGreaterThan(0);

    const cycle = db.query("SELECT * FROM cycle_log WHERE id = ?").get(id) as Record<string, unknown>;
    expect(cycle.started_at).toBe("2026-02-26 12:00:00");
    expect(cycle.task_id).toBe(1);
  });

  test("update cycle log with cost data", () => {
    db.query("INSERT INTO cycle_log (started_at) VALUES (?)").run("2026-02-26 12:00:00");
    db.query(
      "UPDATE cycle_log SET completed_at = ?, duration_ms = ?, cost_usd = ?, api_cost_usd = ?, tokens_in = ?, tokens_out = ? WHERE id = ?"
    ).run("2026-02-26 12:01:00", 60000, 0.05, 0.03, 1000, 500, 1);

    const cycle = db.query("SELECT * FROM cycle_log WHERE id = 1").get() as Record<string, unknown>;
    expect(cycle.duration_ms).toBe(60000);
    expect(cycle.cost_usd).toBe(0.05);
    expect(cycle.tokens_in).toBe(1000);
  });
});
