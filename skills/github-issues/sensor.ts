// skills/github-issues/sensor.ts
//
// Polls configured GitHub repos for newly opened or updated issues.
// Creates triage tasks with priority based on issue labels.
// Cadence: every 15 minutes.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "github-issues";
const INTERVAL_MINUTES = 15;

const log = createSensorLogger(SENSOR_NAME);

const CONFIG_PATH = new URL("../../db/github-issues-config.json", import.meta.url).pathname;

interface IssueConfig {
  repos: string[];
  assigned_to?: string[];
  labels?: string[];
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
}

async function loadConfig(): Promise<IssueConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    const text = await file.text();
    return JSON.parse(text) as IssueConfig;
  } catch {
    return {
      repos: [
        "aibtcdev/aibtc-mcp-server",
        "aibtcdev/skills",
        "aibtcdev/landing-page",
      ],
    };
  }
}

function classifyIssue(issue: GitHubIssue): { priority: number; model: string } {
  const names = issue.labels.map((l) => l.name.toLowerCase());
  if (names.some((n) => n.includes("bug") || n.includes("security") || n.includes("critical"))) {
    return { priority: 3, model: "opus" };
  }
  if (names.some((n) => n.includes("feature") || n.includes("enhancement"))) {
    return { priority: 5, model: "sonnet" };
  }
  if (names.some((n) => n.includes("question") || n.includes("doc") || n.includes("help"))) {
    return { priority: 7, model: "haiku" };
  }
  return { priority: 5, model: "sonnet" };
}

async function fetchIssues(repo: string, since: string, token?: string): Promise<GitHubIssue[]> {
  const url = `https://api.github.com/repos/${repo}/issues?state=open&sort=updated&since=${encodeURIComponent(since)}&per_page=30`;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 403 || response.status === 401) {
    throw new Error(`GitHub API auth error ${response.status} — check GITHUB_TOKEN`);
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${repo}`);
  }

  const data = await response.json() as GitHubIssue[];
  // Exclude PRs (GitHub issues endpoint returns PRs too)
  return data.filter((i) => !i.pull_request);
}

function matchesFilter(issue: GitHubIssue, config: IssueConfig): boolean {
  const hasAssigneeFilter = (config.assigned_to?.length ?? 0) > 0;
  const hasLabelFilter = (config.labels?.length ?? 0) > 0;

  if (hasAssigneeFilter) {
    const loginSet = new Set(issue.assignees.map((a) => a.login.toLowerCase()));
    return config.assigned_to!.some((u) => loginSet.has(u.toLowerCase()));
  }

  if (hasLabelFilter) {
    const labelSet = new Set(issue.labels.map((l) => l.name.toLowerCase()));
    return config.labels!.some((l) => labelSet.has(l.toLowerCase()));
  }

  // No filter = accept all
  return true;
}

export default async function githubIssuesSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const config = await loadConfig();
    const token = process.env.GITHUB_TOKEN;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let created = 0;
    let skipped = 0;

    for (const repo of config.repos) {
      try {
        const issues = await fetchIssues(repo, since, token);
        log(`${repo}: ${issues.length} issue(s) updated in last 24h`);

        for (const issue of issues) {
          if (!matchesFilter(issue, config)) {
            skipped++;
            continue;
          }

          const source = `sensor:github-issues:${repo}#${issue.number}`;
          if (pendingTaskExistsForSource(source)) {
            skipped++;
            continue;
          }

          const { priority, model } = classifyIssue(issue);
          const labelList = issue.labels.map((l) => l.name).join(", ");
          const assigneeList = issue.assignees.map((a) => a.login).join(", ");

          insertTask({
            subject: `[github-issues] ${repo}#${issue.number}: ${issue.title}`,
            description: [
              `GitHub issue in ${repo}`,
              ``,
              `URL: ${issue.html_url}`,
              `Labels: ${labelList || "(none)"}`,
              `Assignees: ${assigneeList || "(none)"}`,
              ``,
              issue.body?.slice(0, 600) ?? "(no body)",
              ``,
              `Triage: arc skills run --name github-issues -- triage --repo ${repo} --issue ${issue.number}`,
              `Analyze: arc skills run --name github-issues -- analyze --repo ${repo} --issue ${issue.number} --path .`,
            ].join("\n"),
            skills: JSON.stringify(["github-issues"]),
            source,
            priority,
            model,
          });

          created++;
          log(`created task for ${repo}#${issue.number} p${priority} (${model})`);
        }
      } catch (e) {
        log(`error fetching ${repo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    log(`run complete: ${created} created, ${skipped} skipped`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
