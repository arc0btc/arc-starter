// erc8004-reputation/sensor.ts
//
// Monitors Arc's on-chain ERC-8004 reputation record for new incoming feedback.
// Runs every 60 minutes. Pure TypeScript — no LLM.
//
// Strategy:
// 1. Call get-feedback-count for Arc's agent ID (1)
// 2. Compare with previously stored count
// 3. If new feedback detected, queue a task to review and respond
//
// This sensor watches *incoming* feedback on Arc's identity.
// The arc-reputation sensor handles *outgoing* reviews (separate concern).

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { resolve } from "node:path";

const SENSOR_NAME = "erc8004-reputation-monitor";
const INTERVAL_MINUTES = 60;
const ARC_AGENT_ID = 1;

const log = createSensorLogger(SENSOR_NAME);

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const REPUTATION_SCRIPT = resolve(ROOT, "reputation/reputation.ts");

// ---- Helpers ----

interface FeedbackCountResult {
  success: boolean;
  agentId: number;
  feedbackCount: number;
  network: string;
}

/** Call upstream reputation script to get feedback count. */
async function getFeedbackCount(): Promise<number> {
  const proc = Bun.spawn(
    ["bun", "run", REPUTATION_SCRIPT, "get-feedback-count", "--agent-id", String(ARC_AGENT_ID)],
    {
      cwd: ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NETWORK: process.env.NETWORK || "mainnet" },
    }
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`get-feedback-count exited with code ${exitCode}`);
  }

  const result: FeedbackCountResult = JSON.parse(stdout.trim());
  if (!result.success) {
    throw new Error("get-feedback-count returned success=false");
  }

  return result.feedbackCount;
}

// ---- Main sensor ----

export default async function erc8004ReputationMonitorSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    const currentCount = await getFeedbackCount();
    const hookState = await readHookState(SENSOR_NAME);
    const previousCount = (hookState?.feedback_count as number) ?? 0;

    log(`agent ${ARC_AGENT_ID} feedback count: ${currentCount} (previous: ${previousCount})`);

    if (currentCount > previousCount) {
      const newEntries = currentCount - previousCount;
      log(`${newEntries} new feedback entry/entries detected`);

      const source = `sensor:${SENSOR_NAME}:count:${currentCount}`;
      insertTaskIfNew(source, {
        subject: `ERC-8004: review ${newEntries} new reputation feedback on agent ${ARC_AGENT_ID}`,
        description: [
          `${newEntries} new feedback entry/entries detected on Arc's on-chain identity (agent ID ${ARC_AGENT_ID}).`,
          `Previous count: ${previousCount}, current count: ${currentCount}.`,
          ``,
          `Steps:`,
          `1. Read all feedback: arc skills run --name erc8004-reputation -- read-all-feedback --agent-id ${ARC_AGENT_ID}`,
          `2. Evaluate each new entry — is it accurate? Does it warrant a response?`,
          `3. If appropriate, respond: arc skills run --name erc8004-reputation -- append-response --agent-id ${ARC_AGENT_ID} --client <addr> --index <idx> --response-uri <uri> --response-hash <hash>`,
          `4. Update MEMORY.md with reputation status`,
        ].join("\n"),
        skills: '["erc8004-reputation", "erc8004-identity"]',
        priority: 5,
        model: "sonnet",
      });
    }

    // Persist state
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      feedback_count: currentCount,
      version: (hookState?.version as number) ?? 1,
    });

    return "ok";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`error: ${errorMessage}`);

    // Persist error state but don't crash
    const hookState = await readHookState(SENSOR_NAME);
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: `error: ${errorMessage}`,
      feedback_count: hookState?.feedback_count ?? 0,
      version: (hookState?.version as number) ?? 1,
    });

    return "ok";
  }
}
