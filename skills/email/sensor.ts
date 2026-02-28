// skills/email/sensor.ts
//
// Syncs email from arc-email-worker API, detects unread messages, queues tasks.
// Runs every 1 minute via sensor cadence gating.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, getUnreadEmailMessages, markEmailRead, type EmailMessage } from "../../src/db.ts";
import { syncEmail, getEmailCredentials } from "./sync.ts";

const SENSOR_NAME = "email";
const INTERVAL_MINUTES = 1;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [email/sensor] ${msg}`);
}

// --- Noise filter ---
// Auto-dismiss GitHub automated notifications that don't need a dispatch cycle.
// Matches: CI run results, Dependabot PRs, GitHub account alerts, push notifications.

const NOISE_SENDERS = new Set([
  "notifications@github.com", // CI run results (Actions)
]);

const NOISE_SUBJECT_PATTERNS: RegExp[] = [
  /\bRun (failed|passed|cancelled|completed)\b/i,    // GitHub Actions CI
  /\bdependabot\b/i,                                  // Dependabot PRs
  /\[GitHub\]/i,                                       // GitHub account notifications (SSH keys, etc.)
  /Your GitHub launch code/i,                          // Onboarding spam
];

function isNoiseEmail(msg: EmailMessage): boolean {
  // All emails from notifications@github.com are CI noise
  if (NOISE_SENDERS.has(msg.from_address)) return true;

  // Check subject patterns against any sender
  const subject = msg.subject ?? "";
  return NOISE_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
}

async function markReadQuietly(remoteId: string, apiBaseUrl: string, adminKey: string): Promise<void> {
  markEmailRead(remoteId);
  try {
    await fetch(`${apiBaseUrl}/api/messages/${remoteId}/read`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey },
    });
  } catch {
    // Best-effort remote mark — local is already done
  }
}

export default async function emailSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Sync from email worker API
  const stats = await syncEmail();

  if (stats.errors.length > 0) {
    log(`sync had ${stats.errors.length} error(s): ${stats.errors[0]}`);
  }

  // Check for unread inbox messages
  const allUnread = getUnreadEmailMessages();
  log(`unread inbox: ${allUnread.length} message(s)`);

  if (allUnread.length === 0) return "ok";

  // Filter out GitHub automated noise — mark as read without creating tasks
  const noise = allUnread.filter(isNoiseEmail);
  const unread = allUnread.filter((msg) => !isNoiseEmail(msg));

  if (noise.length > 0) {
    log(`filtering ${noise.length} noise email(s) — marking as read`);
    let creds: { apiBaseUrl: string; adminKey: string } | null = null;
    try {
      creds = await getEmailCredentials();
    } catch {
      log("could not load email credentials for remote mark-read — local only");
    }
    for (const msg of noise) {
      log(`  noise: [${msg.from_address}] ${msg.subject ?? "(no subject)"}`);
      if (creds) {
        await markReadQuietly(msg.remote_id, creds.apiBaseUrl, creds.adminKey);
      } else {
        markEmailRead(msg.remote_id);
      }
    }
  }

  if (unread.length === 0) return "ok";

  // Group unread messages by sender
  const threadsBySender = new Map<string, EmailMessage[]>();
  for (const msg of unread) {
    const existing = threadsBySender.get(msg.from_address);
    if (existing) {
      existing.push(msg);
    } else {
      threadsBySender.set(msg.from_address, [msg]);
    }
  }

  // Queue one task per sender thread
  for (const [senderAddr, senderMessages] of threadsBySender) {
    const source = `sensor:email:thread:${senderAddr}`;

    if (pendingTaskExistsForSource(source)) {
      log(`task already exists for source "${source}" — skipping`);
      continue;
    }

    const senderDisplay = senderMessages[0].from_name ?? senderAddr;

    // Build message list (oldest first, already sorted by getUnreadEmailMessages)
    const messageLines: string[] = [];
    const remoteIds: string[] = [];
    for (const msg of senderMessages) {
      remoteIds.push(msg.remote_id);
      messageLines.push(
        `--- Email ${msg.remote_id} ---`,
        `Subject: ${msg.subject ?? "(no subject)"}`,
        `To: ${msg.to_address}`,
        `Received: ${msg.received_at}`,
        `Preview: ${msg.body_preview ?? "(no body)"}`,
        "",
      );
    }

    const description = [
      "Read skills/email/AGENT.md before acting.",
      "",
      `Email thread from ${senderDisplay} (${senderMessages.length} unread message${senderMessages.length > 1 ? "s" : ""}) in Arc's inbox (arc@arc0.me / arc@arc0btc.com):`,
      "",
      `From: ${senderDisplay}${senderMessages[0].from_name ? ` <${senderAddr}>` : ""}`,
      `Remote IDs: ${remoteIds.join(", ")}`,
      "",
      "Unread messages (oldest first):",
      "",
      ...messageLines,
      "Instructions:",
      "1. Read full message bodies if needed: arc skills run --name email -- fetch --id <remote_id>",
      "2. Consider all messages together before deciding how to respond.",
      "3. Decide if these emails need a reply, action, or can be marked as read.",
      "4. If replying: arc skills run --name email -- send --to <addr> --subject <subj> --body <text>",
      "5. Mark EACH message as read after handling: arc skills run --name email -- mark-read --id <remote_id>",
      "6. If any email asks you to DO something, create a follow-up task.",
    ].join("\n");

    // whoabuddy's time is the scarcest resource — prioritize their emails
    const priority = senderAddr === "whoabuddy@gmail.com" ? 1 : 5;

    const taskId = insertTask({
      subject: `Email thread from ${senderDisplay} (${senderMessages.length} messages)`,
      description,
      skills: '["email"]',
      priority,
      source,
    });
    log(`created task ${taskId} for thread from ${senderDisplay} (${senderMessages.length} messages)`);
  }

  return "ok";
}
