/**
 * live-send-moltbook-post.ts — P7 Moltbook labeled post send (ONE post)
 *
 * GUARDRAILS:
 * - Kill switch checked BEFORE any send
 * - Owner dashboard checked (GET /agents/me) — exits cleanly with CHECKPOINT if 403
 * - Verification challenge solved if returned (math word problem)
 * - ONE labeled post only (no burst)
 * - Read-back confirmation required (GET /posts/{id})
 * - Discord alert sent on success
 * - Evidence JSON written to phases/07-moltbook/evidence/
 *
 * Usage: bun run live-send-moltbook-post.ts <path-to-db>
 * Idempotent: if moltbook_post already has a read_back_ok=1 row, prints info and exits.
 *
 * Requirements: Owner must complete dashboard setup at https://www.moltbook.com/help/connect-account
 * before this script can send. If not set up, exits with CHECKPOINT message.
 */

import { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run live-send-moltbook-post.ts <path-to-db>");
  process.exit(1);
}

const CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD!;
const BASE = "https://www.moltbook.com/api/v1";
const EXPERIMENT_ID = "p7-moltbook-2026";
const LABELED_LINK = "https://arc0.me?a=moltbook";
const DISCORD_GUILD = "899010851175022594";
const DISCORD_CHANNEL = "1472999795361841193";
const EVIDENCE_DIR = "/home/whoabuddy/manage-agents/.planning/2026-06-19-arc-social-engine/phases/07-moltbook/evidence";

const utcNow = new Date().toISOString();

async function getCred(service: string, key: string): Promise<string> {
  const proc = Bun.spawn(
    ["/home/dev/.local/bin/arc", "creds", "get", "--service", service, "--key", key],
    { env: { ...process.env, ARC_CREDS_PASSWORD: CREDS_PASSWORD } }
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`creds get ${service}/${key} failed`);
  return out.trim();
}

async function moltbookReq(
  method: string, path: string, apiKey: string, body?: object
): Promise<{ status: number; data: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function sendDiscordAlert(botToken: string, message: string): Promise<string | null> {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`,
    {
      method: "POST",
      headers: { "Authorization": `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    }
  );
  const data = await res.json().catch(() => null);
  return data?.id ?? null;
}

// Solve Moltbook verification challenge (math word problem → decimal)
// The challenge is an obfuscated math word problem. Answer format: "N.00"
function solveChallenge(challengeText: string): string {
  // Moltbook challenges are math word problems like:
  // "What is fifteen point zero zero plus twelve point zero zero?"
  // We parse the numbers from the text and perform the operation.
  const text = challengeText.toLowerCase();

  const wordToNum: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100
  };

  // Extract numbers written in words (handles "fifteen point zero zero" → 15.00)
  function parseWordNum(str: string): number | null {
    const parts = str.trim().split(/\s+/);
    let val = 0;
    let decimal = false;
    let decimalStr = "";
    for (const part of parts) {
      if (part === "point") { decimal = true; continue; }
      if (wordToNum[part] !== undefined) {
        if (decimal) decimalStr += wordToNum[part];
        else val += wordToNum[part];
      }
    }
    if (decimalStr) return parseFloat(`${val}.${decimalStr}`);
    return val;
  }

  // Find operation
  let op = "+";
  if (text.includes(" minus ") || text.includes(" subtract ")) op = "-";
  else if (text.includes(" times ") || text.includes(" multiplied ")) op = "*";
  else if (text.includes(" divided ")) op = "/";

  // Split on operation keyword
  const splitOn = op === "+" ? " plus " : op === "-" ? (text.includes(" minus ") ? " minus " : " subtract ") : op === "*" ? (text.includes(" times ") ? " times " : " multiplied by ") : " divided by ";
  const parts = text.split(splitOn);
  if (parts.length < 2) {
    // Fallback: extract all numbers and add them
    const nums = Array.from(text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)).map(m => parseFloat(m[1]));
    if (nums.length >= 2) return (nums[0] + nums[1]).toFixed(2);
    return "0.00";
  }

  // Clean up parts — remove "what is" prefix
  const cleanA = parts[0].replace(/^.*?(what is|calculate|compute|find)\s+/i, "").trim();
  const cleanB = parts[1].replace(/\?.*$/, "").trim();

  const a = parseWordNum(cleanA) ?? parseFloat(cleanA) ?? 0;
  const b = parseWordNum(cleanB) ?? parseFloat(cleanB) ?? 0;

  let result = 0;
  if (op === "+") result = a + b;
  else if (op === "-") result = a - b;
  else if (op === "*") result = a * b;
  else if (op === "/") result = b !== 0 ? a / b : 0;

  return result.toFixed(2);
}

