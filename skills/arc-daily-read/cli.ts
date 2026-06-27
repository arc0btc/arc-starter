#!/usr/bin/env bun
// skills/arc-daily-read/cli.ts
// Arc's Daily Read — P3 of arc-demand-distribution quest.
// Real-data chart + daily named first-person beat + amplification email hook.
// NO decorative AI art. Chart = SQL query on distilled_artifacts. Zero image generation.

import { Database } from "bun:sqlite";
import { join } from "path";

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const DB_PATH = join(ARC_STARTER_ROOT, "db/arc.sqlite");
const FREE_ROOM_URL = "https://whop.com/checkout/plan_arGwx0yFBhYOL?a=x-human";
const X_HANDLE = "@arc0btc";

// ---------- DB bootstrap ----------

function getDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode=WAL");

  // Idempotent schema migration — daily_read_log
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_read_log (
      edition_n INTEGER PRIMARY KEY,
      beat_source TEXT NOT NULL,
      tweet_id TEXT,
      root_tweet_url TEXT,
      thesis_carried TEXT,
      what_got_wrong TEXT,
      chart_data TEXT,
      amplification_email_sent INTEGER NOT NULL DEFAULT 0,
      amplification_email_sent_at TEXT,
      organic_reach_snapshot TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  return db;
}

// ---------- Chart generation (NO AI art — pure SQL on distilled_artifacts) ----------

interface WeeklyCount {
  week: string;
  count: number;
}

interface ChartData {
  weeks: WeeklyCount[];
  totalArtifacts: number;
  thisWeekCount: number;
  lastWeekCount: number;
  dominantType: string;
  generatedAt: string;
}

function toSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...values, 1);
  return values.map((v) => chars[Math.min(Math.floor((v / max) * (chars.length - 1)), chars.length - 1)]).join("");
}

function generateChart(): ChartData {
  const db = getDb();

  // Total artifact count — the "211 research passes" claim
  const totalRow = db.query("SELECT COUNT(*) as n FROM distilled_artifacts WHERE deleted_at IS NULL").get() as { n: number };
  const totalArtifacts = totalRow.n;

  // Weekly counts (last 8 weeks)
  const weeklyRows = db.query(`
    SELECT
      strftime('%Y-W%W', produced_at) as week,
      COUNT(*) as count
    FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', '-56 days')
    GROUP BY week
    ORDER BY week ASC
  `).all() as WeeklyCount[];

  // This week vs last week
  const thisWeekRow = db.query(`
    SELECT COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-6 days')
  `).get() as { n: number };

  const lastWeekRow = db.query(`
    SELECT COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-13 days')
      AND produced_at < datetime('now', 'start of day', '-6 days')
  `).get() as { n: number };

  // Dominant type this week
  const typeRow = db.query(`
    SELECT type, COUNT(*) as n FROM distilled_artifacts
    WHERE deleted_at IS NULL
      AND produced_at >= datetime('now', 'start of day', '-6 days')
    GROUP BY type ORDER BY n DESC LIMIT 1
  `).get() as { type: string; n: number } | null;

  // Humanize the internal type name for tweet copy
  const TYPE_LABELS: Record<string, string> = {
    snippet: "research",
    council: "council",
    arxiv: "arXiv",
    research: "research",
    report: "report",
  };
  const rawType = typeRow?.type ?? "research";
  const humanizedType = TYPE_LABELS[rawType] ?? rawType;

  db.close();

  return {
    weeks: weeklyRows,
    totalArtifacts,
    thisWeekCount: thisWeekRow.n,
    lastWeekCount: lastWeekRow.n,
    dominantType: humanizedType,
    generatedAt: new Date().toISOString(),
  };
}

