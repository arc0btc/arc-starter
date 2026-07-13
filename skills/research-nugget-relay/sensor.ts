// skills/research-nugget-relay/sensor.ts
//
// Revives the dead HN/RSS/GitHub-release producers (arc-x-research-channel quest, Phase 5).
//
// ROOT CAUSE (verified live, 2026-07-13): skills/social-engine/producer-{hn,rss,github-release}.ts
// write rubric-scored research_nugget rows, but were NEVER scheduled — discoverSkills() (src/
// skills.ts) only wires a skill's sensor loop if a file is literally named `sensor.ts` at the
// skill's root, and these producers live in skills/social-engine/, which has no sensor.ts.
// arc-sensors.timer (runs every ~1 min) never touched them. research_nugget's last row is dated
// 2026-06-19 — the one seed run, then silence. Separately, NOTHING has ever read
// research_nugget's `is_promotable=1` rows either — it's a fully dead-end store on both sides.
//
// This sensor closes BOTH gaps in one file, being the missing sensor.ts AND the missing
// consumer:
//   1. Re-runs each enabled non-X producer (hn, rss, github_release — NOT reddit, still
//      403-from-VM-IP since 2026-06-19, out of scope) on ITS OWN configured cadence
//      (research_source_config.fetch_interval_minutes / last_fetched_at), via subprocess.
//   2. Scans research_nugget for is_promotable=1 rows with no report yet (report_path IS
//      NULL) and files a Research: task into the SAME arc-link-research path the X lanes'
//      candidate-maturation already proved (Phase 2) — not a fork.
//
// When that filed task eventually runs `arc-link-research -- process --links <source_url>`,
// src/nugget-bridge.ts's join-key lookup (source_url/content_hash) finds THIS SAME nugget row
// (not a duplicate) and fills in report_path/promoted_at — the two directions of the bridge
// meet on one row.
//
// dev-council 2026-07-13 (Fowler + Kleppmann + Lamport, all independently CONFIRMED): the
// original version of this sensor ALSO set `promoted_at` itself at task-filing time (and even
// in the "task already exists" dedup branch where no task was filed at all) — directly
// contradicting migration 017's own documented contract for that column ("non-NULL means a
// report exists"). A task that failed, retried out, or never round-tripped left the nugget
// permanently `promoted_at != NULL, report_path = NULL` — un-retryable, invisible, the exact
// silent-dead-end failure class this whole quest exists to fix. Fixed by giving `promoted_at`
// exactly ONE writer (src/nugget-bridge.ts, meaning exactly "a report landed") and having this
// sensor scan/gate on `report_path IS NULL` instead. Re-scanning a nugget whose task is already
// filed-but-incomplete is intentional and cheap: `insertTaskIfNew`'s own source-keyed dedup
// (below) is the sole "already attempted" signal, and it's self-healing — if that task ever
// gets cleared/deleted for any reason, the next scan naturally retries instead of staying dead
// forever. (idx_nugget_promoted_pending, defined in migration 017, is keyed on
// (is_promotable, promoted_at) rather than (is_promotable, report_path) — at today's table size
// [~150 rows] this is a non-issue; a future phase should retarget the index if the table grows
// large enough for it to matter.)
//
// STANDING RESEARCH BRIEF + MODEL ROUTING (2026-07-13, Phase 7 quality-fix pass):
// this sensor's filed tasks had the SAME two-line "run process, done" instruction
// candidate-maturation's did — same mechanical-scaffold-only outcome, same fix.
// See skills/candidate-maturation/sensor.ts's header for the full rationale
// (operator email-batch tasks #20099/#20111 vs the hollow #22284 automated one).
// buildStandingBrief below mirrors that sensor's brief shape with the data THIS
// sensor has in hand (rubric_total/source/title/published_at — no engagement
// metrics, this lane's producers aren't X-sourced).

import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

// dev-council 2026-07-13 (Newman, CONFIRMED): no timeout previously bounded a producer
// subprocess — a wedged HTTP fetch in one producer would block the promotion pass (a purely
// local, DB-only job with different failure semantics) for the whole tick, since both shared
// one claimSensorRun gate and ran sequentially. Bounded here; the promotion pass also now runs
// regardless of any individual producer's outcome (already true structurally — the try/catch in
// runProducerIfDue never propagates — made explicit by this comment, not a behavior change).
const PRODUCER_TIMEOUT_MS = 30_000;

const SENSOR_NAME = "research-nugget-relay";
const INTERVAL_MINUTES = 240; // this sensor's own look-gate; each producer still honors its own configured cadence below
const PROMOTE_CAP_PER_RUN = 3; // conservative — a filed task can cost a real dispatched-agent cycle

const log = createSensorLogger(SENSOR_NAME);

