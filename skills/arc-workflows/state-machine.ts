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
      on: { approve: "published", request_changes: "revision" },
      action: (ctx) => {
        return {
          type: "noop",
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

export const PrLifecycleMachine: StateMachine<{
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
}> = {
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
      action: (ctx) => {
        if (!ctx.owner || !ctx.repo || !ctx.number) return null;
        return { type: "noop" };
      },
    },
    "review-requested": {
      on: {
        request_changes: "changes-requested",
        approve: "approved",
        close: "closed",
      },
      action: () => null,
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
        if (!ctx.needsReply) return null;
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
          priority: 6,
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
          priority: 6,
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
          priority: 5,
          skills: ["arc0btc-site-health", "blog-deploy", "blog-publishing"],
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
          priority: 4,
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
  };
  return templates[name] || null;
}
