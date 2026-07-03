#!/usr/bin/env bun
// skills/erc8004-identity/cli.ts
// Wrapper for identity skill, delegates to upstream aibtcdev/skills implementation.
// Usage: arc skills run --name erc8004-identity -- <subcommand> [flags]

import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const IDENTITY_SCRIPT = resolve(ROOT, "identity/identity.ts");

/** Subcommands that require an unlocked wallet */
const WRITE_COMMANDS = new Set([
  "register", "set-uri", "set-metadata", "set-approval",
  "set-wallet", "unset-wallet", "transfer",
]);

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [identity/cli] ${message}`);
}

/**
 * Write a temporary runner script that unlocks the wallet in-process,
 * then runs the identity CLI — all in one bun process so the
 * in-memory session is shared.
 */
async function writeRunnerScript(walletId: string, password: string, identityArgs: string[]): Promise<string> {
  const runnerPath = resolve(ROOT, ".identity-runner.ts");
  const escapedPassword = password.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedWalletId = walletId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedArgs = identityArgs.map(a => `'${a.replace(/'/g, "\\'")}'`).join(", ");
  const script = `
import { getWalletManager } from './src/lib/services/wallet-manager.js';
const wm = getWalletManager();
await wm.unlock('${escapedWalletId}', '${escapedPassword}');
process.argv = ['bun', 'identity', ${escapedArgs}];
await import('./identity/identity.ts');
// Commander async actions may not resolve before module-level code returns;
// give them time to complete, then force exit.
setTimeout(() => process.exit(0), 5000);
`;
  await Bun.write(runnerPath, script);
  return runnerPath;
}

/**
 * Run the upstream identity script as a subprocess.
 * For write commands, unlocks wallet in the same process via a runner script.
 */
async function runScript(
  args: string[],
  walletCreds?: { walletId: string; password: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let spawnArgs: string[];
  let runnerPath: string | undefined;

  if (walletCreds) {
    runnerPath = await writeRunnerScript(walletCreds.walletId, walletCreds.password, args);
    spawnArgs = ["bun", "run", runnerPath];
  } else {
    spawnArgs = ["bun", "run", IDENTITY_SCRIPT, ...args];
  }

  const proc = Bun.spawn(spawnArgs, {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NETWORK: process.env.NETWORK || "mainnet" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Clean up runner script
  if (runnerPath) {
    try { await Bun.file(runnerPath).exists() && (await import("node:fs/promises")).unlink(runnerPath); } catch {}
  }

  return { stdout, stderr, exitCode };
}

// ---- Main ----

async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`Identity Skill

Usage: arc skills run --name erc8004-identity -- <subcommand> [options]

Subcommands:
  register                 Register a new agent identity
  get                      Get agent identity info
  set-uri                  Update agent identity URI
  set-metadata             Set metadata key-value pair
  set-approval             Approve or revoke operator
  set-wallet               Link active wallet to agent identity
  unset-wallet             Remove agent wallet association
  transfer                 Transfer identity NFT to new owner
  get-metadata             Read metadata value by key
  get-last-id              Get most recently minted agent ID

Run 'bun run identity/identity.ts <subcommand> --help' for more details.
`);
    process.exit(0);
  }

  try {
    const subcommand = args[0];
    let walletCreds: { walletId: string; password: string } | undefined;

    // Load wallet credentials for write commands
    if (subcommand && WRITE_COMMANDS.has(subcommand)) {
      const walletId = await getCredential("bitcoin-wallet", "id");
      const password = await getCredential("bitcoin-wallet", "password");
      if (!walletId || !password) {
        console.log(JSON.stringify({ error: "Wallet credentials not found in credential store (bitcoin-wallet/id, bitcoin-wallet/password)" }));
        process.exit(1);
      }
      walletCreds = { walletId, password };

      // Load sponsor API key if --sponsored flag is present
      if (args.includes("--sponsored")) {
        const sponsorKey = await getCredential("x402-relay", "sponsor_api_key");
        if (sponsorKey) {
          process.env.SPONSOR_API_KEY = sponsorKey;
        }
      }
    }

    const result = await runScript(args, walletCreds);

    // Always write stdout to stdout
    if (result.stdout) {
      console.log(result.stdout);
    }

    // Write stderr to stderr
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
