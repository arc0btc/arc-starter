import { Workflow } from "../../src/db.ts";

/**
 * Minimal state machine runner. No external deps.
 * Paulmillr philosophy: small, auditable, dependency-free.
 *
 * A state machine template defines:
 * - states: map of state name -> config
 * - each state config can have:
 *   - on: allowed transitions (transition name -> next state)
 *   - action: optional function(context) -> action or null
 *
 * The runner evaluates a workflow against its template and returns an action.
 */

export interface WorkflowAction {
  type: "create-task" | "noop" | "transition";
  subject?: string;
  nextState?: string;
  priority?: number;
  skills?: string[];
  description?: string;
  model?: string;
  parentTaskId?: number;
  source?: string;
}

export interface StateConfig<C = unknown> {
  on?: Record<string, string>;
  action?: (context: C) => WorkflowAction | null;
}

export interface StateMachine<C = unknown> {
  name: string;
  initialState: string;
  states: Record<string, StateConfig<C>>;
}

/**
 * Evaluate a workflow instance against its template.
 * Returns an action (create-task, transition, or noop).
 */
export function evaluateWorkflow<C = unknown>(
  workflow: Workflow,
  template: StateMachine<C>
): WorkflowAction {
  const stateConfig = template.states[workflow.current_state];

  if (!stateConfig) {
    return { type: "noop" };
  }

  const context = workflow.context ? JSON.parse(workflow.context) : ({} as C);

  if (stateConfig.action) {
    const action = stateConfig.action(context as C);
    return action || { type: "noop" };
  }

  return { type: "noop" };
}

/**
 * Get allowed transitions from a state.
 * Returns map of transition name -> next state.
 */
export function getAllowedTransitions(
  currentState: string,
  template: StateMachine
): Record<string, string> {
  const stateConfig = template.states[currentState];
  return stateConfig?.on || {};
}

/**
 * Check if a transition is allowed.
 */
export function isTransitionAllowed(
  currentState: string,
  targetState: string,
  template: StateMachine
): boolean {
  const allowed = getAllowedTransitions(currentState, template);
  return Object.values(allowed).includes(targetState);
}

/**
 * Default state machines for common patterns.
 */

export const BlogPostingMachine: StateMachine<{
  title?: string;
  url?: string;
  reviewer?: string;
  fact_check_findings?: string;
}> = {
  name: "blog-posting",
  initialState: "draft",
  states: {
    draft: {
      on: { submit: "review" },
      action: (ctx) => {
        if (!ctx.title) return null;
        return {
          type: "noop",
        };
      },
    },
    review: {
      on: { approve: "fact_check", request_changes: "revision" },
      action: (ctx) => {
        return {
          type: "noop",
        };
      },
    },
    fact_check: {
      on: { pass: "published", fail: "revision" },
      action: (ctx) => {
        return {
          type: "create-task",
          subject: `Fact-check blog post: ${ctx.title || "untitled"}`,
          description:
            "Validate claims in the post against actual system state (skill names, sensor counts, task numbers, wallet balances). Set workflow context fact_check_findings with results. Transition to published if valid, revision if not.",
          priority: 5,
          skills: ["blog-publishing", "arc-workflows"],
        };
      },
    },
    revision: {
      on: { resubmit: "review" },
      action: (ctx) => {
        return {
          type: "noop",
        };
      },
    },
    published: {
      on: {},
      action: () => null,
    },
  },
};

export const SignalFilingMachine: StateMachine<{
  beat?: string;
  evidence?: string;
  implication?: string;
}> = {
  name: "signal-filing",
  initialState: "detected",
  states: {
    detected: {
      on: { format: "formatted" },
      action: (ctx) => {
        if (!ctx.beat) return null;
        return { type: "noop" };
      },
    },
    formatted: {
      on: { file: "filed" },
      action: (ctx) => {
        if (!ctx.evidence || !ctx.implication) {
          return {
            type: "noop",
          };
        }
        return { type: "noop" };
      },
    },
    filed: {
      on: {},
      action: () => null,
    },
  },
};

export const BeatClaimingMachine: StateMachine<{
  beat?: string;
  claimedAt?: string;
}> = {
  name: "beat-claiming",
  initialState: "pending",
  states: {
    pending: {
      on: { claim: "claimed" },
      action: (ctx) => {
        if (!ctx.beat) return null;
        return {
          type: "create-task",
          subject: `Claim beat: ${ctx.beat}`,
          priority: 6,
          skills: ["aibtc-news-editorial"],
        };
      },
    },
    claimed: {
      on: { maintain_streak: "active" },
      action: () => null,
    },
    active: {
      on: { file_signal: "active" },
      action: () => null,
    },
  },
};

/** Patterns matching automated PRs that don't need code review. */
const AUTOMATED_PR_PATTERNS = [
  /^chore\(main\): release/i,
  /^chore\(deps\)/i,
  /^chore\(deps-dev\)/i,
  /^bump /i,
];

/** Repos using React/Next.js — load dev-landing-page-review for these PRs. */
const REACT_REPOS = new Set(["aibtcdev/landing-page"]);

interface PrLifecycleContext {
  owner?: string;
  repo?: string;
  number?: number;
  title?: string;
  url?: string;
  author?: string;
  reviewers?: string[];
  lastChecked?: string;
  fromIssue?: number;
  issueUrl?: string;
  reviewCycle?: number;
  isAutomated?: boolean;
}

function shouldSkipPrReview(ctx: PrLifecycleContext): boolean {
  if (ctx.author === "arc0btc") return true;
  if (ctx.isAutomated) return true;
  const title = ctx.title;
  if (title && AUTOMATED_PR_PATTERNS.some((p) => p.test(title))) return true;
  return false;
}

function prReviewSkills(repoFull: string): string[] {
  return REACT_REPOS.has(repoFull)
    ? ["aibtc-repo-maintenance", "dev-landing-page-review"]
    : ["aibtc-repo-maintenance"];
}

function buildReviewDescription(ctx: PrLifecycleContext, cycle: number): string {
  const repoFull = `${ctx.owner}/${ctx.repo}`;
  const isRereview = cycle > 1;
  const lines = [
    `PR #${ctx.number} on ${repoFull} by ${ctx.author || "unknown"}`,
    `Title: ${ctx.title || "untitled"}`,
    "",
    "Instructions:",
    "1. Read skills/aibtc-repo-maintenance/AGENT.md before acting.",
    `2. Run: arc skills run --name aibtc-repo-maintenance -- review-pr --repo ${repoFull} --pr ${ctx.number}`,
    "3. Analyze the diff for correctness and known operational issues.",
    "4. Post a review via gh pr review.",
  ];
  if (REACT_REPOS.has(repoFull)) {
    lines.push(
      "5. Apply the full landing-page review: React performance, composition patterns, and UI/accessibility — see skills/dev-landing-page-review/AGENT.md.",
    );
  }
  if (isRereview) {
    lines.push("", `This is re-review cycle ${cycle}. Focus on whether prior feedback was addressed.`);
  }
  return lines.join("\n");
}

function buildReviewAction(ctx: PrLifecycleContext): WorkflowAction | null {
  if (!ctx.owner || !ctx.repo || !ctx.number) return null;
  if (shouldSkipPrReview(ctx)) return null;
  const cycle = ctx.reviewCycle || 1;
  const isRereview = cycle > 1;
  const repoFull = `${ctx.owner}/${ctx.repo}`;
  return {
    type: "create-task",
    subject: isRereview
      ? `Re-review PR #${ctx.number} on ${repoFull}: ${ctx.title || "untitled"} (cycle ${cycle})`
      : `Review PR #${ctx.number} on ${repoFull}: ${ctx.title || "untitled"}`,
    description: buildReviewDescription(ctx, cycle),
    priority: isRereview ? 4 : 5,
    model: "sonnet",
    skills: prReviewSkills(repoFull),
    source: `pr-review:${repoFull}#${ctx.number}:v${cycle}`,
  };
}

export { AUTOMATED_PR_PATTERNS };

export const PrLifecycleMachine: StateMachine<PrLifecycleContext> = {
  name: "pr-lifecycle",
  initialState: "opened",
  states: {
    "issue-opened": {
      on: { link_pr: "opened", close: "closed" },
      action: (ctx) => {
        if (!ctx.owner || !ctx.repo || !ctx.number) return null;
        return { type: "noop" };
      },
    },
    opened: {
      on: { request_review: "review-requested", close: "closed" },
      action: buildReviewAction,
    },
    "review-requested": {
      on: {
        request_changes: "changes-requested",
        approve: "approved",
        close: "closed",
      },
      action: buildReviewAction,
    },
    "changes-requested": {
      on: { request_review: "review-requested", close: "closed" },
      action: () => null,
    },
    approved: {
      on: { merge: "merged", close: "closed" },
      action: () => null,
    },
    merged: {
      on: {},
      action: () => null,
    },
    closed: {
      on: {},
      action: () => null,
    },
  },
};

