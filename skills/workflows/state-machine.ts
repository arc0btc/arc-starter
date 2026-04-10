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
 * DailyBriefInscriptionMachine — inscribes the aibtc.news daily brief on Bitcoin once per day.
 *
 * Triggered by: sensor:daily-brief-inscribe at 11 PM PST
 * instance_key: "brief-inscription-{YYYY-MM-DD}" (one per PST calendar day)
 *
 * States:
 *   pending              → fetch the compiled brief content from aibtc.news
 *   brief_fetched        → estimate fees and verify BTC balance covers cost
 *   balance_ok           → broadcast commit transaction (Step 1 of commit/reveal)
 *   committed            → poll mempool until commit tx has ≥1 confirmation
 *   confirmed            → broadcast reveal transaction (Step 2 — creates inscription)
 *   revealed             → record inscription txid on aibtc.news via inscribe-brief API
 *   completed            → terminal success
 *   failed               → terminal failure (set from any state on unrecoverable error)
 *
 * Context:
 *   date                 — PST date YYYY-MM-DD (the brief date being inscribed)
 *   parentId             — Parent inscription ID (Loom's collection root; set once at setup)
 *   contentType          — MIME type; default "text/plain"
 *   briefContent         — compiled brief text fetched in brief_fetched step
 *   estimatedCost        — sats from estimate step
 *   commitTxid           — txid from the commit (inscribe) step
 *   revealAmount         — sats locked in commit output; needed for reveal
 *   feeRate              — sat/vB used for commit; stored for reveal step
 *   inscriptionId        — final inscription ID after reveal confirms ({revealTxid}i0)
 *   confirmPollCount     — number of times we have polled for commit confirmation
 *   failureReason        — human-readable reason if state=failed
 */
export interface DailyBriefInscriptionContext {
  date: string;
  parentId?: string;
  contentType?: string;
  briefContent?: string;
  estimatedCost?: number;
  commitTxid?: string;
  revealAmount?: number;
  feeRate?: number;
  inscriptionId?: string;
  confirmPollCount?: number;
  verifyPollCount?: number;
  failureReason?: string;
  /** Remaining dates to inscribe after this one completes. Enables sequential chaining. */
  remainingDates?: string[];
}

export const DailyBriefInscriptionMachine: StateMachine<DailyBriefInscriptionContext> = {
  name: "daily-brief-inscription",
  initialState: "pending",
  states: {
    /**
     * pending → fetch the compiled brief for this date.
     * Task: call GET /api/brief/:date on aibtc.news, store content in context,
     * then transition to brief_fetched.
     * Fail if brief is not yet compiled — close as failed with failureReason.
     */
    pending: {
      on: { brief_ready: "brief_fetched", no_brief: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Fetch compiled brief for ${ctx.date}`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Fetch the compiled daily brief for ${ctx.date} from aibtc.news.

Steps:
1. arc skills run --name aibtc-news-classifieds -- get-brief --date ${ctx.date}
   (requires x402 payment — 1000 sats sBTC)
2. If the brief exists: store the full text content in workflow context as briefContent,
   then transition the workflow to 'brief_fetched'.
3. If brief not found or not yet compiled: transition to 'failed' with
   failureReason="Brief not compiled for ${ctx.date}". Close task as completed.

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * brief_fetched → estimate inscription cost and verify BTC balance.
     * Task: run child-inscription estimate, check btc balance covers totalCost.
     * Transition to balance_ok or failed.
     */
    brief_fetched: {
      on: { balance_ok: "balance_ok", insufficient_funds: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Estimate inscription fee and check BTC balance for ${ctx.date} brief`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Estimate the cost of inscribing the ${ctx.date} brief and verify wallet balance.

Steps:
1. Estimate fee:
   bun run skills/child-inscription/child-inscription.ts estimate \\
     --parent-id "${ctx.parentId ?? "<LOOM_PARENT_INSCRIPTION_ID>"}" \\
     --content-type "${ctx.contentType ?? "text/plain"}" \\
     --content "<briefContent from context>"

2. Check BTC balance:
   arc skills run --name bitcoin-wallet -- info
   (then check bc1q address balance via: curl -s https://mempool.space/api/address/<addr>)

3. If balance >= totalCost: store estimatedCost in context, transition to 'balance_ok'.
4. If balance < totalCost: transition to 'failed' with
   failureReason="Insufficient BTC: need <totalCost> sats, have <balance> sats".

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * balance_ok → broadcast commit transaction (Step 1).
     * Task: run child-inscription inscribe, save commitTxid + revealAmount to context.
     */
    balance_ok: {
      on: { commit_broadcast: "committed", commit_failed: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Commit inscription for ${ctx.date} brief`,
        priority: 5,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Broadcast the commit transaction for the ${ctx.date} brief inscription.

Steps:
1. bun run skills/child-inscription/child-inscription.ts inscribe \\
     --parent-id "${ctx.parentId ?? "<LOOM_PARENT_INSCRIPTION_ID>"}" \\
     --content-type "${ctx.contentType ?? "text/plain"}" \\
     --content "<briefContent from context>" \\
     --fee-rate ${ctx.feeRate ?? 1}

2. On success: store commitTxid, revealAmount, and feeRate in workflow context.
   IMPORTANT: Also clear briefContent from context to reduce token usage in later states:
   arc skills run --name workflows -- transition <workflow_id> committed \\
     --context '{"commitTxid":"<txid>","revealAmount":<amount>,"feeRate":${ctx.feeRate ?? 1},"briefContent":null}'
   The brief text is preserved in the child-inscription state file for the reveal step.

3. On failure: transition to 'failed' with failureReason set to the error message.

Note: child-inscription writes a per-instance state file (.child-inscription-state-{commitTxid}.json) — keep it until reveal is done.

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * committed → poll mempool until commit tx has ≥1 confirmation.
     * Task: check mempool.space. If unconfirmed, schedule a 30-min retry.
     * Fail after 12 polls (~6 hours).
     */
    committed: {
      on: { commit_confirmed: "confirmed", confirm_timeout: "failed" },
      action: (ctx) => {
        const pollCount = ctx.confirmPollCount ?? 0;
        const MAX_POLLS = 12;
        if (pollCount >= MAX_POLLS) return null;
        return {
          type: "create-task",
          subject: `Poll commit confirmation for ${ctx.date} brief (attempt ${pollCount + 1}/${MAX_POLLS})`,
          priority: 7,
          skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
          description: `Check whether the commit tx for the ${ctx.date} brief inscription has confirmed.

commitTxid: ${ctx.commitTxid ?? "<commitTxid from context>"}

Steps:
1. curl -s "https://mempool.space/api/tx/${ctx.commitTxid ?? "<commitTxid>"}" | \\
   python3 -c "import json,sys; s=json.load(sys.stdin).get('status',{}); print('confirmed' if s.get('confirmed') else 'pending')"

2. If confirmed (≥1 block): transition workflow to 'confirmed'. Close task as completed.

3. If still pending:
   - Increment confirmPollCount in context (now ${pollCount + 1}).
   - If pollCount >= ${MAX_POLLS}: transition to 'failed' with failureReason="Commit confirmation timeout".
   - Otherwise: create a follow-up poll task scheduled 30 minutes from now, close this task as completed.

Workflow instance_key: brief-inscription-${ctx.date}`,
        };
      },
    },

    /**
     * confirmed → broadcast reveal transaction (Step 2 — creates the inscription).
     * Task: run child-inscription reveal, capture inscriptionId.
     */
    confirmed: {
      on: { reveal_broadcast: "revealed", reveal_failed: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Reveal inscription for ${ctx.date} brief`,
        priority: 5,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Broadcast the reveal transaction to complete the ${ctx.date} brief inscription.

commitTxid: ${ctx.commitTxid ?? "<commitTxid from context>"}

Steps:
1. bun run skills/child-inscription/child-inscription.ts reveal \\
     --commit-txid ${ctx.commitTxid ?? "<commitTxid>"} \\
     --vout 0

   Content, parentId, and revealAmount are read from the per-instance state file
   (.child-inscription-state-{commitTxid}.json) — do not delete it before running this command.

2. On success: store inscriptionId ({revealTxid}i0) in workflow context.
   Transition workflow to 'revealed'.

3. On failure: transition to 'failed' with failureReason set to the error message.

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * revealed → record the inscription on aibtc.news.
     * Task: call inscribe-brief API to register the txid with the platform.
     * Note: inscription exists on-chain regardless — capture inscriptionId even on API failure.
     */
    revealed: {
      on: { recorded: "verified", record_failed: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Record ${ctx.date} brief inscription on aibtc.news`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Register the completed inscription with aibtc.news for ${ctx.date}.

inscriptionId: ${ctx.inscriptionId ?? "<inscriptionId from context>"}

Steps:
1. arc skills run --name aibtc-news-classifieds -- inscribe-brief --date ${ctx.date} --inscription-id ${ctx.inscriptionId ?? "<inscriptionId from context>"}
   (requires BIP-137 publisher auth)

2. On success: transition workflow to 'recorded' → 'verified'. Close task as completed with
   summary including the inscriptionId.

3. On API failure: transition to 'failed' with failureReason. The inscription already
   exists on-chain — record the inscriptionId in the failure reason for manual recovery.

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * verified → confirm inscription landed on-chain and API recorded it correctly.
     * Task: check aibtc.news API + mempool for reveal tx confirmation.
     * Only proceed to payout after on-chain verification passes.
     */
    verified: {
      on: { verification_passed: "payout", verification_failed: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Verify inscription for ${ctx.date} brief`,
        priority: 7,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Verify the ${ctx.date} brief inscription is confirmed on-chain and recorded on aibtc.news.

inscriptionId: ${ctx.inscriptionId ?? "<inscriptionId from context>"}
Current verify poll count: ${ctx.verifyPollCount ?? 0}

Steps:
1. Check API: GET https://aibtc.news/api/brief/${ctx.date}/inscription
   Confirm response has inscribed: true and inscription_id matches.

2. Check mempool: GET https://mempool.space/api/tx/${ctx.inscriptionId?.split("i")[0] ?? "<revealTxid>"}
   Confirm the reveal transaction has at least 1 confirmation (status.confirmed: true).

3. If both checks pass: transition workflow to 'verification_passed' → 'payout'.

4. If reveal tx unconfirmed and verifyPollCount < 12:
   Increment verifyPollCount in workflow context, do NOT transition.
   Close task as completed with summary "Awaiting confirmation, poll ${(ctx.verifyPollCount ?? 0) + 1}/12".
   The meta-sensor will re-evaluate and create a new verification task on next cycle.

5. If verifyPollCount >= 12 (6+ hours): transition to 'verification_failed' → 'failed'
   with failureReason noting the timeout.

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    /**
     * payout → initiate correspondent payouts now that the brief is permanently on-chain.
     * Task: fetch pending earnings, create payout-distribution workflow for today.
     * Only runs after inscription is confirmed and recorded — guarantees payout is post-permanence.
     */
    payout: {
      on: { payout_triggered: "completed", no_earnings: "completed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Trigger correspondent payouts for ${ctx.date} brief`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "workflows"],
        description: `The ${ctx.date} brief is inscribed on Bitcoin (inscription ID: ${ctx.inscriptionId ?? "<inscriptionId>"}). Now initiate correspondent payouts.

Steps:
1. Check for pending earnings:
   arc skills run --name aibtc-news-classifieds -- earnings --status pending

2. If no earnings found: transition workflow to 'no_earnings' → 'completed'. Close task.

3. If earnings found:
   - Check if a payout workflow already exists:
     arc skills run --name workflows -- list-by-template --template payout-distribution
   - If it already exists for today (instance_key: payout-${ctx.date}): skip creation.
   - If not: create it:
     arc skills run --name workflows -- create \\
       --template payout-distribution \\
       --instance-key "payout-${ctx.date}" \\
       --context '{"date":"${ctx.date}","earnings":[...],"totalSats":N}'
     (populate earnings array and totalSats from the earnings response in step 1)

4. Transition this workflow (brief-inscription-${ctx.date}) to 'payout_triggered' → 'completed'.
${ctx.remainingDates && ctx.remainingDates.length > 0 ? (() => {
          const nextDate = ctx.remainingDates![0];
          const rest = ctx.remainingDates!.slice(1);
          const nextCtx = { date: nextDate, parentId: ctx.parentId, contentType: ctx.contentType ?? "text/plain", feeRate: ctx.feeRate ?? 1, remainingDates: rest.length > 0 ? rest : undefined };
          return `
5. **CHAIN TO NEXT DATE**: After transitioning this workflow to completed, create the next
   inscription workflow for ${nextDate}:
   arc skills run --name workflows -- create daily-brief-inscription brief-inscription-${nextDate} pending \\
     --context '${JSON.stringify(nextCtx)}'
   This ensures sequential execution — the parent UTXO must be returned before the next inscribe.
   Remaining after ${nextDate}: ${rest.length > 0 ? rest.join(", ") : "none (last in chain)"}`;
        })() : ""}

Workflow instance_key: brief-inscription-${ctx.date}`,
      }),
    },

    completed: {
      on: {},
      action: () => null,
    },

    failed: {
      on: {},
      action: () => null,
    },
  },
};

/**
 * PayoutDistributionMachine — processes correspondent payouts end-to-end.
 *
 * Triggered by: DailyBriefInscriptionMachine.payout state after inscription confirmed on-chain
 * instance_key: "payout-{YYYY-MM-DD}" (one per payout run)
 *
 * States:
 *   fetch_unpaid     → query unpaid earnings from aibtc.news API
 *   balance_check    → verify wallet has sufficient sBTC to cover payouts
 *   transfers_sent   → send sBTC transfers to each correspondent
 *   recorded         → record payout txids back to aibtc.news via record-payout
 *   completed        → terminal success
 *
 * Context:
 *   date             — payout run date YYYY-MM-DD
 *   earnings         — JSON array of unpaid earning records [{id, address, amount_sats}...]
 *   totalSats        — sum of all unpaid earnings in sats
 *   balanceSats      — wallet sBTC balance at time of check
 *   transfers        — JSON array of completed transfers [{earningId, txid, amount_sats}...]
 *   failureReason    — human-readable reason if failed
 */
export interface PayoutDistributionContext {
  date: string;
  earnings?: Array<{ id: string; address: string; amount_sats: number }>;
  totalSats?: number;
  balanceSats?: number;
  transfers?: Array<{ earningId: string; txid: string; amount_sats: number }>;
  failureReason?: string;
}

export const PayoutDistributionMachine: StateMachine<PayoutDistributionContext> = {
  name: "payout-distribution",
  initialState: "fetch_unpaid",
  states: {
    fetch_unpaid: {
      on: { earnings_found: "balance_check", no_earnings: "completed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Fetch unpaid earnings for payout run ${ctx.date}`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Fetch all unpaid correspondent earnings from aibtc.news.

Steps:
1. arc skills run --name aibtc-news-classifieds -- earnings --status pending
2. If no unpaid earnings: transition workflow to 'completed'. Close task.
3. If earnings found: store the earnings array and totalSats in workflow context,
   then transition to 'balance_check'.

Workflow instance_key: payout-${ctx.date}`,
      }),
    },

    balance_check: {
      on: { balance_ok: "transfers_sent", insufficient_funds: "completed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Check sBTC balance for ${ctx.totalSats ?? "?"} sats payout`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Verify wallet sBTC balance covers the payout total of ${ctx.totalSats ?? "?"} sats.

Steps:
1. arc skills run --name bitcoin-wallet -- info
2. Check sBTC balance against totalSats (${ctx.totalSats ?? "?"}).
3. If balance >= totalSats: store balanceSats in context, transition to 'transfers_sent'.
4. If balance < totalSats: set failureReason in context, transition to 'completed'
   (escalate to whoabuddy for funding). Close task with summary noting shortfall.

Workflow instance_key: payout-${ctx.date}`,
      }),
    },

    transfers_sent: {
      on: { transfers_complete: "recorded", transfer_failed: "completed" },
      action: (ctx) => {
        const count = ctx.earnings?.length ?? 0;
        return {
          type: "create-task",
          subject: `Send sBTC payouts to ${count} correspondents`,
          priority: 5,
          skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
          description: `Send sBTC transfers for each unpaid earning.

Earnings to pay: ${count} correspondents, ${ctx.totalSats ?? "?"} sats total.

Steps:
1. For each earning in context, send sBTC via the wallet skill
2. Collect txid for each successful transfer
3. Store transfers array [{earningId, txid, amount_sats}...] in workflow context
4. If all transfers succeed: transition to 'recorded'
5. If any transfer fails: store partial transfers + failureReason, transition to 'completed'
   (create follow-up task for failed transfers)

Workflow instance_key: payout-${ctx.date}`,
        };
      },
    },

    recorded: {
      on: { payouts_recorded: "notify", record_failed: "notify" },
      action: (ctx) => {
        const transfers = ctx.transfers ?? [];
        const earningIds = transfers.map((t) => t.earningId).join(",");
        const totalSats = transfers.reduce((sum, t) => sum + t.amount_sats, 0);
        const txid = transfers[0]?.txid ?? "<txid>";
        return {
          type: "create-task",
          subject: `Record payouts on aibtc.news for ${ctx.date}`,
          priority: 6,
          skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
          description: `Record completed payout transactions on aibtc.news.

Steps:
1. arc skills run --name aibtc-news-classifieds -- record-payout \\
     --earning-ids ${earningIds} --txid ${txid} --amount-sats ${totalSats}
   (If multiple txids, call record-payout once per unique txid with its earning IDs)
2. On success or failure: transition workflow to 'notify'.
   The transfers are already on-chain — record txids in failureReason if the API call fails.

Workflow instance_key: payout-${ctx.date}`,
        };
      },
    },

    /**
     * notify → send x402 inbox message to each paid correspondent as proof of payment.
     * Runs after payout is recorded (or attempted). Cost: 100 sats sBTC per message.
     */
    notify: {
      on: { notified: "completed", notify_failed: "completed" },
      action: (ctx) => {
        const transfers = ctx.transfers ?? [];
        const earnings = ctx.earnings ?? [];
        if (transfers.length === 0) return null;

        // Build a lookup of earningId → BTC address from the earnings array
        const addrByEarningId = Object.fromEntries(
          earnings.map((e) => [e.id, e.address])
        );

        const recipientList = transfers
          .map((t) => {
            const btcAddr = addrByEarningId[t.earningId] ?? t.earningId;
            return `  - BTC: ${btcAddr} | earningId: ${t.earningId} | txid: ${t.txid} | ${t.amount_sats} sats`;
          })
          .join("\n");

        return {
          type: "create-task",
          subject: `Notify ${transfers.length} correspondent(s) of payout for ${ctx.date}`,
          priority: 7,
          skills: ["inbox-notify", "contact-registry"],
          description: `Send x402 inbox messages to each correspondent confirming their payout.

Cost: ~100 sats sBTC per message (${transfers.length} messages).

Recipients and transfers:
${recipientList}

Steps:
1. For each recipient, look up their STX address:
   arc skills run --name contact-registry -- lookup --btc-address <btcAddr>
   (If not found in registry, check aibtc.news agent directory or skip with a note)

2. For each recipient with a known STX address, send via inbox-notify (nonce-managed):
   arc skills run --name inbox-notify -- send-one --btc-address <btcAddr> --stx-address <stxAddr> \\
     --content "Payment from aibtc.news — ${ctx.date} brief: <amount_sats> sats sent. Txid: <txid>. Your correspondent earnings from the daily brief are now settled."

3. If a recipient's STX address cannot be found: log the skip, do not block others.

4. After all messages sent (or skipped): transition workflow to 'notified' → 'completed'.

Workflow instance_key: payout-${ctx.date}`,
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
 * ClassifiedRefundMachine — processes refund for a rejected classified ad.
 *
 * Triggered by: cmdReviewClassified on rejection
 * instance_key: "classified-refund-{classifiedId}" (one per rejected classified)
 *
 * States:
 *   fetch_rejected   → get classified details (payer address, amount)
 *   balance_check    → verify wallet sBTC covers refund
 *   transfer_sent    → send sBTC to original payer
 *   recorded         → record refund txid on aibtc.news API
 *   notify           → x402 inbox confirmation to payer
 *   completed        → terminal success
 *   failed           → terminal failure
 *
 * Context:
 *   classifiedId     — the rejected classified's ID
 *   payerBtcAddress  — BTC address of original payer (for notification)
 *   payerStxAddress  — STX address of payer (for sBTC transfer)
 *   refundAmountSats — amount to refund (from classified paidAmount)
 *   balanceSats      — wallet sBTC balance at check time
 *   transferTxid     — sBTC refund transfer txid
 *   failureReason    — on failure
 */
export interface ClassifiedRefundContext {
  classifiedId: string;
  payerBtcAddress?: string;
  payerStxAddress?: string | null;
  refundAmountSats?: number;
  balanceSats?: number;
  transferTxid?: string;
  failureReason?: string;
}

export const ClassifiedRefundMachine: StateMachine<ClassifiedRefundContext> = {
  name: "classified-refund",
  initialState: "fetch_rejected",
  states: {
    fetch_rejected: {
      on: { details_found: "balance_check", details_missing: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Fetch rejected classified details for refund ${ctx.classifiedId}`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Fetch the rejected classified record to confirm refund details.

Steps:
1. arc skills run --name aibtc-news-classifieds -- get-classified --id ${ctx.classifiedId}
2. Confirm payer BTC address (contact field), STX address (placedBy/payerStxAddress field),
   and paid amount (paidAmount field).
3. If details found: update workflow context with payerBtcAddress, payerStxAddress,
   refundAmountSats. Transition to 'details_found' → 'balance_check'.
4. If classified not found or missing payer info: transition to 'details_missing' → 'failed'
   with failureReason.

Workflow instance_key: classified-refund-${ctx.classifiedId}`,
      }),
    },

    balance_check: {
      on: { balance_ok: "transfer_sent", insufficient_funds: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Check sBTC balance for ${ctx.refundAmountSats ?? "?"} sats refund`,
        priority: 6,
        skills: ["bitcoin-wallet"],
        description: `Verify wallet sBTC balance covers the refund of ${ctx.refundAmountSats ?? "?"} sats.

Steps:
1. arc skills run --name bitcoin-wallet -- info
2. Check sBTC balance against refundAmountSats (${ctx.refundAmountSats ?? "?"}).
3. If balance >= refundAmountSats: store balanceSats in context, transition to 'balance_ok'.
4. If balance < refundAmountSats: set failureReason, transition to 'insufficient_funds' → 'failed'.
   Escalate to whoabuddy for funding.

Workflow instance_key: classified-refund-${ctx.classifiedId}`,
      }),
    },

    transfer_sent: {
      on: { transfer_complete: "recorded", transfer_failed: "failed" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Send ${ctx.refundAmountSats ?? "?"} sats sBTC refund for classified ${ctx.classifiedId}`,
        priority: 5,
        skills: ["bitcoin-wallet"],
        description: `Send sBTC refund transfer to the classified placer.

Recipient STX address: ${ctx.payerStxAddress ?? "<lookup from context>"}
Amount: ${ctx.refundAmountSats ?? "?"} sats

Steps:
1. arc skills run --name bitcoin-wallet -- sbtc-transfer \\
     --amount ${ctx.refundAmountSats ?? "?"} --recipient ${ctx.payerStxAddress ?? "<payerStxAddress>"}
2. On success: store transferTxid in workflow context. Transition to 'transfer_complete' → 'recorded'.
3. On failure: set failureReason, transition to 'transfer_failed' → 'failed'.

Workflow instance_key: classified-refund-${ctx.classifiedId}`,
      }),
    },

    recorded: {
      on: { refund_recorded: "notify", record_failed: "notify" },
      action: (ctx) => ({
        type: "create-task",
        subject: `Record refund txid for classified ${ctx.classifiedId}`,
        priority: 6,
        skills: ["aibtc-news-classifieds", "bitcoin-wallet"],
        description: `Record the refund transaction on aibtc.news.

Steps:
1. arc skills run --name aibtc-news-classifieds -- refund-classified \\
     --id ${ctx.classifiedId} --txid ${ctx.transferTxid ?? "<transferTxid>"}
2. On success or failure: transition to 'notify'. The sBTC is already sent —
   record txid in failureReason if the API call fails for manual recovery.

Workflow instance_key: classified-refund-${ctx.classifiedId}`,
      }),
    },

    notify: {
      on: { notified: "completed", notify_failed: "completed" },
      action: (ctx) => {
        if (!ctx.payerBtcAddress || !ctx.payerStxAddress) return null;

        return {
          type: "create-task",
          subject: `Notify classified placer of refund for ${ctx.classifiedId}`,
          priority: 7,
          skills: ["inbox-notify", "contact-registry"],
          description: `Send x402 inbox confirmation that the classified refund has been processed.

Recipient BTC: ${ctx.payerBtcAddress}
Recipient STX: ${ctx.payerStxAddress}
Amount: ${ctx.refundAmountSats ?? "?"} sats
Txid: ${ctx.transferTxid ?? "<txid>"}

Steps:
1. arc skills run --name inbox-notify -- send-one \\
     --btc-address ${ctx.payerBtcAddress} --stx-address ${ctx.payerStxAddress} \\
     --content "Classified Refund | ${ctx.classifiedId} — Your ${ctx.refundAmountSats ?? "?"} sats payment has been refunded. Txid: ${ctx.transferTxid ?? "<txid>"}."
2. Transition to 'notified' → 'completed'.

Workflow instance_key: classified-refund-${ctx.classifiedId}`,
        };
      },
    },

    completed: {
      on: {},
      action: () => null,
    },

    failed: {
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
    "daily-brief-inscription": DailyBriefInscriptionMachine,
    "payout-distribution": PayoutDistributionMachine,
    "classified-refund": ClassifiedRefundMachine,
  };
  return templates[name] || null;
}
