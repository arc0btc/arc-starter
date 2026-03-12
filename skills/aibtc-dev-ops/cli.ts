#!/usr/bin/env bun

import { getCredential } from "../../src/credentials.ts";
import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

/** Repos for audit and status — shared canonical list (excludes worker-logs infrastructure). */
const AIBTC_REPOS: readonly string[] = AIBTC_WATCHED_REPOS;

const WORKER_LOGS_HOST = "https://logs.aibtc.com";

// ---- Helpers ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args], { timeout: 60_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

async function requireApiKey(): Promise<string> {
  let key: string | null = null;
  try {
    key = await getCredential("worker-logs", "aibtc_api_key");
  } catch {
    // credential store unavailable
  }
  if (!key) {
    process.stderr.write(
      "Error: worker-logs/aibtc_api_key credential not set.\n" +
      "Run: arc creds set --service worker-logs --key aibtc_api_key --value <KEY>\n"
    );
    process.exit(1);
  }
  return key;
}

async function requireAdminKey(): Promise<string> {
  let key: string | null = null;
  try {
    key = await getCredential("worker-logs", "aibtc_admin_api_key");
  } catch {
    // credential store unavailable
  }
  if (!key) {
    process.stderr.write(
      "Error: worker-logs/aibtc_admin_api_key credential not set.\n" +
      "Run: arc creds set --service worker-logs --key aibtc_admin_api_key --value <KEY>\n"
    );
    process.exit(1);
  }
  return key;
}