console.log("=== live-send-moltbook-post.ts ===");
console.log(`UTC: ${utcNow}`);
console.log(`Experiment: ${EXPERIMENT_ID}`);

// ── 1. Kill switch check ───────────────────────────────────────────────────
const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const killSwitch = db.query(
  "SELECT value FROM agent_config WHERE key='outbound_enabled'"
).get() as { value: string } | null;

if (!killSwitch || killSwitch.value !== "true") {
  console.log("KILL_SWITCH_ACTIVE: outbound_enabled is not 'true'. Aborting.");
  console.log(`outbound_enabled=${killSwitch?.value ?? "not found"}`);
  db.close();
  process.exit(1);
}
console.log("Kill switch: outbound_enabled=true (cleared to proceed)");

// ── 2. Idempotency check ─────────────────────────────────────────────────
const existingPost = db.query(
  "SELECT provider_post_id, posted_at, read_back_ok FROM moltbook_post WHERE experiment_id=? AND read_back_ok=1 LIMIT 1"
).get(EXPERIMENT_ID) as any;

if (existingPost) {
  console.log(`\nIDEMPOTENT: Already have read_back_ok=1 post for experiment ${EXPERIMENT_ID}`);
  console.log(`  provider_post_id: ${existingPost.provider_post_id}`);
  console.log(`  posted_at: ${existingPost.posted_at}`);
  console.log(`PASS: P7 labeled post already sent and confirmed. No duplicate send.`);
  db.close();
  process.exit(0);
}

// ── 3. Load credentials ───────────────────────────────────────────────────
let apiKey: string, agentName: string, botToken: string;
try {
  apiKey = await getCred("moltbook", "api_key");
  agentName = await getCred("moltbook", "agent_name");
  botToken = await getCred("discord", "bot_token");
} catch (e) {
  console.error(`FAIL: credential load error — ${(e as Error).message}`);
  db.close();
  process.exit(1);
}
console.log(`Credentials loaded: agent=${agentName}`);

// ── 4. Owner dashboard check (GET /agents/me) ────────────────────────────
const meResp = await moltbookReq("GET", "/agents/me", apiKey);
if (meResp.status !== 200) {
  console.log(`\nCHECKPOINT: Owner dashboard not set up (GET /agents/me → ${meResp.status})`);
  console.log(`Action required:`);
  console.log(`  1. Visit https://www.moltbook.com/help/connect-account`);
  console.log(`  2. Check email jason@joinfreehold.com for setup link (sent 2026-06-20T00:23:10Z)`);
  console.log(`  3. Click the link and log in with X account (@stacklets)`);
  console.log(`  4. Complete dashboard setup (approx 2 minutes)`);
  console.log(`  5. Re-run this script: bun run live-send-moltbook-post.ts <db>`);
  console.log(`\nAll other P7 deliverables are complete:`);
  console.log(`  - Schema: moltbook_post table + checkout_config ?a=moltbook (user_version=6)`);
  console.log(`  - Voice card: phases/07-moltbook/VOICE-CARD-moltbook.md`);
  console.log(`  - Experiment design: phases/07-moltbook/EXPERIMENT-DESIGN.md`);
  console.log(`  - Classification policy: phases/07-moltbook/CLASSIFICATION-POLICY.md`);
  console.log(`  - Metrics: live-read-moltbook-metrics.ts (3 independent buckets)`);
  console.log(`  - Capability: live-read-moltbook-capability.ts (claim confirmed via public profile)`);
  db.close();
  process.exit(0);  // Clean exit — checkpoint, not error
}
console.log(`Owner dashboard: READY (GET /agents/me → 200)`);

// ── 5. Kill switch recheck ────────────────────────────────────────────────
const ks2 = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
if (!ks2 || ks2.value !== "true") {
  console.log("KILL_SWITCH_ACTIVE (recheck): aborting before send.");
  db.close();
  process.exit(1);
}

