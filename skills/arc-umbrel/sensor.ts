/**
 * arc-umbrel sensor — monitors Umbrel node health and Bitcoin Core sync status.
 *
 * Checks every 30 minutes. Creates tasks if:
 * - Bitcoin Core is not installed (one-time install prompt)
 * - Sync stalls (no block progress in 2 consecutive checks)
 */

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SENSOR_NAME = "arc-umbrel";
const INTERVAL_MINUTES = 30;
const STATE_FILE = "db/umbrel-sensor-state.json";
const UMBREL_HOST = "192.168.1.106";
const UMBREL_USER = "umbrel";
const UMBREL_PASS = "umbrel";

const log = createSensorLogger(SENSOR_NAME);

interface SensorState {
  lastBlockHeight: number;
  lastCheckTime: string;
  installPrompted: boolean;
}

function loadState(): SensorState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as SensorState;
    } catch {
      // corrupted state, reset
    }
  }
  return { lastBlockHeight: 0, lastCheckTime: "", installPrompted: false };
}

function saveState(state: SensorState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sshExec(command: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(
    [
      "sshpass", "-p", UMBREL_PASS,
      "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
      `${UMBREL_USER}@${UMBREL_HOST}`,
      command,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

export default async function umbrelSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const state = loadState();

  // Check if Umbrel host is reachable
  const ping = await sshExec("echo ok");
  if (ping.exitCode !== 0) {
    log("Umbrel host unreachable at " + UMBREL_HOST);
    return "warn: umbrel-unreachable";
  }

  // Check if Bitcoin Core is installed
  const btcCheck = await sshExec("sudo docker ps --filter name=bitcoin --format '{{.Names}}' 2>/dev/null");

  if (!btcCheck.stdout) {
    // Bitcoin Core not running
    if (!state.installPrompted && !pendingTaskExistsForSource("sensor:arc-umbrel:install")) {
      insertTask({
        subject: "Install Bitcoin Core on Umbrel node",
        description: "Umbrel at 192.168.1.106 has no Bitcoin Core installed. Run: arc skills run --name arc-umbrel -- install-bitcoin",
        skills: '["arc-umbrel"]',
        priority: 3,
        model: "sonnet",
        source: "sensor:arc-umbrel:install",
      });
      state.installPrompted = true;
      saveState(state);
      log("Created install-bitcoin task");
      return "ok: install-task-created";
    }
    return "ok: bitcoin-not-installed";
  }

  // Bitcoin Core is running — check sync via RPC cookie auth
  const cookie = await sshExec(
    "sudo docker exec bitcoin_bitcoind_1 cat /data/.bitcoin/.cookie 2>/dev/null || " +
    "sudo docker exec bitcoin-bitcoind-1 cat /data/.bitcoin/.cookie 2>/dev/null"
  );

  if (cookie.exitCode !== 0 || !cookie.stdout) {
    return "ok: bitcoin-running-no-rpc";
  }

  const [rpcUser, rpcPass] = cookie.stdout.split(":");
  if (!rpcUser || !rpcPass) return "ok: bitcoin-running-bad-cookie";

  // Get blockchain info via RPC
  const rpcResult = await sshExec(
    `curl -s --max-time 15 -u '${rpcUser}:${rpcPass}' ` +
    `--data '{"jsonrpc":"1.0","id":"sensor","method":"getblockchaininfo","params":[]}' ` +
    `-H 'Content-Type: application/json' http://127.0.0.1:8332/`
  );

  if (rpcResult.exitCode !== 0 || !rpcResult.stdout) {
    return "ok: bitcoin-rpc-timeout";
  }

  try {
    const response = JSON.parse(rpcResult.stdout) as { result: Record<string, unknown> };
    const blocks = response.result.blocks as number;
    const headers = response.result.headers as number;
    const progress = (response.result.verificationprogress as number) * 100;
    const ibd = response.result.initialblockdownload as boolean;

    // Check for stall: no progress since last check
    if (state.lastBlockHeight > 0 && blocks === state.lastBlockHeight && ibd) {
      if (!pendingTaskExistsForSource("sensor:arc-umbrel:stall")) {
        insertTask({
          subject: `Bitcoin Core sync stalled at block ${blocks}`,
          description: `No block progress in 30+ minutes. Headers: ${headers}, Progress: ${progress.toFixed(2)}%. Check peer connections and disk space.`,
          skills: '["arc-umbrel"]',
          priority: 5,
          model: "sonnet",
          source: "sensor:arc-umbrel:stall",
        });
        log(`Sync stall detected at block ${blocks}`);
      }
    }

    state.lastBlockHeight = blocks;
    state.lastCheckTime = new Date().toISOString();
    saveState(state);

    const status = ibd ? `syncing ${progress.toFixed(1)}%` : "synced";
    return `ok: bitcoin-${status} block=${blocks}`;
  } catch {
    return "ok: bitcoin-rpc-parse-error";
  }
}
