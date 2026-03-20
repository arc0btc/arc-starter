#!/usr/bin/env bun

import {
  initDatabase,
  getWorkflowByInstanceKey,
  updateWorkflowState,
  insertTask,
  completeWorkflow,
} from "../../src/db.ts";
import type { QuestContext, QuestPhase } from "../workflows/state-machine.ts";

type CommandResult = { success: boolean; message: string; data?: unknown };

function outputJson(result: CommandResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function parseArgs(args: string[]): { command: string; slug: string; phases: string[] } {
  const command = args[0] || "";
  let slug = "";
  const phases: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) {
      slug = args[++i];
    } else if (args[i] === "--phase" && args[i + 1]) {
      phases.push(args[++i]);
    }
  }

  return { command, slug, phases };
}

function buildPhaseDescription(ctx: QuestContext, phase: QuestPhase): string {
  return (
    `Quest: ${ctx.slug}\n` +
    `Goal: ${ctx.goal}\n` +
    `Phase ${phase.n} of ${ctx.phases.length}: ${phase.name}\n\n` +
    `Phase goal: ${phase.goal}\n\n` +
    `Instructions:\n` +
    `1. Do the work for this phase\n` +
    `2. When done, run: arc skills run --name quest-create -- advance --slug ${ctx.slug}\n` +
    `3. The advance command marks this phase complete and queues the next one`
  );
}

function cmdPlan(slug: string, phaseStrs: string[]): CommandResult {
  if (!slug) return { success: false, message: "--slug is required" };
  if (phaseStrs.length === 0) return { success: false, message: "at least one --phase is required" };

  initDatabase();

  const workflow = getWorkflowByInstanceKey(slug);
  if (!workflow) {
    return { success: false, message: `No workflow found with instance_key '${slug}'` };
  }
  if (workflow.current_state !== "planning") {
    return {
      success: false,
      message: `Workflow is in state '${workflow.current_state}', expected 'planning'`,
    };
  }

  const existingCtx: Partial<QuestContext> = workflow.context ? JSON.parse(workflow.context) : {};

  const phases: QuestPhase[] = phaseStrs.map((str, i) => {
    const colonIdx = str.indexOf(":");
    const name = colonIdx >= 0 ? str.slice(0, colonIdx).trim() : str.trim();
    const goal = colonIdx >= 0 ? str.slice(colonIdx + 1).trim() : str.trim();
    return { n: i + 1, name, goal, status: "pending", taskId: null };
  });

  const ctx: QuestContext = {
    slug: existingCtx.slug ?? slug,
    goal: existingCtx.goal ?? "",
    sourceTaskId: existingCtx.sourceTaskId ?? null,
    parentTaskId: existingCtx.parentTaskId ?? null,
    skills: existingCtx.skills ?? [],
    model: existingCtx.model ?? "sonnet",
    phases,
    currentPhase: 1,
  };

  updateWorkflowState(workflow.id, "executing", JSON.stringify(ctx));

  const first = phases[0];
  const skillsList = ["quest-create", ...(ctx.skills || [])];
  const taskId = insertTask({
    subject: `Quest ${ctx.slug} — Phase 1/${phases.length}: ${first.name}`,
    priority: 4,
    model: ctx.model || "sonnet",
    skills: JSON.stringify(skillsList),
    parent_id: ctx.parentTaskId ?? null,
    source: `workflow:${workflow.id}`,
    description: buildPhaseDescription(ctx, first),
  });

  return {
    success: true,
    message: `Quest '${slug}' planned with ${phases.length} phase(s). Phase 1 task created (id=${taskId}).`,
    data: { workflow_id: workflow.id, phases, first_task_id: taskId },
  };
}

function cmdAdvance(slug: string): CommandResult {
  if (!slug) return { success: false, message: "--slug is required" };

  initDatabase();

  const workflow = getWorkflowByInstanceKey(slug);
  if (!workflow) {
    return { success: false, message: `No workflow found with instance_key '${slug}'` };
  }
  if (workflow.current_state !== "executing") {
    return {
      success: false,
      message: `Workflow is in state '${workflow.current_state}', expected 'executing'`,
    };
  }

  const ctx: QuestContext = workflow.context ? JSON.parse(workflow.context) : {};
  const { phases, currentPhase } = ctx;

  if (!phases || phases.length === 0) {
    return { success: false, message: "No phases in workflow context — was plan run?" };
  }

  const updatedPhases = phases.map((p) =>
    p.n === currentPhase ? { ...p, status: "completed" as const } : p
  );

  const nextPhaseN = currentPhase + 1;
  const nextPhase = updatedPhases.find((p) => p.n === nextPhaseN);

  if (!nextPhase) {
    const finalCtx = { ...ctx, phases: updatedPhases };
    updateWorkflowState(workflow.id, "completed", JSON.stringify(finalCtx));
    completeWorkflow(workflow.id);
    return {
      success: true,
      message: `Quest '${slug}' complete — all ${phases.length} phase(s) done.`,
      data: { workflow_id: workflow.id, phases: updatedPhases },
    };
  }

  const newCtx: QuestContext = { ...ctx, phases: updatedPhases, currentPhase: nextPhaseN };
  updateWorkflowState(workflow.id, "executing", JSON.stringify(newCtx));

  const skillsList = ["quest-create", ...(ctx.skills || [])];
  const taskId = insertTask({
    subject: `Quest ${ctx.slug} — Phase ${nextPhaseN}/${phases.length}: ${nextPhase.name}`,
    priority: 4,
    model: ctx.model || "sonnet",
    skills: JSON.stringify(skillsList),
    parent_id: ctx.parentTaskId ?? null,
    source: `workflow:${workflow.id}`,
    description: buildPhaseDescription(newCtx, nextPhase),
  });

  return {
    success: true,
    message: `Phase ${currentPhase} complete. Phase ${nextPhaseN} task created (id=${taskId}).`,
    data: {
      workflow_id: workflow.id,
      completed_phase: currentPhase,
      next_phase: nextPhaseN,
      next_task_id: taskId,
    },
  };
}

function printUsage(): void {
  process.stdout.write(`quest-create CLI

USAGE
  arc skills run --name quest-create -- <subcommand> [flags]

SUBCOMMANDS
  plan --slug <slug> --phase "Name: goal" [--phase "Name: goal" ...]
    Register phases and advance quest from planning → executing.
    Creates the first phase task. Called by the QuestMachine planning task.

  advance --slug <slug>
    Mark current phase complete and queue the next one.
    If all phases done, completes the workflow.
    Called at the end of each phase task.

EXAMPLES
  arc skills run --name quest-create -- plan --slug treasury-infra \\
    --phase "Research: understand balance APIs and payout flow" \\
    --phase "Build: implement sensor and CLI commands" \\
    --phase "Verify: test end-to-end"

  arc skills run --name quest-create -- advance --slug treasury-infra
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const { command, slug, phases } = parseArgs(args);

  let result: CommandResult;

  switch (command) {
    case "plan":
      result = cmdPlan(slug, phases);
      break;
    case "advance":
      result = cmdAdvance(slug);
      break;
    default:
      printUsage();
      process.exit(command && command !== "--help" && command !== "-h" ? 1 : 0);
      return;
  }

  outputJson(result);
  if (!result.success) process.exit(1);
}

main();
