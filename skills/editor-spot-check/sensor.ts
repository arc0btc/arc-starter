import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";

import { getUTCInfo } from "../../src/time.ts";

const SENSOR_NAME = "editor-spot-check";
const POLL_INTERVAL = 60; // check every 60 min, but only fire in 3 windows
const TASK_SOURCE = "sensor:editor-spot-check";
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

// Spot-check windows (UTC hours): 17:00, 21:00, 01:00
const SPOT_CHECK_WINDOWS = [17, 21, 1];
const WINDOW_TOLERANCE = 1; // fire if within 1 hour of window

interface Signal {
  id: string;
  headline?: string;
  btcAddress: string;
  beat: string;
  beatSlug?: string;
  status: string;
  timestamp: string;
  reviewedBy?: string;
}

interface EditorEntry {
  beat_slug: string;
  editor_name: string;
  btc_address: string;
}

function isInWindow(hour: number): boolean {
  return SPOT_CHECK_WINDOWS.some(
    (w) => hour >= w && hour < w + WINDOW_TOLERANCE
  );
}

function getWindowLabel(hour: number): string {
  if (hour >= 17 && hour < 21) return "morning";
  if (hour >= 21 || hour < 1) return "midday";
  return "pre-compile";
}

export default async function editorSpotCheckSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const { hour, date: today } = getUTCInfo();
  if (!isInWindow(hour)) {
    return "skip";
  }
  const windowLabel = getWindowLabel(hour);

  // Dedup: don't create multiple tasks for the same window
  const db = getDatabase();
  const existing = db.query<{ id: number }, [string, string]>(
    `SELECT id FROM tasks
     WHERE source = ?
       AND subject LIKE ?
       AND created_at >= ?
     LIMIT 1`
  ).get(TASK_SOURCE, `%${windowLabel}%`, today);

  if (existing) {
    log(`Spot-check already created for ${windowLabel} window — skipping`);
    return "skip";
  }

  log(`Running ${windowLabel} spot-check for ${today}...`);

  // Fetch today's approved signals
  let signals: Signal[] = [];
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=approved&date=${today}&limit=200`
    );
    if (!resp.ok) {
      log(`API returned ${resp.status}`);
      return "error";
    }
    const data = (await resp.json()) as { signals?: Signal[] };
    signals = data.signals ?? [];
  } catch (err) {
    log(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  // Also include brief_included signals (already compiled)
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=brief_included&date=${today}&limit=200`
    );
    if (resp.ok) {
      const data = (await resp.json()) as { signals?: Signal[] };
      signals.push(...(data.signals ?? []));
    }
  } catch { /* non-critical */ }

  // Group by beat
  const byBeat = new Map<string, Signal[]>();
  for (const s of signals) {
    const slug = s.beatSlug ?? s.beat.toLowerCase();
    const list = byBeat.get(slug) ?? [];
    list.push(s);
    byBeat.set(slug, list);
  }

  // Load editor registry for context
  const editors = db.query<EditorEntry, []>(
    "SELECT beat_slug, editor_name, btc_address FROM editor_registry"
  ).all();
  const editorMap = new Map(editors.map((e) => [e.beat_slug, e]));

  // Build report
  const lines: string[] = [];
  const anomalies: string[] = [];

  lines.push(`## Editor Spot-Check: ${windowLabel} (${today})`);
  lines.push(`Approved/included signals as of ${hour}:00 UTC:\n`);

  const activeBeats = ["aibtc-network", "bitcoin-macro", "quantum"];
  for (const beat of activeBeats) {
    const beatSignals = byBeat.get(beat) ?? [];
    const editor = editorMap.get(beat);
    const editorLabel = editor ? editor.editor_name : "unknown editor";

    lines.push(`### ${beat} (${editorLabel})`);

    if (beatSignals.length === 0) {
      lines.push("- No approved signals yet");
      if (hour >= 21) {
        anomalies.push(`${beat}: zero approvals by ${hour}:00 UTC`);
      }
    } else {
      for (const s of beatSignals.slice(0, 10)) {
        lines.push(`- ${s.id.slice(0, 8)} | ${(s.headline ?? "no headline").slice(0, 80)} [${s.status}]`);
      }
      if (beatSignals.length > 10) {
        lines.push(`- ... and ${beatSignals.length - 10} more`);
      }
      lines.push(`**Total: ${beatSignals.length}/10 slots**`);

      // Anomaly: high approval rate
      if (beatSignals.length >= 9) {
        anomalies.push(`${beat}: ${beatSignals.length}/10 slots filled — near capacity`);
      }
    }
    lines.push("");
  }

  if (anomalies.length > 0) {
    lines.push(`## Anomalies`);
    for (const a of anomalies) {
      lines.push(`- ${a}`);
    }
  }

  const totalSignals = signals.length;
  const subject = anomalies.length > 0
    ? `Spot-check ${windowLabel}: ${totalSignals} signal(s), ${anomalies.length} anomaly/anomalies`
    : `Spot-check ${windowLabel}: ${totalSignals} signal(s) across ${byBeat.size} beat(s)`;

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject,
    description: lines.join("\n"),
    priority: 7,
    skills: JSON.stringify(["editor-spot-check"]),
  });

  if (id !== null) {
    log(`Spot-check task created: #${id} — ${totalSignals} signals, ${anomalies.length} anomalies`);
  }

  return "ok";
}
