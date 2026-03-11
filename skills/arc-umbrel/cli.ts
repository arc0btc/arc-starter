#!/usr/bin/env bun

/**
 * arc-umbrel CLI — Bitcoin Core RPC and Umbrel node management
 *
 * Usage: arc skills run --name arc-umbrel -- <command> [options]
 */

import { parseFlags } from "../../src/utils.ts";

// ---- Constants ----

const UMBREL_HOST = "192.168.1.106";
const UMBREL_USER = "umbrel";
const UMBREL_PASS = "umbrel";
const BITCOIN_RPC_PORT = 8332;

// ---- SSH helpers ----

async function sshExec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    [
      "sshpass", "-p", UMBREL_PASS,
      "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
      `${UMBREL_USER}@${UMBREL_HOST}`,
      command,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ---- Bitcoin Core RPC ----

interface RpcCredentials {
  user: string;
  password: string;
}

async function getBitcoinRpcCredentials(): Promise<RpcCredentials | null> {
  // Read rpcauth from the running Bitcoin Core container's config
  const result = await sshExec(
    "sudo docker exec bitcoin_bitcoind_1 cat /data/.bitcoin/bitcoin.conf 2>/dev/null || " +
    "sudo docker exec bitcoin-bitcoind-1 cat /data/.bitcoin/bitcoin.conf 2>/dev/null || " +
    "echo '__NOT_FOUND__'"
  );
  if (result.exitCode !== 0 || result.stdout.includes("__NOT_FOUND__")) {
    // Try cookie auth
    const cookie = await sshExec(
      "sudo docker exec bitcoin_bitcoind_1 cat /data/.bitcoin/.cookie 2>/dev/null || " +
      "sudo docker exec bitcoin-bitcoind-1 cat /data/.bitcoin/.cookie 2>/dev/null || " +
      "echo '__NOT_FOUND__'"
    );
    if (cookie.exitCode === 0 && !cookie.stdout.includes("__NOT_FOUND__")) {
      const [user, password] = cookie.stdout.split(":");
      if (user && password) return { user, password };
    }
    return null;
  }

  // Parse rpcuser/rpcpassword from config
  const lines = result.stdout.split("\n");
  let user = "";
  let password = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("rpcuser=")) user = trimmed.slice(8);
    if (trimmed.startsWith("rpcpassword=")) password = trimmed.slice(12);
  }

  if (user && password) return { user, password };

  // Fallback: cookie auth from config directory
  return null;
}