/** Fetch with API key auth (for /logs data queries). */
async function workerLogsFetchData(path: string, apiKey: string): Promise<unknown> {
  const url = `${WORKER_LOGS_HOST}${path}`;
  const resp = await fetch(url, {
    headers: { "X-Api-Key": apiKey, "X-App-ID": "aibtc-mainnet" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    process.stderr.write(`Error: worker-logs API returned ${resp.status} ${resp.statusText}\n`);
    process.exit(1);
  }
  return resp.json();
}

/** Fetch with admin key auth (for /apps management queries). */
async function workerLogsFetchAdmin(path: string, adminKey: string): Promise<unknown> {
  const url = `${WORKER_LOGS_HOST}${path}`;
  const resp = await fetch(url, {
    headers: { "X-Admin-Key": adminKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    process.stderr.write(`Error: worker-logs API returned ${resp.status} ${resp.statusText}\n`);
    process.exit(1);
  }
  return resp.json();
}

// ---- Commands ----

async function cmdLogs(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const apiKey = await requireApiKey();

  const params = new URLSearchParams();
  if (flags.app) params.set("app", flags.app);
  params.set("level", flags.level ?? "ERROR");
  params.set("limit", flags.limit ?? "50");
  if (flags.since) params.set("since", flags.since);

  const query = params.toString();
  const data = await workerLogsFetchData(`/logs?${query}`, apiKey);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdApps(): Promise<void> {
  const adminKey = await requireAdminKey();
  const data = await workerLogsFetchAdmin("/apps", adminKey);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdStats(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const adminKey = await requireAdminKey();

  const params = new URLSearchParams();
  if (flags.app) params.set("app", flags.app);
  params.set("days", flags.days ?? "7");

  const query = params.toString();
  const data = await workerLogsFetchAdmin(`/stats?${query}`, adminKey);
  console.log(JSON.stringify(data, null, 2));
}

function cmdAudit(args: string[]): void {
  const flags = parseFlags(args);
  const repos = flags.repo ? [flags.repo] : AIBTC_REPOS;

  if (flags.repo && !AIBTC_REPOS.includes(flags.repo)) {
    process.stderr.write(
      `Error: repo '${flags.repo}' not in AIBTC repos list.\nRepos: ${AIBTC_REPOS.join(", ")}\n`
    );
    process.exit(1);
  }

  const results: Array<{
    repo: string;
    checklist: Array<{ item: string; pass: boolean; detail: string }>;
  }> = [];

  for (const repo of repos) {
    const checks: Array<{ item: string; pass: boolean; detail: string }> = [];

    // 1. TypeScript strict
    const tsconfig = gh(["api", `repos/${repo}/contents/tsconfig.json`, "--jq", ".content"]);
    if (tsconfig.ok && tsconfig.stdout) {
      try {
        const content = Buffer.from(tsconfig.stdout, "base64").toString("utf-8");
        const hasStrict = content.includes('"strict"') && content.includes("true");
        checks.push({ item: "TypeScript strict", pass: hasStrict, detail: hasStrict ? "strict: true" : "strict mode not enabled" });
      } catch {
        checks.push({ item: "TypeScript strict", pass: false, detail: "could not parse tsconfig.json" });
      }
    } else {
      checks.push({ item: "TypeScript strict", pass: false, detail: "no tsconfig.json" });
    }

    // 2. Tests exist
    const tests = gh(["api", `repos/${repo}/git/trees/main?recursive=1`, "--jq",
      '[.tree[].path | select(test("\\\\.(test|spec)\\\\.ts$"))] | length']);
    if (tests.ok) {
      const count = parseInt(tests.stdout, 10);
      const hasTests = !isNaN(count) && count > 0;
      checks.push({ item: "Tests exist", pass: hasTests, detail: hasTests ? `${count} test file(s)` : "no test files" });
    } else {
      checks.push({ item: "Tests exist", pass: false, detail: "could not check" });
    }

    // 3. CI runs tests
    const workflows = gh(["api", `repos/${repo}/contents/.github/workflows`, "--jq", "[.[].name] | length"]);
    const hasCI = workflows.ok && parseInt(workflows.stdout, 10) > 0;
    checks.push({ item: "CI workflows", pass: hasCI, detail: hasCI ? `${workflows.stdout} workflow(s)` : "no workflows" });

    // 4. Worker-logs binding
    const wranglerJsonc = gh(["api", `repos/${repo}/contents/wrangler.jsonc`, "--jq", ".content"]);
    const wranglerToml = gh(["api", `repos/${repo}/contents/wrangler.toml`, "--jq", ".content"]);
    const isWorkersProject = wranglerJsonc.ok || wranglerToml.ok;

    if (isWorkersProject) {
      let wranglerContent = "";
      if (wranglerJsonc.ok && wranglerJsonc.stdout) {
        try { wranglerContent = Buffer.from(wranglerJsonc.stdout, "base64").toString("utf-8"); } catch { /* skip */ }
      } else if (wranglerToml.ok && wranglerToml.stdout) {
        try { wranglerContent = Buffer.from(wranglerToml.stdout, "base64").toString("utf-8"); } catch { /* skip */ }
      }
      const hasLogBinding = wranglerContent.includes("github-worker-logs") || wranglerContent.includes("LOGS");
      checks.push({ item: "Worker-logs binding", pass: hasLogBinding, detail: hasLogBinding ? "binding found" : "no worker-logs binding" });

      // 5. Staging/prod split
      const hasStagingProd = wranglerContent.includes("staging") && wranglerContent.includes("production");
      checks.push({ item: "Staging/prod split", pass: hasStagingProd, detail: hasStagingProd ? "environments configured" : "missing staging/production envs" });

      // 7. wrangler.jsonc
      checks.push({ item: "wrangler.jsonc", pass: wranglerJsonc.ok, detail: wranglerJsonc.ok ? "using .jsonc" : "using .toml" });
    } else {
      checks.push({ item: "Worker-logs binding", pass: false, detail: "not a Workers project" });
      checks.push({ item: "Staging/prod split", pass: false, detail: "not a Workers project" });
      checks.push({ item: "wrangler.jsonc", pass: false, detail: "not a Workers project" });
    }

    // 6. Release-please (required — raw merge-to-main deploys are a gap)
    const releasePlease = gh(["api", `repos/${repo}/contents/.release-please-manifest.json`, "--jq", ".name"]);
    const releasePleaseConfig = gh(["api", `repos/${repo}/contents/release-please-config.json`, "--jq", ".name"]);
    const hasReleasePlease = releasePlease.ok || releasePleaseConfig.ok;
    checks.push({ item: "Release-please", pass: hasReleasePlease, detail: hasReleasePlease ? "configured" : "not configured" });

    results.push({ repo, checklist: checks });
  }

  // Summary
  const summary = results.map((r) => ({
    repo: r.repo,
    passing: r.checklist.filter((c) => c.pass).length,
    failing: r.checklist.filter((c) => !c.pass).length,
    total: r.checklist.length,
    gaps: r.checklist.filter((c) => !c.pass).map((c) => c.item),
  }));

  console.log(JSON.stringify({ repos: results, summary }, null, 2));
}

function cmdStatus(): void {
  const repos: Array<{
    repo: string;
    openIssues: number;
    prodGradeIssues: number;
    openPrs: number;
  }> = [];

  for (const repo of AIBTC_REPOS) {
    // Open issues
    const issueResult = gh([
      "issue", "list",
      "--repo", repo,
      "--state", "open",
      "--json", "number",
      "--limit", "100",
    ]);

    // Prod-grade labeled issues
    const prodGradeResult = gh([
      "issue", "list",
      "--repo", repo,
      "--state", "open",
      "--label", "prod-grade",
      "--json", "number",
      "--limit", "100",
    ]);

    // Open PRs
    const prResult = gh([
      "pr", "list",
      "--repo", repo,
      "--state", "open",
      "--json", "number",
      "--limit", "25",
    ]);

    let openIssues = 0;
    let prodGradeIssues = 0;
    let openPrs = 0;

    if (issueResult.ok) {
      try { openIssues = (JSON.parse(issueResult.stdout) as unknown[]).length; } catch { /* skip */ }
    }
    if (prodGradeResult.ok) {
      try { prodGradeIssues = (JSON.parse(prodGradeResult.stdout) as unknown[]).length; } catch { /* skip */ }
    }
    if (prResult.ok) {
      try { openPrs = (JSON.parse(prResult.stdout) as unknown[]).length; } catch { /* skip */ }
    }

    repos.push({ repo, openIssues, prodGradeIssues, openPrs });
  }

  console.log(JSON.stringify({ repos }, null, 2));
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(
    `aibtc-dev CLI

USAGE
  arc skills run --name aibtc-dev -- <subcommand> [flags]

SUBCOMMANDS
  logs               Query worker-logs REST API for errors
    --app ID           Filter by app (omit for all)
    --level LEVEL      Log level (default: ERROR)
    --since ISO        Start time (default: last 4h)
    --limit N          Max entries (default: 50)

  apps               List all registered worker-logs apps

  stats              Get daily log stats
    --app ID           Filter by app (omit for all)
    --days N           Lookback period (default: 7)

  audit              Run production-grade checklist
    --repo REPO        Single repo (omit for all 12)

  status             Overview of all AIBTC repos

AIBTC REPOS
  ${AIBTC_REPOS.join("\n  ")}
`
  );
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "logs":
      await cmdLogs(args.slice(1));
      break;
    case "apps":
      await cmdApps();
      break;
    case "stats":
      await cmdStats(args.slice(1));
      break;
    case "audit":
      cmdAudit(args.slice(1));
      break;
    case "status":
      cmdStatus();
      break;
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main();
