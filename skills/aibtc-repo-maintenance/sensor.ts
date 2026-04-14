import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  completeWorkflow,
  getWorkflowByInstanceKey,
  getWorkflowsByTemplate,
  insertWorkflow,
  updateWorkflowState,
} from "../../src/db.ts";
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

/**
 * Auto-transition approved PR workflows to merged/closed when GitHub PR state changes.
 * Checks all active pr-lifecycle workflows in 'approved' state.
 */
function resolveApprovedPrWorkflows(): number {
  const approvedWorkflows = getWorkflowsByTemplate("pr-lifecycle").filter(
    (w) => w.current_state === "approved" && w.completed_at === null,
  );

  let resolved = 0;
  for (const workflow of approvedWorkflows) {
    // instance_key format: owner/repo/number (PRs) or owner/repo/issue/number (issues)
    const parts = workflow.instance_key.split("/");
    let owner: string, repo: string, numberStr: string;
    if (parts.length === 3) {
      [owner, repo, numberStr] = parts;
    } else if (parts.length === 4 && parts[2] === "pr") {
      [owner, repo, , numberStr] = parts;
    } else {
      continue;
    }
    const prRef = `${owner}/${repo}#${numberStr}`;

    const result = Bun.spawnSync(
      ["gh", "pr", "view", numberStr, "--repo", `${owner}/${repo}`, "--json", "state,mergedAt"],
      { timeout: 15_000 },
    );
    if (result.exitCode !== 0) continue;

    let state: string;
    let mergedAt: string | null;
    try {
      const parsed = JSON.parse(result.stdout.toString().trim()) as { state: string; mergedAt: string | null };
      state = parsed.state;
      mergedAt = parsed.mergedAt;
    } catch {
      continue;
    }

    if (state === "MERGED" || mergedAt) {
      updateWorkflowState(workflow.id, "merged", workflow.context);
      completeWorkflow(workflow.id);
      log(`auto-transitioned approved→merged workflow for ${prRef}`);
      resolved++;
    } else if (state === "CLOSED") {
      updateWorkflowState(workflow.id, "closed", workflow.context);
      completeWorkflow(workflow.id);
      log(`auto-transitioned approved→closed workflow for ${prRef}`);
      resolved++;
    }
  }
  return resolved;
}

/**
 * Close issue-opened workflows whose GitHub issues have since been closed.
 * Only checks issues older than 24h to avoid unnecessary API calls for new issues.
 */
function closeStaleIssueWorkflows(): number {
  const allIssueWorkflows = getWorkflowsByTemplate("pr-lifecycle").filter(
    (w) => w.current_state === "issue-opened" && w.completed_at === null,
  );

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const toCheck = allIssueWorkflows.filter((w) => w.created_at < cutoff);

  let closed = 0;
  for (const workflow of toCheck) {
    // instance_key format: owner/repo/issue/number
    const parts = workflow.instance_key.split("/");
    if (parts.length < 4) continue;
    const [owner, repo, , numberStr] = parts;
    const issueRef = `${owner}/${repo}#${numberStr}`;

    const result = Bun.spawnSync(
      ["gh", "issue", "view", numberStr, "--repo", `${owner}/${repo}`, "--json", "state"],
      { timeout: 15_000 },
    );
    if (result.exitCode !== 0) continue;

    let state: string;
    try {
      const parsed = JSON.parse(result.stdout.toString().trim()) as { state: string };
      state = parsed.state;
    } catch {
      continue;
    }

    if (state === "CLOSED") {
      updateWorkflowState(workflow.id, "closed", workflow.context);
      completeWorkflow(workflow.id);
      log(`closed stale issue-opened workflow for ${issueRef}`);
      closed++;
    }
  }
  return closed;
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

  // Close workflows for issues that have since been closed on GitHub
  const issuesClosed = closeStaleIssueWorkflows();
  if (issuesClosed > 0) {
    log(`closed ${issuesClosed} stale issue-opened workflow(s)`);
  }

  // Auto-transition approved PR workflows when PR is merged/closed on GitHub
  const prResolved = resolveApprovedPrWorkflows();
  if (prResolved > 0) {
    log(`resolved ${prResolved} approved PR workflow(s)`);
  }

  return "ok";
}
