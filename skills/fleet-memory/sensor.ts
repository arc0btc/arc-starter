/**
 * fleet-memory sensor — detect new learnings across fleet agents.
 *
 * Every 6 hours, checks each agent's patterns.md hash against last collection.
 * Creates a P7 task if any agent has new learnings to collect.
 */

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";
import { existsSync } from "node:fs";

const SENSOR_NAME = "fleet-memory";
const INTERVAL_MINUTES = 360; // 6 hours
const HOOK_STATE_PATH = "db/hook-state/fleet-memory.json";

const log = createSensorLogger(SENSOR_NAME);

interface HookState {
  lastCollectedAt: string | null;
  agentHashes: Record<string, string>;
}

function loadHookState(): HookState {
  try {
    if (existsSync(HOOK_STATE_PATH)) {
      const text = require("node:fs").readFileSync(HOOK_STATE_PATH, "utf-8");
      return JSON.parse(text) as HookState;
    }
  } catch {
    // Fall through
  }
  return { lastCollectedAt: null, agentHashes: {} };
}

function simpleHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex").slice(0, 12);
}

export default async function run(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("checking fleet agents for new learnings");

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("SSH password not configured, skipping");
    return "skip";
  }

  const state = loadHookState();
  const agentNames = Object.keys(AGENTS);
  const changed: string[] = [];

  const results = await Promise.allSettled(
    agentNames.map(async (agent) => {
      try {
        const ip = await getAgentIp(agent);
        const result = await ssh(
          ip,
          password,
          `cat ${REMOTE_ARC_DIR}/memory/patterns.md 2>/dev/null | wc -c && sha256sum ${REMOTE_ARC_DIR}/memory/patterns.md 2>/dev/null | cut -c1-12 || echo "missing"`
        );
        if (!result.ok) {
          log(`${agent}: unreachable`);
          return;
        }

        const lines = result.stdout.trim().split("\n");
        const hash = lines[1]?.trim() ?? "missing";

        if (hash === "missing") {
          log(`${agent}: no patterns.md`);
          return;
        }

        if (state.agentHashes[agent] !== hash) {
          changed.push(agent);
          log(`${agent}: patterns changed (${state.agentHashes[agent]?.slice(0, 8) ?? "none"} → ${hash})`);
        } else {
          log(`${agent}: unchanged`);
        }
      } catch {
        log(`${agent}: error checking`);
      }
    })
  );

  if (changed.length === 0) {
    log("no new learnings detected across fleet");
    return "ok — no changes";
  }

  const subject = `Fleet memory collection: ${changed.join(", ")} have new learnings`;
  const description = [
    `Agents with changed patterns.md: ${changed.join(", ")}`,
    "",
    "Run: arc skills run --name fleet-memory -- full",
  ].join("\n");

  insertTaskIfNew(`sensor:${SENSOR_NAME}`, {
    subject,
    description,
    priority: 7,
    skills: JSON.stringify(["fleet-memory"]),
  });

  return `changes detected: ${changed.join(", ")}`;
}
