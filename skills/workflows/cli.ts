#!/usr/bin/env bun

import {
  initDatabase,
  insertWorkflow,
  getWorkflowById,
  getWorkflowByInstanceKey,
  getWorkflowsByTemplate,
  getAllActiveWorkflows,
  updateWorkflowState,
  completeWorkflow,
  deleteWorkflow,
  Workflow,
} from "../../src/db.ts";

type CommandResult = { success: boolean; message: string; data?: unknown };

function parseArgs(args: string[]): { cmd: string; params: Record<string, string> } {
  const cmd = args[0] || "";
  const params: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }

  return { cmd, params };
}

function printUsage(): void {
  process.stdout.write(`workflows CLI

USAGE
  arc skills run --name workflows -- <subcommand> [args]

SUBCOMMANDS
  list                                      List all active workflows
  list-by-template <template>               List workflows for a template
  create <template> <instance_key> <state>  Create a new workflow
  show <id>                                 Show workflow details
  transition <id> <new_state>               Move to a new state
  complete <id>                             Mark workflow as completed
  delete <id>                                Delete a workflow

FLAGS
  --context JSON                            JSON context for transitions
`);
}

function outputJson(result: CommandResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function list(): CommandResult {
  try {
    initDatabase();
    const workflows = getAllActiveWorkflows();
    return {
      success: true,
      message: `Found ${workflows.length} active workflow(s)`,
      data: workflows,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function listByTemplate(template: string): CommandResult {
  if (!template) {
    return { success: false, message: "template argument required" };
  }
  try {
    initDatabase();
    const workflows = getWorkflowsByTemplate(template);
    return {
      success: true,
      message: `Found ${workflows.length} workflow(s) for template '${template}'`,
      data: workflows,
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function create(template: string, instanceKey: string, initialState: string): CommandResult {
  if (!template || !instanceKey || !initialState) {
    return {
      success: false,
      message: "template, instance_key, and initial_state arguments required",
    };
  }

  try {
    initDatabase();

    // Check if instance already exists
    const existing = getWorkflowByInstanceKey(instanceKey);
    if (existing) {
      return {
        success: false,
        message: `Workflow with instance_key '${instanceKey}' already exists (id=${existing.id})`,
      };
    }

    const id = insertWorkflow({
      template,
      instance_key: instanceKey,
      current_state: initialState,
      context: null,
    });

    return {
      success: true,
      message: `Created workflow id=${id}`,
      data: { id, template, instance_key: instanceKey, current_state: initialState },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function show(idStr: string): CommandResult {
  if (!idStr) {
    return { success: false, message: "id argument required" };
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return { success: false, message: `Invalid id: ${idStr}` };
  }

  try {
    initDatabase();
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return { success: false, message: `Workflow id=${id} not found` };
    }

    const context = workflow.context ? JSON.parse(workflow.context) : null;

    return {
      success: true,
      message: `Workflow id=${id}`,
      data: { ...workflow, context },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function transition(idStr: string, newState: string, contextJson?: string): CommandResult {
  if (!idStr || !newState) {
    return { success: false, message: "id and new_state arguments required" };
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return { success: false, message: `Invalid id: ${idStr}` };
  }

  try {
    initDatabase();
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return { success: false, message: `Workflow id=${id} not found` };
    }

    let newContext: string | null = null;
    if (contextJson) {
      try {
        JSON.parse(contextJson); // Validate JSON
        newContext = contextJson;
      } catch {
        return { success: false, message: `Invalid JSON in --context` };
      }
    } else {
      newContext = workflow.context;
    }

    updateWorkflowState(id, newState, newContext);

    return {
      success: true,
      message: `Transitioned workflow id=${id} to state '${newState}'`,
      data: { id, from_state: workflow.current_state, to_state: newState },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function complete(idStr: string): CommandResult {
  if (!idStr) {
    return { success: false, message: "id argument required" };
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return { success: false, message: `Invalid id: ${idStr}` };
  }

  try {
    initDatabase();
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return { success: false, message: `Workflow id=${id} not found` };
    }

    if (workflow.completed_at) {
      return {
        success: false,
        message: `Workflow id=${id} already completed at ${workflow.completed_at}`,
      };
    }

    completeWorkflow(id);

    return {
      success: true,
      message: `Completed workflow id=${id}`,
      data: { id, final_state: workflow.current_state },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function deleteCmd(idStr: string): CommandResult {
  if (!idStr) {
    return { success: false, message: "id argument required" };
  }

  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return { success: false, message: `Invalid id: ${idStr}` };
  }

  try {
    initDatabase();
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return { success: false, message: `Workflow id=${id} not found` };
    }

    deleteWorkflow(id);

    return {
      success: true,
      message: `Deleted workflow id=${id}`,
      data: { id },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const { cmd, params } = parseArgs(args);

  let result: CommandResult;

  switch (cmd) {
    case "list":
      result = list();
      break;

    case "list-by-template":
      result = listByTemplate(args[1] ?? "");
      break;

    case "create":
      result = create(args[1] ?? "", args[2] ?? "", args[3] ?? "");
      break;

    case "show":
      result = show(args[1] ?? "");
      break;

    case "transition":
      result = transition(args[1] ?? "", args[2] ?? "", params.context);
      break;

    case "complete":
      result = complete(args[1] ?? "");
      break;

    case "delete":
      result = deleteCmd(args[1] ?? "");
      break;

    default:
      if (cmd && cmd !== "--help" && cmd !== "-h") {
        process.stderr.write(`Error: unknown subcommand '${cmd}'\n\n`);
      }
      printUsage();
      if (cmd && cmd !== "--help" && cmd !== "-h") {
        process.exit(1);
      }
      process.exit(0);
      break;
  }

  outputJson(result);

  if (!result.success) {
    process.exit(1);
  }
}

main();
