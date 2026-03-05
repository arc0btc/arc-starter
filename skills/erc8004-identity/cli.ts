#!/usr/bin/env bun
// skills/erc8004-identity/cli.ts
// Wrapper for identity skill, delegates to upstream aibtcdev/skills implementation.
// Usage: arc skills run --name identity -- <subcommand> [flags]

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const IDENTITY_SCRIPT = resolve(ROOT, "identity/identity.ts");

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [identity/cli] ${msg}`);
}

/**
 * Run the upstream identity script as a subprocess.
 */
async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", IDENTITY_SCRIPT, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return {
    stdout,
    stderr,
    exitCode: await proc.exited,
  };
}

// ---- Main ----

async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`Identity Skill

Usage: arc skills run --name identity -- <subcommand> [options]

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
    const result = await runScript(args);

    // Always write stdout to stdout
    if (result.stdout) {
      console.log(result.stdout);
    }

    // Write stderr to stderr
    if (result.stderr) {
      console.error(result.stderr);
    }

    process.exit(result.exitCode);
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

await main(Bun.argv.slice(2));
