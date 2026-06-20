/**
 * live-read-moltbook-capability.ts — P7 Moltbook capability preflight
 * Read-only. Checks: creds present, account profile readable, claim confirmed,
 * existing post read-back, checkout_config moltbook row, owner dashboard status.
 * Prints PASS/FAIL per check. Writes capability JSON artifact.
 *
 * Usage: bun run live-read-moltbook-capability.ts <path-to-db>
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

function existsSync(p: string): boolean {
  try { return Bun.file(p).size >= 0; } catch { return false; }
}

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run live-read-moltbook-capability.ts <path-to-db>");
  process.exit(1);
}

const CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD!;
const BASE = "https://www.moltbook.com/api/v1";
// Known existing post from probe (ba8ebe71 — "Agent-First URLs: A Proposal", 4 upvotes)
const KNOWN_POST_ID = "ba8ebe71-f62e-4636-ad14-0dea9ddb6771";

const utcNow = new Date().toISOString();

async function getCred(service: string, key: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["/home/dev/.local/bin/arc", "creds", "get", "--service", service, "--key", key],
      { env: { ...process.env, ARC_CREDS_PASSWORD: CREDS_PASSWORD } }
    );
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function moltbookGet(path: string, apiKey: string | null): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;
const checks: Array<{ name: string; result: string; detail: string }> = [];

function check(name: string, ok: boolean, detail: string) {
  const result = ok ? "PASS" : "FAIL";
  if (ok) { passed++; console.log(`  PASS: ${name} — ${detail}`); }
  else { failed++; console.error(`  FAIL: ${name} — ${detail}`); }
  checks.push({ name, result, detail });
}

console.log("=== live-read-moltbook-capability.ts ===");
console.log(`UTC: ${utcNow}`);
console.log(`DB: ${dbPath}`);

// ── DB checks ──────────────────────────────────────────────────────────────
const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=3000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
check("DB user_version >= 6 (P7 migration applied)", user_version >= 6, `user_version=${user_version}`);

const moltbookRow = db.query(
  "SELECT product_id, a_param, full_checkout_url FROM checkout_config WHERE product_id='moltbook'"
).get() as any;
check(
  "checkout_config has moltbook row",
  !!moltbookRow,
  moltbookRow
    ? `a_param=${moltbookRow.a_param}, url=${moltbookRow.full_checkout_url}`
    : "row not found"
);
check(
  "moltbook checkout_config a_param='moltbook'",
  moltbookRow?.a_param === "moltbook",
  moltbookRow?.a_param ?? "missing"
);
check(
  "moltbook labeled link is observed-class (no whop_sale rows)",
  db.query("SELECT COUNT(*) as cnt FROM whop_sale WHERE a_param='moltbook'").get<{ cnt: number }>()!.cnt === 0,
  "no whop_sale rows with a_param=moltbook"
);

db.close();

// ── Credential checks ──────────────────────────────────────────────────────
const apiKey = await getCred("moltbook", "api_key");
const agentName = await getCred("moltbook", "agent_name");
const agentId = await getCred("moltbook", "agent_id");
const claimUrl = await getCred("moltbook", "claim_url");

check("moltbook/api_key present in VM creds", !!apiKey, apiKey ? `[${apiKey.length} chars]` : "missing");
check("moltbook/agent_name present", !!agentName, agentName ?? "missing");
check("moltbook/agent_id present", !!agentId, agentId ?? "missing");
check("moltbook/claim_url present", !!claimUrl, claimUrl ?? "missing");

// ── Public API checks (no auth required) ──────────────────────────────────
const profile = await moltbookGet(`/agents/profile?name=${agentName ?? "arcBTC"}`, null);
check(
  "GET /agents/profile?name=arcBTC → 200",
  profile.status === 200,
  `http_status=${profile.status}`
);

const claimed = profile.data?.agent?.is_claimed === true;
check(
  "arcBTC is_claimed=true (claim complete)",
  claimed,
  claimed ? "is_claimed=true" : `is_claimed=${profile.data?.agent?.is_claimed}`
);

const karma = profile.data?.agent?.karma ?? 0;
const postCount = profile.data?.agent?.posts_count ?? 0;
const followerCount = profile.data?.agent?.follower_count ?? 0;
checks.push({
  name: "arcBTC profile baseline (informational)",
  result: "INFO",
  detail: `karma=${karma}, posts=${postCount}, followers=${followerCount}`
});
console.log(`  INFO: arcBTC baseline — karma=${karma}, posts=${postCount}, followers=${followerCount}`);

// ── Existing post read-back (proves GET /posts/{id} works) ─────────────────
const postReadBack = await moltbookGet(`/posts/${KNOWN_POST_ID}`, apiKey);
const postReadBackOk = postReadBack.status === 200 && postReadBack.data?.success === true;
check(
  `GET /posts/${KNOWN_POST_ID} read-back → 200`,
  postReadBackOk,
  postReadBackOk
    ? `title="${postReadBack.data?.post?.title?.substring(0, 50)}"`
    : `http_status=${postReadBack.status}`
);
check(
  "read-back post provider_post_id matches",
  postReadBackOk && postReadBack.data?.post?.id === KNOWN_POST_ID,
  postReadBackOk ? `id confirmed: ${KNOWN_POST_ID}` : "post not readable"
);

// ── Owner dashboard status (determines if POST /posts is available) ────────
let ownerDashboardReady = false;
let ownerDashboardDetail = "";
if (apiKey) {
  const meResp = await moltbookGet("/agents/me", apiKey);
  ownerDashboardReady = meResp.status === 200;
  ownerDashboardDetail = ownerDashboardReady
    ? `GET /agents/me → 200 (READY — POST /posts available)`
    : `GET /agents/me → ${meResp.status} (NEEDS_OWNER_SETUP: visit https://www.moltbook.com/help/connect-account)`;
}
check(
  "Owner dashboard setup complete (required for POST /posts)",
  ownerDashboardReady,
  ownerDashboardDetail
);

// ── Kill switch check ─────────────────────────────────────────────────────
const dbCheck = new Database(dbPath);
const killSwitch = dbCheck.query(
  "SELECT value FROM agent_config WHERE key='outbound_enabled'"
).get() as { value: string } | null;
dbCheck.close();
const killSwitchOk = killSwitch?.value === "true";
check(
  "Kill switch outbound_enabled=true",
  killSwitchOk,
  killSwitch ? `outbound_enabled=${killSwitch.value}` : "key not found"
);

// ── Summary ────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n=== CAPABILITY SUMMARY ===`);
console.log(`UTC: ${utcNow}`);
console.log(`${passed}/${total} PASS | ${failed} FAIL`);
if (!ownerDashboardReady) {
  console.log(`\nCHECKPOINT: Owner dashboard not set up.`);
  console.log(`  → Visit https://www.moltbook.com/help/connect-account`);
  console.log(`  → Setup email was sent to jason@joinfreehold.com at 2026-06-20T00:23:10Z`);
  console.log(`  → After setup, run live-send-moltbook-post.ts to send the labeled post`);
}

// ── Write capability evidence JSON ────────────────────────────────────────
// Write to /tmp on VM; the calling script or operator scps it back to the planning repo.
const evidenceDir = process.env.EVIDENCE_DIR ?? "/tmp/p7-evidence";
if (existsSync(evidenceDir) || true) {
  mkdirSync(evidenceDir, { recursive: true });
  const evidenceFile = join(evidenceDir, `capability-${utcNow.split("T")[0]}.json`);
  const evidence = {
    script: "live-read-moltbook-capability.ts",
    utc: utcNow,
    db_path: dbPath,
    user_version,
    agent_name: agentName,
    agent_id: agentId,
    claim_url: claimUrl,
    api_key_present: !!apiKey,
    is_claimed: claimed,
    karma,
    posts_count: postCount,
    followers: followerCount,
    known_post_read_back: {
      post_id: KNOWN_POST_ID,
      ok: postReadBackOk,
      title: postReadBack.data?.post?.title ?? null
    },
    owner_dashboard_ready: ownerDashboardReady,
    owner_dashboard_detail: ownerDashboardDetail,
    kill_switch_enabled: killSwitchOk,
    checkout_config_moltbook: moltbookRow ?? null,
    checks_passed: passed,
    checks_failed: failed,
    checks
  };
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written: ${evidenceFile}`);
}

if (failed > 0 && failed > (ownerDashboardReady ? 0 : 1)) {
  // Only exit non-zero if something other than the owner dashboard check failed
  // Owner dashboard failure is expected and documented
  process.exit(1);
}
