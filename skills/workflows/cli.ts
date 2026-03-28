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
import {
  evaluateWorkflow,
  getAllowedTransitions,
  getTemplateByName,
} from "./state-machine.ts";

type CommandResult = { success: boolean; message: string; data?: unknown };

function parseArgs(args: string[]): { command: string; params: Record<string, string> } {
  const command = args[0] || "";
  const params: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }

  return { command, params };
}

function printUsage(): void {
  process.stdout.write(`workflows CLI

USAGE
  arc skills run --name workflows -- <subcommand> [args]

SUBCOMMANDS
  list                                      List all active workflows
  list-by-template <template>               List workflows for a template
  create <template> <instance_key> <state>  Create a new workflow (--context JSON)
  show <id>                                 Show workflow details
  transition <id> <new_state>               Move to a new state
  complete <id>                             Mark workflow as completed
  delete <id>                                Delete a workflow
  evaluate <id>                             Evaluate state machine for workflow
  allowed-transitions <id>                  Show allowed transitions from current state

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
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function create(template: string, instanceKey: string, initialState: string, contextJson?: string): CommandResult {
  if (!template || !instanceKey || !initialState) {
    return {
      success: false,
      message: "template, instance_key, and initial_state arguments required",
    };
  }

  let context: string | null = null;
  if (contextJson) {
    try {
      JSON.parse(contextJson); // Validate JSON
      context = contextJson;
    } catch {
      return { success: false, message: "Invalid JSON in --context" };
    }
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
      context,
    });

    return {
      success: true,
      message: `Created workflow id=${id}`,
      data: { id, template, instance_key: instanceKey, current_state: initialState, context: context ? JSON.parse(context) : null },
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(contextJson);
      } catch {
        return { success: false, message: `Invalid JSON in --context` };
      }
      // Merge new context fields into existing context to preserve prior fields (e.g. date, parentId)
      const existing = workflow.context ? JSON.parse(workflow.context) as Record<string, unknown> : {};
      newContext = JSON.stringify({ ...existing, ...parsed });
    } else {
      newContext = workflow.context;
    }

    updateWorkflowState(id, newState, newContext);

    return {
      success: true,
      message: `Transitioned workflow id=${id} to state '${newState}'`,
      data: { id, from_state: workflow.current_state, to_state: newState },
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}


function evaluate(idStr: string): CommandResult {
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

    const template = getTemplateByName(workflow.template);
    if (!template) {
      return {
        success: false,
        message: `Template '${workflow.template}' not found`,
      };
    }

    const action = evaluateWorkflow(workflow, template);

    return {
      success: true,
      message: `Evaluated workflow id=${id}`,
      data: { workflow_id: id, state: workflow.current_state, action },
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function allowedTransitions(idStr: string): CommandResult {
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

    const template = getTemplateByName(workflow.template);
    if (!template) {
      return {
        success: false,
        message: `Template '${workflow.template}' not found`,
      };
    }

    const transitions = getAllowedTransitions(
      workflow.current_state,
      template
    );

    return {
      success: true,
      message: `Allowed transitions from state '${workflow.current_state}'`,
      data: {
        workflow_id: id,
        current_state: workflow.current_state,
        transitions,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const { command, params } = parseArgs(args);

  let result: CommandResult;

  switch (command) {
    case "list":
      result = list();
      break;

    case "list-by-template":
      result = listByTemplate(args[1] ?? "");
      break;

    case "create":
      result = create(args[1] ?? "", args[2] ?? "", args[3] ?? "", params.context);
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

    case "evaluate":
      result = evaluate(args[1] ?? "");
      break;

    case "allowed-transitions":
      result = allowedTransitions(args[1] ?? "");
      break;

    default:
      if (command && command !== "--help" && command !== "-h") {
        process.stderr.write(`Error: unknown subcommand '${command}'\n\n`);
      }
      printUsage();
      if (command && command !== "--help" && command !== "-h") {
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
