import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { taskExistsForSource, insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";
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

/** GitHub username Arc operates as — only create workflows for issues targeting this user. */
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
        // Only create workflows for issues where Arc is assigned or mentioned.
        // The github-mentions sensor handles notification-based engagement separately.
        const isAssigned = issue.assignees.includes(ARC_GITHUB_LOGIN);
        const isManaged = repoClass === "managed";
        if (!isAssigned && !isManaged) continue;

        // Canonical key shared with github-mentions sensor for cross-sensor dedup
        const canonicalSource = `issue:${repo}#${issue.number}`;
        const legacySource = `sensor:github-issue-monitor:${repo}#${issue.number}`;

        if (taskExistsForSource(canonicalSource) || taskExistsForSource(legacySource)) continue;

        // Workflow-based dedup: skip if a workflow instance already exists for this issue
        const workflowKey = `github-issue-${repo}-${issue.number}`;
        if (getWorkflowByInstanceKey(workflowKey)) continue;

        // Create a GithubIssueImplementationMachine instance at "detected" state.
        // The meta-sensor (arc-workflows) evaluates this every 5 minutes and creates
        // the planning task automatically via the machine's detected.action.
        insertWorkflow({
          template: "github-issue-implementation",
          instance_key: workflowKey,
          current_state: "detected",
          context: JSON.stringify({
            repo,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueUrl: issue.html_url,
            repoClass,
            labels: issue.labels,
          }),
        });

        totalCreated++;
      }
    }

    if (totalCreated > 0) {
      log(`created ${totalCreated} github-issue-implementation workflow instance(s)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
