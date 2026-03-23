#!/usr/bin/env bun

/**
 * clarity-check CLI — static analysis for Clarity smart contracts
 *
 * Checks for deprecated functions, anti-patterns, and style issues
 * without requiring a Stacks node or clarinet.
 */

import { resolve, basename, extname } from "node:path";
import { readdirSync, statSync } from "node:fs";

// ---- Types ----

type Severity = "error" | "warning" | "info";

interface Issue {
  rule: string;
  severity: Severity;
  line: number;
  column: number;
  message: string;
  suggestion: string;
}

interface FileResult {
  file: string;
  issues: Issue[];
  lines: number;
}

interface CheckResult {
  success: boolean;
  files: FileResult[];
  totalIssues: number;
  errors: number;
  warnings: number;
  infos: number;
}

interface Rule {
  id: string;
  severity: Severity;
  pattern: RegExp;
  message: string;
  suggestion: string;
}

// ---- Rules ----

const DEPRECATION_RULES: Rule[] = [
  {
    id: "deprecated-define-fungible-token",
    severity: "error",
    pattern: /\(define-fungible-token\s/,
    message: "define-fungible-token is deprecated in Clarity 2+",
    suggestion: "Use (define-ft ...) instead. See SIP-010 updated spec.",
  },
  {
    id: "deprecated-ft-mint-event",
    severity: "error",
    pattern: /\(ft-mint-event\?\s/,
    message: "ft-mint-event? is removed in Clarity 3",
    suggestion:
      "Use print events or ft-mint? return values to track mint events.",
  },
  {
    id: "deprecated-nft-mint-event",
    severity: "error",
    pattern: /\(nft-mint-event\?\s/,
    message: "nft-mint-event? is removed in Clarity 3",
    suggestion:
      "Use print events or nft-mint? return values to track mint events.",
  },
  {
    id: "deprecated-define-non-fungible-token",
    severity: "error",
    pattern: /\(define-non-fungible-token\s/,
    message: "define-non-fungible-token is deprecated in Clarity 2+",
    suggestion: "Use (define-nft ...) instead.",
  },
];

const ANTIPATTERN_RULES: Rule[] = [
  {
    id: "unwrap-panic-in-public",
    severity: "warning",
    pattern: /\(unwrap-panic\s/,
    message: "unwrap-panic in a public function aborts the transaction",
    suggestion:
      "Use (unwrap! ... (err ...)) or (try! ...) to return an error response instead of panicking.",
  },
  {
    id: "missing-sender-check",
    severity: "warning",
    pattern: /\(define-public\s+\([^)]+\)\s*\n(?:(?!\(asserts!.*tx-sender)[\s\S])*?\(stx-transfer\?/,
    message:
      "stx-transfer? in public function without tx-sender assertion nearby",
    suggestion:
      "Add (asserts! (is-eq tx-sender ...) (err ...)) before fund transfers.",
  },
  {
    id: "unbounded-list-operation",
    severity: "warning",
    pattern: /\((fold|map|filter)\s+\S+\s+\(list\s/,
    message: "Inline list literal in fold/map/filter — verify bounds",
    suggestion:
      "Ensure list length is bounded. Prefer data-var or constant-length lists.",
  },
  {
    id: "var-set-without-guard",
    severity: "info",
    pattern:
      /\(define-public\s+\([^)]+\)\s*\n(?:(?!\(asserts!)[\s\S])*?\(var-set\s/,
    message: "var-set in public function without asserts! guard",
    suggestion:
      "Add authorization check: (asserts! (is-eq tx-sender CONTRACT-OWNER) (err u401))",
  },
];

const STYLE_RULES: Rule[] = [
  {
    id: "camel-case-name",
    severity: "info",
    pattern:
      /\(define-(?:public|private|read-only)\s+\(([a-z]+[A-Z][a-zA-Z]*)/,
    message: "Function name uses camelCase instead of kebab-case",
    suggestion: "Clarity convention is kebab-case: my-function, not myFunction",
  },
  {
    id: "magic-number",
    severity: "info",
    pattern: /\((?:asserts!|is-eq|>|<|>=|<=)\s+\S+\s+u\d{3,}\)/,
    message: "Magic number in comparison — consider a named constant",
    suggestion:
      "Extract to (define-constant ERR-CODE uNNN) for readability and maintainability.",
  },
];

const ALL_RULES = [...DEPRECATION_RULES, ...ANTIPATTERN_RULES, ...STYLE_RULES];

// ---- Helpers ----

function log(message: string): void {
  console.error(
    `[${new Date().toISOString()}] [clarity-check/cli] ${message}`
  );
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function findClarFiles(dir: string): string[] {
  const results: string[] = [];
  const absDir = resolve(dir);

  function walk(current: string): void {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const full = resolve(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
        walk(full);
      } else if (stat.isFile() && extname(entry) === ".clar") {
        results.push(full);
      }
    }
  }

  walk(absDir);
  return results;
}

function checkLine(
  line: string,
  lineNum: number,
  rules: Rule[]
): Issue[] {
  const issues: Issue[] = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(line);
    if (match) {
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        line: lineNum,
        column: match.index + 1,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }
  return issues;
}

function checkMultiline(
  content: string,
  rules: Rule[]
): Issue[] {
  const issues: Issue[] = [];
  for (const rule of rules) {
    const match = rule.pattern.exec(content);
    if (match) {
      // Find the line number of the match
      const beforeMatch = content.slice(0, match.index);
      const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
      issues.push({
        rule: rule.id,
        severity: rule.severity,
        line: lineNum,
        column: 1,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }
  return issues;
}

async function analyzeFile(filePath: string): Promise<FileResult> {
  const absPath = resolve(filePath);
  const content = await Bun.file(absPath).text();
  const lines = content.split("\n");
  const issues: Issue[] = [];

  // Line-by-line rules (deprecations, simple patterns)
  const lineRules = [...DEPRECATION_RULES, ...STYLE_RULES, ANTIPATTERN_RULES[0], ANTIPATTERN_RULES[2]];
  for (let i = 0; i < lines.length; i++) {
    // Skip comment lines
    if (lines[i].trimStart().startsWith(";;")) continue;
    issues.push(...checkLine(lines[i], i + 1, lineRules));
  }

  // Multi-line rules (patterns that span function bodies)
  const multilineRules = [ANTIPATTERN_RULES[1], ANTIPATTERN_RULES[3]];
  issues.push(...checkMultiline(content, multilineRules));

  // Sort by line number
  issues.sort((a, b) => a.line - b.line);

  return {
    file: absPath,
    issues,
    lines: lines.length,
  };
}

function summarizeResults(files: FileResult[]): CheckResult {
  let totalIssues = 0;
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const f of files) {
    for (const issue of f.issues) {
      totalIssues++;
      if (issue.severity === "error") errors++;
      else if (issue.severity === "warning") warnings++;
      else infos++;
    }
  }

  return {
    success: errors === 0,
    files,
    totalIssues,
    errors,
    warnings,
    infos,
  };
}

// ---- Subcommands ----

async function cmdCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;
  const dirPath = flags.dir;

  if (!filePath && !dirPath) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Required: --file <path.clar> or --dir <directory>",
        usage:
          "arc skills run --name clarity-check -- check --file contract.clar",
      })
    );
    process.exit(1);
  }

  let files: string[] = [];
  if (filePath) {
    const abs = resolve(filePath);
    const exists = await Bun.file(abs).exists();
    if (!exists) {
      console.log(
        JSON.stringify({ success: false, error: `File not found: ${abs}` })
      );
      process.exit(1);
    }
    files = [abs];
  } else if (dirPath) {
    files = findClarFiles(dirPath);
    if (files.length === 0) {
      console.log(
        JSON.stringify({
          success: true,
          files: [],
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          infos: 0,
          message: `No .clar files found in ${resolve(dirPath)}`,
        })
      );
      return;
    }
  }

  const results: FileResult[] = [];
  for (const f of files) {
    results.push(await analyzeFile(f));
  }

  const summary = summarizeResults(results);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors > 0) {
    process.exit(1);
  }
}

async function cmdDeprecations(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;
  const dirPath = flags.dir;

  if (!filePath && !dirPath) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Required: --file <path.clar> or --dir <directory>",
        usage:
          "arc skills run --name clarity-check -- deprecations --file contract.clar",
      })
    );
    process.exit(1);
  }

  let files: string[] = [];
  if (filePath) {
    files = [resolve(filePath)];
  } else if (dirPath) {
    files = findClarFiles(dirPath);
  }

  const results: FileResult[] = [];
  for (const f of files) {
    const result = await analyzeFile(f);
    // Filter to deprecation issues only
    result.issues = result.issues.filter((i) =>
      i.rule.startsWith("deprecated-")
    );
    if (result.issues.length > 0) {
      results.push(result);
    }
  }

  const summary = summarizeResults(results);
  console.log(JSON.stringify(summary, null, 2));
}

async function cmdSummary(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const dirPath = flags.dir || ".";
  const files = findClarFiles(dirPath);

  if (files.length === 0) {
    console.log(
      JSON.stringify({
        success: true,
        message: `No .clar files found in ${resolve(dirPath)}`,
        totalFiles: 0,
      })
    );
    return;
  }

  const results: FileResult[] = [];
  for (const f of files) {
    results.push(await analyzeFile(f));
  }

  const summary = summarizeResults(results);

  // Compact summary with per-file counts
  const fileSummaries = results.map((r) => ({
    file: basename(r.file),
    path: r.file,
    lines: r.lines,
    issues: r.issues.length,
    errors: r.issues.filter((i) => i.severity === "error").length,
    warnings: r.issues.filter((i) => i.severity === "warning").length,
    infos: r.issues.filter((i) => i.severity === "info").length,
  }));

  console.log(
    JSON.stringify(
      {
        success: summary.success,
        totalFiles: files.length,
        totalIssues: summary.totalIssues,
        errors: summary.errors,
        warnings: summary.warnings,
        infos: summary.infos,
        files: fileSummaries,
      },
      null,
      2
    )
  );
}

async function cmdRules(): Promise<void> {
  const rules = ALL_RULES.map((r) => ({
    id: r.id,
    severity: r.severity,
    message: r.message,
  }));
  console.log(JSON.stringify({ success: true, rules }, null, 2));
}

// ---- Usage ----

function printUsage(): void {
  console.log(`clarity-check — Clarity contract static analysis

Usage:
  bun skills/clarity-check/cli.ts <command> [flags]

Commands:
  check          Run all checks on a file or directory
  deprecations   Check only for deprecated functions
  summary        Show per-file issue counts for a directory
  rules          List all available rules

Flags:
  --file <path>  Path to a .clar file
  --dir <path>   Path to a directory (scans recursively)

Examples:
  bun skills/clarity-check/cli.ts check --file contracts/token.clar
  bun skills/clarity-check/cli.ts check --dir contracts/
  bun skills/clarity-check/cli.ts deprecations --dir contracts/
  bun skills/clarity-check/cli.ts summary --dir contracts/
  bun skills/clarity-check/cli.ts rules
`);
}

// ---- Entry Point ----

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (sub) {
    case "check":
      await cmdCheck(args.slice(1));
      break;
    case "deprecations":
      await cmdDeprecations(args.slice(1));
      break;
    case "summary":
      await cmdSummary(args.slice(1));
      break;
    case "rules":
      await cmdRules();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
