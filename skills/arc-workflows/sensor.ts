import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  insertTask,
  taskExistsForSource,
  pendingTaskExistsForSource,
  getAllActiveWorkflows,
  updateWorkflowState,
  updateWorkflowContext,
  getWorkflowByInstanceKey,
  insertWorkflow,
  completeWorkflow,
  countPrReviewTasksToday,
} from "../../src/db.ts";

const DAILY_PR_REVIEW_CAP = 20;
import {
  evaluateWorkflow,
  getAllowedTransitions,
  getTemplateByName,
  AUTOMATED_PR_PATTERNS,
  type WorkflowAction,
} from "./state-machine.ts";

import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

const SENSOR_NAME = "arc-workflows";
const INTERVAL_MINUTES = 5;
const log = createSensorLogger(SENSOR_NAME);


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
  closingIssueNumbers?: number[];
  /** True if arc0btc already submitted an APPROVED or COMMENTED review on this PR. */
  arcHasReview?: boolean;
  /** Current HEAD commit SHA of the PR branch. */
  headCommitSha?: string;
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

  // If Arc already reviewed this PR (approved or commented), treat as approved.
  // This prevents new commits from resetting the workflow back to review-requested
  // and flooding the queue with duplicate review tasks.
  if (pr.arcHasReview) {
    return "approved";
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
 * Fetch PRs from GitHub using `gh api graphql` (uses gh CLI auth, no separate token needed).
 * Batches all repos into a single GraphQL query for efficiency.
 */
function fetchGitHubPRs(repos: string[]): GithubPR[] {
  const validRepos: Array<{ owner: string; repo: string; full: string }> = [];
  for (const repoPath of repos) {
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) {
      log(`pr-lifecycle: invalid repo path: ${repoPath}`);
      continue;
    }
    validRepos.push({ owner, repo, full: repoPath });
  }

  if (validRepos.length === 0) return [];

  // Batch all repos into one GraphQL query (like aibtc-repo-maintenance sensor)
  const fragments = validRepos.map((r, i) => `repo${i}: repository(owner: "${r.owner}", name: "${r.repo}") {
      pullRequests(last: 50, states: [OPEN, CLOSED]) {
        nodes {
          number
          title
          url
          author { login }
          state
          merged
          reviewDecision
          headRefOid
          closingIssuesReferences(first: 5) {
            nodes { number }
          }
          reviews(last: 20) {
            nodes {
              author { login }
              state
            }
          }
        }
      }
    }`);

  const query = `query { ${fragments.join("\n")} }`;
  const result = Bun.spawnSync(["gh", "api", "graphql", "-f", `query=${query}`], {
    timeout: 30_000,
  });

  if (result.exitCode !== 0) {
    log(`pr-lifecycle: gh api graphql failed: ${result.stderr.toString().trim()}`);
    return [];
  }

  type PRNode = {
    number: number;
    title: string;
    url: string;
    author?: { login: string };
    state: string;
    merged?: boolean;
    reviewDecision?: string | null;
    headRefOid?: string;
    closingIssuesReferences?: { nodes?: Array<{ number: number }> };
    reviews?: { nodes?: Array<{ author?: { login: string }; state: string }> };
  };

  type RepoData = {
    pullRequests: { nodes: PRNode[] };
  };

  let data: Record<string, RepoData>;
  try {
    const parsed = JSON.parse(result.stdout.toString().trim()) as { data: Record<string, RepoData> };
    data = parsed.data;
  } catch {
    log("pr-lifecycle: failed to parse GraphQL response");
    return [];
  }

  const prs: GithubPR[] = [];
  for (let i = 0; i < validRepos.length; i++) {
    const { owner, repo } = validRepos[i];
    const repoData = data[`repo${i}`];
    if (!repoData) continue;

    for (const node of repoData.pullRequests.nodes) {
      const closingIssueNumbers = (node.closingIssuesReferences?.nodes || []).map(
        (n) => n.number,
      );
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
        closingIssueNumbers: closingIssueNumbers.length > 0 ? closingIssueNumbers : undefined,
        arcHasReview: (node.reviews?.nodes || []).some(
          (r) => r.author?.login === "arc0btc" && (r.state === "APPROVED" || r.state === "COMMENTED"),
        ) || undefined,
        headCommitSha: node.headRefOid || undefined,
      });
    }
  }

  return prs;
}

