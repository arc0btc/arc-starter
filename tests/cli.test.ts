import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli.ts");

function arc(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bun", [CLI, ...args], { encoding: "utf-8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
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
    const { stdout, exitCode } = arc("skills", "show", "--name", "ceo");
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
