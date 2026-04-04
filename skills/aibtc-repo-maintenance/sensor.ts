import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { getWorkflowByInstanceKey, insertWorkflow } from "../../src/db.ts";
import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

const SENSOR_NAME = "aibtc-repo-maintenance";
const INTERVAL_MINUTES = 15;

const log = createSensorLogger(SENSOR_NAME);

const WATCHED_REPOS = AIBTC_WATCHED_REPOS;

interface IssueInfo {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
}

function getRecentIssues(): IssueInfo[] {
  // Batch GraphQL query for open issues across all watched repos
  const fragments = WATCHED_REPOS.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `repo${i}: repository(owner: "${owner}", name: "${name}") {
      issues(states: OPEN, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          number
          title
          url
          author { login }
        }
      }
    }`;
  });

  const query = `query { ${fragments.join("\n")} }`;

  const result = Bun.spawnSync(
    ["gh", "api", "graphql", "-f", `query=${query}`],
    { timeout: 30_000 },
  );
  if (result.exitCode !== 0) return [];

  let data: Record<string, { issues: { nodes: Array<{
    number: number;
    title: string;
    url: string;
    author: { login: string };
  }> } }>;

  try {
    const parsed = JSON.parse(result.stdout.toString().trim()) as { data: typeof data };
    data = parsed.data;
  } catch {
    return [];
  }

  const issues: IssueInfo[] = [];
  for (let i = 0; i < WATCHED_REPOS.length; i++) {
    const repoData = data[`repo${i}`];
    if (!repoData) continue;
    const repo = WATCHED_REPOS[i];

    for (const item of repoData.issues.nodes) {
      issues.push({
        repo,
        number: item.number,
        title: item.title,
        author: item.author.login,
        url: item.url,
      });
    }
  }

  return issues;
}

/**
 * Create issue-opened workflow instances for new issues.
 * The arc-workflows sensor handles transitioning these when a PR links them.
 */
function trackIssueWorkflows(issues: IssueInfo[]): number {
  let created = 0;
  for (const issue of issues) {
    const [owner, repo] = issue.repo.split("/");
    const instanceKey = `${owner}/${repo}/issue/${issue.number}`;
    const existing = getWorkflowByInstanceKey(instanceKey);
    if (existing) continue;

    insertWorkflow({
      template: "pr-lifecycle",
      instance_key: instanceKey,
      current_state: "issue-opened",
      context: JSON.stringify({
        owner,
        repo,
        number: issue.number,
        title: issue.title,
        url: issue.url,
        author: issue.author,
        lastChecked: new Date().toISOString(),
      }),
    });
    created++;
  }
  return created;
}

export default async function aibtcMaintenanceSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Track open issues as workflow instances (issue-opened state)
  // PR review task creation is handled by PrLifecycleMachine in arc-workflows
  const issues = getRecentIssues();
  const issuesCreated = trackIssueWorkflows(issues);

  if (issuesCreated > 0) {
    log(`tracked ${issuesCreated} new issue(s)`);
  }

  return "ok";
}