/**
 * Handle GitHub PR state changes: create or update workflow instances
 */
function syncGitHubPRs(): number {
  // Repos to monitor: Arc's own repos + aibtcdev watched repos (configurable via env override)
  const reposEnv = Bun.env.PR_LIFECYCLE_REPOS;
  const repos = reposEnv
    ? reposEnv.split(",").map((r) => r.trim())
    : ["arc0btc/arc-starter", "arc0btc/arc0me-site", ...AIBTC_WATCHED_REPOS];

  const prs = fetchGitHubPRs(repos);
  if (prs.length === 0) return 0;

  let workflowsCreated = 0;
  let workflowsUpdated = 0;

  for (const pr of prs) {
    const instanceKey = `${pr.owner}/${pr.repo}/${pr.number}`;
    const newState = mapPRStateToWorkflowState(pr);

    let workflow = getWorkflowByInstanceKey(instanceKey);

    if (!workflow) {
      // Create new workflow
      const isAutomated = AUTOMATED_PR_PATTERNS.some((p) => p.test(pr.title));
      const newWorkflowId = insertWorkflow({
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
          fromIssue: pr.closingIssueNumbers?.[0] ?? undefined,
          isAutomated: isAutomated || undefined,
          headCommitSha: pr.headCommitSha,
          lastChecked: new Date().toISOString(),
        }),
      });
      workflowsCreated++;

      // Auto-complete if created directly in terminal state (PR already closed/merged when first seen)
      if (newState === "merged" || newState === "closed") {
        completeWorkflow(newWorkflowId);
      }

      // Issue-to-PR transition: if this PR closes issues, transition their workflows
      if (pr.closingIssueNumbers) {
        for (const issueNum of pr.closingIssueNumbers) {
          const issueKey = `${pr.owner}/${pr.repo}/issue/${issueNum}`;
          const issueWorkflow = getWorkflowByInstanceKey(issueKey);
          if (issueWorkflow && issueWorkflow.current_state === "issue-opened") {
            updateWorkflowState(
              issueWorkflow.id,
              "opened",
              JSON.stringify({
                ...JSON.parse(issueWorkflow.context),
                linkedPr: pr.number,
                linkedPrUrl: pr.url,
                transitionedAt: new Date().toISOString(),
              }),
            );
            workflowsUpdated++;
            log(`issue-to-pr: issue #${issueNum} -> PR #${pr.number} on ${pr.owner}/${pr.repo}`);
          }
        }
      }
    } else if (workflow.current_state !== newState) {
      // Preserve existing context fields (reviewCycle, isAutomated, fromIssue, etc.)
      let existingCtx: Record<string, unknown> = {};
      try { existingCtx = JSON.parse(workflow.context); } catch { /* fresh context */ }

      const updatedCtx: Record<string, unknown> = {
        ...existingCtx,
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        headCommitSha: pr.headCommitSha,
        lastChecked: new Date().toISOString(),
      };

      // Prevent regression: don't overwrite review-requested back to opened
      if (workflow.current_state === "review-requested" && newState === "opened") {
        continue;
      }

      // Prevent regression: once approved, don't regress to review states due to new commits
      // (mapPRStateToWorkflowState handles this via arcHasReview, but guard here as well)
      if (workflow.current_state === "approved" &&
          (newState === "opened" || newState === "review-requested")) {
        continue;
      }

      // Increment reviewCycle on re-review transitions (changes-requested → review-requested)
      if (workflow.current_state === "changes-requested" &&
          (newState === "review-requested" || newState === "opened")) {
        updatedCtx.reviewCycle = ((existingCtx.reviewCycle as number) || 1) + 1;
      }

      updateWorkflowState(workflow.id, newState, JSON.stringify(updatedCtx));
      workflowsUpdated++;

      // Auto-complete if terminal state
      if (newState === "merged" || newState === "closed") {
        completeWorkflow(workflow.id);
      }
    } else if (pr.headCommitSha) {
      // State unchanged — still update headCommitSha so the SHA dedup guard sees the latest commit
      updateWorkflowContext(workflow.id, { headCommitSha: pr.headCommitSha });
    }
  }

  if (workflowsCreated > 0 || workflowsUpdated > 0) {
    log(`pr-lifecycle: created=${workflowsCreated}, updated=${workflowsUpdated}`);
  }

  return workflowsCreated + workflowsUpdated;
}

