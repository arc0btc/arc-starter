/**
 * maximumsats-wot/sensor.ts
 *
 * Monitors WoT scores for pubkeys listed in db/maximumsats-wot-watchlist.json.
 * Fires an alert task (P6) if any pubkey's score drops ≥ 10 points since last check.
 *
 * Watchlist format:
 *   [{ "pubkey": "npub1...", "label": "human-readable name" }]
 */

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "maximumsats-wot";
const INTERVAL_MINUTES = 360; // 6 hours

const log = createSensorLogger(SENSOR_NAME);

interface WatchlistEntry {
  pubkey: string;
  label: string;
}

interface ScoreResponse {
  score?: number;
  wot_score?: number;
  [key: string]: unknown;
}

interface HookState {
  scores: Record<string, number>;
}

async function fetchScore(pubkey: string): Promise<number | null> {
  try {
    const res = await fetch(`https://wot.klabo.world/score?pubkey=${encodeURIComponent(pubkey)}`);
    if (res.status === 402) {
      log(`free tier exhausted — skipping score fetch for ${pubkey.slice(0, 12)}...`);
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as ScoreResponse;
    const score = data.score ?? data.wot_score;
    return typeof score === "number" ? score : null;
  } catch {
    return null;
  }
}

export default async function maximumsatsWotSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Load watchlist
  let watchlist: WatchlistEntry[] = [];
  try {
    const raw = await Bun.file("db/maximumsats-wot-watchlist.json").text();
    watchlist = JSON.parse(raw) as WatchlistEntry[];
  } catch {
    log("no watchlist found at db/maximumsats-wot-watchlist.json — skipping");
    return "skip";
  }

  if (watchlist.length === 0) {
    log("watchlist is empty — skipping");
    return "skip";
  }

  const hookState = (await readHookState(SENSOR_NAME)) as HookState;
  const prevScores: Record<string, number> = hookState.scores ?? {};
  const newScores: Record<string, number> = {};
  const alerts: string[] = [];

  for (const entry of watchlist) {
    const score = await fetchScore(entry.pubkey);
    if (score === null) continue;

    newScores[entry.pubkey] = score;

    const prev = prevScores[entry.pubkey];
    if (prev !== undefined && prev - score >= 10) {
      alerts.push(`${entry.label} (${entry.pubkey.slice(0, 12)}...): ${prev} → ${score} (-${prev - score})`);
    }
  }

  await writeHookState(SENSOR_NAME, { scores: { ...prevScores, ...newScores } });

  if (alerts.length === 0) {
    log(`checked ${Object.keys(newScores).length} pubkeys — no significant drops`);
    return "ok";
  }

  const source = `sensor:${SENSOR_NAME}:score-drop`;
  if (pendingTaskExistsForSource(source)) {
    log("alert task already pending — skipping");
    return "skip";
  }

  insertTask({
    subject: `[maximumsats-wot] WoT score drop alert — ${alerts.length} pubkey(s)`,
    description: `WoT score dropped ≥10 points:\n\n${alerts.map((a) => `- ${a}`).join("\n")}`,
    skills: JSON.stringify(["maximumsats-wot"]),
    source,
    priority: 6,
  });

  log(`alert task created for ${alerts.length} score drop(s)`);
  return "ok";
}
