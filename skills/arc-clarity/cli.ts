#!/usr/bin/env bun
/**
 * arc-clarity CLI — Clarity smart contract security audits
 *
 * Usage:
 *   bun skills/arc-clarity/cli.ts audit --file <path.clar>
 *   bun skills/arc-clarity/cli.ts audit --contract <principal.name> [--network mainnet|testnet]
 *   bun skills/arc-clarity/cli.ts report --file <path.json>
 *   bun skills/arc-clarity/cli.ts list
 */

import { existsSync, mkdirSync, readdirSync } from "fs";

const REPORTS_DIR = "skills/arc-clarity/reports";

function ensureReportsDir(): void {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

async function fetchContractSource(
  contractId: string,
  network: string
): Promise<string> {
  const [address, name] = contractId.split(".");
  if (!address || !name) {
    throw new Error(
      `Invalid contract ID: ${contractId}. Expected format: <address>.<name>`
    );
  }

  const baseUrl =
    network === "testnet"
      ? "https://api.testnet.hiro.so"
      : "https://api.hiro.so";

  const url = `${baseUrl}/v2/contracts/source/${address}/${name}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch contract ${contractId}: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { source: string };
  return data.source;
}

function analyzeContract(source: string, contractName: string): AuditReport {
  const lines = source.split("\n");
  const functions: FunctionEntry[] = [];
  const issues: string[] = [];

  // Extract functions
  const funcRegex =
    /\(define-(public|read-only|private)\s+\(([a-zA-Z0-9-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(source)) !== null) {
    const type = match[1] as "public" | "read-only" | "private";
    const name = match[2];
    const funcIssues: string[] = [];

    // Find the function body (rough extraction)
    const funcStart = match.index;
    let depth = 0;
    let funcEnd = funcStart;
    for (let i = funcStart; i < source.length; i++) {
      if (source[i] === "(") depth++;
      if (source[i] === ")") depth--;
      if (depth === 0) {
        funcEnd = i + 1;
        break;
      }
    }
    const funcBody = source.slice(funcStart, funcEnd);

    // Risk classification
    let risk: "GREEN" | "YELLOW" | "ORANGE" | "RED" = "GREEN";
    if (type === "read-only") {
      risk = "GREEN";
    } else if (type === "private") {
      risk = "YELLOW";
    } else {
      // public function analysis
      const hasTokenOps =
        /\b(ft-transfer\?|ft-mint\?|ft-burn\?|nft-transfer\?|nft-mint\?|nft-burn\?|stx-transfer\?|stx-burn\?)\b/.test(
          funcBody
        );
      const hasExternalCalls =
        /\(contract-call\?/.test(funcBody) && !/\(contract-call\? \./.test(funcBody);
      const hasAsContract = /\(as-contract/.test(funcBody);
      const hasAdminCheck =
        /\b(owner|admin|operator|governance)\b/i.test(funcBody);

      if (hasAdminCheck && (hasTokenOps || hasAsContract)) {
        risk = "RED";
      } else if (hasTokenOps || hasExternalCalls) {
        risk = "ORANGE";
      } else {
        risk = "YELLOW";
      }

      // Check for missing auth on state-changing public functions
      const hasAuthCheck =
        /\(asserts!\s+\(is-eq\s+(tx-sender|contract-caller)/.test(funcBody);
      if (!hasAuthCheck && type === "public") {
        // Check if it's a simple getter disguised as public
        const hasStateChange =
          /\b(var-set|map-set|map-insert|map-delete|ft-|nft-|stx-)\b/.test(
            funcBody
          );
        if (hasStateChange) {
          funcIssues.push(
            "Missing authorization check on state-changing public function"
          );
        }
      }

      // Check for missing try! on contract-call?
      if (/\(contract-call\?/.test(funcBody) && !/\(try!\s+\(contract-call\?/.test(funcBody) && !/\(match\s+\(contract-call\?/.test(funcBody)) {
        funcIssues.push(
          "contract-call? without try! or match — errors may be swallowed"
        );
      }

      // Check for as-contract without asset restrictions
      if (hasAsContract && !/\(with-(stx|ft|nft|all-assets)/.test(funcBody)) {
        funcIssues.push(
          "as-contract without explicit asset restrictions (Clarity 4)"
        );
      }
    }

    functions.push({ name, type, risk, issues: funcIssues });
  }

  // Contract-wide checks
  const hardGates = {
    G1_unbounded_iteration: false,
    G2_missing_auth: false,
    G3_unrestricted_as_contract: false,
    G4_swallowed_errors: false,
  };

  // G1: Check for fold/map/filter on non-fixed lists
  // (heuristic: look for fold without list literal or define-constant list)
  if (/\(fold\s+\S+\s+[a-z]/.test(source) && !/\(list\s/.test(source)) {
    hardGates.G1_unbounded_iteration = true;
    issues.push("Potential unbounded iteration detected (fold on variable)");
  }

  // G2: Missing auth summary
  const missingAuth = functions.filter((f) =>
    f.issues.some((i) => i.includes("Missing authorization"))
  );
  if (missingAuth.length > 0) {
    hardGates.G2_missing_auth = true;
    issues.push(
      `Missing authorization on: ${missingAuth.map((f) => f.name).join(", ")}`
    );
  }

  // G3: as-contract without restrictions
  const unrestricted = functions.filter((f) =>
    f.issues.some((i) => i.includes("as-contract without"))
  );
  if (unrestricted.length > 0) {
    hardGates.G3_unrestricted_as_contract = true;
    issues.push(
      `Unrestricted as-contract in: ${unrestricted.map((f) => f.name).join(", ")}`
    );
  }

  // G4: Swallowed errors
  const swallowed = functions.filter((f) =>
    f.issues.some((i) => i.includes("swallowed"))
  );
  if (swallowed.length > 0) {
    hardGates.G4_swallowed_errors = true;
    issues.push(
      `Swallowed errors in: ${swallowed.map((f) => f.name).join(", ")}`
    );
  }

  // Heuristic scoring
  const totalPublic = functions.filter((f) => f.type === "public").length;
  const totalFunctions = functions.length;
  const issueCount = functions.reduce(
    (sum, f) => sum + f.issues.length,
    0
  );

  const categories = buildCategoryScores(
    source,
    functions,
    issueCount,
    totalPublic
  );

  const finalScore = Math.round(
    Object.values(categories).reduce(
      (sum, c) => sum + c.score * c.weight,
      0
    )
  );

  const gatesFailed = Object.entries(hardGates)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const anyLowCategory = Object.values(categories).some((c) => c.score < 60);
  const decision =
    gatesFailed.length > 0 || anyLowCategory || finalScore < 75
      ? "REJECT"
      : "APPROVE";

  return {
    contract: contractName,
    version: "1.0",
    date: new Date().toISOString().split("T")[0],
    functions,
    categories,
    hard_gates: hardGates,
    final_score: finalScore,
    confidence: issueCount === 0 ? 0.85 : Math.max(0.5, 0.85 - issueCount * 0.05),
    decision,
    failed: gatesFailed,
    summary: buildSummary(
      contractName,
      totalFunctions,
      totalPublic,
      issueCount,
      gatesFailed,
      finalScore,
      decision
    ),
    issues,
    note: "This is a static analysis pre-screen. For a full audit, dispatch a subagent with AGENT.md for manual review of each function.",
  };
}

function buildCategoryScores(
  source: string,
  functions: FunctionEntry[],
  issueCount: number,
  totalPublic: number
): Record<string, CategoryScore> {
  const hasAuth = /\(asserts!\s+\(is-eq\s+(tx-sender|contract-caller)/.test(source);
  const hasErrorCodes = /\(define-constant\s+ERR[_A-Z]+\s+\(err\s+u\d+\)/.test(source);
  const hasTry = /\(try!/.test(source);
  const hasPostConditions = /post-condition/i.test(source) || /\(with-(stx|ft|nft)/.test(source);
  const hasRateLimit = /last-.*-block|rate.?limit/i.test(source);
  const hasTraits = /\(define-trait|\(impl-trait|\(use-trait/.test(source);
  const hasConstants = /\(define-constant/.test(source);
  const funcCount = functions.length;

  // Base scores — adjust down for issues
  const issuePenalty = Math.min(30, issueCount * 8);

  return {
    authorization: {
      score: hasAuth ? Math.max(50, 88 - issuePenalty) : totalPublic > 0 ? 40 : 90,
      weight: 0.15,
      reasoning: hasAuth
        ? "Authorization checks present on public functions."
        : totalPublic > 0
          ? "No authorization checks found on public state-changing functions."
          : "No public state-changing functions to check.",
    },
    input_validation: {
      score: /\(asserts!/.test(source) ? Math.max(55, 85 - issuePenalty) : 50,
      weight: 0.1,
      reasoning: /\(asserts!/.test(source)
        ? "Input validation with asserts! detected."
        : "No asserts! found — inputs may not be validated.",
    },
    error_handling: {
      score: hasErrorCodes && hasTry ? 85 : hasErrorCodes || hasTry ? 70 : 45,
      weight: 0.1,
      reasoning: hasErrorCodes && hasTry
        ? "Unique error constants and try! propagation found."
        : "Incomplete error handling pattern.",
    },
    token_safety: {
      score: hasPostConditions ? 85 : /\b(ft-|nft-|stx-)/.test(source) ? 60 : 90,
      weight: 0.15,
      reasoning: hasPostConditions
        ? "Asset restrictions or post-conditions present."
        : /\b(ft-|nft-|stx-)/.test(source)
          ? "Token operations found but no explicit asset restrictions."
          : "No token operations — low risk.",
    },
    access_control: {
      score: hasRateLimit && hasAuth ? 88 : hasAuth ? 75 : 45,
      weight: 0.15,
      reasoning: hasRateLimit
        ? "Rate limiting and access control present."
        : hasAuth
          ? "Basic access control present, no rate limiting."
          : "No access control detected.",
    },
    cost_efficiency: {
      score: funcCount <= 50 && hasConstants ? 85 : funcCount > 50 ? 60 : 75,
      weight: 0.1,
      reasoning:
        funcCount <= 50
          ? "Contract size within limits. Constants used for efficiency."
          : "Large contract — may hit cost limits.",
    },
    code_quality: {
      score: hasConstants && hasErrorCodes ? 82 : 65,
      weight: 0.1,
      reasoning: hasConstants && hasErrorCodes
        ? "Good use of constants and structured error codes."
        : "Room for improvement in code structure.",
    },
    composability: {
      score: hasTraits ? 85 : 70,
      weight: 0.15,
      reasoning: hasTraits
        ? "Trait-based composability detected."
        : "No traits — consider trait interfaces for extensibility.",
    },
  };
}

function buildSummary(
  name: string,
  total: number,
  pub: number,
  issues: number,
  gates: string[],
  score: number,
  decision: string
): string {
  const gateStr =
    gates.length > 0 ? ` Hard gates failed: ${gates.join(", ")}.` : "";
  return `Contract "${name}" has ${total} functions (${pub} public). Static analysis found ${issues} issue(s). Final score: ${score}/100. Decision: ${decision}.${gateStr} Note: This is an automated pre-screen — a full manual audit is recommended for production deployment.`;
}

async function cmdAudit(args: string[]): Promise<void> {
  const fileIdx = args.indexOf("--file");
  const contractIdx = args.indexOf("--contract");
  const networkIdx = args.indexOf("--network");
  const network = networkIdx >= 0 ? args[networkIdx + 1] : "mainnet";

  let source: string;
  let contractName: string;

  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const filePath = args[fileIdx + 1];
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    source = await Bun.file(filePath).text();
    contractName = filePath.split("/").pop()?.replace(".clar", "") ?? "unknown";
  } else if (contractIdx >= 0 && args[contractIdx + 1]) {
    contractName = args[contractIdx + 1];
    console.log(`Fetching contract ${contractName} from ${network}...`);
    source = await fetchContractSource(contractName, network);
  } else {
    console.error("Usage: audit --file <path.clar> | --contract <principal.name>");
    process.exit(1);
  }

  console.log(`Analyzing ${contractName} (${source.split("\n").length} lines)...`);
  const report = analyzeContract(source, contractName);

  ensureReportsDir();
  const reportPath = `${REPORTS_DIR}/${contractName.replace(/\./g, "_")}_${report.date}.json`;
  await Bun.write(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Audit Report: ${contractName} ===`);
  console.log(`Date: ${report.date}`);
  console.log(`Functions: ${report.functions.length} total`);
  console.log(`Final Score: ${report.final_score}/100`);
  console.log(`Decision: ${report.decision}`);
  console.log(`Confidence: ${report.confidence}`);

  if (report.failed.length > 0) {
    console.log(`\nFailed Gates: ${report.failed.join(", ")}`);
  }

  if (report.issues.length > 0) {
    console.log("\nIssues:");
    for (const issue of report.issues) {
      console.log(`  - ${issue}`);
    }
  }

  console.log("\nCategory Scores:");
  for (const [cat, data] of Object.entries(report.categories)) {
    console.log(`  ${cat}: ${data.score}/100 (weight: ${data.weight})`);
  }

  console.log(`\nFull report saved to: ${reportPath}`);
  console.log(report.summary);
}