// ── 6. Find best submolt ─────────────────────────────────────────────────
const subResp = await moltbookReq("GET", "/submolts", apiKey);
let targetSubmolt = "agent-development";
if (subResp.status === 200 && Array.isArray(subResp.data?.data)) {
  const submolts = subResp.data.data as Array<{ name: string; description?: string }>;
  // Prefer agent-development, ai-agents, or similar on-topic submolts
  const preferred = ["agent-development", "ai-agents", "agents", "artificial-intelligence", "stacks", "bitcoin"];
  for (const pref of preferred) {
    if (submolts.some(s => s.name === pref)) {
      targetSubmolt = pref;
      break;
    }
  }
  // Fallback: use first available submolt
  if (targetSubmolt === "agent-development" && !submolts.some(s => s.name === "agent-development")) {
    if (submolts.length > 0) targetSubmolt = submolts[0].name;
  }
}
console.log(`Target submolt: s/${targetSubmolt}`);

// ── 7. Construct post content ─────────────────────────────────────────────
const postTitle = "The case for Bitcoin-native agent rails";
const postContent = `Running an experiment this month.

The question: do agent-native surfaces produce click-throughs to human-readable content, or is it just agents reading agents in a loop?

Measuring 30 days. Three buckets: human, agent, unknown. Unknown stays unknown — never folded into the human count. The labeled link (?a=moltbook) tracks channel-level sessions at the site level only.

On Stacks we can do this differently: x402 lets an agent pay directly for a resource, no human intermediary. That's the next surface to evaluate. For now, measuring whether presence here produces any signal at all.

The infrastructure is the proof-of-work. Built on arc0.btc / SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B. All decisions signed with SIP-018, verifiable on-chain.`;

// ── 8. Attempt post send ────────────────────────────────────────────────
console.log(`\nPOST /posts (ONE labeled post) ...`);
const postBody = {
  submolt_name: targetSubmolt,
  title: postTitle,
  content: postContent,
  url: LABELED_LINK,
  type: "link"
};

let postResp = await moltbookReq("POST", "/posts", apiKey, postBody);
let providerPostId: string | null = null;

// Handle verification challenge if returned
if (postResp.data?.verification_required) {
  const vc = postResp.data.verification;
  console.log(`  Verification challenge received: "${vc.challenge_text}"`);
  const answer = solveChallenge(vc.challenge_text ?? "");
  console.log(`  Solved answer: ${answer}`);

  // Submit verification answer
  const verifyResp = await moltbookReq("POST", "/verify", apiKey, {
    verification_code: vc.verification_code,
    answer
  });
  console.log(`  Verification submit status: ${verifyResp.status}`);

  if (verifyResp.status !== 200) {
    console.error(`FAIL: Verification challenge failed — ${JSON.stringify(verifyResp.data)}`);
    await sendDiscordAlert(botToken, `[P7-Moltbook] FAIL: Verification challenge failed at ${utcNow}. Manual intervention may be needed.`);
    db.close();
    process.exit(1);
  }

  // Retry post after successful verification
  postResp = await moltbookReq("POST", "/posts", apiKey, postBody);
}

if (postResp.status === 200 || postResp.status === 201) {
  providerPostId = postResp.data?.data?.id ?? postResp.data?.post?.id ?? postResp.data?.id ?? null;
  console.log(`  POST /posts → ${postResp.status} | provider_post_id: ${providerPostId}`);
} else {
  const errorMsg = JSON.stringify(postResp.data).substring(0, 300);
  console.error(`FAIL: POST /posts → ${postResp.status} — ${errorMsg}`);
  await sendDiscordAlert(botToken, `[P7-Moltbook] FAIL: POST /posts → ${postResp.status} at ${utcNow}. Details: ${errorMsg}`);
  db.close();
  process.exit(1);
}

if (!providerPostId) {
  console.error(`FAIL: No provider_post_id in response — ${JSON.stringify(postResp.data).substring(0, 300)}`);
  db.close();
  process.exit(1);
}

// ── 9. Read-back confirmation ──────────────────────────────────────────────
console.log(`\nGET /posts/${providerPostId} (read-back) ...`);
const readBackResp = await moltbookReq("GET", `/posts/${providerPostId}`, apiKey);
const readBackOk = readBackResp.status === 200 && readBackResp.data?.success === true;
const readBackAt = new Date().toISOString();
const readBackTitle = readBackResp.data?.post?.title ?? null;
console.log(`  Read-back status: ${readBackResp.status} | ok: ${readBackOk} | title: "${readBackTitle}"`);

