#!/usr/bin/env bun
// skills/email/cli.ts
// Unified CLI for the email skill.
// Usage: arc skills run --name email -- <subcommand> [flags]

import { initDatabase, markEmailRead } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { syncEmail, getEmailCredentials } from "./sync.ts";

// ---- Helpers ----

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [email/cli] ${msg}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

// ---- Subcommands ----

async function cmdSend(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.to || !flags.subject || !flags.body) {
    process.stderr.write("Usage: arc skills run --name email -- send --to <addr> --subject <subj> --body <text> [--from <addr>]\n");
    process.exit(1);
  }

  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  const payload: Record<string, string> = {
    to: flags.to,
    subject: flags.subject,
    body: flags.body,
  };
  if (flags.from) {
    payload.from = flags.from;
  }

  log(`sending to ${flags.to}: "${flags.subject}"`);

  const res = await fetch(`${apiBaseUrl}/api/send`, {
    method: "POST",
    headers: {
      "X-Admin-Key": adminKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  if (!res.ok) {
    log(`send failed: HTTP ${res.status}`);
    console.log(JSON.stringify({ success: false, status: res.status, error: result }, null, 2));
    process.exit(1);
  }

  log("send successful");
  console.log(JSON.stringify({ success: true, ...result }, null, 2));
}

async function cmdMarkRead(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const remoteId = flags.id;

  if (!remoteId) {
    process.stderr.write("Usage: arc skills run --name email -- mark-read --id <remote_id>\n");
    process.exit(1);
  }

  initDatabase();

  // Mark locally
  markEmailRead(remoteId);
  log(`marked ${remoteId} as read locally`);

  // Mark on remote worker
  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  const res = await fetch(`${apiBaseUrl}/api/messages/${remoteId}/read`, {
    method: "POST",
    headers: { "X-Admin-Key": adminKey },
  });

  if (!res.ok) {
    const body = await res.text();
    log(`remote mark-read failed: HTTP ${res.status} — ${body}`);
    console.log(JSON.stringify({ success: true, local: true, remote: false, error: `HTTP ${res.status}` }));
  } else {
    log(`marked ${remoteId} as read on remote worker`);
    console.log(JSON.stringify({ success: true, local: true, remote: true }));
  }
}

async function cmdSync(): Promise<void> {
  initDatabase();
  const stats = await syncEmail();
  console.log(JSON.stringify(stats, null, 2));
}

async function cmdStats(): Promise<void> {
  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  const res = await fetch(`${apiBaseUrl}/api/stats`, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
  });

  if (!res.ok) {
    process.stderr.write(`HTTP ${res.status} from email worker\n`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(JSON.stringify(result, null, 2));
}

async function cmdFetch(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const remoteId = flags.id;

  if (!remoteId) {
    process.stderr.write("Usage: arc skills run --name email -- fetch --id <remote_id>\n");
    process.exit(1);
  }

  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  const res = await fetch(`${apiBaseUrl}/api/messages/${remoteId}`, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
  });

  if (!res.ok) {
    process.stderr.write(`HTTP ${res.status} from email worker\n`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(JSON.stringify(result, null, 2));
}

function printUsage(): void {
  process.stdout.write(`email CLI

USAGE
  arc skills run --name email -- <subcommand> [flags]

SUBCOMMANDS
  send --to <addr> --subject <subj> --body <text> [--from <addr>]
    Send an email via the email worker API.

  mark-read --id <remote_id>
    Mark an email as read (local DB + remote worker).

  sync
    Run a manual sync from the email worker API.

  stats
    Fetch inbox/sent stats from the email worker API.

  fetch --id <remote_id>
    Fetch full message body from the email worker API.

EXAMPLES
  arc skills run --name email -- send --to user@example.com --subject "Hello" --body "Hi there."
  arc skills run --name email -- mark-read --id abc123
  arc skills run --name email -- sync
  arc skills run --name email -- stats
  arc skills run --name email -- fetch --id abc123
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "send":
      await cmdSend(args.slice(1));
      break;
    case "mark-read":
      await cmdMarkRead(args.slice(1));
      break;
    case "sync":
      await cmdSync();
      break;
    case "stats":
      await cmdStats();
      break;
    case "fetch":
      await cmdFetch(args.slice(1));
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

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
