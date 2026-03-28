#!/usr/bin/env bun
// skills/nonce-manager/cli.ts
// CLI wrapper for the upstream nonce-manager skill.
// Usage: arc skills run --name nonce-manager -- <subcommand> [flags]
//
// Delegates to github/aibtcdev/skills/nonce-manager/nonce-manager.ts.
// No wallet unlock needed — nonce management is address-based.

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const NONCE_MANAGER_SCRIPT = resolve(ROOT, "nonce-manager/nonce-manager.ts");

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write("Usage: arc skills run --name nonce-manager -- <subcommand> [flags]\n");
  process.stderr.write("Subcommands: acquire | release | sync | status\n");
  process.exit(1);
}

const proc = Bun.spawn(["bun", "run", NONCE_MANAGER_SCRIPT, ...args], {
  cwd: ROOT,
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, NETWORK: process.env.NETWORK ?? "mainnet" },
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (stderr.trim()) {
  process.stderr.write(stderr);
}

process.stdout.write(stdout);
process.exit(exitCode);
