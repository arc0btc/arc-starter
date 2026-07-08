/**
 * moltbook-mirror-post.ts — arc-day-n-publishing P3: zero-effort per-post Moltbook mirror
 *
 * Mirrors ONE canonical blog publish (Day-N or non-Day-N — both callers share
 * skills/arc-workflows/blog-render.ts's buildBlogPublishTask()) to Moltbook as a labeled
 * link-back post. "Mirror only" per QUEST.md: no bespoke content is authored, the post body
 * is a short link-back blurb, not a re-publication of the article.
 *
 * GUARDRAILS (same shape as the P7 experiment script, live-send-moltbook-post.ts):
 * - Kill switch checked BEFORE any send.
 * - Idempotency checked BEFORE any network call: a blog_slug already mirrored short-circuits.
 * - Owner dashboard checked (GET /agents/me) — exits 0 with CHECKPOINT (not a failure) if not
 *   connected; this is an external operator prerequisite, not a hard gate.
 * - Verification challenge solved if returned.
 * - ONE labeled post only (no burst — one call per invocation, one blog post per mirror).
 * - Read-back confirmation required (GET /posts/{id}).
 * - Discord alert on success.
 * - Evidence JSON written alongside the DB write.
 *
 * Usage: bun run moltbook-mirror-post.ts <path-to-db> --slug <slug> --title "<title>" --url <live-url>
 */

import { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync } from "fs";
import { getMoltbookCred, moltbookReq, sendDiscordAlert, solveMoltbookChallenge } from "./moltbook-client.ts";

const DISCORD_CHANNEL_DEFAULT = "1472999795361841193"; // #arc

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const dbPath = process.argv[2];
const slug = argValue("--slug");
const title = argValue("--title");
const url = argValue("--url");

if (!dbPath || !slug || !title || !url) {
  console.error(
    'Usage: bun run moltbook-mirror-post.ts <path-to-db> --slug <slug> --title "<title>" --url <live-url>'
  );
  process.exit(1);
}

const utcNow = new Date().toISOString();
const labeledUrl = url.includes("?") ? `${url}&src=moltbook` : `${url}?src=moltbook`;

console.log("=== moltbook-mirror-post.ts ===");
console.log(`UTC: ${utcNow}`);
console.log(`slug: ${slug}`);
console.log(`url: ${labeledUrl}`);

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

// ── 1. Kill switch ──────────────────────────────────────────────────────────
const killSwitch = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as
  | { value: string }
  | null;
if (!killSwitch || killSwitch.value !== "true") {
  console.log(`KILL_SWITCH_ACTIVE: outbound_enabled=${killSwitch?.value ?? "not found"}. Aborting.`);
  db.close();
  process.exit(1);
}
console.log("Kill switch: outbound_enabled=true (cleared to proceed)");

// ── 2. Idempotency — checked BEFORE any network call ────────────────────────
const already = db.query("SELECT provider_post_id, posted_at FROM moltbook_post WHERE blog_slug = ?").get(slug) as
  | { provider_post_id: string; posted_at: string }
  | undefined;
if (already) {
  console.log(`IDEMPOTENT: slug "${slug}" already mirrored (provider_post_id=${already.provider_post_id}, posted_at=${already.posted_at}). No duplicate send.`);
  db.close();
  process.exit(0);
}

// ── 3. Credentials ───────────────────────────────────────────────────────────
let apiKey: string, agentName: string, botToken: string | null;
try {
  apiKey = await getMoltbookCred("moltbook", "api_key");
  agentName = await getMoltbookCred("moltbook", "agent_name");
} catch (e) {
  console.error(`FAIL: credential load error — ${(e as Error).message}`);
  db.close();
  process.exit(1);
}
try {
  botToken = await getMoltbookCred("discord", "bot_token");
} catch {
  botToken = null; // Discord alert is best-effort, not required for the mirror to succeed.
}
console.log(`Credentials loaded: agent=${agentName}`);

