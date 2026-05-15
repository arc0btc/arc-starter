#!/usr/bin/env bun
/**
 * trading-comp skill CLI — competition-aware submit primitive + metrics access.
 *
 * Usage:
 *   arc skills run --name trading-comp -- submit --txid <txid> [--source <label>]
 *   arc skills run --name trading-comp -- metrics [--show]
 */

import { resolve } from "node:path";

const API_BASE =
  process.env.AIBTC_CAMPAIGN_API_URL ?? "https://aibtc.com/api/competition";
const TIMEOUT_MS = 10_000;
const METRICS_PATH = resolve(import.meta.dir, "metrics.md");

function createAlertTask(step: string, errorMsg: string, txid?: string): void {
  const txidNote = txid ? ` txid=${txid}` : "";
  const subject = `[ALERT] trading-comp submit failed at ${step}${txidNote}`;
  const description = `Step: ${step}\nError: ${errorMsg}${txid ? `\nTxid: ${txid}` : ""}\n\nNo retry. Resolve manually.`;
  const result = Bun.spawnSync(
    [
      "arc", "tasks", "add",
      "--subject", subject,
      "--description", description,
      "--priority", "2",
      "--model", "opus",
      "--skills", "trading-comp",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    console.error(`[trading-comp] WARNING: failed to create alert task: ${stderr}`);
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function normalizeTxid(txid: string): string {
  const trimmed = txid.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      `Invalid Stacks txid: expected 64 hex chars (with optional 0x prefix), got ${JSON.stringify(txid)}`
    );
  }
  return withPrefix.toLowerCase();
}

type SubmitResult = {
  ok: boolean;
  txid: string;
  source: string;
  response: unknown;
  submitted_at: string;
};

async function submitTxid(txid: string, source: string): Promise<SubmitResult> {
  const normalized = normalizeTxid(txid);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/trades`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txid: normalized }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const msg = `Competition submit failed (${response.status}): ${
      typeof parsed === "string" ? parsed : JSON.stringify(parsed)
    }`;
    createAlertTask("competition-post", msg, normalized);
    throw new Error(msg);
  }
  return {
    ok: true,
    txid: normalized,
    source,
    response: parsed,
    submitted_at: new Date().toISOString(),
  };
}

const [, , command, ...rest] = process.argv;
const flags = parseFlags(rest);

if (!command) {
  console.error(
    "Usage: bun skills/trading-comp/cli.ts <submit|metrics> [flags]"
  );
  process.exit(1);
}

try {
  if (command === "submit") {
    if (!flags.txid) {
      console.error("Error: --txid is required");
      process.exit(1);
    }
    const source = flags.source ?? "manual";
    let normalizedForAlert: string | undefined;
    try {
      normalizedForAlert = normalizeTxid(flags.txid);
    } catch (validationErr) {
      const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
      createAlertTask("txid-validation", msg);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    const result = await submitTxid(normalizedForAlert, source);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "metrics") {
    const file = Bun.file(METRICS_PATH);
    if (!(await file.exists())) {
      console.error(`metrics file not found: ${METRICS_PATH}`);
      process.exit(1);
    }
    if (flags.show) {
      console.log(await file.text());
    } else {
      console.log(JSON.stringify({ path: METRICS_PATH }, null, 2));
    }
  } else {
    console.error(`Unknown command: ${command}. Use: submit, metrics`);
    process.exit(1);
  }
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
