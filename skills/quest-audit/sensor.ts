import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  getDatabase,
  pendingTaskExistsForSource,
  insertTask,
  getTaskById,
} from "../../src/db.ts";
import type { Workflow, Task } from "../../src/db.ts";

const SENSOR_NAME = "quest-audit";
const INTERVAL_MINUTES = 30;
const STALE_ACTIVE_MINUTES = 60;
const log = createSensorLogger(SENSOR_NAME);

interface QuestPhase {
  n: number;
  name: string;
  goal: string;
  status: "pending" | "active" | "completed" | "failed";
  taskId: number | null;
}

interface QuestContext {
  slug: string;
  goal: string;
  sourceTaskId: number | null;
  parentTaskId: number | null;
  skills: string[];
  model: string;
  phases: QuestPhase[];
  currentPhase: number;
}

type HungReason = "failed-phase-task" | "missing-phase-task" | "stale-active-task";

interface HungQuest {
  workflow: Workflow;
  context: QuestContext;
  reason: HungReason;
  phaseNumber: number;
  phaseName: string;
  taskId: number | null;
}

function getActiveQuestWorkflows(): Workflow[] {
  const db = getDatabase();
  return db
    .query(
      "SELECT * FROM workflows WHERE template = 'quest' AND completed_at IS NULL AND current_state = 'executing' ORDER BY updated_at ASC"
    )
    .all() as Workflow[];
}

function detectHungQuests(workflows: Workflow[]): HungQuest[] {
  const hung: HungQuest[] = [];
  const now = Date.now();

  for (const workflow of workflows) {
    let ctx: QuestContext;
    try {
      ctx = JSON.parse(workflow.context) as QuestContext;
    } catch {
      log(`skipping workflow ${workflow.id}: invalid context JSON`);
      continue;
    }

    if (!ctx.phases || ctx.phases.length === 0 || !ctx.currentPhase) continue;

    const current = ctx.phases.find((p) => p.n === ctx.currentPhase);
    if (!current) continue;

    // Phase already completed — meta-sensor should advance; not our concern
    if (current.status === "completed") continue;

    const phaseSource = `quest:${ctx.slug}:phase-${current.n}`;

    if (current.taskId) {
      const task = getTaskById(current.taskId);
      if (!task) {
        // Task referenced but doesn't exist in DB
        hung.push({
          workflow,
          context: ctx,
          reason: "missing-phase-task",
          phaseNumber: current.n,
          phaseName: current.name,
          taskId: current.taskId,
        });
        continue;
      }

      if (task.status === "failed") {
        // Check if a replacement is already pending
        if (!pendingTaskExistsForSource(phaseSource)) {
          hung.push({
            workflow,
            context: ctx,
            reason: "failed-phase-task",
            phaseNumber: current.n,
            phaseName: current.name,
            taskId: current.taskId,
          });
        }
        continue;
      }

      if (task.status === "active" && task.started_at) {
        const startedAt = new Date(task.started_at).getTime();
        const elapsedMinutes = (now - startedAt) / 60_000;
        if (elapsedMinutes > STALE_ACTIVE_MINUTES) {
          hung.push({
            workflow,
            context: ctx,
            reason: "stale-active-task",
            phaseNumber: current.n,
            phaseName: current.name,
            taskId: current.taskId,
          });
        }
        continue;
      }
    } else {
      // No taskId assigned — check if any task exists for this phase source
      if (!pendingTaskExistsForSource(phaseSource)) {
        // Also check if a workflow:N source task exists (meta-sensor creates these)
        const workflowSource = `workflow:${workflow.id}`;
        if (!pendingTaskExistsForSource(workflowSource)) {
          hung.push({
            workflow,
            context: ctx,
            reason: "missing-phase-task",
            phaseNumber: current.n,
            phaseName: current.name,
            taskId: null,
          });
        }
      }
    }
  }

  return hung;
}

function createAuditTask(hung: HungQuest): void {
  const source = `sensor:quest-audit:${hung.context.slug}`;

  // Dedup: don't create if one already pending
  if (pendingTaskExistsForSource(source)) return;

  const reasonLabels: Record<HungReason, string> = {
    "failed-phase-task": "phase task failed with no replacement",
    "missing-phase-task": "phase task missing from queue",
    "stale-active-task": "phase task stuck active >60min",
  };

  const subject = `Quest hung: ${hung.context.slug} — phase ${hung.phaseNumber} (${reasonLabels[hung.reason]})`;

  const description = [
    `Quest "${hung.context.slug}" is hung at phase ${hung.phaseNumber}/${hung.context.phases.length}.`,
    ``,
    `**Reason:** ${reasonLabels[hung.reason]}`,
    `**Phase:** ${hung.phaseName}`,
    `**Goal:** ${hung.context.phases.find((p) => p.n === hung.phaseNumber)?.goal ?? "unknown"}`,
    `**Quest goal:** ${hung.context.goal}`,
    `**Workflow ID:** ${hung.workflow.id}`,
    hung.taskId ? `**Task ID:** ${hung.taskId}` : "",
    ``,
    `**Action required:** Review the quest state and decide:`,
    `1. Retry the phase: \`arc skills run --name quest-create -- advance --slug ${hung.context.slug}\` (if phase work is done)`,
    `2. Re-queue the phase task (meta-sensor should pick it up if workflow state is correct)`,
    `3. Fail the quest if unrecoverable`,
  ]
    .filter(Boolean)
    .join("\n");

  insertTask({
    subject,
    description,
    priority: 4,
    skills: "quest-create,quest-audit",
    source,
    parent_id: hung.context.parentTaskId ?? undefined,
    model: "sonnet",
  });

  log(`flagged hung quest: ${hung.context.slug} phase=${hung.phaseNumber} reason=${hung.reason}`);
}

export default async function questAuditSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    const workflows = getActiveQuestWorkflows();
    if (workflows.length === 0) {
      log("no active quest workflows");
      return "skip";
    }

    const hung = detectHungQuests(workflows);
    if (hung.length === 0) {
      log(`checked ${workflows.length} quest(s), all healthy`);
      return "skip";
    }

    for (const h of hung) {
      createAuditTask(h);
    }

    log(`found ${hung.length} hung quest(s) out of ${workflows.length} active`);
    return "ok";
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return "skip";
  }
}
