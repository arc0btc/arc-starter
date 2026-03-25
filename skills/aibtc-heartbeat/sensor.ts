// skills/aibtc-heartbeat/sensor.ts
//
// Signed AIBTC platform check-in every 5 minutes.
// No LLM needed — signs message with BTC wallet and POSTs to heartbeat API.
// Creates a task if the platform reports unread inbox messages.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { resolve } from "node:path";

import { AGENT_NAME, getAgentWallets } from "../../src/identity.ts";
import type { WalletAddresses } from "../../src/identity.ts";

const SENSOR_NAME = "aibtc-heartbeat";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:aibtc-heartbeat";
const HEARTBEAT_URL = "https://aibtc.com/api/heartbeat";

const SKILLS_ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const SIGN_RUNNER = resolve(import.meta.dir, "../bitcoin-wallet/sign-runner.ts");

const log = createSensorLogger(SENSOR_NAME);

/**
 * Credential service name for a wallet.
 * Primary wallet uses "bitcoin-wallet", legacy wallets use "bitcoin-wallet-legacy".
 */
function credService(wallet: WalletAddresses): string {
  return wallet.label === "primary" ? "bitcoin-wallet" : `bitcoin-wallet-${wallet.label ?? "legacy"}`;
}

/**
 * Sign a message using the wallet's sign-runner (handles unlock/sign/lock in one process).
 * Returns the signature string or null on failure.
 */
async function btcSign(message: string, wallet: WalletAddresses): Promise<string | null> {
  const service = credService(wallet);
  const password = await getCredential(service, "password");
  const walletId = await getCredential(service, "id");

  if (!password || !walletId) {
    log(`wallet credentials not found for ${service}`);
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
    log(`btc-sign failed for ${service} (exit ${exitCode}): ${stderr || stdout}`);
    return null;
  }

  try {
    const result = JSON.parse(stdout.trim());
    const sig = result.signature ?? result.signatureBase64 ?? result.data?.signature;
    if (sig) return sig as string;
    log(`btc-sign: no signature in response for ${service}: ${stdout.trim()}`);
    return null;
  } catch {
    log(`btc-sign failed to parse output for ${service}: ${stdout.trim()}`);
    return null;
  }
}

/**
 * Fire a heartbeat for a single wallet. Returns true on success.
 */
async function heartbeatForWallet(wallet: WalletAddresses, timestamp: string): Promise<boolean> {
  const btcAddress = wallet.btc_segwit;
  const walletLabel = wallet.label ?? "unknown";
  const checkInMessage = `AIBTC Check-In | ${timestamp}`;

  const signature = await btcSign(checkInMessage, wallet);
  if (!signature) {
    log(`signing failed for ${walletLabel} (${btcAddress}) — skipping`);
    return false;
  }

  let responseBody: Record<string, unknown>;
  try {
    const response = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp,
        signature,
        btcAddress,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    responseBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      log(`heartbeat API returned ${response.status} for ${walletLabel}: ${JSON.stringify(responseBody)}`);
      return false;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`heartbeat API request failed for ${walletLabel}: ${message}`);
    return false;
  }

  const level = responseBody.level ?? "unknown";
  const checkInCount = responseBody.checkInCount ?? "?";
  const unreadCount = (responseBody.unreadCount as number) ?? 0;
  log(`[${walletLabel}] check-in ok — level=${level} checkIns=${checkInCount} unread=${unreadCount}`);

  // If unread messages, create a task to read inbox
  if (typeof unreadCount === "number" && unreadCount > 0) {
    const inboxSource = `${TASK_SOURCE}:inbox:${walletLabel}`;
    if (!pendingTaskExistsForSource(inboxSource)) {
      const taskId = insertTask({
        subject: `Read AIBTC inbox for ${walletLabel} wallet (${unreadCount} unread)`,
        description: [
          `The AIBTC heartbeat reported ${unreadCount} unread inbox message(s) for the ${walletLabel} wallet.`,
          "",
          `Read inbox: GET https://aibtc.com/api/inbox/${btcAddress}`,
          "Process messages and reply if needed.",
        ].join("\n"),
        skills: '["bitcoin-wallet"]',
        priority: 1,
        model: "haiku",
        source: inboxSource,
      });
      log(`created task ${taskId} for ${unreadCount} unread inbox message(s) on ${walletLabel}`);
    }
  }

  return true;
}

export default async function aibtcHeartbeatSensor(): Promise<string> {
  const wallets = getAgentWallets(AGENT_NAME);
  if (wallets.length === 0) {
    log("no wallets configured for this agent — heartbeat disabled");
    return "skip";
  }

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const timestamp = new Date().toISOString();

  // Fire heartbeats for all wallets (primary + legacy) sequentially
  // Sequential to avoid race conditions on wallet unlock/lock
  let successCount = 0;
  for (const wallet of wallets) {
    const ok = await heartbeatForWallet(wallet, timestamp);
    if (ok) successCount++;
  }

  log(`heartbeat cycle complete: ${successCount}/${wallets.length} wallets checked in`);
  return successCount > 0 ? "ok" : "error";
}