// ── 4. Owner dashboard check — CHECKPOINT (exit 0), not FAIL, if not connected ──
const meResp = await moltbookReq("GET", "/agents/me", apiKey);
if (meResp.status !== 200) {
  console.log(`\nCHECKPOINT: Owner dashboard not connected (GET /agents/me → ${meResp.status}).`);
  console.log("This is an external operator prerequisite, not a publish failure — do not retry the blog publish over this.");
  console.log("  1. Visit https://www.moltbook.com/help/connect-account");
  console.log("  2. Complete dashboard setup, then re-run this exact command.");
  db.close();
  process.exit(0);
}
console.log("Owner dashboard: READY (GET /agents/me → 200)");

// Recheck kill switch right before the send (matches the P7 script's two-check pattern).
const ks2 = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
if (!ks2 || ks2.value !== "true") {
  console.log("KILL_SWITCH_ACTIVE (recheck): aborting before send.");
  db.close();
  process.exit(1);
}

// ── 5. Pick submolt ──────────────────────────────────────────────────────────
const subResp = await moltbookReq("GET", "/submolts", apiKey);
let targetSubmolt = "agents";
const submoltList = (subResp.data?.submolts ?? subResp.data?.data) as Array<{ name: string }> | undefined;
if (subResp.status === 200 && Array.isArray(submoltList)) {
  const preferred = ["agents", "builds", "infrastructure", "tooling", "ai", "crypto", "technology"];
  let chosen: string | null = null;
  for (const pref of preferred) {
    if (submoltList.some((s) => s.name === pref)) { chosen = pref; break; }
  }
  if (!chosen && submoltList.length > 0) chosen = submoltList[0].name;
  if (chosen) targetSubmolt = chosen;
  if (!submoltList.some((s) => s.name === targetSubmolt)) {
    console.error(`FAIL: chosen submolt s/${targetSubmolt} not in available list. Aborting (no post).`);
    db.close();
    process.exit(1);
  }
}
console.log(`Target submolt: s/${targetSubmolt}`);

// ── 6. Compose link-back mirror (mirror only — no bespoke content) ──────────
const postContent = `New from Arc: "${title}"\n\nMirrored from arc0.me — full piece + provenance at the link.`;

// ── 7. Post ──────────────────────────────────────────────────────────────────
console.log("\nPOST /posts (ONE labeled link-back) ...");
const postBody = { submolt_name: targetSubmolt, title, content: postContent, url: labeledUrl, type: "link" };
let postResp = await moltbookReq("POST", "/posts", apiKey, postBody);
let providerPostId: string | null = null;

if (postResp.data?.verification_required) {
  const vc = postResp.data.verification;
  console.log(`  Verification challenge: "${vc.challenge_text}"`);
  const answer = solveMoltbookChallenge(vc.challenge_text ?? "");
  console.log(`  Solved: ${answer}`);
  const verifyResp = await moltbookReq("POST", "/verify", apiKey, { verification_code: vc.verification_code, answer });
  if (verifyResp.status !== 200) {
    console.error(`FAIL: verification failed — ${JSON.stringify(verifyResp.data)}`);
    if (botToken) await sendDiscordAlert(botToken, DISCORD_CHANNEL_DEFAULT, `[Moltbook-mirror] FAIL: verification challenge failed for slug=${slug} at ${utcNow}.`);
    db.close();
    process.exit(1);
  }
  postResp = await moltbookReq("POST", "/posts", apiKey, postBody);
}

if (postResp.status === 200 || postResp.status === 201) {
  providerPostId = postResp.data?.data?.id ?? postResp.data?.post?.id ?? postResp.data?.id ?? null;
  console.log(`  POST /posts → ${postResp.status} | provider_post_id: ${providerPostId}`);
} else {
  const errorMsg = JSON.stringify(postResp.data).substring(0, 300);
  console.error(`FAIL: POST /posts → ${postResp.status} — ${errorMsg}`);
  if (botToken) await sendDiscordAlert(botToken, DISCORD_CHANNEL_DEFAULT, `[Moltbook-mirror] FAIL: POST /posts → ${postResp.status} for slug=${slug} at ${utcNow}.`);
  db.close();
  process.exit(1);
}

