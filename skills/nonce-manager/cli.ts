#!/usr/bin/env bun
// skills/nonce-manager/cli.ts
// CLI wrapper for the upstream nonce-manager skill.
// Usage: arc skills run --name nonce-manager -- <subcommand> [flags]
//
// Delegates to github/aibtcdev/skills/nonce-manager/nonce-manager.ts.
// No wallet unlock needed — nonce management is address-based.
//
// Local subcommands (handled here, not delegated upstream):
//   queue-check --address SP... [--relay-url URL]

import { resolve } from "node:path";

const RELAY_URL = "https://x402-relay.aibtc.com";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const NONCE_MANAGER_SCRIPT = resolve(ROOT, "nonce-manager/nonce-manager.ts");

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write("Usage: arc skills run --name nonce-manager -- <subcommand> [flags]\n");
  process.stderr.write("Subcommands: acquire | release | sync | status | queue-check\n");
  process.exit(1);
}

// Handle queue-check locally — queries relay queue endpoint for stuck-tx visibility.
// Usage: arc skills run --name nonce-manager -- queue-check --address SP...
if (args[0] === "queue-check") {
  const addrIdx = args.indexOf("--address");
  const relayIdx = args.indexOf("--relay-url");
  const address = addrIdx !== -1 ? args[addrIdx + 1] : undefined;
  const relayBase = (relayIdx !== -1 ? args[relayIdx + 1] : RELAY_URL).replace(/\/+$/, "");

  if (!address) {
    process.stderr.write("Error: --address is required for queue-check\n");
    process.stderr.write("Usage: arc skills run --name nonce-manager -- queue-check --address SP...\n");
    process.exit(1);
  }

  const url = `${relayBase}/queue/${address}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await resp.text();

  if (!resp.ok) {
    process.stderr.write(`Error: relay returned ${resp.status}\n${body}\n`);
    process.exit(1);
  }

  process.stdout.write(body.endsWith("\n") ? body : body + "\n");
  process.exit(0);
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
