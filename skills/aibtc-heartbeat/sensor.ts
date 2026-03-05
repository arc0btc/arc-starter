// skills/aibtc-heartbeat/sensor.ts
//
// Signed AIBTC platform check-in every 5 minutes.
// No LLM needed — signs message with BTC wallet and POSTs to heartbeat API.
// Creates a task if the platform reports unread inbox messages.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { resolve } from "node:path";

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "aibtc-heartbeat";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:aibtc-heartbeat";
const HEARTBEAT_URL = "https://aibtc.com/api/heartbeat";

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const SIGN_RUNNER = resolve(import.meta.dir, "../wallet/sign-runner.ts");

const log = createSensorLogger(SENSOR_NAME);

/**
 * Sign a message using the wallet's sign-runner (handles unlock/sign/lock in one process).
 * Returns the signature string or null on failure.
 */
async function btcSign(message: string): Promise<string | null> {
  const password = await getCredential("bitcoin-wallet", "password");
  const walletId = await getCredential("bitcoin-wallet", "id");

  if (!password || !walletId) {
    log("wallet credentials not found in creds store");
    return null;
  }

  const proc = Bun.spawn(["bun", "run", SIGN_RUNNER, "btc-sign", "--message", message], {
    cwd: SKILLS_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WALLET_ID: walletId,
      WALLET_PASSWORD: password,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log(`btc-sign failed (exit ${exitCode}): ${stderr || stdout}`);
    return null;
  }

  try {
    const result = JSON.parse(stdout.trim());
    const sig = result.signature ?? result.signatureBase64 ?? result.data?.signature;
    if (sig) return sig as string;
    log(`btc-sign: no signature in response: ${stdout.trim()}`);
    return null;
  } catch {
    log(`btc-sign failed to parse output: ${stdout.trim()}`);
    return null;
  }
}

export default async function aibtcHeartbeatSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Build check-in message
  const timestamp = new Date().toISOString();
  const message = `AIBTC Check-In | ${timestamp}`;

  // Sign with BTC wallet
  const signature = await btcSign(message);
  if (!signature) {
    log("signing failed — skipping heartbeat");
    return "ok";
  }

  // POST to heartbeat API
  let responseBody: Record<string, unknown>;
  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp,
        signature,
        btcAddress: ARC_BTC_ADDRESS,
      }),
    });

    responseBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      log(`heartbeat API returned ${response.status}: ${JSON.stringify(responseBody)}`);
      return "ok";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`heartbeat API request failed: ${message}`);
    return "ok";
  }

  // Log result
  const level = responseBody.level ?? "unknown";
  const checkInCount = responseBody.checkInCount ?? "?";
  const unreadCount = (responseBody.unreadCount as number) ?? 0;
  log(`check-in ok — level=${level} checkIns=${checkInCount} unread=${unreadCount}`);

  // If unread messages, create a task to read inbox
  if (typeof unreadCount === "number" && unreadCount > 0) {
    const inboxSource = `${TASK_SOURCE}:inbox`;
    if (!pendingTaskExistsForSource(inboxSource)) {
      const taskId = insertTask({
        subject: `Read AIBTC inbox (${unreadCount} unread)`,
        description: [
          `The AIBTC heartbeat reported ${unreadCount} unread inbox message(s).`,
          "",
          `Read inbox: GET https://aibtc.com/api/inbox/${ARC_BTC_ADDRESS}`,
          "Process messages and reply if needed.",
        ].join("\n"),
        skills: '["bitcoin-wallet"]',
        priority: 1,
        model: "haiku",
        source: inboxSource,
      });
      log(`created task ${taskId} for ${unreadCount} unread inbox message(s)`);
    }
  }

  return "ok";
}
