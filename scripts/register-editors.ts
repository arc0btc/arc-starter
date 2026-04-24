#!/usr/bin/env bun
/**
 * HISTORICAL — initial editor-seat setup script (2026-04-13).
 *
 * Registers Elegant Orb / Ivory Coda / Zen Rocket on the three active beats
 * and sets per-beat review-rate config. Those seats are retired as of
 * 2026-04-24 under the EIC trial (#634); do NOT run this to reassign editors.
 *
 * For editor reassignment, use: scripts/reassign-editor.ts --beat <slug> --to <btc>
 *
 * Kept in-repo as a record of how the original editor registration was set up.
 * Re-running would append Orb/Coda onto beats that currently have DC active,
 * leaving a two-editor state on the platform.
 */

import { ARC_BTC_ADDRESS } from "../src/identity.ts";

const API_BASE = "https://aibtc.news/api";

// ---- Auth helpers (same pattern as editorial cli.ts) ----

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`btc-sign failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  const raw = stdout.trim();
  if (!raw) {
    throw new Error(`btc-sign returned empty output. stderr: ${stderr.trim()}`);
  }

  // btc-sign returns JSON with signatureBase64 field
  try {
    const parsed = JSON.parse(raw) as { signatureBase64?: string };
    if (parsed.signatureBase64) {
      return parsed.signatureBase64;
    }
  } catch {
    // Fall through — maybe it returned raw signature
  }

  return raw;
}

async function buildAuthHeaders(
  method: string,
  path: string
): Promise<Record<string, string>> {
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

async function callApi(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const headers = await buildAuthHeaders(method, path);
  const url = `${API_BASE}${path}`;

  const options: RequestInit = {
    method,
    headers,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();
  return { status: response.status, data };
}

// ---- Editor registrations ----

const EDITORS = [
  {
    beat: "aibtc-network",
    name: "Elegant Orb",
    btc_address: "bc1qhm82hzvfhfuqkeazhsx8p82gm64klymssejslg",
  },
  {
    beat: "bitcoin-macro",
    name: "Ivory Coda",
    btc_address: "bc1qlk749zmklfzm54hcmjs5vr2j6q4h5zddjc6yjm",
  },
];

const ALL_BEATS = ["aibtc-network", "bitcoin-macro", "quantum"];

// ---- Main ----

async function main(): Promise<void> {
  console.log(`Publisher address: ${ARC_BTC_ADDRESS}\n`);

  // Step 1: Check current editor status on all beats
  console.log("=== Checking current editor registrations ===\n");
  for (const slug of ALL_BEATS) {
    const url = `${API_BASE}/beats/${slug}/editors`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      console.log(`  ${slug}: ${JSON.stringify(data)}`);
    } else {
      console.log(`  ${slug}: ${response.status} ${response.statusText}`);
    }
  }

  // Step 2: Register editors
  console.log("\n=== Registering editors ===\n");
  for (const editor of EDITORS) {
    console.log(`Registering ${editor.name} on ${editor.beat}...`);
    const { status, data } = await callApi(
      "POST",
      `/beats/${editor.beat}/editors`,
      { btc_address: editor.btc_address }
    );
    console.log(`  Response ${status}: ${JSON.stringify(data)}\n`);
  }

  // Step 3: Set editor_review_rate_sats and daily_approved_limit on all beats
  console.log("=== Setting beat configuration ===\n");
  for (const slug of ALL_BEATS) {
    console.log(`Configuring ${slug}...`);
    const { status, data } = await callApi(
      "PATCH",
      `/beats/${slug}`,
      {
        btc_address: ARC_BTC_ADDRESS,
        editor_review_rate_sats: 175000,
        daily_approved_limit: 10,
      }
    );
    console.log(`  Response ${status}: ${JSON.stringify(data)}\n`);
  }

  // Step 4: Verify final state
  console.log("=== Verifying final state ===\n");
  for (const slug of ALL_BEATS) {
    const url = `${API_BASE}/beats/${slug}/editors`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      console.log(`  ${slug} editors: ${JSON.stringify(data)}`);
    } else {
      console.log(`  ${slug}: ${response.status} ${response.statusText}`);
    }
  }

  // Check beat config
  console.log("\n=== Beat configuration ===\n");
  const beatsResponse = await fetch(`${API_BASE}/beats`);
  if (beatsResponse.ok) {
    const beats = (await beatsResponse.json()) as Array<Record<string, unknown>>;
    for (const beat of beats) {
      if (ALL_BEATS.includes(beat.slug as string)) {
        console.log(`  ${beat.slug}: daily_approved_limit=${beat.daily_approved_limit}, editor_review_rate_sats=${beat.editor_review_rate_sats}`);
      }
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
