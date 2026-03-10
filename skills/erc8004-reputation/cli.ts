#!/usr/bin/env bun
// skills/erc8004-reputation/cli.ts
// Wrapper for reputation skill, delegates to upstream aibtcdev/skills implementation.
// Read-only commands run the upstream script directly.
// Write commands use tx-runner.ts for wallet-aware execution.
// Usage: arc skills run --name erc8004-reputation -- <subcommand> [flags]

import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const REPUTATION_SCRIPT = resolve(ROOT, "reputation/reputation.ts");
const TX_RUNNER = resolve(import.meta.dir, "tx-runner.ts");

// Write commands that require an unlocked wallet
const WRITE_COMMANDS = new Set(["give-feedback", "revoke-feedback", "append-response", "approve-client"]);

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [reputation/cli] ${message}`);
}

/**
 * Run the upstream reputation script as a subprocess (read-only).
 */
async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", REPUTATION_SCRIPT, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NETWORK: process.env.NETWORK || "mainnet" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}

/**
 * Run a write command via tx-runner.ts (wallet unlock + execute + lock).
 */
async function runTx(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");

  if (!walletId || !walletPassword) {
    return {
      stdout: JSON.stringify({ success: false, error: "Wallet credentials not found (bitcoin-wallet/id, bitcoin-wallet/password)" }),
      stderr: "",
      exitCode: 1,
    };
  }

  const proc = Bun.spawn(["bun", "run", TX_RUNNER, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
      WALLET_ID: walletId,
      WALLET_PASSWORD: walletPassword,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ---- Main ----

async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`Reputation Skill

Usage: arc skills run --name erc8004-reputation -- <subcommand> [options]

Write commands (wallet required):
  give-feedback             Submit feedback for an agent
  revoke-feedback           Revoke previously submitted feedback
  append-response           Append a response to feedback
  approve-client            Approve a client to submit feedback

Read-only commands:
  get-summary               Get reputation summary
  read-feedback             Read a specific feedback entry
  read-all-feedback         Get all feedback entries (paginated)
  get-clients               Get list of clients who gave feedback
  get-feedback-count        Get total feedback count
  get-approved-limit        Check approved feedback limit
  get-last-index            Get last feedback index

Run 'bun run reputation/reputation.ts <subcommand> --help' for more details.
`);
    process.exit(0);
  }

  const subcommand = args[0];
  const isWrite = WRITE_COMMANDS.has(subcommand);

  try {
    const result = isWrite ? await runTx(args) : await runScript(args);

    if (result.stdout) {
      console.log(result.stdout);
    }

    if (result.stderr) {
      console.error(result.stderr);
    }

    process.exit(result.exitCode);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

await main(Bun.argv.slice(2));
