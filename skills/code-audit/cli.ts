#!/usr/bin/env bun
// skills/code-audit/cli.ts
// On-demand static analysis, dependency review, and security scanning.

import { join, resolve } from "node:path";

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

interface AuditFinding {
  severity: "critical" | "high" | "moderate" | "low" | "info";
  type: string;
  message: string;
  file?: string;
  line?: number;
}

interface AuditResult {
  type: string;
  path: string;
  findings: AuditFinding[];
  summary: string;
  exit_code: number;
}

async function runStatic(targetPath: string): Promise<AuditResult> {
  const findings: AuditFinding[] = [];

  // Try tsc --noEmit
  const tsconfig = join(targetPath, "tsconfig.json");
  const hasTsConfig = await Bun.file(tsconfig).exists();

  if (hasTsConfig) {
    const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--project", tsconfig], {
      cwd: targetPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const output = (stdout + stderr).trim();
    if (proc.exitCode !== 0 && output) {
      const lines = output.split("\n").slice(0, 20);
      for (const line of lines) {
        if (line.includes("error TS")) {
          findings.push({ severity: "moderate", type: "type-error", message: line.trim() });
        }
      }
    }
  }

  // Try bun build --no-bundle on src/index.ts or index.ts
  const candidates = ["src/index.ts", "index.ts", "src/main.ts"];
  let buildEntry = "";
  for (const c of candidates) {
    if (await Bun.file(join(targetPath, c)).exists()) {
      buildEntry = c;
      break;
    }
  }

  if (buildEntry) {
    const proc = Bun.spawn(
      ["bun", "build", "--no-bundle", join(targetPath, buildEntry)],
      { cwd: targetPath, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    if (proc.exitCode !== 0 && stderr.trim()) {
      findings.push({
        severity: "high",
        type: "build-error",
        message: stderr.trim().split("\n")[0],
      });
    }
  }

  const severity = findings.some((f) => f.severity === "high") ? "high"
    : findings.length > 0 ? "moderate"
    : "none";

  return {
    type: "static",
    path: targetPath,
    findings,
    summary: findings.length === 0
      ? "No static analysis issues found"
      : `${findings.length} issue(s): ${severity} severity`,
    exit_code: findings.length > 0 ? 1 : 0,
  };
}

async function runDeps(targetPath: string): Promise<AuditResult> {
  const findings: AuditFinding[] = [];

  const pkgFile = Bun.file(join(targetPath, "package.json"));
  if (!await pkgFile.exists()) {
    return {
      type: "deps",
      path: targetPath,
      findings: [],
      summary: "No package.json found",
      exit_code: 0,
    };
  }

  const pkg = await pkgFile.json() as Record<string, unknown>;
  const deps: Record<string, string> = {
    ...(pkg["dependencies"] as Record<string, string> ?? {}),
    ...(pkg["devDependencies"] as Record<string, string> ?? {}),
  };

  // Flag packages with known problematic patterns
  const flaggedPatterns: Array<{ pattern: RegExp; reason: string; severity: AuditFinding["severity"] }> = [
    { pattern: /^node-serialize$/, reason: "Known RCE vulnerability (CVE-2017-5941)", severity: "critical" },
    { pattern: /^serialize-javascript@[01]\./, reason: "Old version with XSS risk", severity: "high" },
    { pattern: /^lodash@[34]\./, reason: "Prototype pollution risk in older lodash", severity: "moderate" },
    { pattern: /^event-stream@/, reason: "Supply chain compromise history", severity: "high" },
  ];

  for (const [name, version] of Object.entries(deps)) {
    const full = `${name}@${version}`;
    for (const { pattern, reason, severity } of flaggedPatterns) {
      if (pattern.test(full) || pattern.test(name)) {
        findings.push({ severity, type: "vulnerable-dep", message: `${full}: ${reason}` });
      }
    }

    // Flag wildcard or very loose version pins
    if (version.startsWith("*") || version === "latest") {
      findings.push({
        severity: "low",
        type: "unpinned-dep",
        message: `${name}: unpinned version "${version}" — supply chain risk`,
      });
    }
  }

  const depCount = Object.keys(deps).length;

  return {
    type: "deps",
    path: targetPath,
    findings,
    summary: findings.length === 0
      ? `${depCount} dependencies reviewed — no issues found`
      : `${depCount} dependencies reviewed — ${findings.length} finding(s)`,
    exit_code: findings.some((f) => f.severity === "critical" || f.severity === "high") ? 1 : 0,
  };
}

async function runSecurity(targetPath: string): Promise<AuditResult> {
  const findings: AuditFinding[] = [];

  // Patterns to scan for
  const patterns: Array<{ regex: RegExp; message: string; severity: AuditFinding["severity"] }> = [
    { regex: /eval\s*\(/, message: "eval() usage — potential code injection", severity: "high" },
    { regex: /new\s+Function\s*\(/, message: "new Function() — potential code injection", severity: "high" },
    { regex: /child_process\.(exec|execSync)\s*\(/, message: "child_process exec — verify input sanitization", severity: "moderate" },
    { regex: /(password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/i, message: "Possible hardcoded credential", severity: "critical" },
    { regex: /sk-[a-zA-Z0-9]{20,}/, message: "Possible OpenAI API key in source", severity: "critical" },
    { regex: /AAAA[0-9A-Za-z+/]{60,}/, message: "Possible SSH private key", severity: "critical" },
    { regex: /http:\/\/(?!localhost|127\.0\.0\.1)/, message: "Unencrypted HTTP URL — use HTTPS", severity: "low" },
    { regex: /SELECT\s+.*\+\s*(req|params|body|query)/i, message: "Possible SQL injection — use parameterized queries", severity: "high" },
  ];

  // Walk .ts, .js, .json files (excluding node_modules, .git)
  async function scanDir(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = Array.from(await (await import("node:fs/promises")).readdir(dir));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === ".bun") continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = await (await import("node:fs/promises")).stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await scanDir(full);
      } else if (/\.(ts|js|json|env|sh)$/.test(entry)) {
        const text = await Bun.file(full).text().catch(() => "");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          for (const { regex, message, severity } of patterns) {
            if (regex.test(lines[i])) {
              // Skip comments
              const trimmed = lines[i].trim();
              if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
              findings.push({
                severity,
                type: "security-pattern",
                message,
                file: full.replace(targetPath, ""),
                line: i + 1,
              });
            }
          }
        }
      }
    }
  }

  await scanDir(targetPath);

  // Cap findings to avoid noise
  const trimmed = findings.slice(0, 50);
  if (findings.length > 50) {
    trimmed.push({ severity: "info", type: "truncated", message: `${findings.length - 50} more findings omitted` });
  }

  return {
    type: "security",
    path: targetPath,
    findings: trimmed,
    summary: trimmed.length === 0
      ? "No security patterns detected"
      : `${findings.length} security pattern(s) found`,
    exit_code: findings.some((f) => f.severity === "critical" || f.severity === "high") ? 1 : 0,
  };
}

async function cmdRun(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const rawPath = typeof flags["path"] === "string" ? flags["path"] : ".";
  const auditType = typeof flags["type"] === "string" ? flags["type"] : "all";
  const targetPath = resolve(rawPath);

  const validTypes = ["static", "deps", "security", "all"];
  if (!validTypes.includes(auditType)) {
    process.stderr.write(`Error: --type must be one of: ${validTypes.join(", ")}\n`);
    process.exit(1);
  }

  const results: AuditResult[] = [];

  if (auditType === "static" || auditType === "all") results.push(await runStatic(targetPath));
  if (auditType === "deps" || auditType === "all") results.push(await runDeps(targetPath));
  if (auditType === "security" || auditType === "all") results.push(await runSecurity(targetPath));

  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  const hasCritical = results.some((r) => r.findings.some((f) => f.severity === "critical"));
  const hasHigh = results.some((r) => r.findings.some((f) => f.severity === "high"));

  const overallSeverity = hasCritical ? "critical" : hasHigh ? "high"
    : totalFindings > 0 ? "moderate" : "clean";

  const recommended_priority = hasCritical ? 2 : hasHigh ? 3 : totalFindings > 0 ? 5 : null;

  console.log(JSON.stringify({
    path: targetPath,
    audit_types: results.map((r) => r.type),
    overall: overallSeverity,
    total_findings: totalFindings,
    recommended_priority,
    results,
  }, null, 2));

  if (results.some((r) => r.exit_code !== 0)) process.exit(1);
}

function printUsage(): void {
  process.stdout.write(`code-audit CLI

USAGE
  arc skills run --name code-audit -- <subcommand> [flags]

SUBCOMMANDS
  run --path PATH [--type static|deps|security|all]
    Run one or more audit types against PATH (default: all).

  static --path PATH
    TypeScript type check and build validation.

  deps --path PATH
    Dependency vulnerability and version pinning review.

  security --path PATH
    Security pattern scan (secrets, injection, unsafe APIs).

EXAMPLES
  arc skills run --name code-audit -- run --path . --type all
  arc skills run --name code-audit -- security --path ./skills
  arc skills run --name code-audit -- deps --path /home/dev/arc-starter
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "run":
      await cmdRun(args.slice(1));
      break;
    case "static":
      await cmdRun(["--path", ...(args.slice(1)), "--type", "static"]);
      break;
    case "deps":
      await cmdRun(["--path", ...(args.slice(1)), "--type", "deps"]);
      break;
    case "security":
      await cmdRun(["--path", ...(args.slice(1)), "--type", "security"]);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
