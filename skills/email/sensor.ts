// skills/email/sensor.ts
//
// Syncs email from arc-email-worker API, detects unread messages, queues tasks.
// Runs every 1 minute via sensor cadence gating.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, getUnreadEmailMessages, type EmailMessage } from "../../src/db.ts";
import { syncEmail } from "./sync.ts";

const SENSOR_NAME = "email";
const INTERVAL_MINUTES = 1;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [email/sensor] ${msg}`);
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
  const unread = getUnreadEmailMessages();
  log(`unread inbox: ${unread.length} message(s)`);

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

    const taskId = insertTask({
      subject: `Email thread from ${senderDisplay} (${senderMessages.length} messages)`,
      description,
      skills: '["email"]',
      priority: 5,
      source,
    });
    log(`created task ${taskId} for thread from ${senderDisplay} (${senderMessages.length} messages)`);
  }

  return "ok";
}
