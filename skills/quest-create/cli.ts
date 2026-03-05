#!/usr/bin/env bun

import {
  initDatabase,
  getWorkflowByInstanceKey,
  insertWorkflow,
  updateWorkflowState,
  completeWorkflow,
  getAllActiveWorkflows,
} from "../../src/db.ts";
import type { QuestContext, QuestPhase } from "../arc-workflows/state-machine.ts";

type CommandResult = { success: boolean; message: string; data?: unknown };

function outputJson(result: CommandResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] || "";
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

function getContext(workflow: { context: string | null }): QuestContext | null {
  if (!workflow.context) return null;
  return JSON.parse(workflow.context) as QuestContext;
}

function instanceKey(slug: string): string {
  return `quest-${slug}`;
}

/**
 * init <slug> "<goal>" [--skills s1,s2] [--model sonnet] [--parent <taskId>]
 *
 * Creates a quest workflow in `planning` state. The meta-sensor will
 * create the planning task on next evaluation.
 */
function cmdInit(args: string[]): CommandResult {
  const { positional, flags } = parseFlags(args);
  const slug = positional[0];
  const goal = positional[1];

  if (!slug || !goal) {
    return { success: false, message: 'Usage: init <slug> "<goal>" [--skills s1,s2] [--model sonnet] [--parent <taskId>]' };
  }

  initDatabase();

  const key = instanceKey(slug);
  const existing = getWorkflowByInstanceKey(key);
  if (existing) {
    return { success: false, message: `Quest '${slug}' already exists (workflow id=${existing.id}, state=${existing.current_state})` };
  }

  const skills = flags.skills ? flags.skills.split(",").map((s) => s.trim()) : [];
  const model = flags.model || "sonnet";
  const parentTaskId = flags.parent ? parseInt(flags.parent, 10) : null;

  const context: QuestContext = {
    slug,
    goal,
    sourceTaskId: null,
    parentTaskId: parentTaskId,
    skills,
    model,
    phases: [],
    currentPhase: 0,
  };

  const id = insertWorkflow({
    template: "quest",
    instance_key: key,
    current_state: "planning",
    context: JSON.stringify(context),
  });

  return {
    success: true,
    message: `Quest '${slug}' created (workflow id=${id}). Meta-sensor will create planning task.`,
    data: { workflowId: id, slug, goal, skills, model },
  };
}

/**
 * plan <slug> "Phase Name: goal" ...
 *
 * Populates phases in the quest workflow context and transitions to `executing`.
 * Called from the planning task after decomposition.
 */
function cmdPlan(args: string[]): CommandResult {
  const slug = args[0];
  if (!slug) {
    return { success: false, message: 'Usage: plan <slug> "Phase Name: goal" ...' };
  }

  const phaseArgs = args.slice(1);
  if (phaseArgs.length === 0) {
    return { success: false, message: "At least one phase required. Format: \"Phase Name: goal\"" };
  }
  if (phaseArgs.length > 10) {
    return { success: false, message: "Max 10 phases per quest. Decompose further if needed." };
  }

  initDatabase();

  const key = instanceKey(slug);
  const workflow = getWorkflowByInstanceKey(key);
  if (!workflow) {
    return { success: false, message: `Quest '${slug}' not found. Run 'init' first.` };
  }

  const ctx = getContext(workflow);
  if (!ctx) {
    return { success: false, message: `Quest '${slug}' has no context.` };
  }

  if (workflow.current_state !== "planning") {
    return { success: false, message: `Quest '${slug}' is in state '${workflow.current_state}', expected 'planning'.` };
  }

  // Parse phases from "Name: goal" format
  const phases: QuestPhase[] = phaseArgs.map((arg, i) => {
    const colonIdx = arg.indexOf(":");
    if (colonIdx < 0) {
      return { n: i + 1, name: arg.trim(), goal: arg.trim(), status: "pending" as const, taskId: null };
    }
    return {
      n: i + 1,
      name: arg.slice(0, colonIdx).trim(),
      goal: arg.slice(colonIdx + 1).trim(),
      status: "pending" as const,
      taskId: null,
    };
  });

  ctx.phases = phases;
  ctx.currentPhase = 1;

  // Transition to executing — meta-sensor will create first phase task
  updateWorkflowState(workflow.id, "executing", JSON.stringify(ctx));

  return {
    success: true,
    message: `Quest '${slug}' planned with ${phases.length} phase(s). Transitioned to 'executing'. Meta-sensor will create Phase 1 task.`,
    data: {
      workflowId: workflow.id,
      slug,
      phases: phases.map((p) => ({ n: p.n, name: p.name, goal: p.goal })),
    },
  };
}

/**
 * advance <slug>
 *
 * Marks current phase completed, advances currentPhase counter.
 * Meta-sensor creates next phase task (or completes quest if all done).
 */
