// skills/inbox-notify/sensor.ts
// Batches pending signal notifications into dispatch tasks.
// Runs every 10 minutes. Creates one task per batch of up to 10 messages.

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { insertTaskIfNew } from "../../src/sensors.ts";
import { drainNotifications, countPending } from "./notification-queue.ts";
import type { PendingNotification } from "./notification-queue.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BATCH_DIR = resolve(ROOT, "db/inbox-notify");
const BATCH_SIZE = 10;

export const interval = 10; // minutes

export default async function sensor(): Promise<string> {
  const counts = countPending();
  if (counts.total === 0) return "skip";

  const results: string[] = [];

  // Batch x402 notifications (up to 10 per task)
  if (counts.notify > 0) {
    const batch = drainNotifications("notify", BATCH_SIZE);
    if (batch.length > 0) {
      const taskId = createBatchSendTask(batch);
      results.push(taskId ? `notify batch: ${batch.length} msgs → task #${taskId}` : `notify batch: ${batch.length} msgs (deduped)`);
    }
  }

  // Batch ERC-8004 feedback (up to 10 per task)
  if (counts.feedback > 0) {
    const batch = drainNotifications("erc8004-feedback", BATCH_SIZE);
    if (batch.length > 0) {
      const taskId = createFeedbackBatchTask(batch);
      results.push(taskId ? `feedback batch: ${batch.length} → task #${taskId}` : `feedback batch: ${batch.length} (deduped)`);
    }
  }

  // Batch ERC-8004 nudges (up to 10 per task)
  if (counts.nudge > 0) {
    const batch = drainNotifications("erc8004-nudge", BATCH_SIZE);
    if (batch.length > 0) {
      const taskId = createNudgeBatchTask(batch);
      results.push(taskId ? `nudge batch: ${batch.length} → task #${taskId}` : `nudge batch: ${batch.length} (deduped)`);
    }
  }

  return results.length > 0 ? results.join("; ") : "skip";
}

function createBatchSendTask(batch: PendingNotification[]): number | null {
  // Write batch file for inbox-notify send-batch
  const batchId = `notify-${Date.now()}`;
  const batchFile = resolve(BATCH_DIR, `${batchId}.json`);
  mkdirSync(BATCH_DIR, { recursive: true });

  const batchData = {
    messages: batch.map(n => ({
      btc_address: n.btc_address,
      stx_address: n.stx_address,
      content: n.content,
      label: n.label,
    })),
  };
  writeFileSync(batchFile, JSON.stringify(batchData, null, 2));

  const signalList = batch.map(n => `  - ${n.status}: #${n.signal_id.slice(0, 8)} → ${n.btc_address.slice(0, 16)}…`).join("\n");

  return insertTaskIfNew(`sensor:inbox-notify:${batchId}`, {
    subject: `Send ${batch.length} signal notification(s) (batch ${batchId.slice(-6)})`,
    description: [
      `Batch x402 inbox notifications for ${batch.length} reviewed signal(s).`,
      ``,
      `Run:`,
      `arc skills run --name inbox-notify -- send-batch --file db/inbox-notify/${batchId}.json`,
      ``,
      `Then confirm pending payments:`,
      `arc skills run --name inbox-notify -- confirm-payments --batch-id ${batchId}`,
      ``,
      `Signals:`,
      signalList,
    ].join("\n"),
    priority: 8,
    skills: JSON.stringify(["inbox-notify", "bitcoin-wallet"]),
  });
}

function createFeedbackBatchTask(batch: PendingNotification[]): number | null {
  const batchId = `feedback-${Date.now()}`;

  const steps = batch.map((n, i) => [
    `${i + 1}. Agent ${n.agent_id}: value=${n.reputation_value} (signal ${n.signal_id.slice(0, 8)} ${n.status})`,
    `   bun run reputation/reputation.ts give-feedback --agent-id ${n.agent_id} --value ${n.reputation_value} --tag1 signal-review --tag2 ${n.status} --endpoint "aibtc.news/signals/${n.signal_id}" --sponsored`,
  ].join("\n")).join("\n");

  return insertTaskIfNew(`sensor:inbox-notify:${batchId}`, {
    subject: `Submit ${batch.length} ERC-8004 reputation feedback(s) (batch)`,
    description: [
      `Submit ERC-8004 reputation feedback for ${batch.length} reviewed signal(s).`,
      ``,
      `Steps (run each in ~/github/aibtcdev/skills/):`,
      `First: arc skills run --name bitcoin-wallet -- unlock`,
      ``,
      steps,
      ``,
      `If a single feedback fails, log it and continue to the next. Do not block the batch.`,
    ].join("\n"),
    priority: 8,
    skills: JSON.stringify(["erc8004-identity", "bitcoin-wallet"]),
  });
}

function createNudgeBatchTask(batch: PendingNotification[]): number | null {
  const batchId = `nudge-${Date.now()}`;
  const batchFile = resolve(BATCH_DIR, `${batchId}.json`);
  mkdirSync(BATCH_DIR, { recursive: true });

  const batchData = {
    messages: batch.map(n => ({
      btc_address: n.btc_address,
      stx_address: n.stx_address,
      content: n.content,
      label: n.label,
    })),
  };
  writeFileSync(batchFile, JSON.stringify(batchData, null, 2));

  return insertTaskIfNew(`sensor:inbox-notify:${batchId}`, {
    subject: `Send ${batch.length} ERC-8004 identity nudge(s) (batch)`,
    description: [
      `Batch x402 inbox identity nudges for ${batch.length} unregistered correspondent(s).`,
      ``,
      `Run:`,
      `arc skills run --name inbox-notify -- send-batch --file db/inbox-notify/${batchId}.json`,
    ].join("\n"),
    priority: 8,
    skills: JSON.stringify(["inbox-notify", "bitcoin-wallet"]),
  });
}
