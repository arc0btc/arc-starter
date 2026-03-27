/**
 * identity-guard sensor — validates SOUL.md matches expected agent identity.
 *
 * Detects identity drift. Fires P1 alert if SOUL.md contains wrong identity.
 *
 * Runs every 30 minutes.
 */

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { AGENT_NAME, IDENTITY } from "../../src/identity.ts";
import { join } from "node:path";

const SENSOR_NAME = "identity-guard";
const INTERVAL_MINUTES = 30;
const ROOT = new URL("../..", import.meta.url).pathname;

const log = createSensorLogger(SENSOR_NAME);

export default async function sensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const soulPath = join(ROOT, "SOUL.md");
  const soulFile = Bun.file(soulPath);

  if (!(await soulFile.exists())) {
    log(`SOUL.md missing at ${soulPath}`);
    insertTaskIfNew(
      `sensor:${SENSOR_NAME}:missing`,
      {
        subject: `[IDENTITY] SOUL.md missing on ${AGENT_NAME}`,
        description: `SOUL.md does not exist at ${soulPath}. Run configure-identity to restore.`,
        priority: 1,
        model: "sonnet",
        skills: JSON.stringify(["arc-remote-setup"]),
      },
    );
    return "alert — SOUL.md missing";
  }

  const content = await soulFile.text();
  const violations: string[] = [];

  // Verify the expected agent name appears in SOUL.md
  const expectedName = IDENTITY.name.replace(/0$/, ""); // "arc0" → "arc", "iris0" → "iris"
  const capitalizedName = expectedName.charAt(0).toUpperCase() + expectedName.slice(1);
  if (!content.includes(capitalizedName)) {
    violations.push(`expected agent name "${capitalizedName}" not found in SOUL.md`);
  }

  if (violations.length > 0) {
    const detail = violations.join("; ");
    log(`IDENTITY DRIFT on ${AGENT_NAME}: ${detail}`);

    insertTaskIfNew(
      `sensor:${SENSOR_NAME}:drift`,
      {
        subject: `[IDENTITY DRIFT] ${AGENT_NAME} has wrong SOUL.md — run configure-identity`,
        description: `Identity guard detected drift on ${AGENT_NAME}:\n${violations.map(v => `- ${v}`).join("\n")}\n\nFix: arc skills run --name arc-remote-setup -- configure-identity --agent ${AGENT_NAME === "arc0" ? "arc" : AGENT_NAME}`,
        priority: 1,
        model: "sonnet",
        skills: JSON.stringify(["arc-remote-setup", "identity-guard"]),
      },
    );

    return `alert — identity drift: ${detail}`;
  }

  log(`identity OK for ${AGENT_NAME}`);
  return "ok";
}
