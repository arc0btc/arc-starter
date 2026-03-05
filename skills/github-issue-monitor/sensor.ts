import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { taskExistsForSource } from "../../src/db.ts";
import { classifyRepo } from "../../src/constants.ts";

const SENSOR_NAME = "github-issue-monitor";
const INTERVAL_MINUTES = 15;
const log = createSensorLogger(SENSOR_NAME);

/** Repos to monitor for issues. Managed + collaborative orgs. */
const MONITORED_REPOS = [
  "arc0btc/arc-starter",
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
  "aibtcdev/agent-news",
] as const;

interface GitHubIssue {
  number: number;
  title: string;
  user: string;
  labels: string[];
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

function since24h(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function fetchOpenIssues(repo: string): GitHubIssue[] {
  const result = gh([
    "api", `/repos/${repo}/issues`,
    "--method", "GET",
    "-f", "state=open",
    "-f", "per_page=25",
    "-f", "sort=updated",
    "-f", "direction=desc",
    "-f", `since=${since24h()}`,
    "--jq",
    `.[] | select(.pull_request == null) | {number: .number, title: .title, user: .user.login, labels: [.labels[].name], html_url: .html_url, created_at: .created_at, updated_at: .updated_at}`,
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
        const source = `sensor:github-issue-monitor:${repo}#${issue.number}`;

        if (taskExistsForSource(source)) continue;

        const labelStr = issue.labels.length > 0 ? `\nLabels: ${issue.labels.join(", ")}` : "";
        const priority = repoClass === "managed" ? 4 : 5;

        // Enrich skills based on issue title keywords
        const titleLower = issue.title.toLowerCase();
        const extraSkills: string[] = [];
        if (/x402|agent.*collab|engagement/.test(titleLower)) {
          extraSkills.push("social-agent-engagement");
        }
        const issueSkills = ["aibtc-repo-maintenance", ...extraSkills];

        insertTaskIfNew(source, {
          subject: `GitHub issue in ${repo}#${issue.number}: ${issue.title}`,
          description: [
            `New issue opened by ${issue.user} in ${repo}`,
            `Repo class: ${repoClass}`,
            `Title: ${issue.title}`,
            `URL: ${issue.html_url}`,
            labelStr ? `Labels: ${issue.labels.join(", ")}` : "",
            "",
            "Instructions:",
            `1. Read the issue: gh issue view --repo ${repo} ${issue.number}`,
            "2. Assess the issue — is it actionable? Does it need triage, a fix, or a response?",
            "3. For managed repos: take ownership and fix or respond.",
            "4. For collaborative repos: comment if you can help, or leave for maintainers.",
            "5. Close this task with a summary of what you did.",
          ].filter(Boolean).join("\n"),
          skills: JSON.stringify(issueSkills),
          priority,
          model: "sonnet",
        }, "any");

        totalCreated++;
      }
    }

    if (totalCreated > 0) {
      log(`created ${totalCreated} issue task(s)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
