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
//   2. Scans research_nugget for is_promotable=1 rows that haven't been promoted yet
//      (promoted_at IS NULL — Phase 5 migration 017's idx_nugget_promoted_pending) and files a
//      Research: task into the SAME arc-link-research path the X lanes' candidate-maturation
//      already proved (Phase 2) — not a fork.
//
// When that filed task eventually runs `arc-link-research -- process --links <source_url>`,
// src/nugget-bridge.ts's join-key lookup (source_url/content_hash) finds THIS SAME nugget row
// (not a duplicate) and fills in report_path/promoted_at (COALESCE, so the promoted_at this
// sensor sets here is preserved as "when we decided to promote it," not overwritten) — the two
// directions of the bridge meet on one row.

import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import { join } from "node:path";

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

function isDue(row: SourceConfigRow): boolean {
  if (!row.last_fetched_at) return true;
  const elapsedMin = (Date.now() - new Date(row.last_fetched_at).getTime()) / 60_000;
  return elapsedMin >= row.fetch_interval_minutes;
}

async function runProducerIfDue(db: ReturnType<typeof getDatabase>, source: string): Promise<void> {
  const scriptName = PRODUCERS[source];
  if (!scriptName) return;

  const row = db
    .query("SELECT source, enabled, fetch_interval_minutes, last_fetched_at FROM research_source_config WHERE source = ?")
    .get(source) as SourceConfigRow | undefined;

  if (!row) {
    log(`${source}: no research_source_config row — skipping`);
    return;
  }
  if (!row.enabled) {
    log(`${source}: disabled — skipping`);
    return;
  }
  if (!isDue(row)) {
    log(`${source}: not due yet (last_fetched_at=${row.last_fetched_at}, interval=${row.fetch_interval_minutes}min)`);
    return;
  }

  const scriptPath = join(import.meta.dir, "..", "social-engine", scriptName);
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
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    for (const line of stdout.trim().split("\n")) if (line) log(`  [${source}] ${line}`);
    if (exitCode !== 0) log(`  [${source}] exited ${exitCode}: ${stderr.trim().slice(0, 500)}`);
  } catch (e) {
    log(`${source}: producer subprocess threw — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function promotePendingNuggets(db: ReturnType<typeof getDatabase>): { promoted: number; filed: number } {
  const pending = db
    .query(
      `SELECT nugget_ref, source, source_url, title, rubric_total, published_at
       FROM research_nugget
       WHERE is_promotable = 1 AND promoted_at IS NULL
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
    const description = [
      `Source: ${nugget.source} producer ingestion (rubric_total=${nugget.rubric_total}/50, is_promotable via >=35 threshold)`,
      `URL: ${nugget.source_url}`,
      `Published: ${nugget.published_at ?? "unknown"}`,
      "",
      "Evaluate this link for mission relevance. Use:",
      `  arc skills run --name arc-link-research -- process --links "${nugget.source_url}"`,
    ].join("\n");

    const taskId = insertTaskIfNew(
      `sensor:${SENSOR_NAME}:${nugget.nugget_ref}`,
      {
        subject: `Research: ecosystem signal — ${nugget.source} nugget (${nugget.title.slice(0, 80)})`,
        description,
        skills: '["arc-link-research"]',
        priority: 7,
      },
      "any",
    );

    if (taskId !== null) {
      db.query("UPDATE research_nugget SET promoted_at = ? WHERE nugget_ref = ?").run(
        new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        nugget.nugget_ref,
      );
      filed++;
      log(`filed task #${taskId} for ${nugget.nugget_ref} (${nugget.source}, rubric_total=${nugget.rubric_total})`);
    } else {
      log(`${nugget.nugget_ref}: task already exists (dedup) — marking promoted anyway to stop re-scanning`);
      db.query("UPDATE research_nugget SET promoted_at = ? WHERE nugget_ref = ?").run(
        new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        nugget.nugget_ref,
      );
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

    for (const source of Object.keys(PRODUCERS)) {
      await runProducerIfDue(db, source);
    }

    const { promoted, filed } = promotePendingNuggets(db);

    log(`completed: ${promoted} promotable nugget(s) considered, ${filed} new Research: task(s) filed`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