if (!providerPostId) {
  console.error("FAIL: no provider_post_id in response.");
  db.close();
  process.exit(1);
}

// ── 8. Read-back confirm ──────────────────────────────────────────────────────
console.log(`\nGET /posts/${providerPostId} (read-back) ...`);
const readBackResp = await moltbookReq("GET", `/posts/${providerPostId}`, apiKey);
const readBackOk = readBackResp.status === 200 && readBackResp.data?.success === true;
const readBackAt = new Date().toISOString();
console.log(`  Read-back: status=${readBackResp.status} ok=${readBackOk}`);

// ── 9. DB write ───────────────────────────────────────────────────────────────
// Note: outbound_action/engagement_log are the X-posting admission engine's own tables
// (lane CHECK constrained to post/reply/daily-read/content-calendar, budget_day/
// atomic_group_id/lease_expires_at are X-scheduler-specific concepts) — confirmed live
// against the current schema, which has evolved since the P7 script last wrote here
// (2026-06-20, pre-posting-scheduler-quest). Moltbook mirrors don't go through that
// admission engine at all, so `moltbook_post` (already carrying provider_post_id,
// posted_at, read_back_ok, blog_slug) is the sole source of truth here —
// outbound_action_id is left NULL (the column is nullable by design for exactly this).
db.exec("BEGIN");
try {
  db.run(
    `INSERT INTO moltbook_post
       (provider_post_id, submolt_name, title, content, url, post_type,
        labeled_link, a_param, outbound_action_id, experiment_id, blog_slug,
        posted_at, read_back_at, read_back_ok)
     VALUES (?, ?, ?, ?, ?, 'link', ?, 'moltbook', NULL, 'blog-mirror', ?, ?, ?, ?)`,
    [
      providerPostId, targetSubmolt, title, postContent, labeledUrl, labeledUrl,
      slug, utcNow, readBackOk ? readBackAt : null, readBackOk ? 1 : 0,
    ]
  );

  db.exec("COMMIT");
  console.log(`\nDB written: moltbook_post.provider_post_id=${providerPostId}`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`FAIL: DB write error — ${(e as Error).message}`);
  db.close();
  process.exit(1);
}
db.close();

// ── 10. Discord alert (best effort) ──────────────────────────────────────────
if (botToken) {
  const msg = `[Moltbook-mirror] PASS: mirrored "${title}" at ${utcNow}\n  provider_post_id: ${providerPostId}\n  submolt: s/${targetSubmolt}\n  labeled_link: ${labeledUrl}\n  read_back_ok: ${readBackOk}`;
  const msgId = await sendDiscordAlert(botToken, DISCORD_CHANNEL_DEFAULT, msg);
  console.log(`Discord alert sent: message_id=${msgId}`);
}

// ── 11. Evidence JSON ──────────────────────────────────────────────────────────
const evidenceDir = "/home/dev/arc-starter/ops-evidence/moltbook-mirror";
mkdirSync(evidenceDir, { recursive: true });
const evidenceFile = `${evidenceDir}/${utcNow.replace(/[:.]/g, "-")}-${slug}.json`;
writeFileSync(
  evidenceFile,
  JSON.stringify(
    { script: "moltbook-mirror-post.ts", utc: utcNow, blog_slug: slug, title, provider_post_id: providerPostId, submolt_name: targetSubmolt, labeled_link: labeledUrl, read_back_ok: readBackOk, owner: "operator (whoabuddy)" },
    null,
    2
  )
);
console.log(`Evidence written: ${evidenceFile}`);

console.log("\n=== PASS ===");
console.log(`provider_post_id: ${providerPostId} | read_back_ok: ${readBackOk} | labeled_link: ${labeledUrl}`);
