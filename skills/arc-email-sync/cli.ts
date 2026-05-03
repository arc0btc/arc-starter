#!/usr/bin/env bun
// skills/arc-email-sync/cli.ts
// Unified CLI for the email skill.
// Usage: arc skills run --name email -- <subcommand> [flags]

import { initDatabase, markEmailRead, archiveOldEmails } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { syncEmail, getEmailCredentials } from "./sync.ts";

// ---- Helpers ----

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [email/cli] ${message}`);
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

const APPROVED_SENDERS = new Set([
  "arc@arc0.me",
  "arc@arc0btc.com",
  "topaz_centaur@agentslovebitcoin.com",
  "forge@agentslovebitcoin.com",
]);
const DEFAULT_SENDER = "arc@arc0.me";

async function cmdSendViaResend(flags: Record<string, string>): Promise<void> {
  const apiKey = await getCredential("resend", "api_key");
  const fromAddress = await getCredential("resend", "from_address");
  if (!apiKey || !fromAddress) {
    process.stderr.write("Error: Resend credentials not set. Run:\n  arc creds set --service resend --key api_key --value <key>\n  arc creds set --service resend --key from_address --value arc@arc0btc.com\n");
    process.exit(1);
  }

  const from = flags.from || fromAddress;
  const payload: Record<string, string> = {
    from,
    to: flags.to,
    subject: flags.subject,
  };
  if (flags.body) payload.text = flags.body;
  if (flags["body-html"]) payload.html = flags["body-html"];
  if (flags["reply-to"]) payload.reply_to = flags["reply-to"];

  log(`[resend] sending to ${flags.to}: "${flags.subject}"`);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    log(`[resend] send failed: HTTP ${response.status}`);
    console.log(JSON.stringify({ success: false, status: response.status, error: result }, null, 2));
    process.exit(1);
  }

  log("[resend] send successful");
  console.log(JSON.stringify({ success: true, id: result.id, via: "resend" }, null, 2));
}

async function cmdSend(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.to || !flags.subject || (!flags.body && !flags["body-html"])) {
    process.stderr.write("Usage: arc skills run --name email -- send --to <addr> --subject <subj> --body <text> [--body-html <html>] [--from <addr>] [--via resend|worker] [--in-reply-to <message-id>]\n");
    process.exit(1);
  }

  if (flags.via === "resend") {
    await cmdSendViaResend(flags);
    return;
  }

  if (flags.from && !APPROVED_SENDERS.has(flags.from)) {
    process.stderr.write(`Error: --from '${flags.from}' is not an approved sender. Approved: ${[...APPROVED_SENDERS].join(", ")}\n`);
    process.exit(1);
  }

  if (flags.from && flags.from !== DEFAULT_SENDER) {
    log(`WARNING: using non-default sender '${flags.from}' (default is '${DEFAULT_SENDER}')`);
  }

  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  const payload: Record<string, string> = {
    to: flags.to,
    subject: flags.subject,
  };
  if (flags.body) {
    payload.body = flags.body;
  }
  if (flags["body-html"]) {
    payload.body_html = flags["body-html"];
  }
  if (flags.from) {
    payload.from = flags.from;
  }
  if (flags["in-reply-to"]) {
    payload.in_reply_to = flags["in-reply-to"];
  }

  log(`sending to ${flags.to}: "${flags.subject}"`);

  const response = await fetch(`${apiBaseUrl}/api/send`, {
    method: "POST",
    headers: {
      "X-Admin-Key": adminKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    log(`send failed: HTTP ${response.status}`);
    console.log(JSON.stringify({ success: false, status: response.status, error: result }, null, 2));
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

  const response = await fetch(`${apiBaseUrl}/api/messages/${remoteId}/read`, {
    method: "POST",
    headers: { "X-Admin-Key": adminKey },
  });

  if (!response.ok) {
    const body = await response.text();
    log(`remote mark-read failed: HTTP ${response.status} — ${body}`);
    console.log(JSON.stringify({ success: true, local: true, remote: false, error: `HTTP ${response.status}` }));
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

  const response = await fetch(`${apiBaseUrl}/api/stats`, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
  });

  if (!response.ok) {
    process.stderr.write(`HTTP ${response.status} from email worker\n`);
    process.exit(1);
  }

  const result = await response.json();
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

  const response = await fetch(`${apiBaseUrl}/api/messages/${remoteId}`, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
  });

  if (!response.ok) {
    process.stderr.write(`HTTP ${response.status} from email worker\n`);
    process.exit(1);
  }

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
}

async function cmdArchive(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const daysStr = flags.days || "7";
  const days = parseInt(daysStr, 10);

  if (isNaN(days) || days < 1) {
    process.stderr.write("Usage: arc skills run --name email -- archive [--days <N>]\nDefault: 7 days\n");
    process.exit(1);
  }

  initDatabase();
  const result = archiveOldEmails(days);
  log(`archived ${result.archived} email(s) older than ${days} day(s)`);
  console.log(JSON.stringify({ success: true, archived: result.archived, days }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`email CLI

USAGE
  arc skills run --name email -- <subcommand> [flags]

SUBCOMMANDS
  send --to <addr> --subject <subj> --body <text> [--body-html <html>] [--from <addr>] [--in-reply-to <message-id>]
    Send an email via the email worker API. Use --body-html for HTML emails.
    Use --in-reply-to to thread replies.

  mark-read --id <remote_id>
    Mark an email as read (local DB + remote worker).

  sync
    Run a manual sync from the email worker API.

  stats
    Fetch inbox/sent stats from the email worker API.

  fetch --id <remote_id>
    Fetch full message body from the email worker API.

  archive [--days <N>]
    Archive stale email threads older than N days (default: 7).

EXAMPLES
  arc skills run --name email -- send --to user@example.com --subject "Hello" --body "Hi there."
  arc skills run --name email -- mark-read --id abc123
  arc skills run --name email -- sync
  arc skills run --name email -- stats
  arc skills run --name email -- fetch --id abc123
  arc skills run --name email -- archive --days 7
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
    case "archive":
      await cmdArchive(args.slice(1));
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
