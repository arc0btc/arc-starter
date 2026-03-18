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
        return {
          type: "create-task",
          subject,
          priority: 6,
          skills: ["arc-skill-manager"],
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
          priority: 6,
          skills: ["arc-reporting", "arc-skill-manager"],
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
 * FleetAlertMachine — models the recurring fleet alert → fix → retrospective cycle.
 *
 * Pattern detected: "fleet alert" tasks (4 recurrences, avg 2.0 steps/chain)
 * consistently spawn a retrospective to capture learnings after resolving remote
 * agent service issues. Distinct from HealthAlertMachine: fleet alerts target
 * remote nodes and require fleet-health + arc-remote-setup skills.
 *
 * instance_key: "fleet-alert-{agent-slug}-{YYYY-MM-DD}" (dedup multiple alerts per agent per day)
 *
 * States:
 *   alert                 → service issue detected on remote agent; creates investigation/fix task
 *   fixing                → fix task executing; waiting for resolution
 *   retrospective_pending → resolved; create retrospective to capture learnings
 *   completed             → done
 *
 * Context:
 *   agentName         — remote agent name, e.g. "iris", "loom"
 *   alertDescription  — short description, e.g. "dispatch: no cycles", "services down"
 *   alertDate         — ISO date string (for dedup / reference)
 *   taskRef           — "task:{id}" of the original fleet alert task
 *   fixSummary        — brief description of how it was resolved (populated before retrospective)
 */
export const FleetAlertMachine: StateMachine<{
  agentName?: string;
  alertDescription?: string;
  alertDate?: string;
  taskRef?: string;
  fixSummary?: string;
}> = {
  name: "fleet-alert",
  initialState: "alert",
  states: {
    alert: {
      on: { investigate: "fixing" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        const desc = ctx.alertDescription
          ? ` — ${ctx.alertDescription}`
          : "";
        return {
          type: "create-task",
          subject: `Fleet alert: ${agent} service issues${desc}`,
          priority: 5,
          skills: ["fleet-health", "arc-remote-setup", "arc-skill-manager"],
          description: `Fleet health alert for remote agent "${agent}"${ctx.alertDate ? ` on ${ctx.alertDate}` : ""}.
Issue: ${ctx.alertDescription || "service issues detected"}${ctx.taskRef ? `\nOriginal alert: ${ctx.taskRef}` : ""}

Steps:
1. Run fleet-health CLI to check service status on ${agent}
2. Identify the root cause (dispatch stalled, services crashed, connectivity, etc.)
3. Apply fix via arc-remote-setup if needed (restart services, clear stale locks, etc.)
4. Verify services are healthy before closing
5. Transition this workflow to 'fixing', then 'retrospective_pending'
6. Set fixSummary in context before transitioning`,
        };
      },
    },
    fixing: {
      on: { resolved: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        return {
          type: "create-task",
          subject: `Retrospective: fleet alert — ${agent} service issues`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a fleet health alert for remote agent "${agent}".
${ctx.taskRef ? `Original alert: ${ctx.taskRef}` : ""}${ctx.fixSummary ? `\nFix applied: ${ctx.fixSummary}` : ""}${ctx.alertDate ? `\nAlert date: ${ctx.alertDate}` : ""}

Steps:
1. Review what caused the service failure on ${agent}
2. Identify if this is a recurring pattern across fleet nodes
3. Note prevention measures or monitoring improvements in memory/MEMORY.md if recurring
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
 * FleetSyncMachine — models the recurring fleet git drift → sync → retrospective cycle.
 *
 * Pattern detected: "sensor:fleet-sync" tasks (8 recurrences, avg 2.8 steps)
 * consistently spawn retrospective follow-ups after syncing drifted agents.
 * This machine deduplicates concurrent drift tasks for the same day and ensures
 * sync results are reviewed for patterns.
 *
 * instance_key: "fleet-sync-{YYYY-MM-DD}" (one per day — multiple drifts same day deduplicate)
 *
 * States:
 *   drift_detected        → agents are behind Arc HEAD; creates sync task
 *   syncing               → sync task executing; waiting for completion
 *   retrospective_pending → sync done; create retrospective to extract learnings
 *   completed             → done
 *
 * Context:
 *   driftedAgents  — comma-separated agent names, e.g. "spark,iris,loom,forge"
 *   commitHash     — Arc HEAD commit that agents need to catch up to
 *   syncSummary    — brief description of what was deployed (populated before retrospective)
 *   alertDate      — ISO date string (for dedup / reference)
 */
export const FleetSyncMachine: StateMachine<{
  driftedAgents?: string;
  commitHash?: string;
  syncSummary?: string;
  alertDate?: string;
}> = {
  name: "fleet-sync",
  initialState: "drift_detected",
  states: {
    drift_detected: {
      on: { sync: "syncing" },
      action: (ctx) => {
        const agents = ctx.driftedAgents || "all agents";
        const commit = ctx.commitHash ? ` (${ctx.commitHash.slice(0, 8)})` : "";
        return {
          type: "create-task",
          subject: `Fleet git drift: sync ${agents} to Arc HEAD${commit}`,
          priority: 5,
          skills: ["fleet-sync", "arc-skill-manager"],
          description: `Fleet git drift detected: ${agents} are behind Arc HEAD${commit}.${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Run fleet-sync CLI to push Arc HEAD to drifted agents
2. Verify all agents are on the correct commit
3. Transition this workflow to 'syncing', then 'retrospective_pending'
4. Set syncSummary in context: what changed in this commit and any sync issues encountered`,
        };
      },
    },
    syncing: {
      on: { synced: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const agents = ctx.driftedAgents || "fleet agents";
        return {
          type: "create-task",
          subject: `Retrospective: fleet git drift — ${agents}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a fleet git drift sync event.
${ctx.commitHash ? `Commit: ${ctx.commitHash}` : ""}${ctx.syncSummary ? `\nSync summary: ${ctx.syncSummary}` : ""}${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Review what caused the drift (sensor cadence, large batch of commits, etc.)
2. Note whether any agents had sync failures or needed manual intervention
3. If a recurring pattern, suggest sensor interval or deployment improvements in memory/MEMORY.md
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
 * FleetEscalationMachine — models the recurring fleet escalation → resolve → retrospective cycle.
 *
 * Pattern detected: "fleet escalation" tasks (8 recurrences, avg 2.1 steps)
 * consistently spawn retrospective follow-ups after resolving blocked worker tasks.
 * This machine deduplicates escalations for the same blocked task and ensures learnings
 * are captured for each unblock pattern.
 *
 * instance_key: "fleet-escalation-{agent}-{blocked-task-id}" (one per blocked task per agent)
 *
 * States:
 *   escalated             → worker is blocked; creates an unblock task
 *   resolving             → unblock task executing; waiting for resolution
 *   retrospective_pending → unblocked; create retrospective to capture learnings
 *   completed             → done
 *
 * Context:
 *   agentName         — remote agent name, e.g. "iris", "loom", "forge"
 *   blockedTaskId     — task ID on the worker that is blocked
 *   blockDescription  — short description of what the task is blocked on
 *   resolutionSummary — how it was unblocked (populated before retrospective)
 *   alertDate         — ISO date string (for reference)
 */
export const FleetEscalationMachine: StateMachine<{
  agentName?: string;
  blockedTaskId?: number;
  blockDescription?: string;
  resolutionSummary?: string;
  alertDate?: string;
}> = {
  name: "fleet-escalation",
  initialState: "escalated",
  states: {
    escalated: {
      on: { resolve: "resolving" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        const taskRef = ctx.blockedTaskId ? ` task #${ctx.blockedTaskId}` : "";
        const blockDesc = ctx.blockDescription ? ` — ${ctx.blockDescription}` : "";
        return {
          type: "create-task",
          subject: `Resolve fleet escalation: ${agent} blocked on${taskRef}${blockDesc}`,
          priority: 4,
          skills: ["fleet-escalation", "fleet-task-sync", "arc-skill-manager"],
          description: `Fleet escalation: remote agent "${agent}" is blocked on${taskRef}.
Block reason: ${ctx.blockDescription || "see escalation alert"}${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Review the blocked task on ${agent} and determine the root cause
2. Provide the missing resource (credentials, config, unblock signal, etc.)
3. Verify the task resumes or is explicitly closed as failed
4. Transition this workflow to 'resolving', then 'retrospective_pending'
5. Set resolutionSummary in context before transitioning`,
        };
      },
    },
    resolving: {
      on: { resolved: "retrospective_pending" },
      action: () => null,
    },
    retrospective_pending: {
      on: { learnings_extracted: "completed" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        const taskRef = ctx.blockedTaskId ? ` task #${ctx.blockedTaskId}` : "";
        return {
          type: "create-task",
          subject: `Retrospective: fleet escalation — ${agent} blocked on${taskRef}`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a fleet escalation: ${agent} was blocked on${taskRef}.
Block reason: ${ctx.blockDescription || "see escalation alert"}${ctx.resolutionSummary ? `\nResolution: ${ctx.resolutionSummary}` : ""}${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

Steps:
1. Review what caused the block and how it was resolved
2. Identify if this block type is recurring (same agent, same missing resource)
3. If recurring, propose a proactive fix (pre-provision credentials, update provisioning template, etc.)
4. Update templates/agent-provisioning.md or memory/MEMORY.md if a gap is identified
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
 *   spendAmount    — current fleet spend, e.g. 168.62
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
          subject: `Cost alert: fleet spend ${spend}${cap} — review drivers`,
          priority: 7,
          skills: ["arc-cost-alerting", "arc-skill-manager"],
          description: `Cost alert triggered: fleet spend is at ${spend}${cap}.${ctx.alertDate ? `\nDate: ${ctx.alertDate}` : ""}

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
          subject: `Retrospective: cost alert — ${spend} fleet spend`,
          priority: 8,
          skills: ["arc-skill-manager"],
          description: `Extract learnings from a cost alert for fleet spend of ${spend}.
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
 * Examples: "Fund Loom/Forge wallets → STX funding received → proceed with on-chain registration".
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
 * CredentialRotationMachine — models the recurring credential-expires → migrate → verify cycle.
 *
 * Pattern detected: "sensor:fleet-health:loom" tasks (16 recurrences, avg 2.3 steps) include
 * "OAuth expires in 4h — migrate to API key" patterns. Credential expirations follow a clear
 * detect → rotate → verify → confirm pattern. This machine deduplicates concurrent rotation
 * attempts for the same credential and tracks verification.
 *
 * instance_key: "cred-rotation-{agent}-{service}" (one per agent per service)
 *
 * States:
 *   expiring         → credential near-expiry detected; creates rotation task
 *   rotating         → rotation task executing
 *   verifying        → new credential set; creates verification task
 *   completed        → verified and confirmed
 *
 * Context:
 *   agentName        — agent whose credential is expiring (e.g. "loom", "iris")
 *   service          — service name (e.g. "anthropic-oauth", "x-oauth")
 *   credType         — current cred type (e.g. "oauth", "api-key")
 *   targetCredType   — what to migrate to (e.g. "api-key")
 *   expiresAt        — ISO timestamp of expiry
 *   newCredKey       — credential store key after rotation (populated after rotating)
 */
export const CredentialRotationMachine: StateMachine<{
  agentName?: string;
  service?: string;
  credType?: string;
  targetCredType?: string;
  expiresAt?: string;
  newCredKey?: string;
}> = {
  name: "credential-rotation",
  initialState: "expiring",
  states: {
    expiring: {
      on: { rotate: "rotating" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        const svc = ctx.service || "unknown-service";
        const from = ctx.credType || "current credential";
        const to = ctx.targetCredType || "new credential";
        const expiry = ctx.expiresAt ? ` (expires: ${ctx.expiresAt})` : "";
        return {
          type: "create-task",
          subject: `Rotate ${svc} credential for ${agent}: ${from} → ${to}`,
          priority: 4,
          skills: ["fleet-health", "arc-remote-setup"],
          description: `Credential expiry detected for ${agent} — ${svc} ${from}${expiry}.

Steps:
1. Generate or retrieve the new ${to} for ${svc}
2. Store it via: arc creds set --service ${svc} --key ${to} --value <VALUE>
3. Update the service config on ${agent} to use the new credential
4. Restart affected services on ${agent} if needed
5. Transition this workflow to 'rotating', then 'verifying'
6. Set newCredKey in context (the creds store key for the new credential)`,
        };
      },
    },
    rotating: {
      on: { verify: "verifying" },
      action: () => null,
    },
    verifying: {
      on: { confirmed: "completed" },
      action: (ctx) => {
        const agent = ctx.agentName || "unknown-agent";
        const svc = ctx.service || "unknown-service";
        return {
          type: "create-task",
          subject: `Verify ${svc} credential rotation on ${agent}`,
          priority: 5,
          skills: ["fleet-health", "arc-remote-setup"],
          description: `Verify the rotated ${svc} credential is working on ${agent}.
New credential key: ${ctx.newCredKey || "see workflow context"}

Steps:
1. Trigger a test dispatch cycle on ${agent} or run a health check
2. Confirm services are running and no auth errors in logs
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
    "fleet-alert": FleetAlertMachine,
    "fleet-sync": FleetSyncMachine,
    "fleet-escalation": FleetEscalationMachine,
    "cost-alert": CostAlertMachine,
    "wallet-funding": WalletFundingMachine,
    "content-promotion": ContentPromotionMachine,
    "credential-rotation": CredentialRotationMachine,
    "psbt-escalation": PsbtEscalationMachine,
    "skill-maintenance": SkillMaintenanceMachine,
    "compounding": CompoundingMachine,
    "self-review-cycle": SelfReviewCycleMachine,
    "cost-report-audit": CostReportAuditMachine,
  };
  return templates[name] || null;
}
