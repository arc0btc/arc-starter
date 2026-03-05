import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli.ts");

function arc(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", CLI, ...args]);
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

describe("arc help", () => {
  test("shows help text", () => {
    const { stdout, exitCode } = arc("help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("arc - autonomous agent CLI");
    expect(stdout).toContain("COMMANDS");
  });

  test("--help flag works", () => {
    const { stdout, exitCode } = arc("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("arc - autonomous agent CLI");
  });

  test("no args shows help", () => {
    const { stdout, exitCode } = arc();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("arc - autonomous agent CLI");
  });
});

describe("arc status", () => {
  test("shows pending and active counts", () => {
    const { stdout, exitCode } = arc("status");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pending:");
    expect(stdout).toContain("active:");
    expect(stdout).toContain("cost today:");
  });
});

describe("arc tasks", () => {
  test("lists tasks without error", () => {
    const { exitCode } = arc("tasks");
    expect(exitCode).toBe(0);
  });

  test("tasks add requires --subject", () => {
    const { stderr, exitCode } = arc("tasks", "add");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--subject is required");
  });

  test("tasks add creates a task with named flags", () => {
    const { stdout, exitCode } = arc("tasks", "add", "--subject", "test task from cli test", "--priority", "8", "--source", "test");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created task #");
    expect(stdout).toContain("test task from cli test");

    // Clean up: close the task so it doesn't pollute the queue
    const match = stdout.match(/Created task #(\d+)/);
    if (match) {
      arc("tasks", "close", "--id", match[1], "--status", "completed", "--summary", "cli test cleanup");
    }
  });

  test("tasks close requires --id", () => {
    const { stderr, exitCode } = arc("tasks", "close");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--id must be a number");
  });

  test("tasks close requires --status", () => {
    const { stderr, exitCode } = arc("tasks", "close", "--id", "999");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--status must be");
  });

  test("tasks close requires --summary", () => {
    const { stderr, exitCode } = arc("tasks", "close", "--id", "999", "--status", "completed");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--summary is required");
  });
});

describe("arc skills", () => {
  test("lists skills without error", () => {
    const { stdout, exitCode } = arc("skills");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("name");
    expect(stdout).toContain("description");
  });

  test("skills show requires --name", () => {
    const { stderr, exitCode } = arc("skills", "show");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--name is required");
  });

  test("skills show --name ceo prints content", () => {
    const { stdout, exitCode } = arc("skills", "show", "--name", "arc-ceo-strategy");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("CEO Operating Manual");
  });

  test("skills show --name nonexistent fails", () => {
    const { stderr, exitCode } = arc("skills", "show", "--name", "nonexistent");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("arc sensors", () => {
  test("sensors list works", () => {
    const { stdout, exitCode } = arc("sensors", "list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("name");
  });
});

describe("unknown commands", () => {
  test("unknown command exits with error", () => {
    const { stderr, exitCode } = arc("nonexistent");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command");
  });
});
