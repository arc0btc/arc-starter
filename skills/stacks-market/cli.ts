#!/usr/bin/env bun
/**
 * Stacks Market skill CLI wrapper
 * Delegates market operations to upstream github/aibtcdev/skills/stacks-market/stacks-market.ts
 *
 * Usage:
 *   arc skills run --name stacks-market -- list-markets [--limit N]
 *   arc skills run --name stacks-market -- search-markets --query KEYWORD
 *   arc skills run --name stacks-market -- get-market --market-id ID
 *   arc skills run --name stacks-market -- quote-buy --market-id ID --side yes|no --amount N
 *   arc skills run --name stacks-market -- buy-yes --market-id ID --amount N --max-cost USTX
 *   arc skills run --name stacks-market -- [other commands...]
 */

import { spawn } from "bun";

const SKILLS_ROOT = "github/aibtcdev/skills";

async function runUpstreamCliCommand(args: string[]): Promise<void> {
  const script = `${SKILLS_ROOT}/stacks-market/stacks-market.ts`;
  const cwd = import.meta.dir.replace(/\/skills\/stacks-market$/, "");

  const proc = spawn(["bun", "run", script, ...args], {
    cwd,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: {
      ...process.env,
      NETWORK: process.env.NETWORK ?? "mainnet",
    },
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// Delegate to upstream CLI
const args = Bun.argv.slice(2); // Remove 'bun' and script path

if (args.length === 0) {
  console.log("Stacks Market skill CLI — delegates to upstream stacks-market.ts");
  console.log("");
  console.log("Usage:");
  console.log("  arc skills run --name stacks-market -- list-markets [--limit N]");
  console.log("  arc skills run --name stacks-market -- search-markets --query KEYWORD");
  console.log("  arc skills run --name stacks-market -- get-market --market-id ID");
  console.log("  arc skills run --name stacks-market -- quote-buy --market-id ID --side yes|no --amount N");
  console.log("  arc skills run --name stacks-market -- quote-sell --market-id ID --side yes|no --amount N");
  console.log("  arc skills run --name stacks-market -- buy-yes --market-id ID --amount N --max-cost USTX");
  console.log("  arc skills run --name stacks-market -- buy-no --market-id ID --amount N --max-cost USTX");
  console.log("  arc skills run --name stacks-market -- sell-yes --market-id ID --amount N --min-proceeds USTX");
  console.log("  arc skills run --name stacks-market -- sell-no --market-id ID --amount N --min-proceeds USTX");
  console.log("  arc skills run --name stacks-market -- redeem --market-id ID");
  console.log("  arc skills run --name stacks-market -- get-position --market-id ID [--address STACKS_ADDRESS]");
  console.log("");
  console.log("All commands delegate to upstream github/aibtcdev/skills/stacks-market/stacks-market.ts");
  process.exit(0);
}

await runUpstreamCliCommand(args);
