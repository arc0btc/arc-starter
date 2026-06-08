#!/usr/bin/env bun
// skills/arc-email-sync/cli.ts
// Unified CLI for the email skill.
// Usage: arc skills run --name email -- <subcommand> [flags]

import { initDatabase, markEmailRead, archiveOldEmails } from "../../src/db.ts";
import { syncEmail, getEmailCredentials } from "./sync.ts";

// ---- Helpers ----

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [email/cli] ${message}`);
}

const BOOLEAN_FLAGS = new Set(["force"]);

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = "true";
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[key] = args[i + 1];
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
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fwd|Fw):\s*/i, "")
    .trim()
    .toLowerCase();
}

interface SentMessage {
  id: string;
  to_address: string;
  subject: string | null;
  received_at: string;
}

interface SentApiResponse {
  ok: boolean;
  data?: { messages: SentMessage[]; total: number };
  error?: { code: string; message: string };
}

async function findRecentSentDuplicate(
  apiBaseUrl: string,
  adminKey: string,
  to: string,
  subject: string,
  windowMs: number,
): Promise<SentMessage | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const url = `${apiBaseUrl}/api/messages?folder=sent&since=${encodeURIComponent(since)}&limit=50`;

  const response = await fetch(url, {
    headers: { "X-Admin-Key": adminKey, Accept: "application/json" },
  });

  if (!response.ok) {
    log(`WARNING: sent-folder dedup check failed: HTTP ${response.status} — skipping dedup`);
    return null;
  }

  const body = (await response.json()) as SentApiResponse;
  if (!body.ok || !body.data) {
    log(`WARNING: sent-folder dedup check returned unexpected shape — skipping dedup`);
    return null;
  }

  const normalizedTarget = normalizeSubject(subject);
  const toNorm = to.toLowerCase().trim();

  for (const message of body.data.messages) {
    if (
      message.to_address.toLowerCase().trim() === toNorm &&
      message.subject !== null &&
      normalizeSubject(message.subject) === normalizedTarget
    ) {
      return message;
    }
  }
  return null;
}

async function cmdSend(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.to || !flags.subject || (!flags.body && !flags["body-html"])) {
    process.stderr.write("Usage: arc skills run --name email -- send --to <addr> --subject <subj> --body <text> [--body-html <html>] [--from <addr>] [--in-reply-to <message-id>] [--force]\n");
    process.exit(1);
  }

  if (flags.from && !APPROVED_SENDERS.has(flags.from)) {
    process.stderr.write(`Error: --from '${flags.from}' is not an approved sender. Approved: ${[...APPROVED_SENDERS].join(", ")}\n`);
    process.exit(1);
  }

  if (flags.from && flags.from !== DEFAULT_SENDER) {
    log(`WARNING: using non-default sender '${flags.from}' (default is '${DEFAULT_SENDER}')`);
  }

  const { apiBaseUrl, adminKey } = await getEmailCredentials();

  // Dedup guard: skip send if an identical email was already sent within the dedup window
  if (!flags.force) {
    const duplicate = await findRecentSentDuplicate(
      apiBaseUrl,
      adminKey,
      flags.to,
      flags.subject,
      DEDUP_WINDOW_MS,
    );
    if (duplicate) {
      log(`deduped: already sent to ${flags.to} with subject "${flags.subject}" at ${duplicate.received_at} (id: ${duplicate.id}) — skipping. Use --force to override.`);
      console.log(JSON.stringify({ success: true, deduped: true, existing_id: duplicate.id, sent_at: duplicate.received_at }, null, 2));
      return;
    }
  } else {
    log(`--force set: bypassing dedup check`);
  }

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
  console.log(JSON.stringify({ success: true, deduped: false, ...result }, null, 2));
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
  send --to <addr> --subject <subj> --body <text> [--body-html <html>] [--from <addr>] [--in-reply-to <message-id>] [--force]
    Send an email via the email worker API. Use --body-html for HTML emails.
    Use --in-reply-to to thread replies.
    Dedup guard: skips send if an identical (same to + subject) email was sent within the last 60 minutes.
    Use --force to bypass dedup and send regardless.

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
