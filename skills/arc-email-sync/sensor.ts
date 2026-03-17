// skills/arc-email-sync/sensor.ts
//
// Syncs email from arc-email-worker API, detects unread messages, queues tasks.
// Runs every 1 minute via sensor cadence gating.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource, getUnreadEmailMessages, markEmailRead, hasSentEmailTo, insertWorkflow, getWorkflowByInstanceKey, updateWorkflowState, getEmailThreadCountBySenderAndSubject, type EmailMessage } from "../../src/db.ts";
import { syncEmail, getEmailCredentials } from "./sync.ts";
import { isGateStopped, resetDispatchGate } from "../../src/dispatch-gate.ts";

const SENSOR_NAME = "arc-email-sync";
const INTERVAL_MINUTES = 1;

const log = createSensorLogger(SENSOR_NAME);

// --- Noise filter ---
// Auto-dismiss GitHub automated notifications that don't need a dispatch cycle.
// Matches: CI run results, Dependabot PRs, GitHub account alerts, push notifications.

const NOISE_SENDERS = new Set([
  "notifications@github.com", // CI run results (Actions)
  "noreply@github.com",       // PR/release notifications, dependabot, release-please
]);

const NOISE_SUBJECT_PATTERNS: RegExp[] = [
  /\bRun (failed|passed|cancelled|completed)\b/i,    // GitHub Actions CI
  /\bdependabot\b/i,                                  // Dependabot PRs
  /\[GitHub\]/i,                                       // GitHub account notifications (SSH keys, etc.)
  /Your GitHub launch code/i,                          // Onboarding spam
  /Pull request.*?(opened|closed|merged|reopened)/i, // PR lifecycle
  /\brelease(d?)[\s-]?(please|created|published)\b/i, // Release automation
  /Review (requested|required) on/i,                  // PR review notifications
];

/** Strip Re:/Fwd:/Fw: prefixes and normalize for thread grouping. */
function normalizeSubject(subject: string | null): string {
  if (!subject) return "(no subject)";
  return subject.replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "").trim().toLowerCase() || "(no subject)";
}

