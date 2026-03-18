// skills/arc0btc-security-audit/sensor.ts
//
// Detects completed paid security audit tasks and queues on-chain ERC-8004
// attestation tasks. Runs every 10 minutes.
//
// Detection strategy:
// 1. Query tasks completed in the last 2 hours
// 2. Filter for paid security audit tasks (source matches paid:security-audit)
// 3. Skip any already attested (tracked in hook state)
// 4. Queue a P8/Haiku task per audit to submit ERC-8004 give-feedback

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "security-audit-attestation";
const INTERVAL_MINUTES = 10;
const LOOKBACK_HOURS = 2;
const TASK_SOURCE_PREFIX = "sensor:security-audit-attestation";

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

/** Return true if this task is a completed paid security audit. */
function isPaidSecurityAudit(task: CompletedTask): boolean {
  const src = task.source ?? "";
  // Web API path: paid:security-audit:<owner>/<repo>
  if (src.startsWith("paid:security-audit:")) {
    return true;
  }
  // Stacks payment path: sensor:arc-payments:<txid> where subject contains Security Audit
  if (src.startsWith("sensor:arc-payments:") || src.startsWith("sensor:stacks-payments:")) {
    const subj = task.subject.toLowerCase();
    return subj.includes("security audit") || subj.includes("security-audit");
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
 * Extract repo context from task source.
 * Web path embeds it as paid:security-audit:owner/repo.
 */
function extractRepoContext(task: CompletedTask): string {
  const src = task.source ?? "";
  if (src.startsWith("paid:security-audit:")) {
    const ref = src.replace("paid:security-audit:", "");
    return `github:${ref}`;
  }
  // Stacks path: look for repo URL in description
  const description = task.description ?? "";
  const match = description.match(/https:\/\/github\.com\/[^\s]+/);
  if (match) return match[0];
  return `task:${task.id}`;
}

function getRecentCompletedAudits(): CompletedTask[] {
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

export default async function securityAuditAttestationSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const hookState = await readHookState(SENSOR_NAME);
  const attestedKeys = new Set<string>(
    (hookState?.attested_task_ids as number[])?.map(String) ?? []
  );

  const tasks = getRecentCompletedAudits();
  const audits = tasks.filter(isPaidSecurityAudit);

  log(`found ${audits.length} completed paid security audit(s) in last ${LOOKBACK_HOURS}h`);

  let queued = 0;
  for (const task of audits) {
    const key = String(task.id);
    if (attestedKeys.has(key)) continue;

    const sender = extractSender(task);
    const repoContext = extractRepoContext(task);

    const description = [
      `Submit ERC-8004 on-chain attestation for completed paid security audit (task #${task.id}).`,
      ``,
      `Security audit task: #${task.id} — "${task.subject}"`,
      `Repo context: ${repoContext}`,
      ...(sender ? [`Requester Stacks address: ${sender}`] : []),
      `Completed at: ${task.completed_at}`,
      ``,
      `Steps:`,
      `1. Look up the requester's ERC-8004 agent ID via contacts skill (search by Stacks address or name)`,
      `2. If agent ID found: submit on-chain feedback:`,
      `   arc skills run --name reputation -- give-feedback \\`,
      `     --agent-id <erc8004-agent-id> \\`,
      `     --value 5 \\`,
      `     --tag1 security-audit \\`,
      `     --tag2 paid-service \\`,
      `     --endpoint "${repoContext}" \\`,
      `     --sponsored`,
      `3. If no ERC-8004 agent ID found: log the gap and close as completed (attestation skipped — no on-chain identity)`,
      `4. Record outcome in result_summary`,
    ].join("\n");

    const source = `${TASK_SOURCE_PREFIX}:task:${task.id}`;
    const result = insertTaskIfNew(source, {
      subject: `Submit ERC-8004 attestation: security audit task #${task.id}`,
      description,
      skills: '["erc8004-reputation", "contacts"]',
      priority: 8,
      model: "haiku",
    });

    if (result !== null) {
      queued++;
      log(`queued attestation task for security audit #${task.id} (${repoContext})`);
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