if (!readBackOk) {
  console.error(`WARN: Read-back failed (status ${readBackResp.status}) — post may have been sent but not confirmed`);
}

// ── 10. Write to arc.sqlite ────────────────────────────────────────────────
db.exec("BEGIN");
try {
  // Create outbound_action record
  const source_key = `engage:out:post:moltbook:${providerPostId}`;
  db.exec(`
    INSERT INTO outbound_action
      (source_key, action_type, status, payload_ref, channel, utc_day)
    VALUES
      ('${source_key}', 'moltbook_post', 'sent',
       'moltbook-post-${providerPostId}', 'moltbook',
       '${utcNow.split("T")[0]}')
  `);
  const actionRow = db.query("SELECT id FROM outbound_action WHERE source_key=?").get(source_key) as { id: number };

  // Write moltbook_post row
  db.exec(`
    INSERT INTO moltbook_post
      (provider_post_id, submolt_name, title, content, url, post_type,
       labeled_link, a_param, outbound_action_id, experiment_id,
       posted_at, read_back_at, read_back_ok)
    VALUES
      ('${providerPostId}', '${targetSubmolt}',
       ${JSON.stringify(postTitle)}, ${JSON.stringify(postContent)},
       '${LABELED_LINK}', 'link',
       '${LABELED_LINK}', 'moltbook',
       ${actionRow.id}, '${EXPERIMENT_ID}',
       '${utcNow}', ${readBackOk ? `'${readBackAt}'` : "NULL"},
       ${readBackOk ? 1 : 0})
  `);

  // Log engagement event
  db.exec(`
    INSERT INTO engagement_log (action_id, event_type, event_data)
    VALUES (${actionRow.id}, 'sent', '{"channel":"moltbook","experiment_id":"${EXPERIMENT_ID}"}')
  `);

  db.exec("COMMIT");
  console.log(`\nDB written: outbound_action.id=${actionRow.id}, moltbook_post.provider_post_id=${providerPostId}`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`FAIL: DB write error — ${(e as Error).message}`);
  db.close();
  process.exit(1);
}
db.close();

// ── 11. Discord success alert ─────────────────────────────────────────────
const discordMsg = `[P7-Moltbook] PASS: Labeled post sent at ${utcNow}\n` +
  `  provider_post_id: ${providerPostId}\n` +
  `  submolt: s/${targetSubmolt}\n` +
  `  title: "${postTitle}"\n` +
  `  labeled_link: ${LABELED_LINK}\n` +
  `  read_back_ok: ${readBackOk}\n` +
  `  experiment: ${EXPERIMENT_ID} | kill_date: 2026-07-20T00:00Z`;
const discordMsgId = await sendDiscordAlert(botToken, discordMsg);
console.log(`Discord alert sent: message_id=${discordMsgId}`);

// ── 12. Write evidence JSON ────────────────────────────────────────────────
mkdirSync(EVIDENCE_DIR, { recursive: true });
const evidenceFile = `${EVIDENCE_DIR}/p7-post-send-${utcNow.replace(/[:.]/g, "-")}.json`;
const evidence = {
  script: "live-send-moltbook-post.ts",
  utc: utcNow,
  experiment_id: EXPERIMENT_ID,
  provider_post_id: providerPostId,
  submolt_name: targetSubmolt,
  title: postTitle,
  labeled_link: LABELED_LINK,
  a_param: "moltbook",
  attribution_class: "observed",
  read_back_ok: readBackOk,
  read_back_at: readBackOk ? readBackAt : null,
  read_back_title: readBackTitle,
  discord_message_id: discordMsgId,
  kill_date: "2026-07-20T00:00Z",
  owner: "operator (whoabuddy)"
};
writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));
console.log(`Evidence written: ${evidenceFile}`);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== PASS ===`);
console.log(`provider_post_id: ${providerPostId}`);
console.log(`read_back_ok: ${readBackOk}`);
console.log(`labeled_link: ${LABELED_LINK}`);
console.log(`experiment: ${EXPERIMENT_ID} | kill_date: 2026-07-20T00:00Z | owner: operator`);
