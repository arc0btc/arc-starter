/**
 * fleet-memory sensor — detect new learnings across fleet agents.
 *
 * Two-tier detection:
 * 1. Fast check (30min): estimate new entry count via line delta. If any agent
 *    has >= SIGNIFICANT_THRESHOLD estimated new entries, queue a P5 urgent task.
 * 2. Routine check (6h): queue a P7 collection task if any hash changed, as fallback.
 *
 * Reduces inter-agent pattern drift by triggering distribution sooner after
 * significant learning accumulation, without running full SSH diffs every 30min.
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
const FAST_SENSOR_NAME = "fleet-memory-fast";
const INTERVAL_MINUTES = 360; // 6 hours — routine fallback
const FAST_INTERVAL_MINUTES = 30; // 30 minutes — significant drift check

// Trigger urgent distribution if an agent has this many estimated new entries
const SIGNIFICANT_THRESHOLD = 3;
// Approximate lines per learning entry in patterns.md (bold bullet + body lines)
const LINES_PER_ENTRY_ESTIMATE = 5;

const HOOK_STATE_PATH = "db/hook-state/fleet-memory.json";

const log = createSensorLogger(SENSOR_NAME);

interface HookState {
  lastCollectedAt: string | null;
  agentHashes: Record<string, string>;
  // Line counts at last collection, used for fast delta estimation
  agentLineCounts: Record<string, number>;
}

function loadHookState(): HookState {
  try {
    if (existsSync(HOOK_STATE_PATH)) {
      const text = require("node:fs").readFileSync(HOOK_STATE_PATH, "utf-8");
      const parsed = JSON.parse(text) as Partial<HookState>;
      return {
        lastCollectedAt: parsed.lastCollectedAt ?? null,
        agentHashes: parsed.agentHashes ?? {},
        agentLineCounts: parsed.agentLineCounts ?? {},
      };
    }
  } catch {
    // Fall through
  }
  return { lastCollectedAt: null, agentHashes: {}, agentLineCounts: {} };
}

export default async function run(): Promise<string> {
  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("SSH password not configured, skipping");
    return "skip";
  }

  const agentNames = Object.keys(AGENTS);

  // --- Fast check: trigger on significant new entry accumulation ---
  const fastClaimed = await claimSensorRun(FAST_SENSOR_NAME, FAST_INTERVAL_MINUTES);
  if (fastClaimed) {
    log("fast check: estimating new entry counts via line delta");
    const state = loadHookState();
    const significant: Array<{ agent: string; estimated: number }> = [];

    await Promise.allSettled(
      agentNames.map(async (agent) => {
        try {
          const ip = await getAgentIp(agent);
          const result = await ssh(
            ip,
            password,
            `wc -l < ${REMOTE_ARC_DIR}/memory/patterns.md 2>/dev/null || echo "0"`
          );
          if (!result.ok) return;

          const currentLines = parseInt(result.stdout.trim(), 10);
          if (isNaN(currentLines)) return;

          const lastLines = state.agentLineCounts[agent] ?? currentLines;
          const delta = currentLines - lastLines;
          const estimatedNew = Math.floor(delta / LINES_PER_ENTRY_ESTIMATE);

          if (estimatedNew >= SIGNIFICANT_THRESHOLD) {
            significant.push({ agent, estimated: estimatedNew });
            log(`${agent}: ~${estimatedNew} new entries estimated (${delta} line delta)`);
          } else {
            log(`${agent}: ${delta >= 0 ? "+" : ""}${delta} lines, below threshold`);
          }
        } catch {
          log(`${agent}: error during fast check`);
        }
      })
    );

    if (significant.length > 0) {
      const agents = significant.map((s) => s.agent).join(", ");
      const counts = significant.map((s) => `${s.agent}(~${s.estimated})`).join(", ");
      const subject = `Fleet memory: significant drift detected — distribute now (${agents})`;
      const description = [
        `Agents with significant new learnings: ${counts}`,
        "",
        "Triggered by fast drift check (30min interval). Threshold: " +
          `${SIGNIFICANT_THRESHOLD}+ estimated new entries.`,
        "",
        "Run: arc skills run --name fleet-memory -- full",
      ].join("\n");

      insertTaskIfNew(`sensor:${FAST_SENSOR_NAME}`, {
        subject,
        description,
        priority: 5, // Sonnet — act promptly, distribute to reduce drift
        skills: JSON.stringify(["fleet-memory"]),
      });

      return `significant drift: ${counts} — P5 task queued`;
    }
  }

  // --- Routine check: 6h fallback for hash-based detection ---
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("routine check: verifying fleet patterns.md hashes");
  const state = loadHookState();
  const changed: string[] = [];

  await Promise.allSettled(
    agentNames.map(async (agent) => {
      try {
        const ip = await getAgentIp(agent);
        const result = await ssh(
          ip,
          password,
          `sha256sum ${REMOTE_ARC_DIR}/memory/patterns.md 2>/dev/null | cut -c1-12 || echo "missing"`
        );
        if (!result.ok) {
          log(`${agent}: unreachable`);
          return;
        }

        const hash = result.stdout.trim();
        if (hash === "missing") {
          log(`${agent}: no patterns.md`);
          return;
        }

        if (state.agentHashes[agent] !== hash) {
          changed.push(agent);
          log(`${agent}: hash changed (${state.agentHashes[agent]?.slice(0, 8) ?? "none"} → ${hash})`);
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

  return `routine: changes detected — ${changed.join(", ")}`;
}
