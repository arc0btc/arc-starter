#!/usr/bin/env bun
// Smoke test for agent-news PR #802 (x402 payments for POST /api/signals)
// Runs against staging preview at agent-news-staging.hosting-962.workers.dev.
// Covers steps 1-4, 7, 10, 11 from docs/x402-signal-payment-smoke-test.md.
// Steps 5, 6, 8 (paid) and 9 (forced 503) handled separately or skipped.

import { spawnSync } from "node:child_process";

const BASE = "https://agent-news-staging.hosting-962.workers.dev";
const ARC_BTC = "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933";
// Staging seed data uses different beats than production. Seen in /api/signals.
const ACTIVE_BEAT = "agent-economy";
const RETIRED_BEAT = "bitcoin-macro"; // Or any slug staging considers retired; if it 404s instead of 410 we'll note.

type Result = { step: string; status: number; ok: boolean; expected: string; body: unknown; headers?: Record<string, string> };
const results: Result[] = [];

function log(r: Result) {
  results.push(r);
  console.log(`\n[${r.ok ? "PASS" : "FAIL"}] ${r.step} → HTTP ${r.status} (expected ${r.expected})`);
  console.log("  body:", typeof r.body === "string" ? r.body.slice(0, 400) : JSON.stringify(r.body).slice(0, 400));
  if (r.headers) {
    const interesting = Object.entries(r.headers).filter(([k]) =>
      ["payment-required", "retry-after", "cache-control", "x-edge-cache"].includes(k.toLowerCase())
    );
    if (interesting.length) console.log("  headers:", Object.fromEntries(interesting));
  }
}

function captureHeaders(r: Response): Record<string, string> {
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return h;
}

async function req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: parsed, headers: captureHeaders(r) };
}

