import { claimSensorRun } from "../../src/sensors.ts";
import {
  initDatabase,
  insertTask,
  getAllActiveWorkflows,
  updateWorkflowState,
  getWorkflowByInstanceKey,
  insertWorkflow,
  completeWorkflow,
} from "../../src/db.ts";
import {
  evaluateWorkflow,
  getTemplateByName,
  type WorkflowAction,
} from "./state-machine.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "workflows-meta";
const INTERVAL_MINUTES = 5;

interface GithubPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "closed";
  merged?: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "PENDING" | null;
}

type WorkflowState =
  | "opened"
  | "review-requested"
  | "changes-requested"
  | "approved"
  | "merged"
  | "closed";

/**
 * Map GitHub PR state to workflow state
 */
function mapPRStateToWorkflowState(pr: GithubPR): WorkflowState {
  // Terminal states first
  if (pr.state === "closed" && pr.merged) {
    return "merged";
  }
  if (pr.state === "closed") {
    return "closed";
  }

  // Open PR state machine
  if (pr.reviewDecision === "APPROVED") {
    return "approved";
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return "changes-requested";
  }
  if (pr.reviewDecision === "PENDING") {
    return "review-requested";
  }

  // Default to opened if no review decision yet
  return "opened";
}

/**
 * Fetch PRs from GitHub API for specified repos
 */
async function fetchGitHubPRs(repos: string[]): Promise<GithubPR[]> {
  const token = getCredential("github", "token");
  if (!token) {
    console.warn("pr-lifecycle: github token not found in credentials");
    return [];
  }

  const prs: GithubPR[] = [];

  for (const repoPath of repos) {
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) {
      console.warn(`pr-lifecycle: invalid repo path: ${repoPath}`);
      continue;
    }

    try {
      const query = `
        query {
          repository(owner: "${owner}", name: "${repo}") {
            pullRequests(first: 50, states: [OPEN, CLOSED]) {
              nodes {
                number
                title
                url
                author {
                  login
                }
                state
                merged
                reviewDecision
              }
            }
          }
        }
      `;

      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        console.warn(
          `pr-lifecycle: GitHub API error for ${repoPath}: ${response.status}`
        );
        continue;
      }

      const data = (await response.json()) as {
        data?: {
          repository?: {
            pullRequests?: {
              nodes?: Array<{
                number: number;
                title: string;
                url: string;
                author?: { login: string };
                state: string;
                merged?: boolean;
                reviewDecision?: string | null;
              }>;
            };
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (data.errors) {
        console.warn(
          `pr-lifecycle: GraphQL error for ${repoPath}: ${data.errors.map((e) => e.message).join(", ")}`
        );
        continue;
      }

      const nodes = data.data?.repository?.pullRequests?.nodes || [];
      for (const node of nodes) {
        prs.push({
          owner,
          repo,
          number: node.number,
          title: node.title,
          url: node.url,
          author: node.author?.login || "unknown",
          state: (node.state.toLowerCase() === "open"
            ? "open"
            : "closed") as "open" | "closed",
          merged: node.merged,
          reviewDecision: node.reviewDecision as
            | "APPROVED"
            | "CHANGES_REQUESTED"
            | "PENDING"
            | null
            | undefined,
        });
      }
    } catch (err) {
      console.warn(
        `pr-lifecycle: error fetching ${repoPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return prs;
}

/**
 * Handle GitHub PR state changes: create or update workflow instances
 */
async function syncGitHubPRs(): Promise<number> {
  // Repos to monitor (configurable via env or default list)
  const reposEnv = Bun.env.PR_LIFECYCLE_REPOS;
  const repos = reposEnv
    ? reposEnv.split(",").map((r) => r.trim())
    : ["arc0btc/arc-starter", "arc0btc/arc0me-site"];

  const prs = await fetchGitHubPRs(repos);
  if (prs.length === 0) return 0;

  let workflowsCreated = 0;
  let workflowsUpdated = 0;

  for (const pr of prs) {
    const instanceKey = `${pr.owner}/${pr.repo}/${pr.number}`;
    const newState = mapPRStateToWorkflowState(pr);

    let workflow = getWorkflowByInstanceKey(instanceKey);

    if (!workflow) {
      // Create new workflow
      insertWorkflow({
        template: "pr-lifecycle",
        instance_key: instanceKey,
        current_state: newState,
        context: JSON.stringify({
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          lastChecked: new Date().toISOString(),
        }),
      });
      workflowsCreated++;
    } else if (workflow.current_state !== newState) {
      // Update workflow if state changed
      updateWorkflowState(
        workflow.id,
        newState,
        JSON.stringify({
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          lastChecked: new Date().toISOString(),
        })
      );
      workflowsUpdated++;

      // Auto-complete if terminal state
      if (newState === "merged" || newState === "closed") {
        completeWorkflow(workflow.id);
      }
    }
  }

  if (workflowsCreated > 0 || workflowsUpdated > 0) {
    console.log(
      `pr-lifecycle: created=${workflowsCreated}, updated=${workflowsUpdated}`
    );
  }

  return workflowsCreated + workflowsUpdated;
}

export default async function workflowsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    let totalActions = 0;

    // Sync GitHub PRs and create/update workflow instances
    const prActionsCount = await syncGitHubPRs();
    totalActions += prActionsCount;

    // Evaluate all active workflows and process their actions
    const workflows = getAllActiveWorkflows();
    for (const workflow of workflows) {
      // Get the template for this workflow
      const template = getTemplateByName(workflow.template);
      if (!template) {
        console.warn(
          `workflows-meta: unknown template "${workflow.template}" for workflow ${workflow.id}`
        );
        continue;
      }

      // Evaluate the workflow state machine
      const action = evaluateWorkflow(workflow, template);

      // Handle the action
      if (action.type === "create-task") {
        const source = `workflow:${workflow.id}`;
        insertTask({
          subject: action.subject,
          description: action.description,
          priority: action.priority || 5,
          skills: action.skills ? action.skills.join(",") : null,
          source,
        });
        totalActions++;
      } else if (action.type === "transition" && action.nextState) {
        updateWorkflowState(
          workflow.id,
          action.nextState,
          workflow.context
        );
        totalActions++;
      }
    }

    return totalActions > 0 ? "ok" : "skip";
  } catch (err) {
    console.error(
      `workflows sensor error: ${err instanceof Error ? err.message : String(err)}`
    );
    return "skip";
  }
}
