// skills/arc0btc-pr-review/sensor.ts
//
// Detects completed paid PR review tasks and queues on-chain ERC-8004
// attestation tasks. Runs every 10 minutes.
//
// Detection strategy:
// 1. Query tasks completed in the last 2 hours
// 2. Filter for paid PR review tasks (source matches arc-payments/stacks-payments or paid:pr-review)
// 3. Skip any already attested (tracked in hook state)
// 4. Queue a P8/Haiku task per review to submit ERC-8004 give-feedback

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "pr-review-attestation";
const INTERVAL_MINUTES = 10;
const LOOKBACK_HOURS = 2;
const TASK_SOURCE_PREFIX = "sensor:pr-review-attestation";

const log = createSensorLogger(SENSOR_NAME);

interface CompletedTask {
  id: number;
  subject: string;
  description: string | null;
  source: string | null;
  result_summary: string | null;
  result_detail: string | null;
  completed_at: string;
}

/** Return true if this task is a completed paid PR review. */
function isPaidPrReview(task: CompletedTask): boolean {
  const src = task.source ?? "";
  // Stacks payment path: sensor:arc-payments:<txid> (or legacy sensor:stacks-payments:<txid>) where subject contains PR Review
  if (src.startsWith("sensor:arc-payments:") || src.startsWith("sensor:stacks-payments:")) {
    const subj = task.subject.toLowerCase();
    return subj.includes("pr review") || subj.includes("pr-review") || subj.includes("pull request");
  }
  // Web API path: paid:pr-review:<owner>/<repo>#<number>
  if (src.startsWith("paid:pr-review:")) {
    return true;
  }
  return false;
}

/**
 * Extract payer Stacks address from task description.
 * Stacks payment tasks embed "Sender: <address>" in description.
 */
function extractSender(task: CompletedTask): string | null {
  const description = task.description ?? "";
  const match = description.match(/Sender:\s*(S[A-Z0-9]{38,})/);
  return match ? match[1] : null;
}

/**
 * Extract PR URL from task description or source.
 * Web path embeds it in source as paid:pr-review:owner/repo#N.
 */
function extractPrContext(task: CompletedTask): string {
  const src = task.source ?? "";
  if (src.startsWith("paid:pr-review:")) {
    const ref = src.replace("paid:pr-review:", "");
    return `github:${ref}`;
  }
  // Stacks path: look for PR URL in description
  const description = task.description ?? "";
  const match = description.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
  if (match) return match[0];
  return `task:${task.id}`;
}

function getRecentCompletedPrReviews(): CompletedTask[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT id, subject, description, source, result_summary, result_detail, completed_at
       FROM tasks
       WHERE status = 'completed'
         AND completed_at > datetime('now', '-${LOOKBACK_HOURS} hours')
       ORDER BY completed_at DESC
       LIMIT 50`
    )
    .all() as CompletedTask[];
}

export default async function prReviewAttestationSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const hookState = await readHookState(SENSOR_NAME);
  const attestedKeys = new Set<string>(
    (hookState?.attested_task_ids as number[])?.map(String) ?? []
  );

  const tasks = getRecentCompletedPrReviews();
  const reviews = tasks.filter(isPaidPrReview);

  log(`found ${reviews.length} completed paid PR review(s) in last ${LOOKBACK_HOURS}h`);

  let queued = 0;
  for (const task of reviews) {
    const key = String(task.id);
    if (attestedKeys.has(key)) continue;

    const sender = extractSender(task);
    const prContext = extractPrContext(task);

    const description = [
      `Submit ERC-8004 on-chain attestation for completed paid PR review (task #${task.id}).`,
      ``,
      `PR review task: #${task.id} — "${task.subject}"`,
      `PR context: ${prContext}`,
      ...(sender ? [`Requester Stacks address: ${sender}`] : []),
      `Completed at: ${task.completed_at}`,
      ``,
      `Steps:`,
      `1. Look up the requester's ERC-8004 agent ID via contacts skill (search by Stacks address or name)`,
      `2. If agent ID found: submit on-chain feedback:`,
      `   arc skills run --name reputation -- give-feedback \\`,
      `     --agent-id <erc8004-agent-id> \\`,
      `     --value 5 \\`,
      `     --tag1 pr-review \\`,
      `     --tag2 paid-service \\`,
      `     --endpoint "${prContext}" \\`,
      `     --sponsored`,
      `3. If no ERC-8004 agent ID found: log the gap and close as completed (attestation skipped — no on-chain identity)`,
      `4. Record outcome in result_summary`,
    ].join("\n");

    const source = `${TASK_SOURCE_PREFIX}:task:${task.id}`;
    const result = insertTaskIfNew(source, {
      subject: `Submit ERC-8004 attestation: PR review task #${task.id}`,
      description,
      skills: '["erc8004-reputation", "contacts"]',
      priority: 8,
      model: "haiku",
    });

    if (result !== null) {
      queued++;
      log(`queued attestation task for PR review #${task.id} (${prContext})`);
    }

    attestedKeys.add(key);
  }

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (hookState?.version as number ?? 0) + 1,
    attested_task_ids: [...attestedKeys].map(Number).slice(-200),
  });

  log(`run complete — ${queued} attestation task(s) queued`);
  return "ok";
}