function cmdReport(args: string[]): void {
  const fileIdx = args.indexOf("--file");
  if (fileIdx < 0 || !args[fileIdx + 1]) {
    console.error("Usage: report --file <path.json>");
    process.exit(1);
  }

  const filePath = args[fileIdx + 1];
  if (!existsSync(filePath)) {
    console.error(`Report not found: ${filePath}`);
    process.exit(1);
  }

  const report = JSON.parse(
    require("fs").readFileSync(filePath, "utf-8")
  ) as AuditReport;

  // Markdown output
  console.log(`# Clarity Audit Report: ${report.contract}\n`);
  console.log(`**Date:** ${report.date}`);
  console.log(`**Score:** ${report.final_score}/100`);
  console.log(`**Decision:** ${report.decision}`);
  console.log(`**Confidence:** ${report.confidence}\n`);

  console.log("## Function Inventory\n");
  console.log("| Function | Type | Risk | Issues |");
  console.log("|----------|------|------|--------|");
  for (const f of report.functions) {
    const issueStr = f.issues.length > 0 ? f.issues.join("; ") : "None";
    console.log(`| ${f.name} | ${f.type} | ${f.risk} | ${issueStr} |`);
  }

  console.log("\n## Category Scores\n");
  console.log("| Category | Score | Weight | Reasoning |");
  console.log("|----------|-------|--------|-----------|");
  for (const [cat, data] of Object.entries(report.categories)) {
    console.log(`| ${cat} | ${data.score} | ${data.weight} | ${data.reasoning} |`);
  }

  if (report.failed.length > 0) {
    console.log("\n## Failed Hard Gates\n");
    for (const gate of report.failed) {
      console.log(`- ${gate}`);
    }
  }

  console.log(`\n## Summary\n\n${report.summary}`);
}

