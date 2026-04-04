#!/usr/bin/env bun

import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

const WATCHED_REPOS = AIBTC_WATCHED_REPOS;

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
  const result = Bun.spawnSync(["gh", ...args], { timeout: 60_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function validateRepo(repo: string): void {
  if (!(WATCHED_REPOS as readonly string[]).includes(repo)) {
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
      "Usage: arc skills run --name aibtc-repo-maintenance -- review-pr --repo OWNER/REPO --pr NUMBER\n"
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
      "Usage: arc skills run --name aibtc-repo-maintenance -- triage-issues --repo OWNER/REPO\n"
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
      "Usage: arc skills run --name aibtc-repo-maintenance -- changelog --repo OWNER/REPO [--days N]\n"
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
  const sensorsResult = Bun.spawnSync(["bash", "bin/arc", "sensors"], {
    cwd: root,
    timeout: 120_000,
  });

  const output = {
    sensors: {
      ok: sensorsResult.exitCode === 0,
      stdout: sensorsResult.stdout.toString().trim(),
      stderr: sensorsResult.stderr.toString().trim(),
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

function cmdStatus(): void {
  // Single GraphQL query fetches open PRs + issues for all watched repos at once
  // (replaces 2 REST calls per repo = 10 calls → 1 call)
  const fragments = WATCHED_REPOS.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `repo${i}: repository(owner: "${owner}", name: "${name}") {
      pullRequests(states: OPEN, first: 25, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        nodes {
          reviews(first: 50) { nodes { author { login } } }
        }
      }
      issues(states: OPEN, first: 1) {
        totalCount
      }
    }`;
  });

  const query = `query { ${fragments.join("\n")} }`;
  const result = gh(["api", "graphql", "-f", `query=${query}`]);

  if (!result.ok) {
    process.stderr.write(`Error fetching status: ${result.stderr}\n`);
    process.exit(1);
  }

  type RepoData = {
    pullRequests: {
      totalCount: number;
      nodes: Array<{ reviews: { nodes: Array<{ author: { login: string } }> } }>;
    };
    issues: { totalCount: number };
  };

  const data = (JSON.parse(result.stdout) as { data: Record<string, RepoData> }).data;

  const repos = WATCHED_REPOS.map((repo, i) => {
    const repoData = data[`repo${i}`];
    if (!repoData) return { repo, openPrs: 0, unreviewedPrs: 0, openIssues: 0 };

    const openPrs = repoData.pullRequests.totalCount;
    const unreviewedPrs = repoData.pullRequests.nodes.filter(
      (pr) => !pr.reviews.nodes.some((r) => r.author.login === GITHUB_USER)
    ).length;
    const openIssues = repoData.issues.totalCount;

    return { repo, openPrs, unreviewedPrs, openIssues };
  });

  console.log(JSON.stringify({ repos }, null, 2));
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(
    `aibtc-repo-maintenance CLI

USAGE
  arc skills run --name aibtc-repo-maintenance -- <subcommand> [flags]

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
