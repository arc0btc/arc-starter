/**
 * identity-guard sensor — validates SOUL.md matches expected agent identity.
 *
 * Detects identity drift caused by fleet-sync overwriting per-agent files
 * with Arc's versions. Fires P1 alert if SOUL.md contains wrong identity.
 *
 * Runs every 30 minutes on all agents (workers + Arc).
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

/**
 * Identity markers that indicate the SOUL.md *claims to be* a specific agent.
 * Only use definitive identity claims (first-person declarations + wallet addresses).
 * Exclude handles/BNS names — workers legitimately reference "arc0.btc" as fleet coordinator.
 */
const ARC_MARKERS: readonly string[] = [
  "# Arc\n",
  "I'm Arc.",
  "I'm Arc ",
  "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
  "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
] as const;

/** Identity markers that should NOT appear in Arc's SOUL.md (worker names) */
const WORKER_MARKERS: Record<string, readonly string[]> = {
  spark: ["# Spark\n", "I'm Spark.", "I'm Spark "],
  iris: ["# Iris\n", "I'm Iris.", "I'm Iris "],
  loom: ["# Loom\n", "I'm Loom.", "I'm Loom "],
  forge: ["# Forge\n", "I'm Forge.", "I'm Forge "],
} as const;

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

  if (AGENT_NAME !== "arc0") {
    // Worker agent: check for Arc's identity markers
    for (const marker of ARC_MARKERS) {
      if (content.includes(marker)) {
        violations.push(`found Arc marker: "${marker}"`);
      }
    }
  } else {
    // Arc: check for worker identity markers (unlikely but symmetric check)
    for (const [agent, markers] of Object.entries(WORKER_MARKERS)) {
      for (const marker of markers) {
        if (content.includes(marker)) {
          violations.push(`found ${agent} marker: "${marker}"`);
        }
      }
    }
  }

  // Also verify the expected agent name appears in SOUL.md
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
