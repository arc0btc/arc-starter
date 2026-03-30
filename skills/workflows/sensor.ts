import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
} from "../../src/sensors.ts";
import {
  initDatabase,
  getAllActiveWorkflows,
} from "../../src/db.ts";
import {
  evaluateWorkflow,
  getTemplateByName,
} from "./state-machine.ts";
import type { WorkflowAction } from "./state-machine.ts";

const SENSOR_NAME = "workflows-meta";
const INTERVAL_MINUTES = 5;
const log = createSensorLogger(SENSOR_NAME);

/**
 * Workflows meta-sensor: evaluates all active workflow instances against
 * their state machine templates. Creates tasks when a workflow action
 * returns "create-task". Runs every 5 minutes.
 */
export default async function workflowsMetaSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const workflows = getAllActiveWorkflows();
  if (workflows.length === 0) {
    log("No active workflows");
    return "ok";
  }

  log(`Evaluating ${workflows.length} active workflow(s)`);

  let tasksCreated = 0;

  for (const wf of workflows) {
    const template = getTemplateByName(wf.template);
    if (!template) {
      log(`Unknown template '${wf.template}' for workflow id=${wf.id}, skipping`);
      continue;
    }

    let action: WorkflowAction;
    try {
      action = evaluateWorkflow(wf, template);
    } catch (err) {
      log(`Error evaluating workflow id=${wf.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (action.type === "noop") continue;

    if (action.type === "create-task") {
      // Include state in source so dedup works across completed tasks for the same state
      const source = `workflow:${wf.id}:${wf.current_state}`;
      const skillsJson = action.skills ? JSON.stringify(action.skills) : null;

      const taskId = insertTaskIfNew(source, {
        subject: action.subject ?? `Workflow ${wf.id} task`,
        description: action.description,
        priority: action.priority ?? 5,
        skills: skillsJson,
        parent_id: action.parentTaskId,
      }, "any");

      if (taskId !== null) {
        log(`Created task ${taskId} for workflow id=${wf.id} (state=${wf.current_state})`);
        tasksCreated++;
      } else {
        log(`Task already exists for workflow id=${wf.id} (source=${source}), skipping`);
      }
    }
  }

  log(`Done: ${tasksCreated} task(s) created from ${workflows.length} workflow(s)`);
  return "ok";
}
