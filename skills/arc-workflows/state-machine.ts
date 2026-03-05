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
}> = {
  name: "pr-lifecycle",
  initialState: "opened",
  states: {
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
          skills: ["bitcoin"],
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
          skills: ["bitcoin"],
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
          skills: ["bitcoin"],
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
          skills: ["bitcoin"],
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
  };
  return templates[name] || null;
}