export default async function workflowsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    let totalActions = 0;

    // Sync GitHub PRs and create/update workflow instances
    const prActionsCount = syncGitHubPRs();
    totalActions += prActionsCount;

    // Evaluate all active workflows and process their actions
    const workflows = getAllActiveWorkflows();
    for (const workflow of workflows) {
      // Get the template for this workflow
      const template = getTemplateByName(workflow.template);
      if (!template) {
        log(`workflows-meta: unknown template "${workflow.template}" for workflow ${workflow.id}`);
        continue;
      }

      // Evaluate the workflow state machine
      const action = evaluateWorkflow(workflow, template);

      // Auto-complete workflows that have reached a terminal state (no outgoing transitions)
      const transitions = getAllowedTransitions(workflow.current_state, template);
      if (Object.keys(transitions).length === 0) {
        completeWorkflow(workflow.id);
        totalActions++;
        continue;
      }

      // Handle the action
      if (action.type === "create-task") {
        // Use action-specific source if provided (e.g. quest phases),
        // otherwise use state-specific source to prevent cross-state dedup collisions
        const source = action.source || `workflow:${workflow.id}:${workflow.current_state}`;
        // Cross-sensor dedup: for pr-review tasks, also check the un-suffixed source
        // (github-mentions uses "pr-review:repo#N", workflows use "pr-review:repo#N:v1").
        // Only block on pending/active — completed tasks shouldn't prevent re-reviews.
        const baseSource = source.replace(/:v\d+$/, "");
        const crossSensorDup = baseSource !== source && pendingTaskExistsForSource(baseSource);
        // Dedup: skip if a pending/active task already exists for this source.
        // Use pendingTaskExistsForSource (not taskExistsForSource) so that completed/failed tasks
        // don't permanently block re-creation — bulk cleanups or task failures should allow retry.
        if (!crossSensorDup && !pendingTaskExistsForSource(source)) {
          // Daily cap: skip PR review tasks once the daily limit is hit.
          // Prevents queue flooding when many open PRs exist across watched repos.
          if (source.startsWith("pr-review:") && countPrReviewTasksToday() >= DAILY_PR_REVIEW_CAP) {
            continue;
          }

          // SHA-based dedup for PR reviews: skip if the PR head commit hasn't changed
          // since the last review was queued. Prevents re-reviewing the same commit
          // multiple times when the workflow cycles (e.g. changes-requested → review-requested).
          if (source.startsWith("pr-review:")) {
            let ctx: Record<string, unknown> = {};
            try { ctx = JSON.parse(workflow.context); } catch { /* ignore */ }
            const headSha = ctx.headCommitSha as string | undefined;
            const lastReviewed = ctx.lastReviewedCommit as string | undefined;
            if (headSha && headSha === lastReviewed) {
              // Same commit already queued for review — skip until author pushes new commits
              continue;
            }
          }

          insertTask({
            subject: action.subject ?? "",
            description: action.description ?? null,
            priority: action.priority || 5,
            model: action.model || "sonnet",
            skills: action.skills ? JSON.stringify(action.skills) : null,
            source,
            parent_id: action.parentTaskId ?? undefined,
            script: action.script
              ? action.script.replace("{WORKFLOW_ID}", String(workflow.id))
              : undefined,
          });

          // For PR reviews, record the HEAD SHA so we don't re-queue for the same commit
          if (source.startsWith("pr-review:")) {
            let ctx: Record<string, unknown> = {};
            try { ctx = JSON.parse(workflow.context); } catch { /* ignore */ }
            const headSha = ctx.headCommitSha as string | undefined;
            if (headSha) {
              updateWorkflowContext(workflow.id, { lastReviewedCommit: headSha });
            }
          }

          if (action.contextUpdate) {
            updateWorkflowContext(workflow.id, action.contextUpdate);
          }
          if (action.autoAdvanceState) {
            updateWorkflowState(workflow.id, action.autoAdvanceState, workflow.context);
          }
          totalActions++;
        }
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
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return "skip";
  }
}