export const ReputationFeedbackMachine: StateMachine<{
  agentId: number;
  agentName?: string;
  currentScore?: number;
  rating: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackUri?: string;
  feedbackHash?: string;
  txid?: string;
  updatedScore?: number;
  notified?: boolean;
}> = {
  name: "reputation-feedback",
  initialState: "pending",
  states: {
    pending: {
      on: { check_reputation: "checking_reputation" },
      action: (ctx) => {
        if (!ctx.agentId || !ctx.rating) return null;
        return {
          type: "create-task",
          subject: `Reputation: Check current score for agent ${ctx.agentId}`,
          priority: 5,
          skills: ["erc8004-reputation"],
          description: `Get current reputation summary before giving feedback. Agent: ${ctx.agentName || ctx.agentId}, Rating: ${ctx.rating}/5`,
        };
      },
    },
    checking_reputation: {
      on: { submit_feedback: "feedback_submitted" },
      action: () => null,
    },
    feedback_submitted: {
      on: { confirm: "confirmed" },
      action: (ctx) => {
        if (!ctx.agentId || !ctx.rating) return null;
        return {
          type: "create-task",
          subject: `Reputation: Verify feedback submission for agent ${ctx.agentId}`,
          priority: 5,
          skills: ["erc8004-reputation"],
          description: `Wait for feedback confirmation (~10-30 min), then verify updated reputation. Feedback txid: ${ctx.txid || "pending"}`,
        };
      },
    },
    confirmed: {
      on: { complete: "completed" },
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

export const ValidationRequestMachine: StateMachine<{
  agentId: number;
  agentName?: string;
  validationHash?: string;
  validationUri?: string;
  validationType?: string;
  responderAddress?: string;
  responseHash?: string;
  responseUri?: string;
  verificationTxid?: string;
  verified?: boolean;
}> = {
  name: "validation-request",
  initialState: "pending",
  states: {
    pending: {
      on: { request: "request_sent" },
      action: (ctx) => {
        if (!ctx.agentId || !ctx.validationType) return null;
        return {
          type: "create-task",
          subject: `Validation: Request validation for agent ${ctx.agentId}`,
          priority: 5,
          skills: ["erc8004-validation"],
          description: `Prepare validation hash and send request. Agent: ${ctx.agentName || ctx.agentId}, Type: ${ctx.validationType}`,
        };
      },
    },
    request_sent: {
      on: { confirm: "confirmed" },
      action: () => null,
    },
    confirmed: {
      on: { respond: "response_submitted" },
      action: () => null,
    },
    response_submitted: {
      on: { verify: "verified" },
      action: (ctx) => {
        if (!ctx.agentId) return null;
        return {
          type: "create-task",
          subject: `Validation: Verify response for agent ${ctx.agentId}`,
          priority: 5,
          skills: ["erc8004-validation"],
          description: `Verify validation response on-chain. Response URI: ${ctx.responseUri || "pending"}, Verification txid: ${ctx.verificationTxid || "pending"}`,
        };
      },
    },
    verified: {
      on: { complete: "completed" },
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

export const InscriptionMachine: StateMachine<{
  dataHash?: string;
  dataSize?: number;
  walletAddress?: string;
  commitTxid?: string;
  commitFee?: number;
  commitConfirmed?: boolean;
  revealTxid?: string;
  revealFee?: number;
  revealConfirmed?: boolean;
  inscriptionId?: string;
  network?: string;
}> = {
  name: "inscription",
  initialState: "pending",
  states: {
    pending: {
      on: { prepare_commit: "commit_preparing" },
      action: (ctx) => {
        if (!ctx.dataHash || !ctx.walletAddress) return null;
        return {
          type: "create-task",
          subject: `Inscription: Prepare commit for ${ctx.dataHash.slice(0, 8)}...`,
          priority: 5,
          skills: ["bitcoin-wallet"],
          description: `Prepare commit transaction. Data hash: ${ctx.dataHash}, Wallet: ${ctx.walletAddress}, Network: ${ctx.network || "mainnet"}`,
        };
      },
    },
    commit_preparing: {
      on: { broadcast_commit: "commit_broadcasted" },
      action: () => null,
    },
    commit_broadcasted: {
      on: { confirm_commit: "reveal_pending" },
      action: (ctx) => {
        if (!ctx.commitTxid) return null;
        return {
          type: "create-task",
          subject: `Inscription: Confirm commit transaction ${ctx.commitTxid.slice(0, 8)}...`,
          priority: 5,
          skills: ["bitcoin-wallet"],
          description: `Wait for commit confirmation (typically 1-6 blocks). Commit txid: ${ctx.commitTxid}`,
        };
      },
    },
    reveal_pending: {
      on: { prepare_reveal: "reveal_preparing" },
      action: () => null,
    },
    reveal_preparing: {
      on: { broadcast_reveal: "reveal_broadcasted" },
      action: (ctx) => {
        if (!ctx.commitTxid) return null;
        return {
          type: "create-task",
          subject: `Inscription: Prepare reveal transaction for ${ctx.commitTxid.slice(0, 8)}...`,
          priority: 5,
          skills: ["bitcoin-wallet"],
          description: `Prepare reveal transaction using commit UTXO. Commit txid: ${ctx.commitTxid}`,
        };
      },
    },
    reveal_broadcasted: {
      on: { confirm_reveal: "confirmed" },
      action: (ctx) => {
        if (!ctx.revealTxid) return null;
        return {
          type: "create-task",
          subject: `Inscription: Confirm reveal transaction ${ctx.revealTxid.slice(0, 8)}...`,
          priority: 5,
          skills: ["bitcoin-wallet"],
          description: `Wait for reveal confirmation and extract inscription ID. Reveal txid: ${ctx.revealTxid}`,
        };
      },
    },
    confirmed: {
      on: { complete: "completed" },
      action: (ctx) => {
        if (!ctx.inscriptionId) return null;
        return { type: "noop" };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

export const NewReleaseMachine: StateMachine<{
  repo?: string;
  version?: string;
  releaseUrl?: string;
  skills?: string[];
  assessmentSummary?: string;
  actionRequired?: boolean;
  integrationDescription?: string;
}> = {
  name: "new-release",
  initialState: "detected",
  states: {
    detected: {
      on: { assess: "assessing" },
      action: (ctx) => {
        if (!ctx.repo || !ctx.version) return null;
        const skillList = ctx.skills?.length ? ctx.skills : ["arc-skill-manager"];
        return {
          type: "create-task",
          subject: `Assess release: ${ctx.repo} ${ctx.version}`,
          priority: 5,
          model: "sonnet",
          skills: skillList,
          description: `Review release ${ctx.version} of ${ctx.repo} for breaking changes or integration opportunities.${ctx.releaseUrl ? ` Release: ${ctx.releaseUrl}` : ""}\n\nAfter assessment, transition workflow to 'integration_pending' (if action required) or 'no_action' (if nothing to do).`,
        };
      },
    },
    assessing: {
      on: { needs_integration: "integration_pending", no_action_needed: "no_action" },
      action: () => null,
    },
    integration_pending: {
      on: { integrate: "integrating" },
      action: (ctx) => {
        if (!ctx.repo || !ctx.version) return null;
        const skillList = ctx.skills?.length ? ctx.skills : ["arc-skill-manager"];
        return {
          type: "create-task",
          subject: `Integrate: ${ctx.repo} ${ctx.version}`,
          priority: 4,
          model: "sonnet",
          skills: skillList,
          description: ctx.integrationDescription || `Apply relevant changes from ${ctx.repo} ${ctx.version} to Arc.`,
        };
      },
    },
    integrating: {
      on: { complete: "completed" },
      action: () => null,
    },
    no_action: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * ArchitectureReviewMachine — models the recurring architecture review → cleanup cycle.
 *
 * Pattern detected: "architecture review" tasks consistently spawn housekeeping
 * follow-ups (cleanup disabled skills, adjust priorities, archive stale reports).
 * This machine deduplicates concurrent reviews and ensures cleanup is tracked.
 *
 * instance_key: "arch-review-{trigger}-{YYYY-MM-DD}" (one per trigger per day)
 *
 * Context:
 *   trigger      — what triggered the review: "codebase-changed" | "active-reports" | "scheduled"
 *   diagramPath  — optional path to the current architecture diagram
 *   reviewSummary — optional summary of findings from the review task
 *   cleanupItems  — optional stringified list of identified cleanup tasks
 */
export const ArchitectureReviewMachine: StateMachine<{
  trigger?: string;
  diagramPath?: string;
  reviewSummary?: string;
  cleanupItems?: string;
}> = {
  name: "architecture-review",
  initialState: "triggered",
  states: {
    triggered: {
      on: { start_review: "reviewing" },
      action: (ctx) => {
        const trigger = ctx.trigger || "scheduled";
        return {
          type: "create-task",
          subject: `architecture review — ${trigger.replace(/-/g, " ")}`,
          priority: 7,
          skills: ["arc-architecture-review", "arc-skill-manager"],
          description: `Run architecture review (trigger: ${trigger}). After completing, transition this workflow to 'reviewing', then set reviewSummary and cleanupItems in context, then transition to 'cleanup_pending' if there are items or 'completed' if clean.`,
        };
      },
    },
    reviewing: {
      on: { identify_cleanup: "cleanup_pending", complete: "completed" },
      action: () => null,
    },
    cleanup_pending: {
      on: { start_cleanup: "cleaning" },
      action: (ctx) => {
        if (!ctx.cleanupItems) return null;
        return {
          type: "create-task",
          subject: `housekeeping: architecture review cleanup`,
          priority: 6,
          skills: ["arc-skill-manager"],
          description: `Address cleanup items identified during architecture review.\n\nItems:\n${ctx.cleanupItems}\n\nAfter completing, transition workflow to 'cleaning', then 'completed'.`,
        };
      },
    },
    cleaning: {
      on: { complete: "completed" },
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * EmailThreadMachine — models the recurring "email thread from X" → follow-up chain cycle.
 *
 * Pattern detected: 24 recurrences, avg 5.4 steps per chain. Email threads consistently
 * spawn diverse follow-up tasks across many skills, then optionally require a reply.
 * This machine ensures every email thread is triaged, acted upon, and closed out.
 *
 * instance_key: "email-thread-{sender-slug}-{message-id-or-date}" (one per thread)
 *
 * States:
 *   received       → triage the email, identify action items and whether a reply is needed
 *   triaged        → follow-up tasks have been created (or none needed); decide next step
 *   reply_pending  → a reply is required; draft and send it
 *   completed      → done (all tasks spawned, reply sent or not needed)
 *
 * Context:
 *   sender         — display name or email of sender
 *   subject        — email subject line
 *   messageCount   — number of messages in thread
 *   source         — which skill detected it (arc-email-sync, aibtc-inbox-sync, etc.)
 *   needsReply     — whether a reply should be sent
 *   actionItems    — comma-separated list of action items identified during triage
 *   replyDraft     — draft reply text (populated before transitioning to reply_pending)
 */
export const EmailThreadMachine: StateMachine<{
  sender?: string;
  subject?: string;
  messageCount?: number;
  source?: string;
  needsReply?: boolean;
  actionItems?: string;
  replyDraft?: string;
}> = {
  name: "email-thread",
  initialState: "received",
  states: {
    received: {
      on: { triage: "triaged" },
      action: (ctx) => {
        if (!ctx.sender) return null;
        const threadDesc = ctx.subject
          ? `"${ctx.subject}" from ${ctx.sender}`
          : `from ${ctx.sender}`;
        return {
          type: "create-task",
          subject: `Triage email thread ${threadDesc}`,
          priority: 6,
          skills: ["arc-email-sync", "arc-skill-manager"],
          description: `Read and triage the email thread ${threadDesc} (${ctx.messageCount || 1} message(s)).
Source: ${ctx.source || "arc-email-sync"}.

Steps:
1. Read the full thread content
2. Identify action items and spawn follow-up tasks for each (use arc tasks add)
3. Determine whether a reply is required
4. Transition this workflow to 'triaged' with updated context:
   - needsReply: true/false
   - actionItems: comma-separated summary of tasks created
   - replyDraft: draft reply text (if needsReply is true)`,
        };
      },
    },
    triaged: {
      on: { needs_reply: "reply_pending", close: "completed" },
      action: (ctx) => {
        if (!ctx.needsReply) {
          // No reply needed — auto-complete
          return { type: "transition", nextState: "completed" };
        }
        // Auto-transition to reply_pending if a reply is needed
        return {
          type: "transition",
          nextState: "reply_pending",
        };
      },
    },
    reply_pending: {
      on: { send: "completed" },
      action: (ctx) => {
        if (!ctx.sender || !ctx.replyDraft) return null;
        return {
          type: "create-task",
          subject: `Send reply to ${ctx.sender}`,
          priority: 6,
          skills: ["arc-email-sync"],
          description: `Send the following reply to ${ctx.sender} for thread: ${ctx.subject || "(no subject)"}.

Draft reply:
${ctx.replyDraft}

After sending, transition this workflow to 'completed'.`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * QuestMachine — decomposes complex tasks into sequential phases.
 *
 * A quest takes a big goal, breaks it into <2min phases, and executes them
 * one at a time via the task queue. Workflow context is the checkpoint —
 * failed phases restart from context, not from scratch.
 *
 * instance_key: "quest-{slug}" (one per quest)
 *
 * Context:
 *   slug           — short identifier for the quest
 *   goal           — high-level goal description
 *   sourceTaskId   — task that spawned this quest
 *   parentTaskId   — task ID to use as parent_id for phase tasks
 *   skills         — skills array for phase tasks
 *   model          — model to use for phase tasks (opus/sonnet/haiku)
 *   phases         — array of { n, name, goal, status, taskId }
 *   currentPhase   — 1-indexed current phase number
 */
export interface QuestPhase {
  n: number;
  name: string;
  goal: string;
  status: "pending" | "active" | "completed" | "failed";
  taskId: number | null;
}

export interface QuestContext {
  slug: string;
  goal: string;
  sourceTaskId: number | null;
  parentTaskId: number | null;
  skills: string[];
  model: string;
  phases: QuestPhase[];
  currentPhase: number;
}

export const QuestMachine: StateMachine<QuestContext> = {
  name: "quest",
  initialState: "planning",
  states: {
    planning: {
      on: { plan_complete: "executing" },
      action: (ctx) => {
        if (!ctx.slug || !ctx.goal) return null;
        return {
          type: "create-task",
          subject: `Quest plan: ${ctx.slug} — decompose into phases`,
          priority: 3,
          model: ctx.model || "sonnet",
          skills: ["quest-create", ...(ctx.skills || [])],
          parentTaskId: ctx.parentTaskId ?? undefined,
          source: `quest:${ctx.slug}:planning`,
          description: `Decompose this quest into <2min phases.\n\nGoal: ${ctx.goal}\nSlug: ${ctx.slug}\n\nInstructions:\n1. Read the quest goal and any linked task context\n2. Break the goal into 2-6 sequential phases, each completable in <2min\n3. Run: arc skills run --name quest-create -- plan --slug ${ctx.slug} --phase "Phase Name: goal" --phase "Phase Name: goal" ...\n4. The plan command will create phase tasks and advance the workflow`,
        };
      },
    },
    executing: {
      on: { all_phases_done: "completed", phase_failed: "failed" },
      action: (ctx) => {
        if (!ctx.phases || ctx.phases.length === 0) return null;
        const current = ctx.phases.find((p) => p.n === ctx.currentPhase);
        if (!current || current.status !== "pending") return null;
        return {
          type: "create-task",
          subject: `Quest ${ctx.slug} — Phase ${current.n}/${ctx.phases.length}: ${current.name}`,
          priority: 4,
          model: ctx.model || "sonnet",
          skills: ["quest-create", ...(ctx.skills || [])],
          parentTaskId: ctx.parentTaskId ?? undefined,
          source: `quest:${ctx.slug}:phase-${current.n}`,
          description: `Quest: ${ctx.slug}\nGoal: ${ctx.goal}\nPhase ${current.n} of ${ctx.phases.length}: ${current.name}\n\nPhase goal: ${current.goal}\n\nInstructions:\n1. Do the work for this phase\n2. When done, run: arc skills run --name quest-create -- advance --slug ${ctx.slug}\n3. The advance command marks this phase complete and queues the next one`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
    failed: {
      on: { retry: "executing" },
      action: () => null,
    },
  },
};

/**
 * StreakMaintenanceMachine — models the recurring streak-post → rate-limit → retry cycle.
 *
 * Pattern detected: "aibtc-news:maintain-streak" tasks (15 recurrences, avg 2.9 steps)
 * consistently spawn retry chains when rate-limited. This machine deduplicates concurrent
 * attempts and tracks window state between retries.
 *
 * instance_key: "streak-{beat}-{YYYY-MM-DD}" (one per beat per day)
 *
 * States:
 *   pending        → initial; creates the streak maintenance task
 *   attempting     → task is executing; waits for success or rate-limit signal
 *   rate_limited   → hit rate limit; creates a post-window retry task
 *   completed      → streak posted successfully
 *
 * Context:
 *   beat           — e.g. "aibtc.news"
 *   targetStreak   — desired streak length (e.g. 1, 2, 3...)
 *   currentStreak  — current streak count before this attempt
 *   retryCount     — number of rate-limit retries so far
 *   windowOpenAt   — ISO timestamp estimate of when rate limit window opens
 */
export const StreakMaintenanceMachine: StateMachine<{
  beat?: string;
  targetStreak?: number;
  currentStreak?: number;
  retryCount?: number;
  windowOpenAt?: string;
}> = {
  name: "streak-maintenance",
  initialState: "pending",
  states: {
    pending: {
      on: { attempt: "attempting" },
      action: (ctx) => {
        const beat = ctx.beat || "aibtc.news";
        const streak = ctx.targetStreak || 1;
        return {
          type: "create-task",
          subject: `Maintain ${streak}-day streak on ${beat}`,
          priority: 7,
          model: "haiku",
          skills: ["aibtc-news-editorial"],
          description: `Maintain the ${streak}-day streak on ${beat}.\n\nOn success: transition this workflow to 'attempting', then 'completed'.\nIf rate limited: transition to 'attempting', then 'rate_limited' and set windowOpenAt (ISO timestamp estimate) in context.`,
        };
      },
    },
    attempting: {
      on: { success: "completed", rate_limited: "rate_limited" },
      action: () => null,
    },
    rate_limited: {
      on: { retry: "attempting" },
      action: (ctx) => {
        const beat = ctx.beat || "aibtc.news";
        const streak = ctx.targetStreak || 1;
        const retryCount = (ctx.retryCount || 0) + 1;
        const MAX_RETRIES = 3;
        if (retryCount > MAX_RETRIES) {
          // Cap reached — do not spawn another retry task; let the workflow stall until human intervention
          return null;
        }
        const windowNote = ctx.windowOpenAt
          ? `Rate limit window estimated to open at: ${ctx.windowOpenAt}.`
          : "Rate limit window: unknown — wait ~4h before retrying.";
        return {
          type: "create-task",
          subject: `Maintain ${streak}-day streak on ${beat} (post-window retry ${retryCount}/${MAX_RETRIES})`,
          priority: 7,
          model: "haiku",
          skills: ["aibtc-news-editorial"],
          description: `Retry streak maintenance for ${beat} after rate limit window.\n${windowNote}\nThis is retry attempt ${retryCount} of ${MAX_RETRIES} max.\n\nOn success: transition workflow to 'attempting', then 'completed'.\nIf rate limited again: transition to 'attempting', then 'rate_limited' with updated retryCount and windowOpenAt.`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * AgentCollaborationMachine — models the AIBTC inbox thread → ops → retrospective cycle.
 *
 * Pattern detected: "sensor:aibtc-inbox-sync:thread" tasks (5 recurrences, avg 2.8 steps)
 * consistently spawn Bitcoin/Stacks operation tasks and retrospective learning extractions.
 * This machine tracks collaboration threads from other agents through to learning capture.
 *
 * instance_key: "agent-collab-{sender-slug}-{YYYY-MM-DD}" (one per sender per day)
 *
 * States:
 *   received            → triage the incoming agent thread
 *   triaged             → action items identified; auto-transition to ops or retrospective
 *   ops_pending         → Bitcoin/Stacks operation queued and executing
 *   retrospective_pending → capture learnings from the collaboration
 *   completed           → done
 *
 * Context:
 *   sender          — agent display name (e.g., "Topaz Centaur")
 *   messageCount    — number of messages in thread
 *   source          — sensor source (e.g., "sensor:aibtc-inbox-sync:thread")
 *   actionType      — "bitcoin-op" | "stacks-op" | "information" | "collaboration"
 *   opsDescription  — description of the Bitcoin/Stacks operation to execute
 *   retrospectiveRef — reference to completed ops task (e.g., "task:1403")
 */
export const AgentCollaborationMachine: StateMachine<{
  sender?: string;
  messageCount?: number;
  source?: string;
  actionType?: string;
  opsDescription?: string;
  retrospectiveRef?: string;
}> = {
  name: "agent-collaboration",
  initialState: "received",
  states: {
    received: {
      on: { triage: "triaged" },
      action: (ctx) => {
        if (!ctx.sender) return null;
        return {
          type: "create-task",
          subject: `Triage AIBTC thread from ${ctx.sender}`,
          priority: 6,
          skills: ["aibtc-inbox-sync"],
          description: `Read and triage the AIBTC thread from ${ctx.sender} (${ctx.messageCount || 1} message(s)).
Source: ${ctx.source || "sensor:aibtc-inbox-sync:thread"}.

Steps:
1. Read the full thread content
2. Identify action items (Bitcoin ops, Stacks ops, information requests, collaboration)
3. Set actionType in workflow context: "bitcoin-op" | "stacks-op" | "information" | "collaboration"
4. If ops required, set opsDescription with clear task instructions
5. Transition workflow to 'triaged'`,
        };
      },
    },
    triaged: {
      on: { needs_ops: "ops_pending", no_ops: "retrospective_pending" },
      action: (ctx) => {
        if (!ctx.actionType) return null;
        if (ctx.actionType === "bitcoin-op" || ctx.actionType === "stacks-op") {
          return { type: "transition", nextState: "ops_pending" };
        }
        return { type: "transition", nextState: "retrospective_pending" };
      },
    },
    ops_pending: {
      on: { ops_complete: "retrospective_pending" },
      action: (ctx) => {
        if (!ctx.opsDescription) return null;
        const skills =
          ctx.actionType === "bitcoin-op"
            ? ["bitcoin-wallet", "styx", "bitcoin-taproot-multisig"]
            : ["stacks-js", "styx"];
        return {
          type: "create-task",
          subject: ctx.opsDescription,
          priority: 4,
          skills,
          description: `${ctx.opsDescription}\n\nRequested by ${ctx.sender || "agent"} via AIBTC inbox.\n\nAfter completing, transition this workflow to 'ops_pending', then 'retrospective_pending'. Set retrospectiveRef to "task:{id}" of this task.`,
        };
      },
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        if (!ctx.sender) return null;
        return {
          type: "create-task",
          subject: `Retrospective: extract learnings from collaboration with ${ctx.sender}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract and record learnings from the collaboration with ${ctx.sender}.
${ctx.retrospectiveRef ? `Reference: ${ctx.retrospectiveRef}` : ""}

Steps:
1. Review what happened in this collaboration thread
2. Identify patterns, insights, or improvements for future agent interactions
3. Update memory/MEMORY.md with key learnings (under Agent Network section if relevant)
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * SiteHealthAlertMachine — models the recurring site health alert → fix → retrospective cycle.
 *
 * Pattern detected: "sensor:arc0btc-site-health" tasks (3 recurrences, avg 2.7 steps)
 * consistently spawn a fix task followed by a retrospective to capture learnings.
 * This machine deduplicates concurrent alerts and ensures learnings are captured.
 *
 * instance_key: "site-health-{YYYY-MM-DD}" (one per day — multiple alerts same day deduplicate)
 *
 * States:
 *   alert                → health issue detected; creates a fix task
 *   fixing               → fix task is executing
 *   retrospective_pending → fix done; create retrospective to extract learnings
 *   completed            → done
 *
 * Context:
 *   issueCount     — number of issues detected
 *   issuesSummary  — short description of the issue(s)
 *   fixSummary     — brief description of what was fixed (populated before retrospective)
 *   alertDate      — ISO date of the alert (for dedup / reference)
 */
export const SiteHealthAlertMachine: StateMachine<{
  issueCount?: number;
  issuesSummary?: string;
  fixSummary?: string;
  alertDate?: string;
}> = {
  name: "site-health-alert",
  initialState: "alert",
  states: {
    alert: {
      on: { fix: "fixing" },
      action: (ctx) => {
        const issues = ctx.issueCount || 1;
        const summary = ctx.issuesSummary ? `: ${ctx.issuesSummary}` : "";
        return {
          type: "create-task",
          subject: `Fix arc0btc.com health issue(s)${summary}`,
          priority: 3,
          skills: ["arc0btc-site-health", "blog-deploy"],
          description: `Site health alert: ${issues} issue(s) detected${summary}.

Steps:
1. Run arc0btc-site-health CLI to identify the specific issue(s)
2. Fix using blog-deploy or blog-publishing skills as appropriate
3. Re-run health check to verify all issues resolved
4. Transition this workflow: 'fixing' → 'retrospective_pending'
   - Set fixSummary in context before transitioning`,
        };
      },
    },
    fixing: {
      on: { fixed: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        return {
          type: "create-task",
          subject: `Retrospective: arc0btc.com health alert — extract learnings`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a recent arc0btc.com health alert and its fix.
${ctx.fixSummary ? `Fix summary: ${ctx.fixSummary}` : ""}${ctx.alertDate ? `\nAlert date: ${ctx.alertDate}` : ""}

Steps:
1. Review what broke and how it was fixed
2. Identify if this is a recurring issue type and note the pattern
3. Add prevention notes to memory/MEMORY.md if a pattern is identified
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * RecurringFailureMachine — models the investigate → fix → retrospective cycle.
 *
 * Pattern detected: "investigate recurring failure" tasks (3 recurrences, avg 2.0 steps/chain)
 * consistently spawn a retrospective, sometimes preceded by a fix/retry task.
 * This machine deduplicates concurrent investigations of the same failure type
 * and ensures learnings are always captured.
 *
 * instance_key: "recurring-failure-{failure-type}-{YYYY-MM-DD}" (one per type per day)
 *
 * States:
 *   detected              → investigation task created
 *   investigating         → root cause found; auto-transition to fix_pending or retrospective_pending
 *   fix_pending           → fix task created and executing
 *   fixing                → fix executing; waiting for completion
 *   retrospective_pending → capture learnings
 *   completed             → done
 *
 * Context:
 *   failureType       — e.g. "rate-limit", "payment-error"
 *   occurrences       — number of times this failure was observed
 *   sourceSkill       — skill that detected or triaged it (e.g. "arc-failure-triage")
 *   investigationSummary — root cause findings (populated after investigating state)
 *   needsFix          — true if a code/config fix is required, false if learnings only
 *   fixDescription    — what to fix (populated when needsFix is true)
 *   fixTaskRef        — "task:{id}" of the fix task, for retrospective reference
 *   learningsSummary  — brief summary of what was learned (populated before completing)
 */
export const RecurringFailureMachine: StateMachine<{
  failureType?: string;
  occurrences?: number;
  sourceSkill?: string;
  investigationSummary?: string;
  needsFix?: boolean;
  fixDescription?: string;
  fixTaskRef?: string;
  learningsSummary?: string;
}> = {
  name: "recurring-failure",
  initialState: "detected",
  states: {
    detected: {
      on: { investigate: "investigating" },
      action: (ctx) => {
        const failureType = ctx.failureType || "unknown";
        const occurrences = ctx.occurrences || 2;
        const skills = ctx.sourceSkill
          ? ["arc-failure-triage", ctx.sourceSkill, "arc-skill-manager"]
          : ["arc-failure-triage", "arc-skill-manager"];
        return {
          type: "create-task",
          subject: `Investigate recurring failure: ${failureType} (${occurrences} occurrences)`,
          priority: 5,
          skills,
          description: `Recurring failure type "${failureType}" has been observed ${occurrences} times.

Steps:
1. Review recent task history for this failure type
2. Identify the root cause
3. Determine if a code/config fix is needed or if the pattern just needs documenting
4. Transition this workflow to 'investigating', then set in context:
   - investigationSummary: root cause description
   - needsFix: true if a fix is required, false if learnings only
   - fixDescription: what to fix (only if needsFix is true)
5. Then transition to 'fix_pending' (if needsFix) or 'retrospective_pending' (if not)`,
        };
      },
    },
    investigating: {
      on: { needs_fix: "fix_pending", no_fix: "retrospective_pending" },
      action: (ctx) => {
        if (ctx.investigationSummary === undefined) return null;
        if (ctx.needsFix) {
          return { type: "transition", nextState: "fix_pending" };
        }
        return { type: "transition", nextState: "retrospective_pending" };
      },
    },
    fix_pending: {
      on: { apply: "fixing" },
      action: (ctx) => {
        if (!ctx.fixDescription) return null;
        const failureType = ctx.failureType || "unknown";
        const skills = ctx.sourceSkill
          ? ["arc-failure-triage", ctx.sourceSkill, "arc-skill-manager"]
          : ["arc-failure-triage", "arc-skill-manager"];
        return {
          type: "create-task",
          subject: `Fix recurring failure: ${failureType}`,
          priority: 5, // Sonnet sufficient: investigation (P4) did hard thinking; fix application is mechanical
          skills,
          description: `Apply the fix identified during investigation of recurring "${failureType}" failure.

Investigation summary: ${ctx.investigationSummary || "see investigation task"}

Fix to apply: ${ctx.fixDescription}

After applying the fix:
1. Verify the fix resolves the root cause
2. Transition this workflow to 'fixing', then 'retrospective_pending'
3. Set fixTaskRef to "task:{this-task-id}" in context`,
        };
      },
    },
    fixing: {
      on: { fixed: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const failureType = ctx.failureType || "unknown";
        const occurrences = ctx.occurrences || 2;
        const fixRef = ctx.fixTaskRef ? `\nFix applied: ${ctx.fixTaskRef}` : "";
        return {
          type: "create-task",
          subject: `Retrospective: recurring failure "${failureType}" (${occurrences} occurrences)`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract and record learnings from the recurring "${failureType}" failure investigation.
${fixRef}
Root cause: ${ctx.investigationSummary || "see investigation task"}

Steps:
1. Summarize the failure pattern, root cause, and fix applied (if any)
2. Identify prevention measures or monitoring improvements
3. Update memory/MEMORY.md if this reveals a systemic pattern
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * HealthAlertMachine — models the recurring health alert → acknowledge → retrospective cycle.
 *
 * Pattern detected: "health alert" tasks (3 recurrences, avg 2.0 steps/chain)
 * consistently spawn a retrospective to extract learnings. Unlike RecurringFailureMachine,
 * health alerts skip investigation (the alert IS the finding) and go straight to retrospective.
 * This machine deduplicates multiple alerts of the same type per day and ensures learnings
 * are always captured.
 *
 * instance_key: "health-alert-{alertType}-{YYYY-MM-DD}" (one per alert type per day)
 *
 * States:
 *   triggered             → health alert detected; creates an acknowledgement/resolution task
 *   acknowledging         → task is executing; waiting for resolution
 *   retrospective_pending → resolved; create retrospective to capture learnings
 *   completed             → done
 *
 * Context:
 *   alertType          — e.g. "dispatch-stale", "dispatch-stuck", "stale-lock"
 *   alertDate          — ISO date string (for dedup / reference)
 *   taskRef            — "task:{id}" of the original health alert task
 *   resolutionSummary  — brief description of how it was resolved (populated before retrospective)
 */
export const HealthAlertMachine: StateMachine<{
  alertType?: string;
  alertDate?: string;
  taskRef?: string;
  resolutionSummary?: string;
}> = {
  name: "health-alert",
  initialState: "triggered",
  states: {
    triggered: {
      on: { acknowledge: "acknowledging" },
      action: (ctx) => {
        const alertType = ctx.alertType || "unknown";
        const subject = `health alert: ${alertType.replace(/-/g, " ")}`;
        const skills = ["arc-service-health"];
        if (alertType === "stale-lock" || alertType === "dispatch-stale") skills.push("arc-housekeeping");
        return {
          type: "create-task",
          subject,
          priority: 2,
          skills,
          description: `Health alert triggered: ${alertType}.${ctx.taskRef ? `\nOriginal alert: ${ctx.taskRef}` : ""}${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Check service status and confirm whether the alert condition is still active
2. Resolve the condition if possible (restart service, clear stale lock, etc.)
3. Transition this workflow to 'acknowledging', then 'retrospective_pending'
4. Set resolutionSummary in context before transitioning`,
        };
      },
    },
    acknowledging: {
      on: { resolved: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const alertType = ctx.alertType || "unknown";
        return {
          type: "create-task",
          subject: `Retrospective: health alert — ${alertType.replace(/-/g, " ")}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a health alert: ${alertType}.${ctx.taskRef ? `\nOriginal alert: ${ctx.taskRef}` : ""}${ctx.resolutionSummary ? `\nResolution: ${ctx.resolutionSummary}` : ""}

Steps:
1. Review what triggered the alert and how it was resolved
2. Identify if this is a recurring pattern or a one-off condition
3. If recurring, note prevention measures or monitoring improvements in memory/MEMORY.md
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * OvernightBriefMachine — models the recurring overnight brief → retrospective cycle.
 *
 * Pattern detected: "sensor:arc-reporting-overnight" tasks (3 recurrences, avg 2.0 steps)
 * consistently spawn a retrospective to extract learnings from each brief.
 * This machine deduplicates concurrent brief tasks for the same date and ensures
 * a retrospective always follows.
 *
 * instance_key: "overnight-brief-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   pending               → creates the overnight brief task
 *   briefing              → brief executing; waiting for completion
 *   retrospective_pending → brief complete; create retrospective to extract learnings
 *   completed             → done
 *
 * Context:
 *   date           — ISO date string, e.g. "2026-03-08"
 *   briefTaskRef   — "task:{id}" of the overnight brief (populated after briefing starts)
 *   briefSummary   — optional short summary from the brief (populated before retrospective)
 */
export const OvernightBriefMachine: StateMachine<{
  date?: string;
  briefTaskRef?: string;
  briefSummary?: string;
}> = {
  name: "overnight-brief",
  initialState: "pending",
  states: {
    pending: {
      on: { start: "briefing" },
      action: (ctx) => {
        const date = ctx.date || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `Overnight brief — ${date}`,
          priority: 2,
          skills: ["arc-reporting"],
          description: `Generate the overnight brief for ${date}.

Steps:
1. Run arc-reporting skill to produce the nightly summary
2. Transition this workflow to 'briefing', set briefTaskRef to "task:{this-task-id}"
3. After completing the brief, set briefSummary (1-2 sentence summary of key findings)
4. Transition to 'retrospective_pending'`,
        };
      },
    },
    briefing: {
      on: { complete: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const date = ctx.date || "unknown date";
        return {
          type: "create-task",
          subject: `Retrospective: extract learnings from overnight brief — ${date}`,
          priority: 8,
          skills: ["arc-reporting", "arc-skill-manager"],
          description: `Extract learnings from the overnight brief for ${date}.
${ctx.briefTaskRef ? `Brief task: ${ctx.briefTaskRef}` : ""}
${ctx.briefSummary ? `Brief summary: ${ctx.briefSummary}` : ""}

Steps:
1. Review the overnight brief and identify patterns, insights, or anomalies
2. Note any recurring issues or improvements for future briefs in memory/MEMORY.md
3. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};




/**
 * CostAlertMachine — models the recurring cost alert → review → retrospective cycle.
 *
 * Pattern detected: "sensor:arc-cost-alerting" tasks (7 recurrences, avg 2.0 steps)
 * consistently spawn retrospective follow-ups after cost spikes are reviewed.
 * This machine deduplicates concurrent alerts for the same day and ensures
 * cost patterns are reviewed and recorded.
 *
 * instance_key: "cost-alert-{YYYY-MM-DD}" (one per day — multiple alerts same day deduplicate)
 *
 * States:
 *   alert                 → cost threshold crossed; creates a review task
 *   reviewing             → review task executing
 *   retrospective_pending → review done; create retrospective to extract learnings
 *   completed             → done
 *
 * Context:
 *   spendAmount    — current daily spend, e.g. 168.62
 *   cap            — configured daily cap, e.g. 200
 *   alertDate      — ISO date string (for dedup / reference)
 *   reviewSummary  — what drove the spend spike (populated before retrospective)
 */
export const CostAlertMachine: StateMachine<{
  spendAmount?: number;
  cap?: number;
  alertDate?: string;
  reviewSummary?: string;
}> = {
  name: "cost-alert",
  initialState: "alert",
  states: {
    alert: {
      on: { review: "reviewing" },
      action: (ctx) => {
        const spend = ctx.spendAmount ? `$${ctx.spendAmount.toFixed(2)}` : "high spend";
        const cap = ctx.cap ? `/$${ctx.cap}` : "";
        return {
          type: "create-task",
          subject: `Cost alert: daily spend ${spend}${cap} — review drivers`,
          priority: 7,
          skills: ["arc-cost-alerting", "arc-skill-manager"],
          description: `Cost alert triggered: daily spend is at ${spend}${cap}.${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Run arc status to see current cost breakdown by agent and task type
2. Identify the top 3 cost drivers (noisy sensors, expensive tasks, runaway loops)
3. If a sensor is clearly over-firing, note it — but do NOT throttle tasks or change budgets
4. Transition this workflow to 'reviewing', then 'retrospective_pending'
5. Set reviewSummary in context: what drove the spend`,
        };
      },
    },
    reviewing: {
      on: { reviewed: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const spend = ctx.spendAmount ? `$${ctx.spendAmount.toFixed(2)}` : "elevated spend";
        return {
          type: "create-task",
          subject: `Retrospective: cost alert — ${spend} daily spend`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a cost alert for daily spend of ${spend}.
${ctx.reviewSummary ? `Review summary: ${ctx.reviewSummary}` : ""}${ctx.alertDate ? `\nAlert date: ${ctx.alertDate}` : ""}

Steps:
1. Review the cost drivers identified in the review task
2. Identify if this is a recurring pattern (same sensors, same task types)
3. If recurring, note the pattern in memory/MEMORY.md for future reference
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * WalletFundingMachine — models the recurring wallet funding → confirm receipt → proceed chain.
 *
 * Pattern detected: "source:human" tasks (8 recurrences, avg 5.3 steps) consistently spawn
 * a "funding received" confirmation task followed by an on-chain registration or operation.
 * Examples: "Fund wallet → STX funding received → proceed with on-chain registration".
 * This machine tracks the funding lifecycle and ensures the downstream operation is triggered.
 *
 * instance_key: "wallet-funding-{agent}-{operation-slug}" (one per agent per operation)
 *
 * States:
 *   pending          → funding requested; creates a send task
 *   sent             → transfer broadcast; waiting for confirmation
 *   confirmed        → funds confirmed; creates the downstream operation task
 *   completed        → downstream operation done
 *
 * Context:
 *   recipient        — agent or address receiving funds (e.g. "loom", "SP2GH...")
 *   amountStx        — amount to send, e.g. 5
 *   sourceAddress    — Arc's STX address (default: SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B)
 *   txid             — broadcast txid (populated after sent)
 *   operationSubject — subject of the downstream task to create on confirmation
 *   operationSkills  — skills for the downstream task
 *   operationDesc    — description for the downstream task
 */
export const WalletFundingMachine: StateMachine<{
  recipient?: string;
  amountStx?: number;
  sourceAddress?: string;
  txid?: string;
  operationSubject?: string;
  operationSkills?: string[];
  operationDesc?: string;
}> = {
  name: "wallet-funding",
  initialState: "pending",
  states: {
    pending: {
      on: { send: "sent" },
      action: (ctx) => {
        if (!ctx.recipient || !ctx.amountStx) return null;
        return {
          type: "create-task",
          subject: `Send ${ctx.amountStx} STX to ${ctx.recipient}`,
          priority: 5,
          skills: ["crypto-wallet", "bitcoin-wallet"],
          description: `Send ${ctx.amountStx} STX from ${ctx.sourceAddress || "Arc wallet"} to ${ctx.recipient}.

Steps:
1. Verify Arc has sufficient STX balance (arc skills run --name crypto-wallet -- balance)
2. Broadcast the transfer transaction
3. Transition this workflow to 'sent' and set txid in context
4. The workflow will auto-advance to 'confirmed' once the txid is confirmed`,
        };
      },
    },
    sent: {
      on: { confirm: "confirmed" },
      action: (ctx) => {
        if (!ctx.txid) return null;
        return {
          type: "create-task",
          subject: `Confirm STX transfer to ${ctx.recipient || "recipient"} (txid: ${ctx.txid.slice(0, 8)}...)`,
          priority: 7,
          skills: ["crypto-wallet"],
          description: `Verify STX transfer confirmed on-chain.
Txid: ${ctx.txid}
Recipient: ${ctx.recipient || "unknown"}

Steps:
1. Check transaction status (typically 1-3 blocks, ~10-30 min on Stacks)
2. Confirm funds arrived at recipient address
3. Transition this workflow to 'confirmed'`,
        };
      },
    },
    confirmed: {
      on: { proceed: "completed" },
      action: (ctx) => {
        if (!ctx.operationSubject) return null;
        return {
          type: "create-task",
          subject: ctx.operationSubject,
          priority: 5,
          skills: ctx.operationSkills || ["arc-skill-manager"],
          description: ctx.operationDesc || `Proceed with operation after STX funding confirmed.\nFunding txid: ${ctx.txid || "see workflow context"}`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * ContentPromotionMachine — models the recurring blog-publish → X promotion chain.
 *
 * Pattern detected: "source:human" tasks consistently chain blog-publishing + arc-brand-voice +
 * social-x-posting skills (avg 5.3 steps). Published content needs X promotion and engagement
 * tracking. This machine ensures promotion always follows publication.
 *
 * instance_key: "content-promo-{post-slug}" (one per post)
 *
 * States:
 *   published        → post is live; create X promotion task
 *   promoting        → promotion posted; waiting for engagement window
 *   completed        → done
 *
 * Context:
 *   postSlug         — identifier for the post (e.g. "arc-weekly-2026-03-09")
 *   postUrl          — public URL of the published post
 *   postTitle        — title for crafting the tweet
 *   tweetDraft       — pre-written tweet (optional; if empty, agent drafts one)
 *   xPostId          — X post ID after promotion (populated after promoting)
 */
export const ContentPromotionMachine: StateMachine<{
  postSlug?: string;
  postUrl?: string;
  postTitle?: string;
  tweetDraft?: string;
  xPostId?: string;
}> = {
  name: "content-promotion",
  initialState: "published",
  states: {
    published: {
      on: { promote: "promoting" },
      action: (ctx) => {
        if (!ctx.postUrl && !ctx.postSlug) return null;
        const ref = ctx.postUrl || ctx.postSlug || "the post";
        return {
          type: "create-task",
          subject: `Promote on X: ${ctx.postTitle || ctx.postSlug || "new post"}`,
          priority: 6,
          skills: ["arc-x-agent", "arc-brand-voice", "social-x-posting"],
          description: `Promote the newly published content on X.
Post: ${ref}${ctx.postTitle ? `\nTitle: ${ctx.postTitle}` : ""}
${ctx.tweetDraft ? `Draft tweet:\n${ctx.tweetDraft}` : "Draft a tweet using arc-brand-voice guidelines. Keep it concise, add the post URL, no hashtag spam."}

Steps:
1. Read the post if needed to craft an authentic tweet
2. Post to X via arc-x-agent
3. Transition this workflow to 'promoting' and set xPostId in context`,
        };
      },
    },
    promoting: {
      on: { complete: "completed" },
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};


/**
 * PsbtEscalationMachine — models the recurring PSBT-needs-sign-off → approval → proceed chain.
 *
 * Pattern detected: "sensor:aibtc-inbox-sync:thread" tasks include escalation patterns where
 * Arc must pause on a Bitcoin operation (signing a PSBT, multisig co-sign) and wait for
 * whoabuddy approval before proceeding. This machine deduplicates concurrent escalations
 * for the same PSBT and ensures the approval gate is respected.
 *
 * instance_key: "psbt-escalation-{psbt-id-or-txid}" (one per PSBT)
 *
 * States:
 *   pending          → PSBT needs sign-off; creates escalation task to whoabuddy
 *   awaiting_approval → escalation sent; waiting for human approval signal
 *   approved         → approval received; creates signing/broadcast task
 *   rejected         → whoabuddy rejected; close with failed status
 *   completed        → signed and broadcast
 *
 * Context:
 *   psbtId           — identifier for the PSBT (inscription ID, txid prefix, etc.)
 *   requestedBy      — agent or person who requested the signature (e.g. "Tiny Marten")
 *   description      — what the PSBT does (e.g. "transfer inscription #8315 to XYZ")
 *   amountBtc        — BTC amount involved (for escalation context)
 *   approvedBy       — who approved it (populated after approval)
 *   signedTxid       — txid after broadcast (populated after signing)
 */
export const PsbtEscalationMachine: StateMachine<{
  psbtId?: string;
  requestedBy?: string;
  description?: string;
  amountBtc?: number;
  approvedBy?: string;
  signedTxid?: string;
}> = {
  name: "psbt-escalation",
  initialState: "pending",
  states: {
    pending: {
      on: { escalate: "awaiting_approval" },
      action: (ctx) => {
        const psbt = ctx.psbtId || "unknown PSBT";
        const requester = ctx.requestedBy || "external agent";
        const desc = ctx.description || "no description provided";
        const amount = ctx.amountBtc ? ` (${ctx.amountBtc} BTC)` : "";
        return {
          type: "create-task",
          subject: `ESCALATION: PSBT sign-off needed — ${psbt}${amount}`,
          priority: 3,
          skills: ["bitcoin-wallet", "bitcoin-taproot-multisig"],
          description: `Arc received a PSBT signing request that requires whoabuddy approval.

PSBT: ${psbt}
Requested by: ${requester}
Description: ${desc}${amount ? `\nAmount: ${amount}` : ""}

⚠️ DO NOT SIGN until whoabuddy explicitly approves.

Steps:
1. Summarize the PSBT details (inputs, outputs, purpose) for whoabuddy review
2. Send escalation via email or X DM: "PSBT sign-off needed: ${desc}"
3. Transition this workflow to 'awaiting_approval'
4. Do NOT proceed — wait for the approval signal to arrive`,
        };
      },
    },
    awaiting_approval: {
      on: { approve: "approved", reject: "rejected" },
      action: () => null,
    },
    approved: {
      on: { sign: "completed" },
      action: (ctx) => {
        const psbt = ctx.psbtId || "unknown PSBT";
        const approver = ctx.approvedBy || "whoabuddy";
        return {
          type: "create-task",
          subject: `Sign and broadcast PSBT: ${psbt} (approved by ${approver})`,
          priority: 3,
          skills: ["bitcoin-wallet", "bitcoin-taproot-multisig", "styx"],
          description: `PSBT has been approved by ${approver}. Sign and broadcast.

PSBT: ${psbt}
Original request: ${ctx.description || "see workflow context"}
Approved by: ${approver}

Steps:
1. Load the PSBT and verify it matches the approved description
2. Sign with Arc's Bitcoin key
3. Broadcast the signed transaction
4. Transition workflow to 'completed' and set signedTxid in context`,
        };
      },
    },
    rejected: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * SkillMaintenanceMachine — models the email-signal → skill audit → fix cycle.
 *
 * Pattern detected: "sensor:arc-email-sync:task" tasks (3 recurrences, avg 2.0 steps)
 * consistently spawn skill audit tasks that find issues and spawn targeted fix/rewrite tasks.
 * Email signals (API changes, contract upgrades, dependency shifts) trigger proactive skill checks.
 * Distinct from RecurringFailureMachine (reactive failures) — this is proactive maintenance
 * triggered by external signals about upstream changes.
 *
 * instance_key: "skill-maintenance-{skill-name}-{YYYY-MM-DD}" (one per skill per day)
 *
 * States:
 *   triggered    → signal received; creates an audit/investigation task
 *   auditing     → audit executing; auto-transitions based on auditFindings + fixDescription
 *   fix_pending  → issue confirmed; creates targeted fix/rewrite task
 *   fixing       → fix executing
 *   no_action    → audit found no issues; terminal
 *   completed    → fix applied; terminal
 *
 * Context:
 *   skillName       — e.g. "stacks-stackspot", "zest-v2", "stacks-payments"
 *   signalSource    — what triggered the audit: "arc-email-sync", "sensor", "api-change", etc.
 *   signalSummary   — brief description of what changed (e.g. "v2 contracts deployed on mainnet")
 *   auditFindings   — findings from audit (populated before fix_pending or no_action transition)
 *   fixDescription  — what to fix (populated when fix is needed)
 */
export const SkillMaintenanceMachine: StateMachine<{
  skillName?: string;
  signalSource?: string;
  signalSummary?: string;
  auditFindings?: string;
  fixDescription?: string;
}> = {
  name: "skill-maintenance",
  initialState: "triggered",
  states: {
    triggered: {
      on: { audit: "auditing" },
      action: (ctx) => {
        const skill = ctx.skillName || "unknown-skill";
        const signal = ctx.signalSummary ? `: ${ctx.signalSummary}` : "";
        return {
          type: "create-task",
          subject: `Audit ${skill}${signal}`,
          priority: 5,
          skills: [skill, "arc-skill-manager"],
          description: `Skill health audit triggered by ${ctx.signalSource || "external signal"}${signal}.

Steps:
1. Check ${skill} sensor.ts, cli.ts, and any external APIs/contracts it depends on
2. Verify the skill still functions correctly against current external state
3. Identify any schema mismatches, deprecated endpoints, or broken dependencies
4. Transition this workflow to 'auditing', then:
   - If issues found: set auditFindings and fixDescription in context, transition to 'fix_pending'
   - If no issues: set auditFindings, transition to 'no_action'`,
        };
      },
    },
    auditing: {
      on: { needs_fix: "fix_pending", no_fix: "no_action" },
      action: (ctx) => {
        if (ctx.auditFindings === undefined) return null;
        if (ctx.fixDescription) {
          return { type: "transition", nextState: "fix_pending" };
        }
        return { type: "transition", nextState: "no_action" };
      },
    },
    fix_pending: {
      on: { apply: "fixing" },
      action: (ctx) => {
        const skill = ctx.skillName || "unknown-skill";
        if (!ctx.fixDescription) return null;
        return {
          type: "create-task",
          subject: `Fix ${skill}: ${ctx.fixDescription}`,
          priority: 4,
          skills: [skill, "arc-skill-manager"],
          description: `Apply fix to ${skill} as identified during audit.

Audit findings: ${ctx.auditFindings || "see audit task"}
Fix to apply: ${ctx.fixDescription}

Steps:
1. Implement the required changes (sensor schema, CLI, contract addresses, etc.)
2. Run a quick syntax check: bun build --no-bundle skills/${skill}/sensor.ts (if applicable)
3. Commit changes with conventional commit format
4. Transition this workflow to 'fixing', then 'completed'`,
        };
      },
    },
    fixing: {
      on: { complete: "completed" },
      action: () => null,
    },
    no_action: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * DeFi compounding: harvest LP fees → reinvest into same pool or rebalance.
 * Sensor creates instances when accrued fees exceed threshold.
 * Each cycle: detected → harvesting → reinvesting → completed.
 */
export const CompoundingMachine: StateMachine<{
  pool?: string;
  poolName?: string;
  feeToken?: string;
  feeAmount?: string;
  feeAmountUsd?: number;
  threshold?: number;
  strategy?: "same-pool" | "rebalance";
  harvestTxId?: string;
  reinvestTxId?: string;
  treasuryLog?: string;
}> = {
  name: "compounding",
  initialState: "detected",
  states: {
    detected: {
      on: { harvest: "harvesting", skip: "completed" },
      action: (ctx) => {
        if (!ctx.pool) return null;
        const poolLabel = ctx.poolName || ctx.pool;
        return {
          type: "create-task",
          subject: `Harvest Bitflow LP fees: ${poolLabel}`,
          priority: 5,
          skills: ["bitflow", "defi-compounding"],
          description: `Harvest accrued fees from Bitflow LP position.

Pool: ${ctx.pool}
Fee token: ${ctx.feeToken || "unknown"}
Estimated fees: ${ctx.feeAmount || "unknown"}
Strategy: ${ctx.strategy || "same-pool"}

Steps:
1. Quote current LP position value via \`arc skills run --name bitflow -- pools\`
2. Remove liquidity to harvest fees: \`arc skills run --name bitflow -- remove-liquidity --pool ${ctx.pool} --lp-amount <fee-portion>\`
3. Record harvest tx ID in workflow context
4. Transition workflow to 'harvesting' state`,
        };
      },
    },
    harvesting: {
      on: { reinvest: "reinvesting", fail: "failed" },
      action: (ctx) => {
        if (!ctx.harvestTxId) return null;
        const poolLabel = ctx.poolName || ctx.pool || "unknown";
        const strategy = ctx.strategy || "same-pool";
        return {
          type: "create-task",
          subject: `Reinvest ${strategy === "rebalance" ? "via rebalance" : "into"} ${poolLabel}`,
          priority: 5,
          skills: ["bitflow", "defi-compounding"],
          description: `Reinvest harvested fees back into liquidity.

Pool: ${ctx.pool}
Harvest tx: ${ctx.harvestTxId}
Strategy: ${strategy}

Steps:
1. Check harvested token balances
2. ${strategy === "rebalance" ? "Swap to rebalance token ratio via Bitflow or Jingswap auction" : "Use harvested tokens directly"}
3. Add liquidity: \`arc skills run --name bitflow -- add-liquidity --pool ${ctx.pool} --token-a-amount <amount> --token-b-amount <amount>\`
4. Record reinvest tx ID in workflow context
5. Transition workflow to 'reinvesting' state`,
        };
      },
    },
    reinvesting: {
      on: { log: "logging", fail: "failed" },
      action: (ctx) => {
        if (!ctx.reinvestTxId) return null;
        return {
          type: "transition",
          nextState: "logging",
        };
      },
    },
    logging: {
      on: { complete: "completed" },
      action: (ctx) => {
        const poolLabel = ctx.poolName || ctx.pool || "unknown";
        return {
          type: "create-task",
          subject: `Log compounding cycle: ${poolLabel}`,
          priority: 8,
          skills: ["defi-compounding"],
          description: `Record compounding cycle for treasury reporting.

Pool: ${ctx.pool}
Fee amount: ${ctx.feeAmount || "unknown"}
Harvest tx: ${ctx.harvestTxId || "unknown"}
Reinvest tx: ${ctx.reinvestTxId || "unknown"}
Strategy: ${ctx.strategy || "same-pool"}

Steps:
1. Append entry to memory/defi-compounding-log.json
2. Update MEMORY.md with compounding stats if significant
3. Transition workflow to 'completed'`,
        };
      },
    },
    failed: {
      on: { retry: "detected" },
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * SelfReviewCycleMachine — models the periodic self-review → triage → fix lifecycle.
 *
 * Pattern detected: "sensor:arc-self-review" tasks (3 recurrences, avg 2.0 steps/chain)
 * consistently spawn follow-up chains covering disparate issues (sensor bugs, alert
 * investigations, analytics baselines). Without a machine, cycles overlap and duplicate.
 *
 * instance_key: "self-review-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   triggered         → review task created for the current cycle
 *   reviewing         → review executing; auto-transitions based on issueCount
 *   issues_found      → creates triage task to prioritize and dispatch targeted fixes
 *   triaging          → triage task executing; fix tasks being dispatched
 *   dispatched        → fix tasks running; monitoring resolution
 *   clean             → review found no issues (terminal)
 *   resolved          → all fixes dispatched and cycle complete (terminal)
 *
 * Context:
 *   cycleDate         — YYYY-MM-DD of this review cycle
 *   issueCount        — number of issues found
 *   issueSummary      — brief description of issues found
 *   costToday         — USD cost at time of review (e.g. "23.33")
 *   fixTaskIds        — JSON array of dispatched fix task IDs (populated during triaging)
 *   learningsSummary  — what was learned this cycle (populated before resolved)
 */
export const SelfReviewCycleMachine: StateMachine<{
  cycleDate?: string;
  issueCount?: number;
  issueSummary?: string;
  costToday?: string;
  fixTaskIds?: number[];
  learningsSummary?: string;
}> = {
  name: "self-review-cycle",
  initialState: "triggered",
  states: {
    triggered: {
      on: { start_review: "reviewing" },
      action: (ctx) => {
        const date = ctx.cycleDate || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `self-review: run health check for ${date}`,
          priority: 5,
          skills: ["arc-self-review"],
          description: `Periodic self-review cycle for ${date}.

Steps:
1. Run the full self-review checklist (sensors, dispatch health, cost, skill drift)
2. Record issueCount and issueSummary in workflow context
3. Transition workflow to 'reviewing'
4. If issues found: set issueCount > 0 and transition to 'issues_found'
5. If clean: transition to 'clean'`,
        };
      },
    },
    reviewing: {
      on: { found_issues: "issues_found", no_issues: "clean" },
      action: (ctx) => {
        if (ctx.issueCount === undefined) return null;
        if (ctx.issueCount > 0) {
          return { type: "transition", nextState: "issues_found" };
        }
        return { type: "transition", nextState: "clean" };
      },
    },
    issues_found: {
      on: { triage: "triaging" },
      action: (ctx) => {
        const count = ctx.issueCount || 1;
        const cost = ctx.costToday ? `, $${ctx.costToday} today` : "";
        return {
          type: "create-task",
          subject: `self-review triage: ${count} issue(s) found${cost}`,
          priority: 5,
          skills: ["arc-self-review", "arc-skill-manager"],
          description: `Triage and dispatch fixes for ${count} issue(s) identified in today's self-review.

Issues: ${ctx.issueSummary || "see review task"}

Steps:
1. Review each issue and determine the correct fix task
2. Create targeted fix tasks (use arc tasks add) for each actionable issue
3. Record dispatched task IDs in workflow context as fixTaskIds array
4. Transition workflow to 'triaging', then 'dispatched'
5. Capture learningsSummary before transitioning to 'resolved'`,
        };
      },
    },
    triaging: {
      on: { dispatch: "dispatched" },
      action: () => null,
    },
    dispatched: {
      on: { resolve: "resolved" },
      action: () => null,
    },
    clean: {
      on: {},
      action: () => null,
    },
    resolved: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * CostReportAuditMachine — models the daily cost report → anomaly investigation lifecycle.
 *
 * Pattern detected: "sensor:arc-cost-reporting" tasks (3 recurrences, avg 2.0 steps/chain)
 * consistently spawn investigation tasks for anomalies across different skills
 * (untagged tasks, blog-publishing cadence, aibtc-news-editorial API costs).
 * Without a machine, each report cycle creates ad-hoc audits with no unified tracking.
 *
 * Distinct from SkillMaintenanceMachine (which audits one skill) — this audits
 * the cost distribution across all skills and routes targeted audits per anomaly.
 *
 * instance_key: "cost-report-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   reported          → daily cost report generated; creates analysis task
 *   analyzing         → analysis executing; auto-transitions based on anomalyCount
 *   anomalies_found   → creates audit dispatch task per anomaly skill
 *   auditing          → individual skill audits running
 *   clean             → no anomalies detected (terminal)
 *   resolved          → audits complete, learnings captured (terminal)
 *
 * Context:
 *   reportDate        — YYYY-MM-DD of this report
 *   costTotal         — total daily cost in USD
 *   topDrivers        — JSON stringified array of {skill, costUsd} sorted descending
 *   anomalyCount      — number of anomalies needing investigation
 *   anomalies         — JSON stringified array of anomaly descriptions
 *   auditSkills       — JSON stringified array of skill names to audit
 *   auditTaskIds      — JSON stringified array of dispatched audit task IDs
 *   findingsSummary   — consolidated findings from all audits
 */
export const CostReportAuditMachine: StateMachine<{
  reportDate?: string;
  costTotal?: string;
  topDrivers?: string;
  anomalyCount?: number;
  anomalies?: string;
  auditSkills?: string;
  auditTaskIds?: string;
  findingsSummary?: string;
}> = {
  name: "cost-report-audit",
  initialState: "reported",
  states: {
    reported: {
      on: { analyze: "analyzing" },
      action: (ctx) => {
        const date = ctx.reportDate || new Date().toISOString().slice(0, 10);
        const cost = ctx.costTotal ? ` — $${ctx.costTotal}` : "";
        return {
          type: "create-task",
          subject: `analyze cost report ${date}${cost}`,
          priority: 6,
          skills: ["arc-cost-reporting"],
          description: `Analyze daily cost breakdown for ${date} and identify anomalies.

${ctx.topDrivers ? `Top drivers: ${ctx.topDrivers}` : ""}

Steps:
1. Review cost distribution by skill using arc status / cycle_log
2. Flag skills exceeding 20% of daily spend or showing >2x day-over-day increase
3. Record anomalyCount and anomalies (JSON array) in workflow context
4. Transition workflow to 'analyzing'
5. If anomalies: set auditSkills (JSON array of skill names) and transition to 'anomalies_found'
6. If clean: transition to 'clean'`,
        };
      },
    },
    analyzing: {
      on: { found_anomalies: "anomalies_found", no_anomalies: "clean" },
      action: (ctx) => {
        if (ctx.anomalyCount === undefined) return null;
        if (ctx.anomalyCount > 0) {
          return { type: "transition", nextState: "anomalies_found" };
        }
        return { type: "transition", nextState: "clean" };
      },
    },
    anomalies_found: {
      on: { dispatch_audits: "auditing" },
      action: (ctx) => {
        const count = ctx.anomalyCount || 1;
        const anomalyList = ctx.anomalies || "see analysis task";
        const skills: string[] = ["arc-cost-reporting"];
        try {
          const parsed = JSON.parse(ctx.auditSkills || "[]") as string[];
          skills.push(...parsed);
        } catch {
          // use default skills
        }
        return {
          type: "create-task",
          subject: `cost audit: dispatch ${count} anomaly investigation(s)`,
          priority: 6,
          skills,
          description: `Dispatch targeted audit tasks for ${count} cost anomaly(ies) found in today's report.

Anomalies: ${anomalyList}
Skills to audit: ${ctx.auditSkills || "see analysis task"}

Steps:
1. For each anomalous skill, create a targeted investigation task using arc-skill-manager
2. Link each fix task back to this workflow via --parent
3. Record dispatched task IDs in auditTaskIds (JSON array) in workflow context
4. Transition workflow to 'auditing', then 'resolved' once learnings are captured
5. Summarize findings in findingsSummary before transitioning to 'resolved'`,
        };
      },
    },
    auditing: {
      on: { resolve: "resolved" },
      action: () => null,
    },
    clean: {
      on: {},
      action: () => null,
    },
    resolved: {
      on: {},
      action: () => null,
    },
  },
};


/**
 * LandingPageReviewMachine — models the recurring "new release → review landing page content
 * → update llms.txt/llms-full.txt" cycle triggered by github-release-watcher.
 *
 * Pattern detected: "sensor:github-release-watcher:landing-page-review" tasks (5 recurrences,
 * avg 2.8 steps/chain) consistently spawn a follow-up to update llms.txt notable skills.
 * This machine deduplicates re-triggers per release and ensures the llms.txt update always
 * follows the content review.
 *
 * instance_key: "landing-page-review-{version}" (one per release)
 *   e.g. "landing-page-review-skills-v0.28.0"
 *
 * States:
 *   release_detected → new release found; creates a landing page review task
 *   reviewing        → review task executing; executor transitions to content_updating when done
 *   content_updating → content gaps identified; create llms.txt update task
 *   completed        → done (llms.txt updated)
 *   no_gaps          → review found nothing to update; done
 *
 * Context:
 *   repo            — "owner/repo" e.g. "aibtcdev/landing-page"
 *   version         — release version string e.g. "skills-v0.28.0"
 *   releaseUrl      — GitHub release URL (optional)
 *   contentGaps     — comma-separated summary of gaps found during review
 *   notableSkills   — comma-separated list of new skills to add to llms.txt
 */
export const LandingPageReviewMachine: StateMachine<{
  repo?: string;
  version?: string;
  releaseUrl?: string;
  contentGaps?: string;
  notableSkills?: string;
}> = {
  name: "landing-page-review",
  initialState: "release_detected",
  states: {
    release_detected: {
      on: { start_review: "reviewing" },
      action: (ctx) => {
        if (!ctx.repo || !ctx.version) return null;
        return {
          type: "create-task",
          subject: `Review ${ctx.repo} for ${ctx.version} content gaps`,
          priority: 6,
          skills: ["aibtc-repo-maintenance", "dev-landing-page-review"],
          description: `Review the landing page repo ${ctx.repo} for content gaps introduced by release ${ctx.version}.${ctx.releaseUrl ? `\nRelease: ${ctx.releaseUrl}` : ""}

Steps:
1. Compare the release changelog against landing page content
2. Identify missing notable skills, updated descriptions, or stale copy
3. Record findings in workflow context as contentGaps (comma-separated)
4. Record new skills to highlight as notableSkills (comma-separated)
5. Transition workflow:
   - If gaps found: arc skills run --name workflows -- transition <id> reviewing --context '{"contentGaps":"...","notableSkills":"..."}'
   - If nothing needed: arc skills run --name workflows -- transition <id> no_gaps`,
        };
      },
    },
    reviewing: {
      on: { update_content: "content_updating", no_gaps: "no_gaps" },
      action: (ctx) => {
        if (ctx.contentGaps === undefined) return null;
        if (!ctx.contentGaps || ctx.contentGaps.trim() === "") {
          return { type: "transition", nextState: "no_gaps" };
        }
        return { type: "transition", nextState: "content_updating" };
      },
    },
    content_updating: {
      on: { done: "completed" },
      action: (ctx) => {
        if (!ctx.version) return null;
        const skillsNote = ctx.notableSkills
          ? `\nNotable skills to add: ${ctx.notableSkills}`
          : "";
        const gapsNote = ctx.contentGaps
          ? `\nContent gaps identified: ${ctx.contentGaps}`
          : "";
        return {
          type: "create-task",
          subject: `Update llms.txt notable skills for ${ctx.version}`,
          priority: 7,
          skills: ["aibtc-repo-maintenance"],
          description: `Update llms.txt and llms-full.txt in the landing page repo to reflect ${ctx.version} additions.${gapsNote}${skillsNote}

Steps:
1. Open llms.txt and llms-full.txt in the landing page repo
2. Add the notable skills enumeration under the appropriate section
3. Ensure descriptions are accurate and concise
4. Hand off to Arc via PR workflow for the PR (GitHub is Arc-only)
5. Transition workflow to completed: arc skills run --name workflows -- transition <id> done`,
        };
      },
    },
    no_gaps: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * CeoReviewMachine — models the recurring CEO review → action items → retrospective cycle.
 *
 * Pattern detected: "sensor:arc-ceo-review" tasks (3 recurrences, avg 4.7 steps/chain)
 * consistently spawn diverse action item tasks (github-mentions, blog-deploy, PR workflow,
 * arc-reporting, arc-memory) followed by a retrospective to extract learnings.
 * This machine deduplicates concurrent review tasks for the same timeslot and ensures
 * the retrospective always follows.
 *
 * instance_key: "ceo-review-{YYYY-MM-DDTHH}" (one per scheduled review slot)
 *
 * States:
 *   scheduled             → creates the CEO review task
 *   reviewing             → review executing; executor identifies action items and transitions
 *   actions_pending       → action tasks created; waiting for completion
 *   retrospective_pending → create retrospective to extract learnings
 *   completed             → done
 *
 * Context:
 *   reviewDate     — ISO date-time of the review, e.g. "2026-03-20T01:01"
 *   reviewSummary  — brief summary of findings from the review (populated after reviewing)
 *   actionItems    — comma-separated list of spawned action task subjects
 *   taskRef        — "task:{id}" of the review task (populated after scheduling)
 */
export const CeoReviewMachine: StateMachine<{
  reviewDate?: string;
  reportFile?: string;
  reviewSummary?: string;
  taskRef?: string;
}> = {
  name: "ceo-review",
  initialState: "scheduled",
  states: {
    scheduled: {
      on: { start: "reviewing" },
      action: (ctx) => {
        const date = ctx.reviewDate || new Date().toISOString().slice(0, 16);
        return {
          type: "create-task",
          subject: `CEO review — ${date}`,
          priority: 4,
          skills: ["arc-ceo-review", "arc-ceo-strategy"],
          description: `Run the CEO review for ${date}.${ctx.reportFile ? `\nReport file: reports/${ctx.reportFile}` : ""}

This is a REPORT-ONLY review. Do NOT create follow-up tasks or modify existing tasks.

Steps:
1. Follow the instructions in skills/arc-ceo-review/AGENT.md
2. Write the Assessment section into the watch report
3. Set reviewSummary (2-3 sentence strategic assessment) in workflow context
4. Transition this workflow to 'reviewing'`,
        };
      },
    },
    reviewing: {
      on: { email: "emailing" },
      action: (ctx) => {
        if (ctx.reviewSummary === undefined) return null;
        return { type: "transition", nextState: "emailing" };
      },
    },
    emailing: {
      on: { sent: "completed" },
      action: (ctx) => {
        const date = ctx.reviewDate || "unknown date";
        return {
          type: "create-task",
          subject: `Email watch report to whoabuddy — ${date}`,
          priority: 4,
          skills: ["arc-email-sync"],
          description: `Send the completed watch report to whoabuddy.${ctx.reportFile ? `\nReport file: reports/${ctx.reportFile}` : ""}

Steps:
1. Read the watch report file
2. Send via arc skills run --name arc-email-sync -- send with the report as the email body
3. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * WorkflowReviewMachine — models the recurring workflow pattern detection → design → wire cycle.
 *
 * Pattern detected: "sensor:arc-workflow-review" tasks (3 recurrences, avg 2.7 steps/chain)
 * consistently spawn a follow-up to wire new machines into their sensors after design.
 * This machine deduplicates concurrent design tasks for the same review cycle and ensures
 * the sensor-wiring follow-up always happens.
 *
 * instance_key: "workflow-review-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   detected       → patterns found; creates the workflow design task
 *   designing      → design task executing; executor designs and registers new machines
 *   wiring_pending → new machines designed; create sensor-wiring audit task
 *   completed      → machines wired or no wiring needed
 *   no_patterns    → sensor found no new patterns to model (terminal)
 *
 * Context:
 *   patternCount   — number of repeating patterns detected
 *   patternSummary — brief description of detected patterns
 *   reviewDate     — ISO date of the review cycle
 *   newMachines    — comma-separated names of new state machines designed
 *   wiringSummary  — what sensors were wired (populated before completing)
 */
export const WorkflowReviewMachine: StateMachine<{
  patternCount?: number;
  patternSummary?: string;
  reviewDate?: string;
  newMachines?: string;
  wiringSummary?: string;
}> = {
  name: "workflow-review",
  initialState: "detected",
  states: {
    detected: {
      on: { start_design: "designing", no_patterns: "no_patterns" },
      action: (ctx) => {
        const count = ctx.patternCount || 0;
        if (count === 0) return { type: "transition", nextState: "no_patterns" };
        const date = ctx.reviewDate || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `Workflow design: ${count} repeating pattern(s) detected`,
          priority: 5,
          skills: ["arc-workflows", "arc-skill-manager"],
          description: `Workflow review detected ${count} repeating multi-step process(es) not yet modeled as workflow state machines.
${ctx.patternSummary ? `\nPatterns:\n${ctx.patternSummary}` : ""}

Steps:
1. Evaluate each pattern — does a formal state machine add value?
2. For each pattern worth modeling: design and register the template in state-machine.ts
3. Set newMachines in workflow context (comma-separated names of new machines)
4. Transition this workflow to 'designing', then 'wiring_pending'`,
        };
      },
    },
    designing: {
      on: { needs_wiring: "wiring_pending", no_wiring: "completed" },
      action: (ctx) => {
        if (ctx.newMachines === undefined) return null;
        if (!ctx.newMachines || ctx.newMachines.trim() === "") {
          return { type: "transition", nextState: "completed" };
        }
        return { type: "transition", nextState: "wiring_pending" };
      },
    },
    wiring_pending: {
      on: { wired: "completed" },
      action: (ctx) => {
        const machines = ctx.newMachines || "new machines";
        return {
          type: "create-task",
          subject: `Audit: wire ${machines} into their sensors`,
          priority: 6,
          skills: ["arc-workflows", "arc-skill-manager"],
          description: `New state machines have been designed: ${machines}.

For each new machine, audit the corresponding sensor(s) to check if they should create workflow instances instead of bare tasks.

Steps:
1. For each machine, identify the sensor(s) that trigger the pattern
2. Check if the sensor already creates workflow instances
3. If not: update the sensor to call createWorkflow() before creating the root task
4. Commit changes; run bun build --no-bundle to verify syntax
5. Transition this workflow to 'completed' and set wiringSummary in context`,
        };
      },
    },
    no_patterns: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * ComplianceReviewMachine — models the recurring compliance scan → retrospective cycle.
 *
 * Pattern detected: "sensor:compliance-review" tasks (3 recurrences, avg 2.0 steps/chain)
 * consistently spawn a retrospective to extract learnings after each scan.
 * This machine deduplicates concurrent scans for the same day and ensures
 * learnings are always captured.
 *
 * instance_key: "compliance-review-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   scan_complete         → compliance scan finished; creates a review task
 *   reviewing             → review task executing
 *   retrospective_pending → review done; create retrospective to extract learnings
 *   clean                 → scan found no findings (terminal)
 *   completed             → findings reviewed and learnings captured (terminal)
 *
 * Context:
 *   findingCount   — number of compliance findings
 *   skillCount     — number of skills scanned
 *   scanDate       — ISO date of the scan (for dedup / reference)
 *   taskRef        — "task:{id}" of the compliance review task
 *   learningsSummary — brief summary of what was learned
 */
export const ComplianceReviewMachine: StateMachine<{
  findingCount?: number;
  skillCount?: number;
  scanDate?: string;
  taskRef?: string;
  learningsSummary?: string;
}> = {
  name: "compliance-review",
  initialState: "scan_complete",
  states: {
    scan_complete: {
      on: { review: "reviewing", no_findings: "clean" },
      action: (ctx) => {
        const count = ctx.findingCount ?? 0;
        if (count === 0) return { type: "transition", nextState: "clean" };
        const skills = ctx.skillCount ? ` across ${ctx.skillCount} skills` : "";
        const date = ctx.scanDate || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `compliance-review: ${count} finding(s)${skills}`,
          priority: 6,
          skills: ["compliance-review", "arc-memory", "arc-skill-manager"],
          description: `Compliance scan on ${date} found ${count} finding(s)${skills}.

Steps:
1. Review each finding and determine severity (blocker / warning / info)
2. Create fix tasks for blocker-level findings (arc tasks add --priority 4)
3. Note warning-level patterns for memory
4. Set taskRef to "task:{this-task-id}" and transition this workflow to 'reviewing'
5. After completing, transition to 'retrospective_pending'`,
        };
      },
    },
    reviewing: {
      on: { reviewed: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const count = ctx.findingCount ?? 0;
        const date = ctx.scanDate || "unknown date";
        return {
          type: "create-task",
          subject: `Retrospective: compliance-review ${count} finding(s) — ${date}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from the compliance review scan on ${date} (${count} finding(s)).
${ctx.taskRef ? `Review task: ${ctx.taskRef}` : ""}
${ctx.learningsSummary ? `Learnings: ${ctx.learningsSummary}` : ""}

Steps:
1. Review findings and fixes applied
2. Identify if any findings are recurring patterns
3. If recurring, add prevention notes to memory/MEMORY.md
4. Transition workflow to 'completed'`,
        };
      },
    },
    clean: {
      on: {},
      action: () => null,
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * GithubMentionMachine — models the recurring GitHub @mention → work → retrospective cycle.
 *
 * Pattern detected: "github @mention in aibtcdev/agent-news" tasks (4 recurrences, avg 2.0 steps)
 * consistently spawn a work task followed by a retrospective to capture learnings.
 * This machine deduplicates concurrent mention processing and guarantees the retrospective runs.
 *
 * instance_key: "github-mention-{repo-slug}-{mention-type}-{id}"
 *   e.g. "github-mention-aibtcdev-agent-news-pr-200"
 *
 * States:
 *   received              → @mention detected; creates the work task (bugfix, feature, response)
 *   executing             → work task running; waiting for completion
 *   retrospective_pending → work done; create retrospective to extract learnings
 *   completed             → done
 *
 * Context:
 *   repo            — "owner/repo" e.g. "aibtcdev/agent-news"
 *   mentionUrl      — URL to the PR/issue/comment containing the mention
 *   mentionContext  — brief description of what is needed
 *   workType        — "bugfix" | "feature" | "response" | "pr-review" (default: response)
 *   skills          — skill names to load for the work task
 *   taskRef         — "task:{id}" of the execution task (populated after receiving)
 *   retrospectiveRef — "task:{id}" of the retrospective (for cross-referencing)
 */
export const GithubMentionMachine: StateMachine<{
  repo?: string;
  mentionUrl?: string;
  mentionContext?: string;
  workType?: string;
  skills?: string[];
  taskRef?: string;
  retrospectiveRef?: string;
}> = {
  name: "github-mention",
  initialState: "received",
  states: {
    received: {
      on: { execute: "executing" },
      action: (ctx) => {
        if (!ctx.repo) return null;
        const repo = ctx.repo;
        const workType = ctx.workType || "response";
        const context = ctx.mentionContext ? ` — ${ctx.mentionContext}` : "";
        const skills = ctx.skills?.length
          ? ctx.skills
          : ["aibtc-repo-maintenance", "arc-skill-manager"];
        return {
          type: "create-task",
          subject: `GitHub @mention in ${repo}${context}`,
          priority: 4,
          skills,
          description: `Respond to a GitHub @mention in ${repo}.${ctx.mentionUrl ? `\nMention: ${ctx.mentionUrl}` : ""}${ctx.mentionContext ? `\nContext: ${ctx.mentionContext}` : ""}
Work type: ${workType}

Steps:
1. Read the mention and any surrounding thread context
2. Perform the required work (bugfix, feature, review comment, or written response)
3. If work requires a PR, use PR workflow to route to Arc (GitHub-only policy)
4. Transition this workflow to 'executing'
5. Set taskRef to "task:{this-task-id}" in context before transitioning`,
        };
      },
    },
    executing: {
      on: { done: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const repo = ctx.repo || "unknown-repo";
        return {
          type: "create-task",
          subject: `Retrospective: extract learnings from GitHub @mention in ${repo}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from handling a GitHub @mention in ${repo}.
${ctx.taskRef ? `Work task: ${ctx.taskRef}` : ""}${ctx.mentionUrl ? `\nMention: ${ctx.mentionUrl}` : ""}${ctx.mentionContext ? `\nContext: ${ctx.mentionContext}` : ""}

Steps:
1. Review what the mention requested and how it was addressed
2. Identify patterns (recurring request types, gaps in the codebase, process issues)
3. If a pattern is recurring, add prevention or improvement notes to memory/MEMORY.md
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * SelfAuditMachine — models the recurring daily audit anomaly → investigate → fix/learn cycle.
 *
 * Pattern detected: "sensor:arc-self-audit" tasks (3 recurrences, avg 2.3 steps/chain)
 * consistently spawn investigation and fix/learning follow-ups. Without a machine, concurrent
 * anomalies produce overlapping investigation tasks and audit cycles close without extracting
 * learnings.
 *
 * instance_key: "self-audit-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   triggered          → investigation task created for the detected anomalies
 *   investigating      → root cause analysis running; auto-transitions based on needsFix
 *   fix_pending        → fix or PR task created
 *   fixing             → fix executing; dispatch agent transitions when done
 *   learning_pending   → learning-extraction task created
 *   completed          → learnings recorded (terminal)
 *
 * Context:
 *   auditDate          — YYYY-MM-DD of this audit cycle
 *   anomalyCount       — number of anomalies detected
 *   anomalySummary     — brief text listing anomalies
 *   investigationSummary — root cause findings (populated during investigating)
 *   needsFix           — true if code/config change required (populated during investigating)
 *   fixDescription     — what to fix (populated when needsFix is true)
 *   learningsSummary   — brief summary of learnings (populated before completing)
 */
export const SelfAuditMachine: StateMachine<{
  auditDate?: string;
  anomalyCount?: number;
  anomalySummary?: string;
  investigationSummary?: string;
  needsFix?: boolean;
  fixDescription?: string;
  learningsSummary?: string;
}> = {
  name: "self-audit",
  initialState: "triggered",
  states: {
    triggered: {
      on: { investigate: "investigating" },
      action: (ctx) => {
        const date = ctx.auditDate || new Date().toISOString().slice(0, 10);
        const count = ctx.anomalyCount || 1;
        const summary = ctx.anomalySummary || "see audit task";
        return {
          type: "create-task",
          subject: `Investigate: ${count} self-audit anomaly(ies) on ${date}`,
          priority: 5,
          skills: ["arc-self-audit", "arc-skill-manager", "arc-failure-triage"],
          model: "sonnet",
          description: `Investigate ${count} anomaly(ies) detected in the daily self-audit for ${date}.

Anomalies: ${summary}

Steps:
1. Review recent task history, sensor state, and cost trends for each anomaly
2. Identify root cause(s)
3. Determine if a code/config fix is needed or if learnings-only is sufficient
4. Transition this workflow to 'investigating', then set in context:
   - investigationSummary: root cause description
   - needsFix: true if a fix is required, false if learnings only
   - fixDescription: what to fix (only if needsFix is true)
5. Then transition to 'fix_pending' (if needsFix) or 'learning_pending' (if not)`,
        };
      },
    },
    investigating: {
      on: { needs_fix: "fix_pending", no_fix: "learning_pending" },
      action: (ctx) => {
        if (ctx.investigationSummary === undefined) return null;
        if (ctx.needsFix) {
          return { type: "transition", nextState: "fix_pending" };
        }
        return { type: "transition", nextState: "learning_pending" };
      },
    },
    fix_pending: {
      on: { apply: "fixing" },
      action: (ctx) => {
        if (!ctx.fixDescription) return null;
        const date = ctx.auditDate || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `Fix: self-audit anomaly on ${date}`,
          priority: 5,
          skills: ["arc-self-audit", "arc-skill-manager"],
          model: "sonnet",
          description: `Apply the fix identified during investigation of self-audit anomalies on ${date}.

Investigation summary: ${ctx.investigationSummary || "see investigation task"}

Fix to apply: ${ctx.fixDescription}

After applying the fix:
1. Verify it resolves the root cause
2. Transition this workflow to 'fixing', then 'learning_pending'`,
        };
      },
    },
    fixing: {
      on: { fixed: "learning_pending" },
      action: () => null,
    },
    learning_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const date = ctx.auditDate || new Date().toISOString().slice(0, 10);
        return {
          type: "create-task",
          subject: `Extract learning from self-audit: ${date}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          model: "haiku",
          description: `Record learnings from the ${date} self-audit cycle.

Anomalies: ${ctx.anomalySummary || "see audit task"}
Investigation: ${ctx.investigationSummary || "see investigation task"}
${ctx.fixDescription ? `Fix applied: ${ctx.fixDescription}` : "No code fix needed."}

Steps:
1. Summarize the anomaly pattern, root cause, and resolution
2. If this reveals a recurring or systemic pattern, update memory/MEMORY.md
3. Set learningsSummary in workflow context
4. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * FailureRetrospectiveMachine — models the daily failure triage → fix → learnings cycle.
 *
 * Pattern detected: "sensor:arc-failure-triage:retro" tasks (4 recurrences, avg 2.8 steps/chain)
 * consistently spawn fix tasks and learning extraction. RecurringFailureMachine handles individual
 * recurring failure types; this machine handles the daily triage cycle itself: one workflow per day
 * deduplicates retro tasks and ensures learnings are always captured after fixes.
 *
 * instance_key: "failure-retro-{YYYY-MM-DD}" (one per day)
 *
 * States:
 *   triage_pending    → daily retro sensor fired; create the triage task
 *   triaging          → triage running; auto-transitions when triageSummary is set
 *   learnings_pending → fixes dispatched (or none needed); extract learnings
 *   completed         → done
 *
 * Context:
 *   retroDate      — YYYY-MM-DD of the retro day
 *   failureCount   — number of failed tasks in this retro
 *   triageSummary  — root cause summary (populated by the triage task before transitioning)
 *   fixRefs        — "task:N,task:M" comma-separated list of fix tasks created (optional)
 *   learningsSummary — brief summary of extracted learnings (populated before completing)
 */
export const FailureRetrospectiveMachine: StateMachine<{
  retroDate?: string;
  failureCount?: number;
  triageSummary?: string;
  fixRefs?: string;
  learningsSummary?: string;
}> = {
  name: "failure-retrospective",
  initialState: "triage_pending",
  states: {
    triage_pending: {
      on: { start: "triaging" },
      action: (ctx) => {
        const date = ctx.retroDate || "today";
        const count = ctx.failureCount ?? 0;
        return {
          type: "create-task",
          subject: `Daily failure retrospective: ${count} failed task(s)`,
          priority: 6,
          model: "sonnet",
          skills: ["arc-failure-triage", "arc-skill-manager"],
          description: `Triage ${count} failed tasks from ${date}.

Steps:
1. Review failed tasks from the past 24h
2. Identify root causes and group by type
3. For recurring patterns (3+ occurrences), create fix tasks via arc tasks add
4. Set triageSummary in workflow context summarizing findings and any fix tasks created
5. Set fixRefs to "task:N,task:M" for any fix tasks created (if applicable)
6. Transition this workflow to 'learnings_pending'`,
        };
      },
    },
    triaging: {
      on: { learnings: "learnings_pending" },
      action: (ctx) => {
        if (ctx.triageSummary === undefined) return null;
        return { type: "transition", nextState: "learnings_pending" };
      },
    },
    learnings_pending: {
      on: { done: "completed" },
      action: (ctx) => {
        const date = ctx.retroDate || "today";
        const fixes = ctx.fixRefs ? `\nFix tasks created: ${ctx.fixRefs}` : "";
        return {
          type: "create-task",
          subject: `Extract learnings from failure retrospective ${date}`,
          priority: 8,
          model: "haiku",
          skills: ["arc-skill-manager"],
          description: `Extract and record learnings from the ${date} failure retrospective.
${fixes}
Findings: ${ctx.triageSummary || "see triage task"}

Steps:
1. Review the triage findings and any fix tasks created
2. Identify systemic patterns or recurring themes
3. Update memory/MEMORY.md with durable learnings
4. Set learningsSummary in workflow context
5. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * HumanReplyMachine — models the human-feedback → action → retrospective cycle.
 *
 * Pattern detected: "[re:" tasks (4 recurrences, avg 2.3 steps/chain) consistently spawn
 * an action task followed by a learning-extraction retrospective. Human feedback messages
 * (inbox replies referencing a prior task) trigger this machine.
 *
 * instance_key: "human-reply-{referencedTaskId}" (one per referenced task ID)
 *
 * States:
 *   received              → feedback received; create task to address it
 *   acknowledging         → action task running; auto-transitions when actionTaken is set
 *   retrospective_pending → action done; extract learnings
 *   completed             → done
 *
 * Context:
 *   referencedTaskId — the task ID being replied to (from "[re: #N]" subject)
 *   senderNote       — content of the human's message
 *   actionTaken      — description of what was done (populated before transitioning to retrospective)
 *   actionTaskRef    — "task:N" of the action task (optional cross-reference)
 *   learningsSummary — brief summary of extracted learnings (populated before completing)
 */
export const HumanReplyMachine: StateMachine<{
  referencedTaskId?: number;
  senderNote?: string;
  actionTaken?: string;
  actionTaskRef?: string;
  learningsSummary?: string;
}> = {
  name: "human-reply",
  initialState: "received",
  states: {
    received: {
      on: { acknowledge: "acknowledging" },
      action: (ctx) => {
        const refId = ctx.referencedTaskId;
        const subject = refId
          ? `Address human feedback on task #${refId}`
          : "Address human feedback";
        return {
          type: "create-task",
          subject,
          priority: 3,
          model: "sonnet",
          skills: ["arc-skill-manager"],
          description: `Human sent a reply with feedback or instructions.

Original task reference: ${refId ? `#${refId}` : "unknown"}
Message: ${ctx.senderNote || "(see inbox)"}

Steps:
1. Read task #${refId ?? "N"} to understand the original context
2. Address the feedback (fix, update, or respond as appropriate)
3. Set actionTaken in workflow context describing what was done
4. Set actionTaskRef to "task:{this-task-id}"
5. Transition workflow to 'retrospective_pending'`,
        };
      },
    },
    acknowledging: {
      on: { done: "retrospective_pending" },
      action: (ctx) => {
        if (ctx.actionTaken === undefined) return null;
        return { type: "transition", nextState: "retrospective_pending" };
      },
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const refId = ctx.referencedTaskId;
        const fixRef = ctx.actionTaskRef ? `\nAction taken: ${ctx.actionTaskRef}` : "";
        return {
          type: "create-task",
          subject: `Retrospective: extract learnings from human reply on task #${refId ?? "unknown"}`,
          priority: 8,
          model: "haiku",
          skills: ["arc-skill-manager"],
          description: `Extract and record learnings from human feedback on task #${refId ?? "unknown"}.
${fixRef}
Feedback: ${ctx.senderNote || "(see inbox)"}
Action taken: ${ctx.actionTaken || "see action task"}

Steps:
1. Summarize the feedback and the response
2. Identify any systemic issues or process improvements
3. Update memory/MEMORY.md if this reveals a pattern worth remembering
4. Set learningsSummary in workflow context
5. Transition workflow to 'completed'`,
        };
      },
    },
    completed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * Get a template by name.
 * Registry maps template names to their state machines.
 */
export function getTemplateByName(name: string): StateMachine | null {
  const templates: Record<string, StateMachine> = {
    "blog-posting": BlogPostingMachine,
    "signal-filing": SignalFilingMachine,
    "beat-claiming": BeatClaimingMachine,
    "pr-lifecycle": PrLifecycleMachine,
    "reputation-feedback": ReputationFeedbackMachine,
    "validation-request": ValidationRequestMachine,
    "inscription": InscriptionMachine,
    "new-release": NewReleaseMachine,
    "architecture-review": ArchitectureReviewMachine,
    "email-thread": EmailThreadMachine,
    "streak-maintenance": StreakMaintenanceMachine,
    "quest": QuestMachine,
    "agent-collaboration": AgentCollaborationMachine,
    "site-health-alert": SiteHealthAlertMachine,
    "recurring-failure": RecurringFailureMachine,
    "health-alert": HealthAlertMachine,
    "overnight-brief": OvernightBriefMachine,
    "cost-alert": CostAlertMachine,
    "wallet-funding": WalletFundingMachine,
    "content-promotion": ContentPromotionMachine,
    "psbt-escalation": PsbtEscalationMachine,
    "skill-maintenance": SkillMaintenanceMachine,
    "compounding": CompoundingMachine,
    "self-review-cycle": SelfReviewCycleMachine,
    "cost-report-audit": CostReportAuditMachine,
    "landing-page-review": LandingPageReviewMachine,
    "ceo-review": CeoReviewMachine,
    "workflow-review": WorkflowReviewMachine,
    "compliance-review": ComplianceReviewMachine,
    "github-mention": GithubMentionMachine,
    "self-audit": SelfAuditMachine,
    "failure-retrospective": FailureRetrospectiveMachine,
    "human-reply": HumanReplyMachine,
  };
  return templates[name] || null;
}