const PRODUCERS: Record<string, string> = {
  hn: "producer-hn.ts",
  rss: "producer-rss.ts",
  github_release: "producer-github-release.ts",
  // reddit intentionally excluded — research_source_config.enabled=0, confirmed 403 from this
  // VM's IP since 2026-06-19 (preflight_notes on that row). Reviving it is out of scope here;
  // it stays disabled until an auth path or alternative endpoint is configured.
};

interface SourceConfigRow {
  source: string;
  enabled: number;
  fetch_interval_minutes: number;
  last_fetched_at: string | null;
}

interface PromotableNugget {
  nugget_ref: string;
  source: string;
  source_url: string;
  title: string;
  rubric_total: number;
  published_at: string | null;
}

/**
 * Model routing (operator directive: never downgrade brainpower to save tokens —
 * applied where the signal warrants it). rubric_total is 0-50; is_promotable
 * already requires >=35, so every task filed here already cleared that floor.
 * Route the top of the promotable range to opus (roughly "relevance>=3ish" on a
 * 0-5 scale translated to this rubric), routine promotable (35-39) to sonnet.
 */
function chooseModel(rubricTotal: number): "opus" | "sonnet" {
  return rubricTotal >= 40 ? "opus" : "sonnet";
}

/**
 * The standing brief. Same "Task ID: N" substitution pattern as
 * candidate-maturation/sensor.ts's buildStandingBrief — insertTaskIfNew() hasn't
 * run yet when this description is built, so the agent fills in its own known
 * task id (src/dispatch.ts's buildPrompt always states "Task ID: N" up top).
 */
function buildStandingBrief(nugget: PromotableNugget): string {
  return [
    `Source: ${nugget.source} producer ingestion (rubric_total=${nugget.rubric_total}/50, is_promotable via >=35 threshold)`,
    `URL: ${nugget.source_url}`,
    `Published: ${nugget.published_at ?? "unknown"}`,
    "",
    "--- Standing research brief (mirrors the operator's own email-batch brief shape — #20099/#20111) ---",
    "",
    "1. Run this FIRST, passing --task with THIS task's own id (shown above in your",
    "   prompt as \"Task ID: N\") so the report's front-matter carries it:",
    `     arc skills run --name arc-link-research -- process --links "${nugget.source_url}" --task <Task ID>`,
    "   This caches/dedups the link and writes a mechanical scaffold report.",
    "2. Then go BEYOND that scaffold — edit the SAME report file directly:",
    "   - sku_why: real buyer-facing judgment (would a $9 packaged reader pay for",
    "     this? why or why not, one line — not left empty).",
    "   - repos_touched: resolve it by actually reading arc-starter (this VM) and",
    "     agent-runtime if relevant — never leave it \"unknown\" without having looked.",
    "   - Write a \"## TL;DR\" (3 lines) and cited \"## Key Takeaways\".",
    "   - Add an Arc-alignment note: cite a real file/skill where Arc already does",
    "     this, or state plainly \"no direct code hook\" — never hand-wave.",
    "   - Run reindex when done: arc skills run --name arc-link-research -- reindex",
    "3. DECLINE PATH: if, after reading it, this is genuinely low-relevance/",
    "   tangential — do NOT force a report. Skip step 1-2 entirely and close this",
    "   task directly with a two-line reasoned decline:",
    "     arc tasks close --id <Task ID> --status completed --summary \"<why this",
    "     isn't relevant, 2 lines>\"",
    "   A short, honest decline is the CORRECT output here, not a failure — a",
    "   declined nugget correctly stays report_path=NULL forever (see module",
    "   header: insertTaskIfNew's \"any\"-status dedup means it won't be re-filed,",
    "   which is the right terminal state for something genuinely not worth a",
    "   report — not a wedge).",
  ].join("\n");
}

function isDue(row: SourceConfigRow): boolean {
  if (!row.last_fetched_at) return true;
  const elapsedMin = (Date.now() - new Date(row.last_fetched_at).getTime()) / 60_000;
  return elapsedMin >= row.fetch_interval_minutes;
}

/** Returns false if a configured, enabled producer's script is missing — a loud signal, not a
 *  silent skip (dev-council 2026-07-13, Newman, CONFIRMED: the string-joined relative path
 *  from this sensor to skills/social-engine/producer-*.ts has no compile-time link; if a
 *  producer file ever moves or is renamed, the old code would log a nonzero exit and still
 *  return "ok" — zero ingestion, no alert, a carbon copy of the original "never scheduled,
 *  silently dead" failure class this quest was chartered to fix). */
