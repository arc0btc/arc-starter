import { claimSensorRun } from "../../src/sensors.ts";
import {
  initDatabase,
  insertTask,
  getAllActiveWorkflows,
  updateWorkflowState,
} from "../../src/db.ts";
import {
  evaluateWorkflow,
  getTemplateByName,
  type WorkflowAction,
} from "./state-machine.ts";

const SENSOR_NAME = "workflows-meta";
const INTERVAL_MINUTES = 5;

export default async function workflowsMetaSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    const workflows = getAllActiveWorkflows();
    if (workflows.length === 0) return "skip";

    let actionsProcessed = 0;

    for (const workflow of workflows) {
      // Get the template for this workflow
      const template = getTemplateByName(workflow.template);
      if (!template) {
        console.warn(
          `workflows-meta sensor: unknown template "${workflow.template}" for workflow ${workflow.id}`
        );
        continue;
      }

      // Evaluate the workflow state machine
      const action = evaluateWorkflow(workflow, template);

      // Handle the action
      if (action.type === "create-task") {
        const source = `workflow:${workflow.id}`;
        insertTask({
          subject: action.subject,
          description: action.description,
          priority: action.priority || 5,
          skills: action.skills ? action.skills.join(",") : null,
          source,
        });
        actionsProcessed++;
      } else if (action.type === "transition" && action.nextState) {
        updateWorkflowState(
          workflow.id,
          action.nextState,
          workflow.context
        );
        actionsProcessed++;
      }
    }

    return actionsProcessed > 0 ? "ok" : "skip";
  } catch (err) {
    console.error(
      `workflows-meta sensor error: ${err instanceof Error ? err.message : String(err)}`
    );
    return "skip";
  }
}