function renderChartText(data: ChartData): string {
  const sparkline = toSparkline(data.weeks.map((w) => w.count));
  const trend = data.thisWeekCount > data.lastWeekCount ? "up" : data.thisWeekCount < data.lastWeekCount ? "down" : "flat";
  const delta = data.thisWeekCount - data.lastWeekCount;
  const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "flat";
  return `${sparkline} (${deltaStr} vs last week, ${data.dominantType} dominant)`;
}

// ---------- Edition tracking ----------

interface PriorBeat {
  edition_n: number;
  thesis_carried: string | null;
  what_got_wrong: string | null;
}

function getEditionN(): number {
  const db = getDb();
  const row = db.query("SELECT MAX(edition_n) as max_n FROM daily_read_log").get() as { max_n: number | null };
  db.close();
  return (row.max_n ?? 0) + 1;
}

function getPriorBeat(): PriorBeat | null {
  const db = getDb();
  const row = db.query(
    "SELECT edition_n, thesis_carried, what_got_wrong FROM daily_read_log ORDER BY edition_n DESC LIMIT 1"
  ).get() as PriorBeat | null;
  db.close();
  return row;
}

function alreadyPostedToday(): boolean {
  const db = getDb();
  const row = db.query(
    "SELECT COUNT(*) as n FROM daily_read_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };
  db.close();
  return row.n > 0;
}

// ---------- Beat composition ----------

interface Beat {
  tweets: string[];
  editionN: number;
  thesis: string;
  chartData: ChartData;
}

function composeBeat(): Beat {
  const editionN = getEditionN();
  const priorBeat = getPriorBeat();
  const chartData = generateChart();
  const sparklineText = renderChartText(chartData);

  const { totalArtifacts, thisWeekCount, lastWeekCount, dominantType } = chartData;
  const trend = thisWeekCount > lastWeekCount ? `up ${thisWeekCount - lastWeekCount}` : thisWeekCount < lastWeekCount ? `down ${lastWeekCount - thisWeekCount}` : "flat";

  // Tweet 1: Root — data first, edition stamp second (MUST-FIX #1 from panel)
  const tweet1 = [
    `${totalArtifacts} research passes in my pipeline. This week: ${thisWeekCount} ${dominantType} artifacts, ${trend} from last week.`,
    ``,
    `${sparklineText}`,
    ``,
    `Arc's Daily Read — Edition ${editionN}`,
  ].join("\n").slice(0, 240);

  // Tweet 2: So-what call — first-person operational, stakes, specific implication
  const tweet2 = [
    `What this means: ${dominantType} output ${trend === "flat" ? "holding steady" : `trending ${trend.split(" ")[0]}`} in my distill pipeline.`,
    ``,
    `Each artifact is a dispatch cycle where I processed real sources and produced real output. ${totalArtifacts} cycles. Not a demo.`,
  ].join("\n").slice(0, 240);

  // Tweet 3: Continuity — thesis tracking or new thesis
  let tweet3: string;
  let thesis: string;

  if (priorBeat?.thesis_carried && editionN > 1) {
    // Carry forward the prior thesis with an update
    const correction = priorBeat.what_got_wrong
      ? `Yesterday I said: "${priorBeat.thesis_carried.slice(0, 80)}..." — I got this wrong: ${priorBeat.what_got_wrong.slice(0, 60)}.`
      : `Yesterday's thesis: "${priorBeat.thesis_carried.slice(0, 80)}..." — still tracking.`;
    thesis = `${dominantType} output trend will clarify over the next 3 beats. Watching for: sustained increase or regression to baseline.`;
    tweet3 = `${correction}\n\nNew tracked thesis: ${thesis}`.slice(0, 240);
  } else {
    // Edition 1 — set the opening thesis
    thesis = `${dominantType} artifact volume is a leading indicator of Arc's research depth. Watching this weekly. If it drops below ${Math.max(thisWeekCount - 2, 1)}/week, dispatch cadence degraded.`;
    tweet3 = `Edition 1. Starting a tracked thesis:\n\n${thesis}\n\nCheck Edition 2 to see if the data moved.`.slice(0, 240);
  }

  // Tweet 4: CTA — follow + soft free-room join, audience named (MUST-FIX #4 from panel)
  const tweet4 = [
    `Follow ${X_HANDLE} for the daily beat.`,
    ``,
    `Free room for Stacks builders who want to feed agents real signal: ${FREE_ROOM_URL}`,
    ``,
    `No pitch. Just the signal.`,
  ].join("\n").slice(0, 240);

  return {
    tweets: [tweet1, tweet2, tweet3, tweet4],
    editionN,
    thesis,
    chartData,
  };
}

// ---------- Cap check ----------

interface CapStatus {
  allowed: boolean;
  todayCount: number;
  cap: number;
  slotsRemaining: number;
  killSwitch: boolean;
}

function checkCap(): CapStatus {
  const db = new Database(DB_PATH, { readonly: true });

  // Kill switch check
  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as { value: string } | null;
  const killSwitch = ksRow?.value === "false";

  // Daily tweet count
  const countRow = db.query(
    "SELECT COUNT(*) as n FROM x_post_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };

  db.close();

  const DAILY_TWEET_CAP = 6;
  const todayCount = countRow.n;
  const slotsRemaining = DAILY_TWEET_CAP - todayCount;
  const TWEETS_PER_BEAT = 4;

  return {
    allowed: !killSwitch && slotsRemaining >= TWEETS_PER_BEAT,
    todayCount,
    cap: DAILY_TWEET_CAP,
    slotsRemaining,
    killSwitch,
  };
}

// ---------- X posting via existing CLI ----------

async function postTweet(
  text: string,
  source: string,
  replyToId?: string,
  isRoot: boolean = false,
  dryRun: boolean = false
): Promise<string | null> {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would post (source: ${source}, is_root: ${isRoot}):`);
    console.log(`  ${text.replace(/\n/g, " ").slice(0, 80)}...`);
    return `dry-run-tweet-id-${source}`;
  }

  const args = [
    join(ARC_STARTER_ROOT, "skills/social-x-posting/cli.ts"),
    "post",
    "--text", text,
    "--source", source,
  ];
  if (replyToId) {
    args.push("--reply-to", replyToId);
  }
  if (isRoot) {
    args.push("--root");
  }

  const proc = Bun.spawn(["bun", ...args], {
    cwd: ARC_STARTER_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`X post failed (source: ${source}): ${stderr}`);
    return null;
  }

  // Parse tweet ID from output
  const match = stdout.match(/tweet_id[:\s]+(\d+)/i) || stdout.match(/"id":\s*"(\d+)"/);
  const tweetId = match?.[1] ?? null;
  console.log(`  Posted ${source}: tweet_id=${tweetId ?? "unknown"}`);
  return tweetId;
}

// ---------- Amplification email ----------

async function sendAmplificationEmail(
  editionN: number,
  tweetUrl: string | null,
  beat: Beat,
  dryRun: boolean = false
): Promise<boolean> {
  // Reuse the same credentials as arc-report-email/sensor.ts
  const { getCredential } = await import("../../src/credentials.ts");
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  const recipient = await getCredential("email", "report_recipient");

  if (!apiBaseUrl || !adminKey) {
    console.warn("  [EMAIL] email credentials not configured — skipping amplification email");
    return false;
  }

  if (!recipient) {
    console.warn("  [EMAIL] no report_recipient credential — skipping");
    return false;
  }

  const subject = `Arc's Daily Read — Edition ${editionN} ready to amplify`;

  const tweetLink = tweetUrl ? `<a href="${tweetUrl}">${tweetUrl}</a>` : "(tweet URL pending)";

  const suggestedQuoteTweet = `My agent Arc just dropped Edition ${editionN} of its Daily Read. ${beat.chartData.totalArtifacts} research passes in the pipeline. Worth a look if you're building on Stacks.`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: monospace; max-width: 640px; margin: 40px auto; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
  h2 { color: #f0f0f0; border-bottom: 1px solid #333; padding-bottom: 8px; }
  .tweet { background: #1a1a1a; border-left: 3px solid #1d9bf0; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
  .label { color: #888; font-size: 0.85em; margin-bottom: 4px; }
  .action { background: #0d1a2e; border: 1px solid #1d9bf0; padding: 12px; border-radius: 4px; margin: 16px 0; }
  .quote { background: #1a1a0d; border-left: 3px solid #f0a500; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
</style></head>
<body>
  <h2>Arc's Daily Read — Edition ${editionN}</h2>
  <p>Edition ${editionN} is live. Ready to amplify.</p>

  <div class="action">
    <strong>Tweet link:</strong> ${tweetLink}<br>
    <em>(One-tap quote-tweet or reply to amplify into your feed)</em>
  </div>

  <h3>Suggested quote-tweet (your voice, not Arc's):</h3>
  <div class="quote">${suggestedQuoteTweet}</div>

  <h3>The 4-tweet beat (Arc's voice):</h3>
  ${beat.tweets.map((t, i) => `
    <div class="tweet">
      <div class="label">Tweet ${i + 1}${i === 0 ? " (root)" : ""}</div>
      <pre style="white-space:pre-wrap;margin:0">${t}</pre>
    </div>
  `).join("")}

  <hr style="border-color:#333;margin:24px 0">
  <p style="color:#666;font-size:0.85em">
    Reach tracking: organic baseline = 51 followers (2026-06-27).
    If you amplify, reply to this email with the quote-tweet URL so Arc can log amplified vs organic reach.
    If you don't amplify, no action needed — Arc will log "shipped without amplification (operator offline) — dead reach expected."
  </p>
</body>
</html>`;

  const plainText = `Arc's Daily Read — Edition ${editionN}\n\nTweet: ${tweetUrl ?? "(pending)"}\n\nSuggested quote-tweet:\n${suggestedQuoteTweet}\n\nBeat:\n${beat.tweets.join("\n---\n")}`;

  if (dryRun) {
    console.log(`  [DRY-RUN EMAIL] Would send to ${recipient}: "${subject}"`);
    console.log(`  [DRY-RUN EMAIL] Body includes ${beat.tweets.length} tweet drafts + quote-tweet suggestion`);
    return true;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/send`, {
      method: "POST",
      headers: {
        "X-Admin-Key": adminKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        to: recipient,
        subject,
        body: plainText,
        html: htmlBody,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`  [EMAIL] send failed: HTTP ${response.status} — ${body}`);
      return false;
    }

    console.log(`  [EMAIL] sent to ${recipient}: "${subject}"`);
    return true;
  } catch (err) {
    console.error(`  [EMAIL] network error: ${err}`);
    return false;
  }
}

// ---------- Logging ----------

function logBeat(
  db: Database,
  editionN: number,
  beat: Beat,
  tweetId: string | null,
  emailSent: boolean,
  postedAt: string
): void {
  const tweetUrl = tweetId ? `https://x.com/${X_HANDLE.slice(1)}/status/${tweetId}` : null;

  db.run(
    `INSERT OR REPLACE INTO daily_read_log
     (edition_n, beat_source, tweet_id, root_tweet_url, thesis_carried, what_got_wrong,
      chart_data, amplification_email_sent, amplification_email_sent_at, organic_reach_snapshot, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      editionN,
      `daily-read:${editionN}`,
      tweetId,
      tweetUrl,
      beat.thesis,
      null, // what_got_wrong is set on the NEXT beat, looking back
      JSON.stringify(beat.chartData),
      emailSent ? 1 : 0,
      emailSent ? new Date().toISOString() : null,
      JSON.stringify({ follower_count_at_post: 51 }), // P2 baseline; updated when live X pull is available
      postedAt,
    ]
  );
}

// ---------- Commands ----------

async function cmdChart() {
  const data = generateChart();
  const sparkline = toSparkline(data.weeks.map((w) => w.count));
  console.log("=== Arc Daily Read — Real-Data Chart ===");
  console.log(`Source: distilled_artifacts table (db/arc.sqlite) — NO AI art`);
  console.log(`Generated: ${data.generatedAt}`);
  console.log(`Total research passes (all time): ${data.totalArtifacts}`);
  console.log(`This week: ${data.thisWeekCount} | Last week: ${data.lastWeekCount}`);
  console.log(`Dominant type: ${data.dominantType}`);
  console.log(`\nWeekly sparkline (last 8 weeks): ${sparkline}`);
  console.log("\nWeekly breakdown:");
  data.weeks.forEach((w) => console.log(`  ${w.week}: ${w.count}`));
  console.log("\nChart text for tweet:");
  console.log(renderChartText(data));
  console.log("\n[ASSERTION: This chart is generated by SQL query on Arc's own distilled_artifacts data.");
  console.log(" No OpenRouter, DALL-E, or image generation API is used. Source: src/db.ts query on db/arc.sqlite]");
}

async function cmdCompose(dryRun: boolean) {
  console.log("=== Arc Daily Read — Beat Composition ===");
  const beat = composeBeat();

  console.log(`\nEdition: ${beat.editionN}`);
  console.log(`Thesis: ${beat.thesis}`);
  console.log("\n--- 4-tweet beat ---");
  beat.tweets.forEach((t, i) => {
    const charCount = t.length;
    const label = i === 0 ? "ROOT" : i === 3 ? "CTA" : `REPLY-${i + 1}`;
    console.log(`\n[${label}] ${charCount} chars:`);
    console.log(t);
    if (charCount > 240) {
      console.warn(`  WARNING: tweet ${i + 1} exceeds 240 chars (${charCount})`);
    }
  });

  const cap = checkCap();
  console.log("\n--- Cap check ---");
  console.log(`Today's tweets: ${cap.todayCount}/${cap.cap}`);
  console.log(`Slots remaining: ${cap.slotsRemaining}`);
  console.log(`Kill switch: ${cap.killSwitch ? "ACTIVE (outbound_enabled=false)' — would block" : "inactive"}`);
  console.log(`Posting allowed: ${cap.allowed ? "YES" : "NO"}`);

  if (dryRun) {
    console.log("\n[DRY-RUN] No posts sent. Use `post --dry-run` to simulate posting flow.");
  }
}

async function cmdPost(dryRun: boolean) {
  console.log(`=== Arc Daily Read — Post ${dryRun ? "(DRY-RUN)" : "(LIVE)"} ===`);

  // Kill switch + cap check
  const cap = checkCap();
  if (cap.killSwitch) {
    console.log("HALTED: kill switch active (outbound_enabled=false)");
    process.exit(0);
  }
  if (!cap.allowed) {
    console.log(`DEFERRED: cap exhausted or insufficient slots (${cap.slotsRemaining} remaining, need 4)`);
    console.log(`Today's tweets: ${cap.todayCount}/${cap.cap}`);
    process.exit(0);
  }

  // Already posted today?
  if (alreadyPostedToday() && !dryRun) {
    console.log("SKIPPED: already posted today (daily_read_log row exists for today)");
    process.exit(0);
  }

  const beat = composeBeat();
  const postedAt = new Date().toISOString();

  console.log(`\nEdition ${beat.editionN} | ${cap.slotsRemaining} slots available`);
  console.log("Posting 4-tweet beat...");

  // Post root
  const rootId = await postTweet(beat.tweets[0], `daily-read:${beat.editionN}:root`, undefined, true, dryRun);

  // Post reply-2
  const reply2Id = await postTweet(beat.tweets[1], `daily-read:${beat.editionN}:reply-2`, rootId ?? undefined, false, dryRun);

  // Post reply-3
  const reply3Id = await postTweet(beat.tweets[2], `daily-read:${beat.editionN}:reply-3`, reply2Id ?? undefined, false, dryRun);

  // Post CTA
  const ctaId = await postTweet(beat.tweets[3], `daily-read:${beat.editionN}:cta`, reply3Id ?? undefined, false, dryRun);

  const tweetUrl = rootId ? `https://x.com/arc0btc/status/${rootId}` : null;

  // Send amplification email (REQUIRED per D4)
  console.log("\nFiring amplification email (D4 — required)...");
  const emailSent = await sendAmplificationEmail(beat.editionN, tweetUrl, beat, dryRun);

  if (!emailSent) {
    console.warn("  Amplification email FAILED — logging: 'shipped without amplification (operator offline) — dead reach expected'");
  }

  // Log the beat
  if (!dryRun) {
    const db = getDb();
    logBeat(db, beat.editionN, beat, rootId, emailSent, postedAt);
    db.close();
    console.log(`\nLogged Edition ${beat.editionN} to daily_read_log`);
  } else {
    console.log(`\n[DRY-RUN] Would log Edition ${beat.editionN} to daily_read_log`);
    console.log(`  tweet_id: ${rootId}`);
    console.log(`  email_sent: ${emailSent}`);
    console.log(`  thesis: ${beat.thesis}`);
  }

  console.log("\n=== Complete ===");
  console.log(`Amplification: ${emailSent ? "email sent to operator" : "not sent — dead reach expected"}`);
  console.log(`Organic baseline: 51 followers (P2, 2026-06-27)`);
  console.log(`Reach proof status: CARRIED FORWARD (target ≥10 consecutive beats — see daily_read_log)`);
}

async function cmdStatus() {
  const db = getDb();
  const rows = db.query(
    "SELECT edition_n, posted_at, thesis_carried, amplification_email_sent, tweet_id FROM daily_read_log ORDER BY edition_n DESC LIMIT 5"
  ).all() as any[];
  db.close();

  const cap = checkCap();

  console.log("=== Arc Daily Read — Status ===");
  console.log(`Next edition: ${getEditionN()}`);
  console.log(`Today's tweet count: ${cap.todayCount}/${cap.cap} (${cap.slotsRemaining} slots remaining)`);
  console.log(`Kill switch: ${cap.killSwitch ? "ACTIVE" : "inactive"}`);
  console.log(`Today posted: ${alreadyPostedToday()}`);
  console.log(`\nRecent beats:`);
  if (rows.length === 0) {
    console.log("  No beats yet. Edition 1 pending.");
  } else {
    rows.forEach((r) => {
      console.log(`  Edition ${r.edition_n} | posted: ${r.posted_at ?? "not yet"} | email: ${r.amplification_email_sent ? "sent" : "not sent"} | tweet: ${r.tweet_id ?? "n/a"}`);
    });
  }
  console.log(`\nReach-proof carry-forward target: ≥10 consecutive beats at UTC 13:00`);
  console.log(`Confirm condition: ≥15 net followers + ≥1 external RT within 7 days of Edition 1`);
  console.log(`Refute condition: <5 net followers after 10 beats with ≥1 operator amplification fired`);
  console.log(`P2 baseline: 51 followers (2026-06-27), 0 external engagement`);
}

// ---------- Main ----------

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

switch (command) {
  case "chart":
    await cmdChart();
    break;
  case "compose":
    await cmdCompose(dryRun);
    break;
  case "post":
    await cmdPost(dryRun);
    break;
  case "status":
    await cmdStatus();
    break;
  default:
    console.log("Usage: bun cli.ts <chart|compose|post|status> [--dry-run]");
    console.log("  chart           Show real-data ASCII chart from distilled_artifacts");
    console.log("  compose         Show the 4-tweet beat composition");
    console.log("  post            Post the daily beat (use --dry-run to simulate)");
    console.log("  status          Show edition log and cap state");
    process.exit(1);
}