function cmdAdvance(args: string[]): CommandResult {
  const slug = args[0];
  if (!slug) {
    return { success: false, message: "Usage: advance <slug>" };
  }

  initDatabase();

  const key = instanceKey(slug);
  const workflow = getWorkflowByInstanceKey(key);
  if (!workflow) {
    return { success: false, message: `Quest '${slug}' not found.` };
  }

  const ctx = getContext(workflow);
  if (!ctx) {
    return { success: false, message: `Quest '${slug}' has no context.` };
  }

  if (workflow.current_state !== "executing") {
    return { success: false, message: `Quest '${slug}' is in state '${workflow.current_state}', expected 'executing'.` };
  }

  const current = ctx.phases.find((p) => p.n === ctx.currentPhase);
  if (!current) {
    return { success: false, message: `Phase ${ctx.currentPhase} not found in quest '${slug}'.` };
  }

  // Mark current phase completed
  current.status = "completed";

  // Check if there's a next phase
  const nextPhase = ctx.phases.find((p) => p.n === ctx.currentPhase + 1);
  if (nextPhase) {
    ctx.currentPhase = nextPhase.n;
    updateWorkflowState(workflow.id, "executing", JSON.stringify(ctx));
    return {
      success: true,
      message: `Phase ${current.n} (${current.name}) completed. Phase ${nextPhase.n} (${nextPhase.name}) is next. Meta-sensor will create the task.`,
      data: {
        completedPhase: current.n,
        nextPhase: nextPhase.n,
        totalPhases: ctx.phases.length,
      },
    };
  }

  // All phases done — complete the quest
  updateWorkflowState(workflow.id, "completed", JSON.stringify(ctx));
  completeWorkflow(workflow.id);

  return {
    success: true,
    message: `Phase ${current.n} (${current.name}) completed. All ${ctx.phases.length} phases done. Quest '${slug}' completed.`,
    data: {
      completedPhase: current.n,
      totalPhases: ctx.phases.length,
      questComplete: true,
    },
  };
}

/**
 * status [slug]
 *
 * Show quest status. If no slug, show all active quests.
 */
function cmdStatus(args: string[]): CommandResult {
  const slug = args[0];

  initDatabase();

  if (slug) {
    const key = instanceKey(slug);
    const workflow = getWorkflowByInstanceKey(key);
    if (!workflow) {
      return { success: false, message: `Quest '${slug}' not found.` };
    }

    const ctx = getContext(workflow);
    const completedCount = ctx?.phases.filter((p) => p.status === "completed").length ?? 0;
    const totalPhases = ctx?.phases.length ?? 0;

    return {
      success: true,
      message: `Quest '${slug}': ${workflow.current_state} (${completedCount}/${totalPhases} phases)`,
      data: {
        workflowId: workflow.id,
        state: workflow.current_state,
        goal: ctx?.goal,
        currentPhase: ctx?.currentPhase,
        phases: ctx?.phases,
        completedAt: workflow.completed_at,
      },
    };
  }

  // List all active quest workflows
  const allWorkflows = getAllActiveWorkflows();
  const quests = allWorkflows.filter((w) => w.template === "quest");

  if (quests.length === 0) {
    return { success: true, message: "No active quests.", data: [] };
  }

  const summaries = quests.map((w) => {
    const ctx = getContext(w);
    const completed = ctx?.phases.filter((p) => p.status === "completed").length ?? 0;
    const total = ctx?.phases.length ?? 0;
    return {
      workflowId: w.id,
      slug: ctx?.slug,
      state: w.current_state,
      goal: ctx?.goal,
      progress: `${completed}/${total}`,
      currentPhase: ctx?.currentPhase,
    };
  });

  return {
    success: true,
    message: `${quests.length} active quest(s)`,
    data: summaries,
  };
}

function printUsage(): void {
  process.stdout.write(`quest-create CLI — decompose complex tasks into sequential phases

USAGE
  arc skills run --name quest-create -- <subcommand> [args]

SUBCOMMANDS
  init <slug> "<goal>" [--skills s1,s2] [--model sonnet] [--parent <taskId>]
      Create a new quest workflow in 'planning' state

  plan <slug> "Phase Name: goal" ...
      Set phases and transition to 'executing' (called from planning task)

  advance <slug>
      Mark current phase done, advance to next (called from phase task)

  status [slug]
      Show quest status (all quests if no slug given)
`);
}

// ---- Main ----

const [subcommand, ...rest] = process.argv.slice(2);
let result: CommandResult;

switch (subcommand) {
  case "init":
    result = cmdInit(rest);
    break;
  case "plan":
    result = cmdPlan(rest);
    break;
  case "advance":
    result = cmdAdvance(rest);
    break;
  case "status":
    result = cmdStatus(rest);
    break;
  default:
    if (subcommand && subcommand !== "--help" && subcommand !== "-h") {
      process.stderr.write(`Error: unknown subcommand '${subcommand}'\n\n`);
    }
    printUsage();
    process.exit(subcommand && subcommand !== "--help" && subcommand !== "-h" ? 1 : 0);
    break;
}

outputJson(result!);
if (!result!.success) process.exit(1);
