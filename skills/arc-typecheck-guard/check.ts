/**
 * Core type-check baseline logic shared by sensor.ts and cli.ts.
 *
 * Runs `tsc --noEmit` and compares per-file error counts against a persisted
 * baseline (db/tsc-baseline.json). Only errors in files touched by an unattended
 * `chore(loop): auto-commit` — and only counts that INCREASED over baseline — are
 * treated as regressions. This ignores the ~50 pre-existing project errors and
 * catches exactly the failure mode from #22717, where a transpile-clean-but
 * -type-broken sensor shipped via the auto-commit fallback and threw at runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const BASELINE_PATH = join(ROOT, "db", "tsc-baseline.json");
const AUTO_COMMIT_PREFIX = "chore(loop): auto-commit after dispatch cycle";

/** Persisted baseline: HEAD we last checked and the per-file error counts there. */
export interface Baseline {
  lastCheckedSha: string | null;
  errorCounts: Record<string, number>; // repo-relative file path -> tsc error count
  updatedAt: string;
}

/** Result of one tsc invocation. `ran` is false only when tsc could not execute at all. */
export interface TscResult {
  ran: boolean;
  counts: Record<string, number>;
  errorLines: string[]; // raw "file(l,c): error TSxxxx: ..." diagnostic lines
}

export type GuardStatus =
  | "skip" // HEAD unchanged since last check, or git unavailable
  | "seeded" // first ever run — baseline established, nothing flagged
  | "advanced" // only reviewed/human commits in range — pointer advanced, no tsc run
  | "clean" // auto-commits present, no new type errors
  | "regressions" // auto-commits introduced new type errors
  | "tsc-unavailable"; // tsc binary missing or crashed

export interface Regression {
  file: string;
  before: number;
  after: number;
  lines: string[];
}

export interface GuardOutcome {
  status: GuardStatus;
  head?: string;
  regressions?: Regression[];
}

/** Spawn a git command in the repo root, capturing output. */
async function git(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/** Current HEAD commit SHA, or null if git fails. */
export async function getHeadSha(): Promise<string | null> {
  const { exitCode, stdout } = await git("rev-parse", "HEAD");
  if (exitCode !== 0) return null;
  return stdout.trim() || null;
}

/** Load the persisted baseline, or a fresh empty one if absent/corrupt. */
export function loadBaseline(): Baseline {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Partial<Baseline>;
    return {
      lastCheckedSha: parsed.lastCheckedSha ?? null,
      errorCounts: parsed.errorCounts ?? {},
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return { lastCheckedSha: null, errorCounts: {}, updatedAt: "" };
  }
}

/** Persist the baseline to db/tsc-baseline.json. */
export async function saveBaseline(baseline: Baseline): Promise<void> {
  await Bun.write(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
}

/**
 * Run `tsc --noEmit` once over the whole project and parse errors by file.
 * tsc exits non-zero when it reports type errors — that is expected, not a failure.
 * A non-zero exit with NO diagnostic lines means tsc itself could not run.
 */
export async function runTsc(): Promise<TscResult> {
  const bin = join(ROOT, "node_modules", ".bin", "tsc");
  if (!existsSync(bin)) return { ran: false, counts: {}, errorLines: [] };

  const proc = Bun.spawn([bin, "--noEmit", "-p", join(ROOT, "tsconfig.json")], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const combined = stdout + "\n" + stderr;
  const errorLines = combined.split("\n").filter((line) => /error TS\d+/.test(line));

  // No diagnostics but a non-zero exit → tsc crashed / bad invocation, not a clean tree.
  if (errorLines.length === 0 && exitCode !== 0) {
    return { ran: false, counts: {}, errorLines: [] };
  }

  const counts: Record<string, number> = {};
  for (const line of errorLines) {
    const match = line.match(/^\s*(.+?)\(\d+,\d+\):\s+error TS\d+/);
    if (!match) continue;
    let file = match[1].trim();
    if (file.startsWith(ROOT)) file = file.slice(ROOT.length);
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return { ran: true, counts, errorLines };
}

/**
 * Repo-relative .ts files under src/ or skills/ that were changed by an unattended
 * auto-commit in the range (fromSha, toSha]. Reviewed/human commits are ignored —
 * those go through code-review + CI, so they are not this guard's concern.
 */
export async function autoCommitTsFiles(fromSha: string, toSha: string): Promise<string[]> {
  const { exitCode, stdout } = await git("log", "--format=%H%x1f%s", `${fromSha}..${toSha}`);
  if (exitCode !== 0) return [];

  const files = new Set<string>();
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [sha, subject] = line.split("\x1f");
    if (!sha || !subject?.startsWith(AUTO_COMMIT_PREFIX)) continue;

    const diff = await git("diff", "--name-only", `${sha}~1`, sha);
    if (diff.exitCode !== 0) continue;
    for (const file of diff.stdout.trim().split("\n").filter(Boolean)) {
      if (file.endsWith(".ts") && (file.startsWith("src/") || file.startsWith("skills/"))) {
        files.add(file);
      }
    }
  }
  return [...files];
}

/**
 * Full guard pass. Detects type errors introduced by unattended auto-commits since
 * the last checked HEAD. Refreshes the baseline whenever it runs tsc, so reviewed
 * fixes lower it and confirmed regressions are not re-flagged. Pure logic — the
 * caller (sensor/cli) decides how to surface the outcome.
 */
export async function runGuard(): Promise<GuardOutcome> {
  const head = await getHeadSha();
  if (!head) return { status: "skip" };

  const baseline = loadBaseline();

  // First ever run: establish the baseline, flag nothing.
  if (!baseline.lastCheckedSha) {
    const tsc = await runTsc();
    if (!tsc.ran) return { status: "tsc-unavailable" };
    await saveBaseline({ lastCheckedSha: head, errorCounts: tsc.counts, updatedAt: nowIso() });
    return { status: "seeded", head };
  }

  if (baseline.lastCheckedSha === head) return { status: "skip" };

  const autoFiles = await autoCommitTsFiles(baseline.lastCheckedSha, head);
  if (autoFiles.length === 0) {
    // Trusted range (reviewed/human commits only). Advance the pointer without
    // running tsc; the frequent auto-commit path keeps counts fresh.
    await saveBaseline({ ...baseline, lastCheckedSha: head });
    return { status: "advanced", head };
  }

  const tsc = await runTsc();
  if (!tsc.ran) return { status: "tsc-unavailable" };

  const regressions: Regression[] = [];
  for (const file of autoFiles) {
    const before = baseline.errorCounts[file] ?? 0;
    const after = tsc.counts[file] ?? 0;
    if (after > before) {
      regressions.push({
        file,
        before,
        after,
        lines: tsc.errorLines.filter((line) => line.includes(file)),
      });
    }
  }

  // Refresh the full baseline to current so we do not re-flag and so reviewed
  // fixes elsewhere in the tree are absorbed.
  await saveBaseline({ lastCheckedSha: head, errorCounts: tsc.counts, updatedAt: nowIso() });

  return regressions.length > 0
    ? { status: "regressions", head, regressions }
    : { status: "clean", head };
}

/** ISO timestamp — isolated so tests/callers can reason about it. */
function nowIso(): string {
  return new Date().toISOString();
}
