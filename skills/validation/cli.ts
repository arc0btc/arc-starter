#!/usr/bin/env bun
// skills/validation/cli.ts
// Wrapper for validation skill, delegates to upstream aibtcdev/skills implementation.
// Usage: arc skills run --name validation -- <subcommand> [flags]

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const VALIDATION_SCRIPT = resolve(ROOT, "validation/validation.ts");

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [validation/cli] ${msg}`);
}

/**
 * Run the upstream validation script as a subprocess.
 */
async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", VALIDATION_SCRIPT, ...args], {
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
    console.log(`Validation Skill

Usage: arc skills run --name validation -- <subcommand> [options]

Subcommands:
  request                  Request validation from a validator
  respond                  Submit a validation response
  get-status               Get validation request status
  get-summary              Get validation summary for agent
  get-agent-validations    List validations for an agent
  get-validator-requests   List validation requests for a validator

Run 'bun run validation/validation.ts <subcommand> --help' for more details.
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
