// skills/contact-registry/sensor.ts
// Periodic agent backfill from aibtc.com — keeps the local contacts table fresh.
//
// Without this sensor the backfill is manual-only; new agents that join
// aibtc.com don't enter our DB until someone runs `arc skills run --name
// contact-registry -- backfill-agents`. That's the gap the user flagged when
// they noted "they populate in larger batches then I see increases".
//
// Cadence: every 6 hours. The actual backfill runs as a deterministic
// `script` task — no LLM, no cost — so the cycle is cheap. claimSensorRun()
// guards against re-firing within the interval.

import { claimSensorRun, insertTaskIfNew, createSensorLogger } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "contact-registry-backfill";
const INTERVAL_MINUTES = 360; // 6 hours
const TASK_SOURCE = "sensor:contact-registry-backfill";

const log = createSensorLogger(SENSOR_NAME);

export default async function contactBackfillSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Source key includes the UTC date+hour bucket so a long backlog doesn't fan
  // into multiple identical tasks within the same window.
  const now = new Date();
  const bucket = `${now.toISOString().slice(0, 10)}-h${Math.floor(now.getUTCHours() / 6) * 6}`;

  const id = insertTaskIfNew(`${TASK_SOURCE}:${bucket}`, {
    subject: `Backfill aibtc.com agents into contacts table (6h sweep ${bucket})`,
    description: [
      `Pulls the current agent list from aibtc.com/api/agents and upserts into the local contacts table.`,
      ``,
      `New agents become eligible for agent-welcome outreach (sensor checks for type=agent + active + addresses + agent_id + no prior outreach).`,
      ``,
      `Deterministic — runs as a script, no LLM cost. Re-runs every 6 hours.`,
    ].join("\n"),
    priority: 8,
    skills: JSON.stringify([]),
    script: "arc skills run --name contact-registry -- backfill-agents",
  });

  if (id !== null) {
    log(`queued backfill task #${id} for bucket ${bucket}`);
  }
  return id !== null ? "ok" : "skip";
}
