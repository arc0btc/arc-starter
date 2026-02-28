#!/usr/bin/env bun
// skills/reputation/cli.ts
// Wrapper for reputation skill, delegates to upstream aibtcdev/skills implementation.
// Usage: arc skills run --name reputation -- <subcommand> [flags]

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const REPUTATION_SCRIPT = resolve(ROOT, "reputation/reputation.ts");

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [reputation/cli] ${msg}`);
}

/**
 * Run the upstream reputation script as a subprocess.
 */
async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", REPUTATION_SCRIPT, ...args], {
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
    console.log(`Reputation Skill

Usage: arc skills run --name reputation -- <subcommand> [options]

Subcommands:
  give-feedback             Submit feedback for an agent
  revoke-feedback          Revoke previously submitted feedback
  append-response          Append a response to feedback
  approve-client           Approve a client to submit feedback
  get-summary              Get reputation summary
  read-feedback            Read a specific feedback entry
  read-all-feedback        Get all feedback entries (paginated)
  get-clients              Get list of clients who gave feedback
  get-feedback-count       Get total feedback count
  get-approved-limit       Check approved feedback limit
  get-last-index           Get last feedback index

Run 'bun run reputation/reputation.ts <subcommand> --help' for more details.
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
