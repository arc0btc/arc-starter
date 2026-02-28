#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

const WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
];

const GITHUB_USER = "arc0btc";

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
  const result = spawnSync("gh", args, { timeout: 60_000 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
  };
}

function validateRepo(repo: string): void {
  if (!WATCHED_REPOS.includes(repo)) {
    process.stderr.write(
      `Error: repo '${repo}' not in watched list.\nWatched: ${WATCHED_REPOS.join(", ")}\n`
    );
    process.exit(1);
  }
}

// ---- Commands ----

function cmdReviewPr(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.repo || !flags.pr) {
    process.stderr.write(
      "Usage: arc skills run --name aibtc-maintenance -- review-pr --repo OWNER/REPO --pr NUMBER\n"
    );
    process.exit(1);
  }

  validateRepo(flags.repo);
  const prNumber = flags.pr;

  // Fetch PR details
  const details = gh([
    "pr", "view", prNumber,
    "--repo", flags.repo,
    "--json", "title,author,body,files,additions,deletions,baseRefName,headRefName,state",
  ]);

  if (!details.ok) {
    process.stderr.write(`Error fetching PR: ${details.stderr}\n`);
    process.exit(1);
  }

  // Fetch PR diff
  const diff = gh(["pr", "diff", prNumber, "--repo", flags.repo]);

  if (!diff.ok) {
    process.stderr.write(`Error fetching diff: ${diff.stderr}\n`);
    process.exit(1);
  }

  // Fetch PR comments for context
  const comments = gh([
    "pr", "view", prNumber,
    "--repo", flags.repo,
    "--json", "comments,reviews",
  ]);

  const output = {
    pr: JSON.parse(details.stdout),
    diff: diff.stdout,
    existingReviews: comments.ok ? JSON.parse(comments.stdout) : null,
  };

  console.log(JSON.stringify(output, null, 2));
}

function cmdTriageIssues(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.repo) {
    process.stderr.write(
      "Usage: arc skills run --name aibtc-maintenance -- triage-issues --repo OWNER/REPO\n"
    );
    process.exit(1);
  }

  validateRepo(flags.repo);

  const result = gh([
    "issue", "list",
    "--repo", flags.repo,
    "--state", "open",
    "--json", "number,title,author,labels,createdAt,comments",
    "--limit", "25",
  ]);

  if (!result.ok) {
    process.stderr.write(`Error fetching issues: ${result.stderr}\n`);
    process.exit(1);
  }

  const issues = JSON.parse(result.stdout) as Array<{
    number: number;
    title: string;
    author: { login: string };
    labels: Array<{ name: string }>;
    createdAt: string;
    comments: Array<{ author: { login: string } }>;
  }>;

  const triage = issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    author: issue.author.login,
    labels: issue.labels.map((l) => l.name),
    createdAt: issue.createdAt,
    commentCount: issue.comments.length,
    weCommented: issue.comments.some((c) => c.author.login === GITHUB_USER),
  }));

  console.log(JSON.stringify({ repo: flags.repo, issueCount: triage.length, issues: triage }, null, 2));
}

function cmdChangelog(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.repo) {
    process.stderr.write(
      "Usage: arc skills run --name aibtc-maintenance -- changelog --repo OWNER/REPO [--days N]\n"
    );
    process.exit(1);
  }

  validateRepo(flags.repo);
  const days = parseInt(flags.days ?? "7", 10);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const result = gh([
    "pr", "list",
    "--repo", flags.repo,
    "--state", "merged",
    "--json", "number,title,author,mergedAt,labels",
    "--limit", "50",
    "--search", `merged:>=${since}`,
  ]);

  if (!result.ok) {
    process.stderr.write(`Error fetching merged PRs: ${result.stderr}\n`);
    process.exit(1);
  }

  const prs = JSON.parse(result.stdout) as Array<{
    number: number;
    title: string;
    author: { login: string };
    mergedAt: string;
    labels: Array<{ name: string }>;
  }>;

  const changelog = prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.author.login,
    mergedAt: pr.mergedAt,
    labels: pr.labels.map((l) => l.name),
  }));

  console.log(JSON.stringify({ repo: flags.repo, since, prCount: changelog.length, prs: changelog }, null, 2));
}

function cmdTestIntegration(): void {
  const root = new URL("../..", import.meta.url).pathname;

  // Run sensors once and capture output
  const sensorsResult = spawnSync("bash", ["bin/arc", "sensors"], {
    cwd: root,
    timeout: 120_000,
  });

  const output = {
    sensors: {
      ok: sensorsResult.status === 0,
      stdout: sensorsResult.stdout?.toString().trim() ?? "",
      stderr: sensorsResult.stderr?.toString().trim() ?? "",
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

function cmdStatus(): void {
  const repos: Array<{
    repo: string;
    openPrs: number;
    unreviewedPrs: number;
    openIssues: number;
  }> = [];

  for (const repo of WATCHED_REPOS) {
    const prResult = gh([
      "pr", "list",
      "--repo", repo,
      "--state", "open",
      "--json", "number,reviews",
      "--limit", "25",
    ]);

    const issueResult = gh([
      "issue", "list",
      "--repo", repo,
      "--state", "open",
      "--json", "number",
      "--limit", "100",
    ]);

    let openPrs = 0;
    let unreviewedPrs = 0;
    let openIssues = 0;

    if (prResult.ok) {
      try {
        const prs = JSON.parse(prResult.stdout) as Array<{
          number: number;
          reviews: Array<{ author: { login: string } }>;
        }>;
        openPrs = prs.length;
        unreviewedPrs = prs.filter(
          (pr) => !pr.reviews.some((r) => r.author.login === GITHUB_USER)
        ).length;
      } catch {
        // skip
      }
    }

    if (issueResult.ok) {
      try {
        const issues = JSON.parse(issueResult.stdout) as Array<{ number: number }>;
        openIssues = issues.length;
      } catch {
        // skip
      }
    }

    repos.push({ repo, openPrs, unreviewedPrs, openIssues });
  }

  console.log(JSON.stringify({ repos }, null, 2));
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(
    `aibtc-maintenance CLI

USAGE
  arc skills run --name aibtc-maintenance -- <subcommand> [flags]

SUBCOMMANDS
  review-pr          Fetch PR diff and details for review
    --repo REPO        Owner/repo (e.g., aibtcdev/landing-page)
    --pr NUMBER        PR number

  triage-issues      List and triage open issues
    --repo REPO        Owner/repo

  changelog          Summarize recently merged PRs
    --repo REPO        Owner/repo
    --days N           Lookback period (default: 7)

  test-integration   Run sensors once, report upstream failures

  status             Show state of all watched repos

WATCHED REPOS
  ${WATCHED_REPOS.join("\n  ")}
`
  );
}

// ---- Entry point ----

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "review-pr":
      cmdReviewPr(args.slice(1));
      break;
    case "triage-issues":
      cmdTriageIssues(args.slice(1));
      break;
    case "changelog":
      cmdChangelog(args.slice(1));
      break;
    case "test-integration":
      cmdTestIntegration();
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
