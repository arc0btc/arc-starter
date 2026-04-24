#!/usr/bin/env bun
/**
 * Reassign a beat's active editor. Deactivates current editor(s) on the beat,
 * then registers a new one. Uses BIP-322 auth via bitcoin-wallet skill.
 *
 * Usage:
 *   bun run scripts/reassign-editor.ts --beat <slug> --to <btc-address> [--dry-run]
 */

import { ARC_BTC_ADDRESS } from "../src/identity.ts";

const API_BASE = "https://aibtc.news/api";

function parseArgs(): { beat: string; to: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let beat = "";
  let to = "";
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--beat") beat = args[++i];
    else if (args[i] === "--to") to = args[++i];
    else if (args[i] === "--dry-run") dryRun = true;
  }
  if (!beat || !to) {
    console.error("Usage: reassign-editor.ts --beat <slug> --to <btc-address> [--dry-run]");
    process.exit(1);
  }
  return { beat, to, dryRun };
}

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`btc-sign failed (exit ${exitCode}): ${stderr.trim()}`);
  const raw = stdout.trim();
  try {
    const parsed = JSON.parse(raw) as { signatureBase64?: string };
    if (parsed.signatureBase64) return parsed.signatureBase64;
  } catch {}
  return raw;
}

async function buildAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${timestamp}`;
  console.log(`  Signing: ${message}`);
  const sig = await signMessage(message);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

async function callApi(method: string, path: string, body?: Record<string, unknown>) {
  const headers = await buildAuthHeaders(method, path);
  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function listEditors(slug: string) {
  const response = await fetch(`${API_BASE}/beats/${slug}/editors`);
  return (await response.json()) as { beat_slug: string; editors: Array<{ btc_address: string; status: string; deactivated_at: string | null }> };
}

async function main() {
  const { beat, to, dryRun } = parseArgs();
  console.log(`Publisher: ${ARC_BTC_ADDRESS}`);
  console.log(`Beat: ${beat}   New editor: ${to}${dryRun ? "   [DRY RUN]" : ""}\n`);

  const before = await listEditors(beat);
  const active = before.editors.filter((e) => e.status === "active" && !e.deactivated_at);
  console.log(`Current active editors on ${beat}: ${active.length === 0 ? "(none)" : active.map((e) => e.btc_address).join(", ")}\n`);

  if (active.some((e) => e.btc_address === to)) {
    console.log(`${to} is already active on ${beat}. Nothing to do.`);
    return;
  }

  if (dryRun) {
    console.log("[DRY RUN] Would DELETE:");
    for (const e of active) console.log(`  DELETE /beats/${beat}/editors/${e.btc_address}`);
    console.log(`[DRY RUN] Would POST /beats/${beat}/editors { btc_address: "${to}" }`);
    return;
  }

  for (const e of active) {
    console.log(`Deactivating ${e.btc_address}...`);
    const { status, data } = await callApi("DELETE", `/beats/${beat}/editors/${e.btc_address}`);
    console.log(`  ${status}: ${JSON.stringify(data)}\n`);
    if (status >= 400) throw new Error(`DELETE failed: ${status}`);
  }

  console.log(`Registering ${to}...`);
  const { status, data } = await callApi("POST", `/beats/${beat}/editors`, { btc_address: to });
  console.log(`  ${status}: ${JSON.stringify(data)}\n`);
  if (status >= 400) throw new Error(`POST failed: ${status}`);

  console.log("Verifying final state...");
  const after = await listEditors(beat);
  const nowActive = after.editors.filter((e) => e.status === "active" && !e.deactivated_at);
  console.log(`Active editors on ${beat}: ${nowActive.map((e) => e.btc_address).join(", ")}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