function cmdList(): void {
  ensureReportsDir();
  const files = readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No audit reports found.");
    return;
  }
  console.log(`${files.length} audit report(s):\n`);
  for (const f of files) {
    const report = JSON.parse(
      require("fs").readFileSync(`${REPORTS_DIR}/${f}`, "utf-8")
    ) as AuditReport;
    console.log(
      `  ${report.contract} — ${report.final_score}/100 ${report.decision} (${report.date})`
    );
  }
}

// --- Types ---

interface FunctionEntry {
  name: string;
  type: "public" | "read-only" | "private";
  risk: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  issues: string[];
}

interface CategoryScore {
  score: number;
  weight: number;
  reasoning: string;
}

interface AuditReport {
  contract: string;
  version: string;
  date: string;
  functions: FunctionEntry[];
  categories: Record<string, CategoryScore>;
  hard_gates: Record<string, boolean>;
  final_score: number;
  confidence: number;
  decision: "APPROVE" | "REJECT";
  failed: string[];
  summary: string;
  issues: string[];
  note: string;
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "audit":
    cmdAudit(args.slice(1));
    break;
  case "report":
    cmdReport(args.slice(1));
    break;
  case "list":
    cmdList();
    break;
  default:
    console.log(`arc-clarity — Clarity smart contract security audits

Commands:
  audit --file <path.clar>                    Audit a local contract file
  audit --contract <addr.name> [--network N]  Audit an on-chain contract
  report --file <path.json>                   Render audit report as markdown
  list                                        List saved audit reports`);
    if (command) {
      console.error(`\nUnknown command: ${command}`);
      process.exit(1);
    }
}
