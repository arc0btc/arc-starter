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
          skills: ["aibtc-news-editorial", "publisher-voice"],
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
          skills: ["aibtc-news-editorial", "publisher-voice"],
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
          skills: ["aibtc-news-editorial", "publisher-voice"],
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
          skills: [skill, "manage-skills"],
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
          skills: [skill, "manage-skills"],
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
 * LandingPageReviewMachine — models the release-watcher → landing page review → gap-fix cycle.
 *
 * Pattern detected: "sensor:github-release-watcher:landing-page-review" tasks
 * (3 recurrences, avg 2.7 steps/chain) consistently spawn doc-update follow-ups
 * after reviewing the landing page for a new release.
 * This machine deduplicates concurrent reviews for the same release version and
 * ensures identified gaps always get fix tasks created.
 *
 * instance_key: "landing-page-review-{repo-slug}-{version}" (one per release)
 *
 * States:
 *   triggered     → review task created; checks landing page against new release
 *   reviewing     → review task executing; identifies documentation/content gaps
 *   gaps_found    → fix tasks created for each gap (SKILL.md updates, SHORT_DESC entries, etc.)
 *   fixing        → fix tasks executing
 *   no_gaps       → review found nothing to fix; terminal
 *   completed     → all gaps fixed; terminal
 *
 * Context:
 *   repo             — e.g. "aibtcdev/landing-page"
 *   releaseVersion   — e.g. "skills-v0.21.0"
 *   releaseDate      — ISO date string
 *   reviewTaskRef    — "task:{id}" of the review task
 *   gapSummary       — brief description of gaps found (populated before gaps_found)
 *   fixTaskRefs      — space-separated "task:{id}" refs of fix tasks created
 */
export const ResearchToPrdMachine: StateMachine<{
  project?: string;
  description?: string;
  skills?: string[];
  researchNotes?: string;
  prdPath?: string;
  planTaskCount?: number;
  completedCount?: number;
  gaps?: string;
  parentTaskId?: number;
}> = {
  name: "research-to-prd",
  initialState: "research",
  states: {
    research: {
      on: { synthesize: "synthesize" },
      action: (ctx) => {
        if (!ctx.project) return null;
        const skills = ctx.skills || [];
        return {
          type: "create-task",
          subject: `[${ctx.project}] Research: gather data from sources`,
          priority: 3,
          skills: ["workflows", ...skills],
          parentTaskId: ctx.parentTaskId,
          description: `Phase: RESEARCH for "${ctx.project}"\n\nGoal: ${ctx.description || "Gather data from multiple sources"}\n\nInstructions:\n1. Research the topic from multiple angles (code, docs, external sources)\n2. Save findings to the project scratchpad\n3. When research is sufficient, transition workflow to "synthesize" with researchNotes summarizing key findings`,
        };
      },
    },
    synthesize: {
      on: { plan: "plan" },
      action: (ctx) => {
        if (!ctx.researchNotes) return null;
        const skills = ctx.skills || [];
        return {
          type: "create-task",
          subject: `[${ctx.project}] Synthesize: create PRD from research`,
          priority: 3,
          skills: ["workflows", ...skills],
          parentTaskId: ctx.parentTaskId,
          description: `Phase: SYNTHESIZE for "${ctx.project}"\n\nResearch summary:\n${ctx.researchNotes}\n\nInstructions:\n1. Read the full research from the project scratchpad\n2. Synthesize into a PRD with ranked features (must-have, should-have, nice-to-have)\n3. Save PRD to research/ or docs/ directory\n4. Transition workflow to "plan" with prdPath set to the PRD file path`,
        };
      },
    },
    plan: {
      on: { implement: "implement" },
      action: (ctx) => {
        if (!ctx.prdPath) return null;
        const skills = ctx.skills || [];
        return {
          type: "create-task",
          subject: `[${ctx.project}] Plan: break PRD into implementation tasks`,
          priority: 3,
          skills: ["workflows", ...skills],
          parentTaskId: ctx.parentTaskId,
          description: `Phase: PLAN for "${ctx.project}"\n\nPRD: ${ctx.prdPath}\n\nInstructions:\n1. Read the PRD\n2. Break it into discrete implementation tasks with skill assignments and priorities\n3. Create each task via arc tasks add (with --skills and --priority)\n4. Transition workflow to "implement" with planTaskCount set to the number of tasks created`,
        };
      },
    },
    implement: {
      on: { simplify: "simplify", verify: "verify" },
      action: (ctx) => {
        // Implementation is driven by the individual tasks created in PLAN.
        // The meta-sensor checks if tasks are done and auto-transitions.
        return { type: "noop" };
      },
    },
    simplify: {
      on: { verify: "verify" },
      action: (ctx) => {
        const skills = ctx.skills || [];
        return {
          type: "create-task",
          subject: `[${ctx.project}] Simplify: review all changes for quality`,
          priority: 4,
          skills: ["workflows", ...skills],
          parentTaskId: ctx.parentTaskId,
          description: `Phase: SIMPLIFY for "${ctx.project}"\n\nInstructions:\n1. Identify all files changed as part of this initiative\n2. Run /simplify against changed files to review for reuse, quality, and efficiency\n3. Fix any issues found\n4. Transition workflow to "verify"`,
        };
      },
    },
    verify: {
      on: { complete: "complete", rework: "implement" },
      action: (ctx) => {
        if (!ctx.prdPath) return null;
        const skills = ctx.skills || [];
        return {
          type: "create-task",
          subject: `[${ctx.project}] Verify: check work against PRD`,
          priority: 3,
          skills: ["workflows", ...skills],
          parentTaskId: ctx.parentTaskId,
          description: `Phase: VERIFY for "${ctx.project}"\n\nPRD: ${ctx.prdPath}\n\nInstructions:\n1. Read the PRD and compare against completed work\n2. Check each PRD item — is it implemented and working?\n3. If gaps found: set gaps in workflow context and transition to "implement" (rework)\n4. If all items verified: transition to "complete"`,
        };
      },
    },
    complete: {
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
    "signal-filing": SignalFilingMachine,
    "beat-claiming": BeatClaimingMachine,
    "quest": QuestMachine,
    "streak-maintenance": StreakMaintenanceMachine,
    "credential-rotation": CredentialRotationMachine,
    "skill-maintenance": SkillMaintenanceMachine,
    "research-to-prd": ResearchToPrdMachine,
  };
  return templates[name] || null;
}