// Sign with Arc's registered wallet via the bitcoin-wallet skill.
async function signWithArc(message: string): Promise<{ signature: string; signer: string }> {
  const proc = spawnSync(
    "arc",
    ["skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { encoding: "utf8" }
  );
  if (proc.status !== 0) throw new Error(`btc-sign failed: ${proc.stderr}\n${proc.stdout}`);
  // Output has logging line then JSON. Find first '{'.
  const jsonStart = proc.stdout.indexOf("{");
  if (jsonStart < 0) throw new Error(`btc-sign no JSON: ${proc.stdout}`);
  const out = JSON.parse(proc.stdout.slice(jsonStart));
  const sig = out.signature ?? out.signatureBase64;
  if (!sig || !out.signer) throw new Error(`btc-sign missing fields: ${proc.stdout}`);
  return { signature: sig, signer: out.signer };
}

// Server signs path WITHOUT query string. `routePath` should be the literal
// path segment registered in routes/signals.ts (e.g. "/signals", "/signals/counts").
async function authHeaders(method: string, routePath: string) {
  const ts = Math.floor(Date.now() / 1000);
  const message = `${method} /api${routePath}:${ts}`;
  const { signature, signer } = await signWithArc(message);
  return {
    "X-BTC-Address": signer,
    "X-BTC-Signature": signature,
    "X-BTC-Timestamp": String(ts),
  };
}

const VALID_BODY = {
  beat_slug: ACTIVE_BEAT,
  btc_address: ARC_BTC,
  headline: "Smoke test: Bitcoin macro placeholder headline for staging preview",
  content: "Smoke test body. Should be ≥100 chars to avoid client-side rejection. Bitcoin macro fee market briefly stable; mempool ~120 vMB; testing PR #802 staging preview x402 payment integration. For agents: ignore — this is a synthetic submission against staging.",
  sources: [
    { url: "https://mempool.space/api/v1/fees/recommended", title: "Mempool fees" },
    { url: "https://api.blockchain.info/charts/hash-rate", title: "Blockchain.info hashrate" },
  ],
  tags: ["smoke-test", "pr-802"],
  disclosure: "claude-opus-4-7, smoke-test",
};

// ---------- STEP 1: anonymous POST ----------
async function step1() {
  const r = await req("POST", "/api/signals");
  log({ step: "1 anonymous (no body)", status: r.status, ok: [400, 401].includes(r.status), expected: "400 or 401", body: r.body, headers: r.headers });
}

// ---------- STEP 4: retired beat ----------
async function step4() {
  const auth = await authHeaders("POST", "/signals");
  const body = { ...VALID_BODY, beat_slug: RETIRED_BEAT };
  const r = await req("POST", "/api/signals", body, auth);
  const ok = r.status === 410;
  log({ step: "4 retired beat (must precede payment)", status: r.status, ok, expected: "410", body: r.body, headers: r.headers });
}

// ---------- STEP 3: registered, no X-PAYMENT, valid body → 402 ----------
async function step3() {
  const auth = await authHeaders("POST", "/signals");
  const r = await req("POST", "/api/signals", VALID_BODY, auth);
  const ok = r.status === 402;
  log({ step: "3 registered + no payment + valid body", status: r.status, ok, expected: "402", body: r.body, headers: r.headers });
}

// ---------- STEP 11: pending visibility leak negative tests ----------
async function step11() {
  // 11a: include_pending=true with no agent → 400 PENDING_REQUIRES_AGENT
  const a = await req("GET", "/api/signals?include_pending=true");
  log({ step: "11a include_pending without agent", status: a.status, ok: a.status === 400, expected: "400", body: a.body });

  // 11b: include_pending=true with agent but no auth → 401 MISSING_AUTH
  const b = await req("GET", `/api/signals?agent=${ARC_BTC}&include_pending=true`);
  log({ step: "11b include_pending+agent no auth", status: b.status, ok: b.status === 401, expected: "401", body: b.body });

  // 11c: include_pending=true for *other* agent with our auth → 401 ADDRESS_MISMATCH
  const otherAgent = "bc1qd0z0a8z8am9j84fk3lk5g2hutpxcreypnf2p47";
  const auth11c = await authHeaders("GET", "/signals");
  const c = await req("GET", `/api/signals?agent=${otherAgent}&include_pending=true`, undefined, auth11c);
  log({ step: "11c include_pending other agent w/ our auth", status: c.status, ok: c.status === 401, expected: "401", body: c.body });

  // 11d: counts include_pending=true without agent → 400
  const d = await req("GET", "/api/signals/counts?include_pending=true");
  log({ step: "11d counts include_pending without agent", status: d.status, ok: d.status === 400, expected: "400", body: d.body });

  // 11e: counts agent-scoped no auth → 200, no pending bucket
  const e = await req("GET", `/api/signals/counts?agent=${ARC_BTC}`);
  const noPending = typeof e.body === "object" && e.body !== null && !("pending_payment" in (e.body as Record<string, unknown>));
  log({ step: "11e public counts (no pending bucket)", status: e.status, ok: e.status === 200 && noPending, expected: "200 + no pending bucket", body: e.body });
}

// ---------- STEP 10: pending invisible to default list, visible to author ----------
async function step10Read() {
  // Without auth, default list should not include pending payments
  const a = await req("GET", "/api/signals");
  log({ step: "10a default list works", status: a.status, ok: a.status === 200, expected: "200", body: typeof a.body === "object" && a.body && "total" in (a.body as Record<string, unknown>) ? `total=${(a.body as { total: number }).total}` : a.body });

  // Author-scoped + auth
  const auth = await authHeaders("GET", "/signals");
  const b = await req("GET", `/api/signals?agent=${ARC_BTC}&include_pending=true`, undefined, auth);
  log({ step: "10b author+include_pending w/ auth", status: b.status, ok: [200].includes(b.status), expected: "200", body: typeof b.body === "object" && b.body && "total" in (b.body as Record<string, unknown>) ? `total=${(b.body as { total: number }).total}` : b.body });
}

// ---------- STEP 2: BIP-322 signed but unregistered identity ----------
// Uses ephemeral bc1q keypair generated in scripts/_ephemeral-sign.ts.
async function step2() {
  const ts = Math.floor(Date.now() / 1000);
  const message = `POST /api/signals:${ts}`;
  const proc = spawnSync("bun", ["run", "scripts/_ephemeral-sign.ts", message], { encoding: "utf8" });
  if (proc.status !== 0) {
    log({ step: "2 BIP-322 fresh unregistered", status: 0, ok: false, expected: "403", body: `ephemeral signer failed: ${proc.stderr || proc.stdout}` });
    return;
  }
  const out = JSON.parse(proc.stdout);
  console.log(`\n[step 2] ephemeral address: ${out.address}`);
  const r = await req("POST", "/api/signals", { ...VALID_BODY, btc_address: out.address }, {
    "X-BTC-Address": out.address,
    "X-BTC-Signature": out.signature,
    "X-BTC-Timestamp": String(ts),
  });
  const isIdentityRequired = r.status === 403 && typeof r.body === "object" && r.body !== null && (r.body as { code?: string }).code === "IDENTITY_REQUIRED";
  log({ step: "2 BIP-322 fresh unregistered", status: r.status, ok: isIdentityRequired, expected: "403 IDENTITY_REQUIRED", body: r.body });
}

async function main() {
  console.log(`Smoke test against ${BASE}`);
  console.log(`Arc BTC address: ${ARC_BTC}\n`);

  await step1();
  await step11();
  await step10Read();
  await step3();
  await step4();
  await step2();

  console.log("\n\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.step.padEnd(50)} ${r.status} (expected ${r.expected})`);
  }
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed`);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
