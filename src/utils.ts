// ---- Logging ----

const ROOT = new URL("..", import.meta.url).pathname;

/** Timestamp-prefixed console logger. */
export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- Command runner ----

/** Spawn a command in the repo root, capturing stdout/stderr. */
export async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

// ---- Process utilities ----

/** Check if a process with the given PID is still alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- Arg parsing ----

export interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

export function parseFlags(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const eqIdx = raw.indexOf("=");
      if (eqIdx >= 0) {
        // --flag=value syntax
        flags[raw.slice(0, eqIdx)] = raw.slice(eqIdx + 1);
        i += 1;
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[raw] = next;
          i += 2;
        } else {
          flags[raw] = "true";
          i += 1;
        }
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { flags, positional };
}

// ---- String formatting ----

export function pad(s: string, width: number): string {
  return s.length >= width ? s + " " : s + " ".repeat(width - s.length);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "~" : s;
}

/**
 * URL-safe slug from arbitrary text. Replaces RUNS of non-alphanumeric characters with a
 * single hyphen (never deletes them) so word boundaries survive — e.g. a title containing a
 * file:line citation like "dispatch.ts:137-149" doesn't collapse into the illegible
 * "dispatchts137-149". Fixed live in `arc-article-pipeline` (P2, 2026-07-03) after the delete-
 * don't-replace version shipped that exact bug; extracted here (P3, 2026-07-03) after a third
 * skill (`arc-packaging`) needed the identical function — dev-council (Fowler) flagged the
 * rule-of-three threshold as crossed for this specific pure string transform (no per-pipeline
 * semantics, so no divergence-safety reason to keep copies independent, unlike the INDEX.md
 * table parsers which genuinely differ in shape). Existing call sites in arc-daily-read /
 * arc-article-pipeline are left as-is (already shipped, already verified) — only new code
 * imports this one.
 */
export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Derives a cosmetic, human-readable slug from a report filename by stripping the leading
 * ISO-timestamp prefix. NOT collision-free — many reports share a generic post-timestamp name
 * (e.g. "<timestamp>_research.md" all strip to "research") — so never key rotation/dedup logic
 * on this. Use for display/route naming only; use `fileKeyFromReportFile` for anything that
 * needs to distinguish reports.
 */
export function slugFromReportFile(reportFile: string): string {
  return reportFile.replace(/^\d{4}-\d{2}-\d{2}T[\d:-]+Z_/, "").replace(/\.md$/, "");
}

/**
 * Derives a per-report rotation/dedup key from a report filename, keyed on the full filename
 * (not the collapsible slug above) so it stays unique even across generically-named reports.
 * Extracted 2026-07-28 (#24249) after the same derived-identifier-collision bug shipped
 * independently three times — arc-article-pipeline (#23670), arc-daily-read (#23897/#24018),
 * and arc-packaging (#24240) — each fixed by adding a full-filename-keyed column instead of the
 * stripped slug. Mirrors the `slugify` extraction precedent above (P3, 2026-07-03): new code
 * that needs a rotation/dedup key from a report filename should import this rather than
 * re-deriving one; existing shipped call sites are left as-is.
 */
export function fileKeyFromReportFile(reportFile: string): string {
  return reportFile.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
}
