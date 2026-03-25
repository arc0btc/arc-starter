import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { classifyRepo } from "../../src/constants.ts";

const SENSOR_NAME = "github-issue-monitor";
const INTERVAL_MINUTES = 15;
const LOOKBACK_HOURS = 4;
const log = createSensorLogger(SENSOR_NAME);

/** Repos to monitor for issues. Managed + collaborative orgs. */
const MONITORED_REPOS = [
  "arc0btc/arc-starter",
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/agent-news",
  "aibtcdev/loop-starter-kit",
  "aibtcdev/x402-sponsor-relay",
  "secret-mars/loop-starter-kit",
] as const;

/** GitHub username Arc operates as — only create tasks for issues targeting this user. */
const ARC_GITHUB_LOGIN = "arc0btc";

interface GitHubIssue {
  number: number;
  title: string;
  user: string;
  labels: string[];
  assignees: string[];
  html_url: string;
  created_at: string;
  updated_at: string;
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args], { timeout: 30_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function sinceWindow(): string {
  return new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
}

function fetchOpenIssues(repo: string): GitHubIssue[] {
  const result = gh([
    "api", `/repos/${repo}/issues`,
    "--method", "GET",
    "-f", "state=open",
    "-f", "per_page=25",
    "-f", "sort=updated",
    "-f", "direction=desc",
    "-f", `since=${sinceWindow()}`,
    "--jq",
    `.[] | select(.pull_request == null) | {number: .number, title: .title, user: .user.login, labels: [.labels[].name], assignees: [.assignees[].login], html_url: .html_url, created_at: .created_at, updated_at: .updated_at}`,
  ]);

  if (!result.ok || !result.stdout) return [];

  const issues: GitHubIssue[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      issues.push(JSON.parse(line) as GitHubIssue);
    } catch {
      // skip malformed lines
    }
  }
  return issues;
}

export default async function githubIssueMonitorSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    let totalCreated = 0;

    for (const repo of MONITORED_REPOS) {
      const issues = fetchOpenIssues(repo);
      if (issues.length === 0) continue;

      const repoClass = classifyRepo(repo);

      for (const issue of issues) {
        // Managed repos: triage all issues (Arc owns these repos)
        // Collaborative repos: only triage when Arc is explicitly assigned
        const isAssigned = issue.assignees.includes(ARC_GITHUB_LOGIN);
        if (repoClass !== "managed" && !isAssigned) continue;

        // Canonical key shared with github-mentions sensor for cross-sensor dedup
        const canonicalSource = `issue:${repo}#${issue.number}`;
        const priority = repoClass === "managed" ? 4 : 5;

        const id = insertTaskIfNew(canonicalSource, {
          subject: `GitHub issue in ${repo}#${issue.number}: ${issue.title}`,
          description: [
            `Triage GitHub issue: ${issue.html_url}`,
            `Repo class: ${repoClass} | Author: ${issue.user} | Labels: ${issue.labels.join(", ") || "none"}`,
            "",
            "Steps:",
            "1. Read the issue: gh issue view --repo " + repo + " " + issue.number,
            "2. Check for related open issues, recent PRs, and CI status",
            "3. Cross-reference with operational experience — have sensors/logs seen related signals?",
            repoClass === "managed"
              ? "4. Take ownership: fix, close, or create a follow-up task"
              : "4. Add context and triage. Open a PR if fixable. Let whoabuddy decide on closure.",
            "5. Close this task with a summary of what you found and did",
          ].join("\n"),
          priority,
          model: "sonnet",
          skills: JSON.stringify(["github-issue-monitor"]),
        }, "any");

        if (id !== null) totalCreated++;
      }
    }

    if (totalCreated > 0) {
      log(`created ${totalCreated} triage task(s)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