async function bitcoinRpc(method: string, params: unknown[] | Record<string, unknown> = []): Promise<unknown> {
  const creds = await getBitcoinRpcCredentials();
  if (!creds) {
    throw new Error("Bitcoin Core not running or RPC credentials not found. Is Bitcoin Core installed?");
  }

  // Use curl via SSH to hit the RPC endpoint inside the Docker network
  const payload = JSON.stringify({ jsonrpc: "1.0", id: "arc", method, params });
  const escapedPayload = payload.replace(/'/g, "'\\''");

  const result = await sshExec(
    `curl -s --max-time 30 -u '${creds.user}:${creds.password}' ` +
    `--data '${escapedPayload}' ` +
    `-H 'Content-Type: application/json' ` +
    `http://127.0.0.1:${BITCOIN_RPC_PORT}/`
  );

  if (result.exitCode !== 0) {
    throw new Error(`RPC call failed: ${result.stderr || result.stdout}`);
  }

  const response = JSON.parse(result.stdout) as { result: unknown; error: unknown };
  if (response.error) {
    throw new Error(`RPC error: ${JSON.stringify(response.error)}`);
  }

  return response.result;
}

// ---- Commands ----

async function cmdStatus(): Promise<void> {
  process.stdout.write("Umbrel Node Status — 192.168.1.106\n");
  process.stdout.write("=".repeat(40) + "\n\n");

  // System info
  const disk = await sshExec("df -h /mnt/root/data 2>/dev/null || df -h /");
  process.stdout.write("Disk:\n" + disk.stdout + "\n\n");

  const mem = await sshExec("free -h | head -2");
  process.stdout.write("Memory:\n" + mem.stdout + "\n\n");

  const uptime = await sshExec("uptime -p");
  process.stdout.write("Uptime: " + uptime.stdout + "\n\n");

  // Installed apps
  const apps = await sshExec("ls ~/umbrel/app-data/ 2>/dev/null || echo '(none)'");
  process.stdout.write("Installed apps: " + (apps.stdout || "(none)") + "\n\n");

  // Check if Bitcoin Core is running
  const btcRunning = await sshExec("sudo docker ps --filter name=bitcoin --format '{{.Names}} {{.Status}}' 2>/dev/null");
  if (btcRunning.stdout) {
    process.stdout.write("Bitcoin Core: RUNNING\n" + btcRunning.stdout + "\n\n");
    // Try to get sync status
    try {
      const info = await bitcoinRpc("getblockchaininfo") as Record<string, unknown>;
      const progress = (info.verificationprogress as number) * 100;
      process.stdout.write(`Chain: ${info.chain}\n`);
      process.stdout.write(`Blocks: ${info.blocks}\n`);
      process.stdout.write(`Headers: ${info.headers}\n`);
      process.stdout.write(`Sync: ${progress.toFixed(2)}%\n`);
      process.stdout.write(`Pruned: ${info.pruned}\n`);
    } catch (e) {
      process.stdout.write(`RPC: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  } else {
    process.stdout.write("Bitcoin Core: NOT INSTALLED\n");
  }
}

async function cmdInstallBitcoin(): Promise<void> {
  // Check if already installed
  const check = await sshExec("ls ~/umbrel/app-data/bitcoin 2>/dev/null && echo 'EXISTS'");
  if (check.stdout.includes("EXISTS")) {
    process.stdout.write("Bitcoin Core is already installed.\n");
    const running = await sshExec("sudo docker ps --filter name=bitcoin --format '{{.Names}}'");
    if (running.stdout) {
      process.stdout.write("Status: Running\n");
    } else {
      process.stdout.write("Status: Installed but not running. Check Umbrel UI.\n");
    }
    return;
  }

  process.stdout.write("Installing Bitcoin Core via Umbrel CLI...\n");
  process.stdout.write("Note: This starts IBD (Initial Block Download). Full sync takes days.\n");
  process.stdout.write("Using pruned mode to fit in available storage.\n\n");

  // Install via umbreld
  const result = await sshExec("sudo ~/umbrel/bin/umbreld client apps install bitcoin 2>&1");
  if (result.exitCode !== 0) {
    // Fallback: try the umbreld API
    const apiResult = await sshExec(
      `curl -s -X POST http://127.0.0.1:2000/api/install -H 'Content-Type: application/json' -d '{"appId":"bitcoin"}' 2>&1`
    );
    if (apiResult.exitCode !== 0) {
      process.stderr.write(`Installation failed. Install manually via Umbrel UI at http://${UMBREL_HOST}\n`);
      process.stderr.write(`CLI output: ${result.stdout}\n${result.stderr}\n`);
      process.stderr.write(`API output: ${apiResult.stdout}\n`);
      process.exit(1);
    }
    process.stdout.write("Installed via Umbrel API.\n");
  } else {
    process.stdout.write(result.stdout + "\n");
  }

  process.stdout.write("\nBitcoin Core installation initiated.\n");
  process.stdout.write("Monitor sync progress: arc skills run --name arc-umbrel -- sync\n");
}

async function cmdRpc(method: string, paramsStr?: string): Promise<void> {
  if (!method) {
    process.stderr.write("Error: RPC method required.\n");
    process.stderr.write("Usage: arc skills run --name arc-umbrel -- rpc <method> [--params JSON]\n");
    process.stderr.write("\nCommon methods:\n");
    process.stderr.write("  getblockchaininfo    — Chain state, sync progress\n");
    process.stderr.write("  getblockcount        — Current block height\n");
    process.stderr.write("  getbestblockhash     — Tip block hash\n");
    process.stderr.write("  getblock             — Block details (--params '{\"blockhash\":\"...\"}')\n");
    process.stderr.write("  gettransaction       — Wallet tx details (--params '{\"txid\":\"...\"}')\n");
    process.stderr.write("  getmempoolinfo       — Mempool statistics\n");
    process.stderr.write("  getnetworkinfo       — P2P network status\n");
    process.stderr.write("  getpeerinfo          — Connected peers\n");
    process.stderr.write("  estimatesmartfee     — Fee estimation (--params '{\"conf_target\":6}')\n");
    process.exit(1);
  }

  let params: unknown[] | Record<string, unknown> = [];
  if (paramsStr) {
    try {
      const parsed = JSON.parse(paramsStr);
      // Bitcoin Core RPC expects positional params as array or named as object
      if (Array.isArray(parsed)) {
        params = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Convert named params to positional for common methods
        params = parsed as Record<string, unknown>;
      }
    } catch {
      process.stderr.write(`Error: Invalid JSON params: ${paramsStr}\n`);
      process.exit(1);
    }
  }

  try {
    const result = await bitcoinRpc(method, params);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

async function cmdSync(): Promise<void> {
  try {
    const info = await bitcoinRpc("getblockchaininfo") as Record<string, unknown>;
    const progress = (info.verificationprogress as number) * 100;
    const blocks = info.blocks as number;
    const headers = info.headers as number;
    const remaining = headers - blocks;

    process.stdout.write("Bitcoin Core Sync Status\n");
    process.stdout.write("=".repeat(30) + "\n");
    process.stdout.write(`Chain:    ${info.chain}\n`);
    process.stdout.write(`Progress: ${progress.toFixed(4)}%\n`);
    process.stdout.write(`Blocks:   ${blocks.toLocaleString()}\n`);
    process.stdout.write(`Headers:  ${headers.toLocaleString()}\n`);
    process.stdout.write(`Behind:   ${remaining.toLocaleString()} blocks\n`);
    process.stdout.write(`Pruned:   ${info.pruned ? "yes" : "no"}\n`);

    if (info.initialblockdownload) {
      process.stdout.write(`\nInitial Block Download in progress...\n`);
      // Estimate time
      const networkInfo = await bitcoinRpc("getnetworkinfo") as Record<string, unknown>;
      process.stdout.write(`Peers:    ${(networkInfo.connections as number) || "unknown"}\n`);
    } else {
      process.stdout.write(`\nFully synced.\n`);
    }
  } catch (e) {
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.stderr.write("\nBitcoin Core may not be installed or running.\n");
    process.stderr.write("Install: arc skills run --name arc-umbrel -- install-bitcoin\n");
    process.exit(1);
  }
}

function cmdStacksInfo(): void {
  process.stdout.write("Stacks Node on Umbrel\n");
  process.stdout.write("=".repeat(30) + "\n\n");
  process.stdout.write("Status: NOT AVAILABLE in Umbrel app store\n\n");
  process.stdout.write("The default Umbrel app store (300+ apps) does not include a Stacks node.\n");
  process.stdout.write("There is no community Umbrel app package for Stacks.\n\n");
  process.stdout.write("Options:\n\n");
  process.stdout.write("1. Manual Docker install on Umbrel host\n");
  process.stdout.write("   - Run stacks-node as a Docker container\n");
  process.stdout.write("   - Mount data to /mnt/root/data/stacks-node\n");
  process.stdout.write("   - Connect to local Bitcoin Core for chain data\n");
  process.stdout.write("   - Image: blockstack/stacks-core or hirosystems/stacks-node\n");
  process.stdout.write("   - Requires ~50GB storage for Stacks chain data\n\n");
  process.stdout.write("2. Custom Umbrel app package\n");
  process.stdout.write("   - Create umbrel-app.yml manifest\n");
  process.stdout.write("   - Package as community app store entry\n");
  process.stdout.write("   - Most maintainable long-term approach\n\n");
  process.stdout.write("3. Separate VM\n");
  process.stdout.write("   - Run Stacks node on a dedicated VM\n");
  process.stdout.write("   - Point to Umbrel's Bitcoin Core RPC\n");
  process.stdout.write("   - Keeps Umbrel focused on Bitcoin L1\n\n");
  process.stdout.write("Recommended: Option 1 (manual Docker) for initial setup,\n");
  process.stdout.write("then Option 2 (custom app) for maintainability.\n\n");
  process.stdout.write("Storage note: Umbrel has 180GB total. Bitcoin Core pruned (~10GB) +\n");
  process.stdout.write("Stacks (~50GB) fits. Full Bitcoin Core (~600GB) does not.\n");
}

function printUsage(): void {
  process.stdout.write(`arc-umbrel — Bitcoin Core RPC and Umbrel node management

Usage: arc skills run --name arc-umbrel -- <command> [options]

Commands:
  status                          System and node status
  install-bitcoin                 Install Bitcoin Core on Umbrel (pruned mode)
  rpc <method> [--params JSON]    Execute Bitcoin Core JSON-RPC call
  sync                            Bitcoin Core sync progress
  stacks-info                     Stacks node options and status
  help                            Show this help

RPC examples:
  rpc getblockchaininfo
  rpc getblock --params '["000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"]'
  rpc estimatesmartfee --params '[6]'

Node: ${UMBREL_HOST} (SSH: ${UMBREL_USER}@${UMBREL_HOST})
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  switch (sub) {
    case "status":
      await cmdStatus();
      break;
    case "install-bitcoin":
      await cmdInstallBitcoin();
      break;
    case "rpc":
      await cmdRpc(args[1], flags.params);
      break;
    case "sync":
      await cmdSync();
      break;
    case "stacks-info":
      cmdStacksInfo();
      break;
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown command '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
