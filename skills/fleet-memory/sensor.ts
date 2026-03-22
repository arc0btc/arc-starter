/**
 * fleet-memory sensor v2 — detect new learnings across fleet agents.
 *
 * v2: Replaces patterns.md line-count/hash detection with entry count deltas
 * from each agent's memory/shared/index.json.
 *
 * Two-tier detection:
 * 1. Fast check (30min): compare remote index.json entry count with last known.
 *    If any agent has >= SIGNIFICANT_THRESHOLD new entries, queue a P5 urgent task.
 * 2. Routine check (6h): same check — queue P7 task if any delta detected.
 */

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  getActiveAgentNames,
  isFleetSuspended,
} from "../../src/ssh.ts";
import { existsSync } from "node:fs";

const SENSOR_NAME = "fleet-memory";
const FAST_SENSOR_NAME = "fleet-memory-fast";
const INTERVAL_MINUTES = 360; // 6 hours — routine fallback
const FAST_INTERVAL_MINUTES = 30; // 30 minutes — significant drift check
const SIGNIFICANT_THRESHOLD = 3; // new entries to trigger urgent distribution

const REMOTE_SHARED_INDEX = "memory/shared/index.json";
const HOOK_STATE_PATH = "db/hook-state/fleet-memory.json";

const log = createSensorLogger(SENSOR_NAME);

interface HookState {
  lastCollectedAt: string | null;
  agentRemoteCounts: Record<string, number>;
}

function loadHookState(): HookState {
  try {
    if (existsSync(HOOK_STATE_PATH)) {
      const text = require("node:fs").readFileSync(HOOK_STATE_PATH, "utf-8");
      const parsed = JSON.parse(text) as Partial<HookState>;
      return {
        lastCollectedAt: parsed.lastCollectedAt ?? null,
        agentRemoteCounts: parsed.agentRemoteCounts ?? {},
      };
    }
  } catch {
    // Fall through
  }
  return { lastCollectedAt: null, agentRemoteCounts: {} };
}

/** Get entry count from a remote agent's shared/index.json */
async function getRemoteEntryCount(
  ip: string,
  password: string
): Promise<number | null> {
  // Try python3 for accurate JSON parse; fall back to grep count as estimate
  const result = await ssh(
    ip,
    password,
    `python3 -c "import json; d=json.load(open('${REMOTE_ARC_DIR}/${REMOTE_SHARED_INDEX}')); print(len(d.get('entries', [])))" 2>/dev/null` +
      ` || grep -c '"id":' ${REMOTE_ARC_DIR}/${REMOTE_SHARED_INDEX} 2>/dev/null` +
      ` || echo "0"`
  );
  if (!result.ok) return null;
  const n = parseInt(result.stdout.trim(), 10);
  return isNaN(n) ? null : n;
}

export default async function run(): Promise<string> {
  if (isFleetSuspended()) return "skip";

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("SSH password not configured, skipping");
    return "skip";
  }

  const agentNames = getActiveAgentNames();
  const state = loadHookState();

  // --- Fast check: trigger on significant new entry accumulation ---
  const fastClaimed = await claimSensorRun(FAST_SENSOR_NAME, FAST_INTERVAL_MINUTES);
  if (fastClaimed) {
    log("fast check: comparing remote index entry counts");
    const significant: Array<{ agent: string; delta: number }> = [];

    await Promise.allSettled(
      agentNames.map(async (agent) => {
        try {
          const ip = await getAgentIp(agent);
          const count = await getRemoteEntryCount(ip, password);
          if (count === null) {
            log(`${agent}: unreachable or no index`);
            return;
          }

          const lastKnown = state.agentRemoteCounts[agent] ?? 0;
          const delta = count - lastKnown;

          if (delta >= SIGNIFICANT_THRESHOLD) {
            significant.push({ agent, delta });
            log(`${agent}: ${delta} new entries (${lastKnown} → ${count})`);
          } else {
            log(`${agent}: ${delta >= 0 ? "+" : ""}${delta} entries, below threshold`);
          }
        } catch {
          log(`${agent}: error during fast check`);
        }
      })
    );

    if (significant.length > 0) {
      const agents = significant.map((s) => s.agent).join(", ");
      const counts = significant.map((s) => `${s.agent}(+${s.delta})`).join(", ");
      const subject = `Fleet memory: significant drift detected — distribute now (${agents})`;
      const description = [
        `Agents with significant new entries: ${counts}`,
        "",
        `Triggered by fast drift check (${FAST_INTERVAL_MINUTES}min interval). Threshold: ${SIGNIFICANT_THRESHOLD}+ new entries.`,
        "",
        "Run: arc skills run --name fleet-memory -- full",
      ].join("\n");

      insertTaskIfNew(`sensor:${FAST_SENSOR_NAME}`, {
        subject,
        description,
        priority: 5,
        model: "sonnet",
        skills: JSON.stringify(["fleet-memory"]),
      });

      return `significant drift: ${counts} — P5 task queued`;
    }
  }

  // --- Routine check: 6h fallback ---
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("routine check: verifying remote entry counts");
  const changed: string[] = [];

  await Promise.allSettled(
    agentNames.map(async (agent) => {
      try {
        const ip = await getAgentIp(agent);
        const count = await getRemoteEntryCount(ip, password);
        if (count === null) {
          log(`${agent}: unreachable or no index`);
          return;
        }

        const lastKnown = state.agentRemoteCounts[agent] ?? 0;
        const delta = count - lastKnown;

        if (delta > 0) {
          changed.push(agent);
          log(`${agent}: ${delta} new entries (${lastKnown} → ${count})`);
        } else {
          log(`${agent}: no new entries (${count} total)`);
        }
      } catch {
        log(`${agent}: error checking`);
      }
    })
  );

  if (changed.length === 0) {
    log("no new entries detected across fleet");
    return "ok — no changes";
  }

  const subject = `Fleet memory collection: ${changed.join(", ")} have new entries`;
  const description = [
    `Agents with new entries: ${changed.join(", ")}`,
    "",
    "Run: arc skills run --name fleet-memory -- full",
  ].join("\n");

  insertTaskIfNew(`sensor:${SENSOR_NAME}`, {
    subject,
    description,
    priority: 7,
    model: "sonnet",
    skills: JSON.stringify(["fleet-memory"]),
  });

  return `routine: changes detected — ${changed.join(", ")}`;
}
