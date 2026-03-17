#!/usr/bin/env bun
// skills/arc-email-sync/cli.ts
// Unified CLI for the email skill.
// Usage: arc skills run --name email -- <subcommand> [flags]

import { initDatabase, markEmailRead } from "../../src/db.ts";
import { syncEmail, getEmailCredentials, sendEmail, type SendEmailPayload } from "./sync.ts";
import { toHtmlEmail } from "../arc-report-email/html.ts";
import { parseFlags } from "../../src/utils.ts";

// ---- Helpers ----

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [email/cli] ${message}`);
}

// ---- Subcommands ----

async function cmdSend(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);

  if (!flags.to || !flags.subject || !flags.body) {
    process.stderr.write("Usage: arc skills run --name email -- send --to <addr> --subject <subj> --body <text> [--from <addr>] [--in-reply-to <message-id>] [--html <html-string>] [--attachment <path.html>]\n");
    process.exit(1);
  }

  // Auto-generate HTML from body text unless explicit --html provided
  const htmlBody = flags.html ?? toHtmlEmail(flags.body, flags.subject, "Arc");

  const payload: SendEmailPayload = {
    to: flags.to,
    subject: flags.subject,
    body: flags.body,
    html: htmlBody,
  };
  if (flags.from) payload.from = flags.from;
  if (flags["in-reply-to"]) payload.in_reply_to = flags["in-reply-to"];
  if (flags.attachment) {
    const filePath = flags.attachment;
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      process.stderr.write(`Error: attachment file not found: ${filePath}\n`);
      process.exit(1);
    }
    const content = await file.text();
    const filename = filePath.split("/").pop() ?? "attachment.html";
    const contentType = filePath.endsWith(".html") || filePath.endsWith(".htm")
      ? "text/html"
      : "application/octet-stream";
    payload.attachments = [{ filename, content: Buffer.from(content).toString("base64"), content_type: contentType }];
    log(`attaching ${filename} (${contentType}, ${content.length} bytes)`);
  }

  log(`sending to ${flags.to}: "${flags.subject}"`);

  try {
    await sendEmail(payload);
    log("send successful");
    console.log(JSON.stringify({ success: true }, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`send failed: ${errorMessage}`);
    console.log(JSON.stringify({ success: false, error: errorMessage }, null, 2));
    process.exit(1);
  }
}

async function cmdMarkRead(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
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
  const { flags } = parseFlags(args);
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

function printUsage(): void {
  process.stdout.write(`email CLI

USAGE
  arc skills run --name email -- <subcommand> [flags]

SUBCOMMANDS
  send --to <addr> --subject <subj> --body <text> [--from <addr>] [--in-reply-to <message-id>] [--html <html-string>] [--attachment <path>]
    Send an email via the email worker API. HTML is auto-generated from --body (markdown supported).
    Use --html to supply explicit HTML body. Use --in-reply-to to thread replies.
    Use --attachment to attach an HTML file.

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
  arc skills run --name email -- send --to user@example.com --subject "Report" --body "See attached." --attachment ./report.html
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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