async function runProducerIfDue(db: ReturnType<typeof getDatabase>, source: string): Promise<boolean> {
  const scriptName = PRODUCERS[source];
  if (!scriptName) return true;

  const row = db
    .query("SELECT source, enabled, fetch_interval_minutes, last_fetched_at FROM research_source_config WHERE source = ?")
    .get(source) as SourceConfigRow | undefined;

  if (!row) {
    log(`${source}: no research_source_config row — skipping`);
    return true;
  }
  if (!row.enabled) {
    log(`${source}: disabled — skipping`);
    return true;
  }
  if (!isDue(row)) {
    log(`${source}: not due yet (last_fetched_at=${row.last_fetched_at}, interval=${row.fetch_interval_minutes}min)`);
    return true;
  }

  const scriptPath = join(import.meta.dir, "..", "social-engine", scriptName);
  if (!existsSync(scriptPath)) {
    log(`${source}: LOUD FAILURE — producer script missing at ${scriptPath} (moved/renamed?) — this source will silently stop ingesting until fixed`);
    return false;
  }

  log(`${source}: due — running ${scriptName}`);
  try {
    // process.execPath (not the bare string "bun") so this resolves correctly regardless of the
    // caller's PATH — arc-sensors.service does set PATH to include ~/.bun/bin (confirmed live),
    // but this makes the sensor independently correct under direct/manual invocation too
    // (the exact "bun PATH gotcha over SSH" this codebase has hit before).
    const proc = Bun.spawn([process.execPath, scriptPath], {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, PRODUCER_TIMEOUT_MS);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      for (const line of stdout.trim().split("\n")) if (line) log(`  [${source}] ${line}`);
      if (timedOut) {
        log(`  [${source}] killed after ${PRODUCER_TIMEOUT_MS}ms timeout — treated as a failed run, not fatal to this cycle`);
      } else if (exitCode !== 0) {
        log(`  [${source}] exited ${exitCode}: ${stderr.trim().slice(0, 500)}`);
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
    return true;
  } catch (e) {
    log(`${source}: producer subprocess threw — ${e instanceof Error ? e.message : String(e)}`);
    return true; // a runtime spawn error is disclosed but not the "loud missing-file" signal specifically
  }
}

/**
 * Scan/gate on `report_path IS NULL`, NOT `promoted_at` (see module header — `promoted_at`
 * belongs solely to src/nugget-bridge.ts now, meaning exactly "a report exists"). Dedup for
 * "have we already tried this one" is `insertTaskIfNew`'s own source-keyed check
 * (`sensor:research-nugget-relay:${nugget_ref}`, dedupMode="any") — cheap, correct, and
 * self-healing: nothing here permanently marks a nugget as done just because a task was filed,
 * so a nugget whose task died without producing a report simply gets re-considered (and
 * re-deduped, at negligible cost) on the next run instead of vanishing from the queue forever.
 */
function promotePendingNuggets(db: ReturnType<typeof getDatabase>): { promoted: number; filed: number } {
  const pending = db
    .query(
      `SELECT nugget_ref, source, source_url, title, rubric_total, published_at
       FROM research_nugget
       WHERE is_promotable = 1 AND report_path IS NULL
       ORDER BY rubric_total DESC
       LIMIT ?`,
    )
    .all(PROMOTE_CAP_PER_RUN) as PromotableNugget[];

  if (pending.length === 0) {
    log("no promotable nuggets awaiting promotion");
    return { promoted: 0, filed: 0 };
  }

  let filed = 0;
  for (const nugget of pending) {
    const taskId = insertTaskIfNew(
      `sensor:${SENSOR_NAME}:${nugget.nugget_ref}`,
      {
        subject: `Research: ecosystem signal — ${nugget.source} nugget (${nugget.title.slice(0, 80)})`,
        description: buildStandingBrief(nugget),
        skills: '["arc-link-research"]',
        priority: 7,
        model: chooseModel(nugget.rubric_total),
      },
      "any",
    );

    if (taskId !== null) {
      filed++;
      log(`filed task #${taskId} for ${nugget.nugget_ref} (${nugget.source}, rubric_total=${nugget.rubric_total})`);
    } else {
      // A task already exists for this nugget_ref (any status) — nothing to do. NOT marking
      // anything here (the original version's bug: it stamped promoted_at even in this branch,
      // where no task was filed, permanently hiding an item whose prior task may have died
      // without ever producing a report). Left in the queue; cheap to re-check next run.
      log(`${nugget.nugget_ref}: task already exists (dedup) — leaving in queue, report_path still NULL`);
    }
  }

  return { promoted: pending.length, filed };
}

export default async function researchNuggetRelaySensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");
    const db = getDatabase();

    let anyProducerMissing = false;
    for (const source of Object.keys(PRODUCERS)) {
      const ok = await runProducerIfDue(db, source);
      if (!ok) anyProducerMissing = true;
    }

    // Promotion pass runs regardless of any individual producer's outcome (Newman lens,
    // 2026-07-13) — a wedged/missing/failed producer must not starve the purely-local
    // promotion consumer, which has entirely different failure semantics.
    const { promoted, filed } = promotePendingNuggets(db);

    log(`completed: ${promoted} promotable nugget(s) considered, ${filed} new Research: task(s) filed`);

    // A missing producer script is the exact "silently stopped ingesting" failure class this
    // quest exists to fix — surface it as a real sensor failure (consecutive_failures / any
    // downstream monitor watching sensor health) rather than a quiet "ok".
    return anyProducerMissing ? "error" : "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
