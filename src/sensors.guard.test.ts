import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMidGitOperation, checkRuntimeCanary } from "./sensors.ts";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "arc-sensors-guard-"));
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) {
    const d = cleanups.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe("detectMidGitOperation", () => {
  test("clean repo → null", () => {
    const dir = tempRepo(); cleanups.push(dir);
    expect(detectMidGitOperation(dir)).toBeNull();
  });

  test("MERGE_HEAD present → merge in progress", () => {
    const dir = tempRepo(); cleanups.push(dir);
    writeFileSync(join(dir, ".git/MERGE_HEAD"), "abc\n");
    expect(detectMidGitOperation(dir)).toBe("merge in progress");
  });

  test("CHERRY_PICK_HEAD → cherry-pick in progress", () => {
    const dir = tempRepo(); cleanups.push(dir);
    writeFileSync(join(dir, ".git/CHERRY_PICK_HEAD"), "abc\n");
    expect(detectMidGitOperation(dir)).toBe("cherry-pick in progress");
  });

  test("rebase-merge dir → interactive rebase in progress", () => {
    const dir = tempRepo(); cleanups.push(dir);
    mkdirSync(join(dir, ".git/rebase-merge"), { recursive: true });
    expect(detectMidGitOperation(dir)).toBe("interactive rebase in progress");
  });

  test("non-repo (no .git) → null (don't block non-git contexts)", () => {
    const dir = mkdtempSync(join(tmpdir(), "arc-sensors-guard-nogit-"));
    cleanups.push(dir);
    expect(detectMidGitOperation(dir)).toBeNull();
  });
});

describe("checkRuntimeCanary", () => {
  test("missing file → not ok", () => {
    const dir = tempRepo(); cleanups.push(dir);
    const r = checkRuntimeCanary(join(dir, ".arc-runtime"), "loom");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("missing");
  });

  test("matching content → ok", () => {
    const dir = tempRepo(); cleanups.push(dir);
    writeFileSync(join(dir, ".arc-runtime"), "loom\n");
    expect(checkRuntimeCanary(join(dir, ".arc-runtime"), "loom").ok).toBe(true);
  });

  test("mismatched content → not ok with token in reason", () => {
    const dir = tempRepo(); cleanups.push(dir);
    writeFileSync(join(dir, ".arc-runtime"), "arc\n");
    const r = checkRuntimeCanary(join(dir, ".arc-runtime"), "loom");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("loom");
      expect(r.reason).toContain("arc");
    }
  });
});
