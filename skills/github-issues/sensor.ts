import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { getWorkflowByInstanceKey, insertWorkflow } from "../../src/db.ts";

const SENSOR_NAME = "github-issues";
const INTERVAL_MINUTES = 15;
const LOOKBACK_HOURS = 24;
const log = createSensorLogger(SENSOR_NAME);

const DEFAULT_REPOS = [
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/skills",
  "aibtcdev/landing-page",
];

interface SensorConfig {
  repos?: string[];
  assigned_to?: string[];
  labels?: string[];
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  pull_request?: unknown;
}

async function loadConfig(): Promise<SensorConfig> {
  const configPath = new URL("../../db/github-issues-config.json", import.meta.url).pathname;
  try {
    const file = Bun.file(configPath);
    if (await file.exists()) return (await file.json()) as SensorConfig;
  } catch {
    // missing or unparsable — fall through to defaults
  }
  return {};
}

async function fetchOpenIssues(repo: string, token?: string): Promise<GitHubIssue[]> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${repo}/issues?state=open&sort=updated&direction=desc&per_page=25&since=${encodeURIComponent(since)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    log(`GitHub API ${res.status} for ${repo}`);
    return [];
  }
  const data = (await res.json()) as GitHubIssue[];
  return data.filter((i) => !i.pull_request);
}

export default async function githubIssuesSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const config = await loadConfig();
    const repos = config.repos ?? DEFAULT_REPOS;
    const token = process.env.GITHUB_TOKEN;
    let created = 0;

    for (const repo of repos) {
      let issues: GitHubIssue[];
      try {
        issues = await fetchOpenIssues(repo, token);
      } catch (e) {
        log(`fetch failed for ${repo}: ${(e as Error).message}`);
        continue;
      }

      for (const issue of issues) {
        // Optional assignee filter
        if (config.assigned_to && config.assigned_to.length > 0) {
          const assigneeLogins = issue.assignees.map((a) => a.login);
          if (!config.assigned_to.some((u) => assigneeLogins.includes(u))) continue;
        }

        // Optional label filter
        if (config.labels && config.labels.length > 0) {
          const issueLabels = issue.labels.map((l) => l.name.toLowerCase());
          if (!config.labels.some((l) => issueLabels.includes(l.toLowerCase()))) continue;
        }

        // Workflow-based dedup: skip if a workflow instance already exists for this issue.
        // Key matches github-issue-monitor for cross-sensor dedup.
        const workflowKey = `github-issue-${repo}-${issue.number}`;
        if (getWorkflowByInstanceKey(workflowKey)) continue;

        // Create GithubIssueImplementationMachine instance at "detected" state.
        // The arc-workflows meta-sensor evaluates this every 5 minutes and creates
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
            labels: issue.labels.map((l) => l.name),
          }),
        });

        created++;
      }
    }

    if (created > 0) {
      log(`created ${created} github-issue-implementation workflow instance(s)`);
    }

    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