function isNoiseEmail(email: EmailMessage): boolean {
  // All emails from notifications@github.com are CI noise
  if (NOISE_SENDERS.has(email.from_address)) return true;

  // Check subject patterns against any sender
  const subject = email.subject ?? "";
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

  // --- Dispatch gate restart via email ---
  // If gate is stopped, check for a RESTART command from whoabuddy
  if (isGateStopped() && allUnread.length > 0) {
    const RESTART_RE = /\bRESTART\b/;
    const restartEmail = allUnread.find(
      (email) => email.from_address === "whoabuddy@gmail.com" &&
        (RESTART_RE.test(email.subject ?? "") || RESTART_RE.test(email.body_preview ?? "")),
    );
    if (restartEmail) {
      log(`RESTART command received from whoabuddy (email ${restartEmail.remote_id}) — resetting dispatch gate`);
      resetDispatchGate();
      // Mark the restart email as read
      let creds: { apiBaseUrl: string; adminKey: string } | null = null;
      try { creds = await getEmailCredentials(); } catch { /* local-only fallback */ }
      if (creds) {
        await markReadQuietly(restartEmail.remote_id, creds.apiBaseUrl, creds.adminKey);
      } else {
        markEmailRead(restartEmail.remote_id);
      }
    }
  }

  if (allUnread.length === 0) return "ok";

  // Filter out GitHub automated noise — mark as read without creating tasks
  const noise = allUnread.filter(isNoiseEmail);
  const unread = allUnread.filter((email) => !isNoiseEmail(email));

  if (noise.length > 0) {
    log(`filtering ${noise.length} noise email(s) — marking as read`);
    let creds: { apiBaseUrl: string; adminKey: string } | null = null;
    try {
      creds = await getEmailCredentials();
    } catch {
      log("could not load email credentials for remote mark-read — local only");
    }
    for (const email of noise) {
      log(`  noise: [${email.from_address}] ${email.subject ?? "(no subject)"}`);
      if (creds) {
        await markReadQuietly(email.remote_id, creds.apiBaseUrl, creds.adminKey);
      } else {
        markEmailRead(email.remote_id);
      }
    }
  }

  if (unread.length === 0) return "ok";

  // Group unread messages by sender + normalized subject (thread key).
  // Stripping Re:/Fwd: prefixes ensures replies land in the same thread.
  const threadsByKey = new Map<string, EmailMessage[]>();
  for (const email of unread) {
    const threadKey = `${email.from_address}:${normalizeSubject(email.subject)}`;
    const existing = threadsByKey.get(threadKey);
    if (existing) {
      existing.push(email);
    } else {
      threadsByKey.set(threadKey, [email]);
    }
  }

  // Queue one task per sender+subject thread
  for (const [threadKey, senderMessages] of threadsByKey) {
    const senderAddr = senderMessages[0].from_address;
    const source = `sensor:arc-email-sync:thread:${threadKey}`;

    if (pendingTaskExistsForSource(source)) {
      log(`task already exists for source "${source}" — skipping`);
      continue;
    }

    // Check if Arc already replied to this sender after the NEWEST unread message.
    // Using oldest was too aggressive — a reply to an early message suppressed
    // all later unread messages from the same sender (even on different topics).
    const newestReceivedAt = senderMessages[senderMessages.length - 1].received_at; // sorted ASC
    if (hasSentEmailTo(senderAddr, newestReceivedAt)) {
      log(`already replied to ${senderAddr} since ${newestReceivedAt} — skipping task creation`);
      // Advance any open workflow for this thread to reply_sent
      const senderSlug = senderAddr.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
      const firstRemoteId = senderMessages[0].remote_id;
      const workflowKey = `email-thread-${senderSlug}-${firstRemoteId}`;
      const workflow = getWorkflowByInstanceKey(workflowKey);
      if (workflow && workflow.current_state !== "reply_sent" && workflow.current_state !== "completed") {
        updateWorkflowState(workflow.id, "reply_sent", workflow.context);
        log(`advanced workflow ${workflowKey} → reply_sent`);
      }
      continue;
    }

    const rawSenderDisplay = senderMessages[0].from_name ?? senderAddr;
    const senderDisplay = rawSenderDisplay.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 80);

    // Build message list (oldest first, already sorted by getUnreadEmailMessages)
    const messageLines: string[] = [];
    const remoteIds: string[] = [];
    const recipientAddresses = new Set<string>();
    for (const email of senderMessages) {
      remoteIds.push(email.remote_id);
      recipientAddresses.add(email.to_address);
      const lines = [
        `--- Email ${email.remote_id} ---`,
        `Subject: ${email.subject ?? "(no subject)"}`,
        `To: ${email.to_address}`,
        `Received: ${email.received_at}`,
      ];
      if (email.message_id) lines.push(`Message-ID: ${email.message_id}`);
      lines.push(
        `Preview: ${email.body_preview ?? "(no body)"}`,
        "",
      );
      messageLines.push(...lines);
    }

    // Build recipient display (show all recipient addresses and identify agent)
    const recipientsList = Array.from(recipientAddresses).sort();
    const recipientDisplay = recipientsList.join(" / ");
    const isSparkEmail = recipientsList.some((addr) => addr.includes("spark@"));
    const agentLabel = isSparkEmail ? "Spark's" : "Arc's";
    const inboxLabel = recipientsList.length === 1 ? `${agentLabel} inbox (${recipientsList[0]})` : `${agentLabel} inbox (${recipientDisplay})`;

    const description = [
      "Read skills/arc-email-sync/AGENT.md before acting.",
      "",
      `Email thread from ${senderDisplay} (${senderMessages.length} unread message${senderMessages.length > 1 ? "s" : ""}) in ${inboxLabel}:`,
      "",
      `From: ${senderDisplay}${senderMessages[0].from_name ? ` <${senderAddr}>` : ""}`,
      `Remote IDs: ${remoteIds.join(", ")}`,
      "",
      "Unread messages (oldest first):",
      "",
      ...messageLines,
      "Instructions:",
      "1. Read full message bodies if needed: arc skills run --name arc-email-sync -- fetch --id <remote_id>",
      "2. Consider all messages together before deciding how to respond.",
      "3. Decide if these emails need a reply, action, or can be marked as read.",
      "4. If replying: arc skills run --name arc-email-sync -- send --to <addr> --subject <subj> --body <text> --in-reply-to <Message-ID>",
      "5. Mark EACH message as read after handling: arc skills run --name arc-email-sync -- mark-read --id <remote_id>",
      "6. If any email asks you to DO something, create a follow-up task.",
    ].join("\n");

    // whoabuddy's time is the scarcest resource — highest priority
    // spark@arc0.me (agent helper) — high priority for coordination
    const priority =
      senderAddr === "whoabuddy@gmail.com" ? 1 :
      senderAddr === "spark@arc0me.typeform.com" ? 3 : 5;

    // whoabuddy emails are P1 — let priority-based model routing apply (Opus, 30min timeout)
    // rather than capping at sonnet's 15min, which is too short for complex implementation tasks
    const model = senderAddr === "whoabuddy@gmail.com" ? "opus" : "haiku";

    // Enrich skills based on content keywords (subject + body previews)
    const contentForKeywords = senderMessages
      .map((m) => `${m.subject ?? ""} ${m.body_preview ?? ""}`)
      .join(" ")
      .toLowerCase();
    const extraEmailSkills: string[] = [];
    if (/multisig|taproot|musig|bip-340|bip-342/.test(contentForKeywords)) {
      extraEmailSkills.push("bitcoin-taproot-multisig");
    }
    if (/\bworktree\b/.test(contentForKeywords)) {
      extraEmailSkills.push("arc-worktrees");
    }
    if (/manage.?skills|skill.?manager/.test(contentForKeywords)) {
      extraEmailSkills.push("arc-skill-manager");
    }
    if (/\bx402\b|agent.*payment|payment.*agent/.test(contentForKeywords)) {
      extraEmailSkills.push("social-agent-engagement");
    }
    if (/\bbudget\b|\bcost alert\b|\bspend\b|\boverspend\b/.test(contentForKeywords)) {
      extraEmailSkills.push("arc-cost-alerting");
    }
    if (/aibtc.?news|news.?brief|news.?editorial/.test(contentForKeywords)) {
      extraEmailSkills.push("aibtc-news-editorial");
    }
    if (/web.?dashboard|dashboard.*arc|arc.*dashboard/.test(contentForKeywords)) {
      extraEmailSkills.push("arc-web-dashboard");
    }
    const emailSkills = ["arc-email-sync", ...extraEmailSkills];

    // Compute total thread depth (inbox messages matching this sender + normalized subject)
    const normalizedSubj = normalizeSubject(senderMessages[0].subject);
    const totalThreadCount = getEmailThreadCountBySenderAndSubject(senderAddr, normalizedSubj);
    const depthLabel = `(${senderMessages.length} unread${totalThreadCount > senderMessages.length ? `, ${totalThreadCount} total` : ""})`;

    const senderLabel =
      senderAddr === "whoabuddy@gmail.com" ? "Email from whoabuddy" :
      `External email from ${senderDisplay}`;

    const taskId = insertTask({
      subject: `${senderLabel} ${depthLabel}: ${(senderMessages[0].subject ?? "(no subject)").slice(0, 55)}`,
      description,
      skills: JSON.stringify(emailSkills),
      priority,
      model,
      source,
    });
    log(`created task ${taskId} for thread from ${senderLabel} (${senderMessages.length} unread, ${totalThreadCount} total)`);

    // Auto-suggest starting a new conversation thread when depth is >= 15
    if (totalThreadCount >= 15) {
      const suggestSource = `sensor:arc-email-sync:suggest-new-thread:${senderAddr}`;
      if (!pendingTaskExistsForSource(suggestSource)) {
        const suggestId = insertTask({
          subject: `[Email] Consider new thread with ${senderDisplay} (${totalThreadCount} messages deep)`,
          description: [
            `The email conversation with ${senderDisplay} (${senderAddr}) has grown to ${totalThreadCount} total messages.`,
            "",
            "Long threads can become unwieldy for email clients and harder to follow.",
            `Consider proactively starting a fresh subject line in the next reply to ${senderDisplay}`,
            "to create a new thread anchor. You don't need to do anything now — this is an advisory note.",
            "",
            `View the thread in the dashboard: /email`,
          ].join("\n"),
          skills: JSON.stringify(["arc-email-sync"]),
          priority: 8,
          model: "haiku",
          source: suggestSource,
          parent_id: taskId,
        });
        log(`created new-thread suggestion task ${suggestId} for ${senderAddr} (${totalThreadCount} messages)`);
      }
    }

    // Create an email-thread workflow instance so the lifecycle can be tracked
    // beyond task completion (reply_pending → completed flow).
    // Start in "triaged" since the sensor already handles task creation.
    const senderSlug = senderAddr.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40);
    const firstRemoteId = remoteIds[0];
    const workflowKey = `email-thread-${senderSlug}-${firstRemoteId}`;
    if (!getWorkflowByInstanceKey(workflowKey)) {
      const firstSubject = senderMessages[0].subject ?? "";
      insertWorkflow({
        template: "email-thread",
        instance_key: workflowKey,
        current_state: "triaged",
        context: JSON.stringify({
          sender: senderDisplay,
          subject: firstSubject,
          messageCount: senderMessages.length,
          source: "arc-email-sync",
          needsReply: false,
        }),
      });
      log(`created email-thread workflow ${workflowKey}`);
    }
  }

  return "ok";
}
