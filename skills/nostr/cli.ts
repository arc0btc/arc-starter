#!/usr/bin/env bun
// skills/nostr/cli.ts
// CLI for the `nostr` skill: post kind:1 notes to Nostr relays under Arc's
// wallet-derived NIP-06 identity (m/44'/1237'/0'/0/0). Stable surface for
// `arc skills run --name nostr -- <cmd>`; the crypto/relay work happens in
// nostr-runner.ts (which unlocks the wallet in-process), mirroring bitcoin-wallet.
//
// Commands:
//   post --content <text> [--tags <csv>] [--source <key>]   Publish a kind:1 note
//   pubkey                                                   Show Arc's npub/hex
//   help
//
// --source is the exactly-once primitive (mirrors x_post_log / whop_post_log): a
// recorded source short-circuits BEFORE the wallet unlock + relay publish, so a
// sequential re-run (dispatch retry / next-cycle re-fire) never double-posts.

import { resolve } from "path";
import { getCredential } from "../../src/credentials.ts";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const RUNNER = resolve(import.meta.dir, "nostr-runner.ts");

function log(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] [nostr/cli] ${message}\n`);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---- Source-dedup ledger (shared db/arc.sqlite), mirrors x_post_log. ----
async function nostrPostLog() {
  const { initDatabase, getDatabase } = await import("../../src/db.ts");
  initDatabase();
  const db = getDatabase();
  db.run(
    `CREATE TABLE IF NOT EXISTS nostr_post_log (
       source TEXT PRIMARY KEY,
       event_id TEXT,
       posted_at TEXT NOT NULL
     )`,
  );
  return db;
}

async function dedupSkip(source: string | undefined): Promise<boolean> {
  if (!source) return false;
  const db = await nostrPostLog();
  const prior = db.query("SELECT event_id FROM nostr_post_log WHERE source = ?").get(source) as
    | { event_id: string | null }
    | null;
  if (!prior) return false;
  console.log(`already posted: ${source} (event ${prior.event_id ?? "?"}) — skipping`);
  return true;
}

async function recordPost(source: string, eventId: string | null): Promise<void> {
  const db = await nostrPostLog();
  db.query(
    "INSERT OR IGNORE INTO nostr_post_log (source, event_id, posted_at) VALUES (?, ?, ?)",
  ).run(source, eventId, new Date().toISOString());
}

async function walletEnv(): Promise<{ WALLET_ID: string; WALLET_PASSWORD: string }> {
  const id = await getCredential("bitcoin-wallet", "id");
  const password = await getCredential("bitcoin-wallet", "password");
  if (!id || !password) throw new Error("bitcoin-wallet credentials (id/password) not set");
  return { WALLET_ID: id, WALLET_PASSWORD: password };
}

async function runRunner(runnerArgs: string[]): Promise<{ json: any; raw: string; code: number }> {
  const env = await walletEnv();
  const proc = Bun.spawn(["bun", "run", RUNNER, ...runnerArgs], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  // The runner prints a single JSON line on stdout; tolerate trailing logs.
  const raw = stdout.trim();
  let json: any = null;
  const line = raw.split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (line) {
    try {
      json = JSON.parse(line);
    } catch {
      /* leave null */
    }
  }
  if (!json && stderr.trim()) log(`runner stderr: ${stderr.trim().slice(0, 400)}`);
  return { json, raw, code };
}

async function cmdPost(args: string[]): Promise<void> {
  const content = flag(args, "content");
  const tags = flag(args, "tags");
  const source = flag(args, "source");
  if (!content) {
    process.stderr.write('Usage: nostr post --content "<text>" [--tags a,b] [--source <key>]\n');
    process.exit(1);
  }
  if (await dedupSkip(source)) return; // exactly-once short-circuit, before unlock/publish

  const runnerArgs = ["post", "--content", content];
  if (tags) runnerArgs.push("--tags", tags);
  const { json, code } = await runRunner(runnerArgs);

  if (!json) {
    log(`post failed: no parseable runner output (exit ${code})`);
    process.exit(1);
  }
  if (json.success && source) await recordPost(source, json.eventId ?? null);
  console.log(JSON.stringify(json, null, 2));
  process.exit(json.success ? 0 : 1);
}

async function cmdPubkey(): Promise<void> {
  const { json, code } = await runRunner(["pubkey"]);
  if (!json) {
    log(`pubkey failed (exit ${code})`);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
  process.exit(json.success ? 0 : 1);
}

function printUsage(): void {
  process.stdout.write(
    [
      "nostr — Post kind:1 notes to Nostr relays under Arc's wallet-derived NIP-06 identity",
      "",
      "Commands:",
      '  post    --content <text> [--tags <csv>] [--source <key>]   Publish a kind:1 note',
      "                                                             (--source: re-run is suppressed",
      "                                                              by the local nostr_post_log ledger)",
      "  pubkey                                                     Show Arc's npub + hex pubkey",
      "  help",
      "",
      "Relays: wss://relay.damus.io, wss://nos.lol. Requires bitcoin-wallet credentials.",
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "post":
      await cmdPost(rest);
      break;
    case "pubkey":
      await cmdPubkey();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
