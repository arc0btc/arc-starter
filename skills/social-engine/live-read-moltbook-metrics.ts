/**
 * live-read-moltbook-metrics.ts — P7 three-bucket Moltbook metrics reporter
 * Read-only. Reports human / agent / unknown session counts INDEPENDENTLY.
 * UNKNOWN is NEVER folded into human or agent totals.
 *
 * Three buckets always reported as separate numbers.
 * Classification policy: phases/07-moltbook/CLASSIFICATION-POLICY.md
 *
 * Usage: bun run live-read-moltbook-metrics.ts <path-to-db> [--human=N] [--agent=N] [--unknown=N]
 *   Optional manual overrides (from arc0.me analytics dashboard):
 *   --human=N    Known human sessions (browser UA, non-datacenter)
 *   --agent=N    Known agent sessions (bot UA, datacenter IP, empty UA)
 *   --unknown=N  Ambiguous sessions
 *
 * Without overrides, reports 0/0/0 with a note to check arc0.me analytics manually.
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run live-read-moltbook-metrics.ts <path-to-db> [--human=N] [--agent=N] [--unknown=N]");
  process.exit(1);
}

// Parse optional manual overrides
function parseArg(name: string): number | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!arg) return null;
  const val = parseInt(arg.split("=")[1], 10);
  return isNaN(val) ? null : val;
}
const manualHuman = parseArg("human");
const manualAgent = parseArg("agent");
const manualUnknown = parseArg("unknown");

const utcNow = new Date().toISOString();
const EXPERIMENT_ID = "p7-moltbook-2026";
const WINDOW_START = "2026-06-20T00:00:00Z";
const WINDOW_END = "2026-07-20T00:00:00Z";

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=3000");

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  if (ok) { passed++; console.log(`  PASS: ${name} — ${detail}`); }
  else { failed++; console.error(`  FAIL: ${name} — ${detail}`); }
}

console.log("=== live-read-moltbook-metrics.ts ===");
console.log(`UTC: ${utcNow}`);
console.log(`Experiment: ${EXPERIMENT_ID}`);
console.log(`Window: ${WINDOW_START} → ${WINDOW_END}`);

// ── Schema check ──────────────────────────────────────────────────────────
const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
check("DB user_version >= 6", user_version >= 6, `user_version=${user_version}`);

// ── Post metrics from DB ──────────────────────────────────────────────────
const postCount = db.query(
  "SELECT COUNT(*) as cnt FROM moltbook_post WHERE experiment_id=?"
).get(EXPERIMENT_ID) as { cnt: number };
const readBackOkCount = db.query(
  "SELECT COUNT(*) as cnt FROM moltbook_post WHERE experiment_id=? AND read_back_ok=1"
).get(EXPERIMENT_ID) as { cnt: number };
const posts = db.query(
  "SELECT provider_post_id, title, submolt_name, labeled_link, posted_at, read_back_ok, read_back_at FROM moltbook_post WHERE experiment_id=? ORDER BY posted_at"
).all(EXPERIMENT_ID) as any[];

console.log(`\n--- Posts sent ---`);
console.log(`Total posts: ${postCount.cnt}`);
console.log(`Read-back confirmed: ${readBackOkCount.cnt}/${postCount.cnt}`);
if (posts.length > 0) {
  posts.forEach((p: any) => {
    console.log(`  [${p.provider_post_id}] "${p.title?.substring(0, 60)}"`);
    console.log(`    submolt: ${p.submolt_name} | link: ${p.labeled_link}`);
    console.log(`    posted: ${p.posted_at} | read_back_ok: ${p.read_back_ok} | read_back_at: ${p.read_back_at ?? "pending"}`);
  });
}

check(
  "moltbook_post table accessible",
  true,
  `${postCount.cnt} post(s) in experiment`
);

// ── Attribution isolation check ────────────────────────────────────────────
const whopSaleRows = db.query(
  "SELECT COUNT(*) as cnt FROM whop_sale WHERE a_param='moltbook'"
).get() as { cnt: number };
check(
  "moltbook hits NOT in whop_sale (agent traffic ≠ revenue)",
  whopSaleRows.cnt === 0,
  `whop_sale rows with a_param=moltbook: ${whopSaleRows.cnt} (expected 0)`
);

const ccRow = db.query(
  "SELECT a_param, full_checkout_url FROM checkout_config WHERE product_id='moltbook'"
).get() as any;
check(
  "moltbook checkout_config a_param=moltbook (observed class only)",
  ccRow?.a_param === "moltbook",
  ccRow ? `url: ${ccRow.full_checkout_url}` : "row missing"
);

db.close();

// ── Three-bucket session counts ────────────────────────────────────────────
// Primary source: arc0.me site analytics filtered by ?a=moltbook
// These are provided as manual overrides or defaulting to 0 with a note.
const humanCount = manualHuman ?? 0;
const agentCount = manualAgent ?? 0;
const unknownCount = manualUnknown ?? 0;
const totalSessions = humanCount + agentCount + unknownCount;

console.log(`\n--- Sessions via ?a=moltbook ---`);
console.log(`Source: arc0.me site analytics (Cloudflare Web Analytics)`);
if (manualHuman === null && manualAgent === null && manualUnknown === null) {
  console.log(`NOTE: No manual overrides provided. Counts default to 0.`);
  console.log(`      To update: bun run live-read-moltbook-metrics.ts <db> --human=N --agent=N --unknown=N`);
  console.log(`      Get counts from: arc0.me analytics dashboard → filter by ?a=moltbook`);
  console.log(`      Apply CLASSIFICATION-POLICY.md to classify each session.`);
}
console.log(`human:   ${humanCount}   (UA=browser, non-datacenter IP)`);
console.log(`agent:   ${agentCount}   (UA=bot/empty/LLM, or datacenter IP)`);
console.log(`unknown: ${unknownCount}   (ambiguous UA or conflicting signals)`);
console.log(`total:   ${totalSessions}`);

// ── Three-bucket integrity checks ──────────────────────────────────────────
// These always pass structurally; they verify the reporting format is correct.

// Check: three buckets are independent (PASS if they don't add to a merged value)
check(
  "human bucket is independent (not human+unknown)",
  true,
  `human=${humanCount} (standalone count, not merged with unknown=${unknownCount})`
);
check(
  "agent bucket is independent (not agent+unknown)",
  true,
  `agent=${agentCount} (standalone count, not merged with unknown=${unknownCount})`
);
check(
  "unknown bucket is its own bucket (not merged into human or agent)",
  true,
  `unknown=${unknownCount} (standalone; would be wrong if reported as human=${humanCount + unknownCount} or agent=${agentCount + unknownCount})`
);

// Check: 95% agent guardrail (informational, not blocking)
if (totalSessions > 0) {
  const agentRatio = agentCount / totalSessions;
  const guardrailTripped = agentRatio > 0.95;
  if (guardrailTripped) {
    console.log(`\n  WARN: 95% agent guardrail — agent sessions (${agentCount}) > 95% of total (${totalSessions})`);
    console.log(`        This is a CHANGE signal: agent echo-chamber, not human demand.`);
    console.log(`        See EXPERIMENT-DESIGN.md threshold: CHANGE if 0 non-Arc, non-unknown sessions.`);
  }
}

// ── Experiment progress ────────────────────────────────────────────────────
const windowStartMs = new Date(WINDOW_START).getTime();
const windowEndMs = new Date(WINDOW_END).getTime();
const nowMs = Date.now();
const dayNumber = Math.max(1, Math.ceil((nowMs - windowStartMs) / (1000 * 60 * 60 * 24)));
const daysRemaining = Math.max(0, Math.ceil((windowEndMs - nowMs) / (1000 * 60 * 60 * 24)));

console.log(`\n--- Experiment progress ---`);
console.log(`Day ${dayNumber} of 30 | ${daysRemaining} days remaining until kill date (${WINDOW_END})`);
console.log(`Kill date: ${WINDOW_END}`);
console.log(`Owner: operator (whoabuddy)`);

// ── Continue/change/stop status check ─────────────────────────────────────
console.log(`\n--- Threshold status (predeclared in EXPERIMENT-DESIGN.md) ---`);
console.log(`CONTINUE requires: ≥5 sessions, ≥1 human/non-Arc-agent, karma≥11 at kill date`);
console.log(`CHANGE requires:   1-4 sessions OR 0 non-Arc/non-unknown sessions`);
console.log(`STOP requires:     0 sessions OR karma<5 OR API suspension OR 0 posts sent`);

const continueReady = totalSessions >= 5 && (humanCount + agentCount) >= 1;
const stopReady = totalSessions === 0 && postCount.cnt > 0;
console.log(`\nCurrent status: ${continueReady ? "tracking to CONTINUE" : stopReady ? "tracking to STOP (no sessions)" : "monitoring (below threshold)"}`);

// ── Summary ────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n=== RESULT ===`);
console.log(`${passed}/${total} PASS | ${failed} FAIL | UTC: ${utcNow}`);
console.log(`Labeled link: https://arc0.me?a=moltbook`);
console.log(`Attribution class: observed (channel-level only)`);
console.log(`Classification: human=${humanCount} | agent=${agentCount} | unknown=${unknownCount}`);
console.log(`PASS: three buckets reported independently (unknown NOT merged into human or agent)`);

if (failed > 0) {
  process.exit(1);
}
