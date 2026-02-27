// skills/email/sensor.ts
//
// Syncs email from arc-email-worker API, detects unread messages, queues tasks.
// Runs every 1 minute via sensor cadence gating.

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource, getUnreadEmailMessages } from "../../src/db.ts";
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

  // Queue a task for the oldest unread message
  const msg = unread[0];
  const senderDisplay = msg.from_name ?? msg.from_address;
  const subjectPreview = msg.subject?.slice(0, 50) ?? "(no subject)";
  const source = `sensor:email:${msg.remote_id}`;

  log(`oldest unread: remote_id=${msg.remote_id} from=${senderDisplay}`);

  if (pendingTaskExistsForSource(source)) {
    log(`task already exists for source "${source}" — skipping`);
    return "ok";
  }

  const description = [
    "Read skills/email/AGENT.md before acting.",
    "",
    "New email in Arc's inbox (arc@arc0.me / arc@arc0btc.com):",
    "",
    `Remote ID: ${msg.remote_id}`,
    `From: ${senderDisplay}${msg.from_name ? ` <${msg.from_address}>` : ""}`,
    `To: ${msg.to_address}`,
    `Subject: ${msg.subject ?? "(no subject)"}`,
    `Received: ${msg.received_at}`,
    "",
    "Preview:",
    msg.body_preview ?? "(no body)",
    "",
    "Instructions:",
    "1. Read the full message body if needed: arc skills run --name email -- fetch --id <remote_id>",
    "2. Decide if this email needs a reply, action, or can be marked as read.",
    "3. If replying: arc skills run --name email -- send --to <addr> --subject <subj> --body <text>",
    "4. Mark the message as read after handling: arc skills run --name email -- mark-read --id <remote_id>",
    "5. If the email asks you to DO something, create a follow-up task.",
    `6. There are ${unread.length - 1} other unread email(s) after this one.`,
  ].join("\n");

  const taskId = insertTask({
    subject: `Email from ${senderDisplay}: ${subjectPreview}`,
    description,
    skills: '["email"]',
    priority: 5,
    source,
  });
  log(`created task ${taskId} for email ${msg.remote_id}`);

  return "ok";
}
