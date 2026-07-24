// skills/claude-cli-drift-watch/sensor.ts
// Monthly read-only check: installed `claude` CLI version vs npm registry latest.
// Reports drift only — never attempts an upgrade. See SKILL.md for the "why".

import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { insertTaskIfNew } from "../../src/sensors.ts";

const SENSOR_NAME = "claude-cli-drift-watch";
const INTERVAL_MINUTES = 43_200; // 30 days
const DRIFT_THRESHOLD_VERSIONS = 5; // total (major*10000 + minor*100 + patch) delta
const NPM_LATEST_URL = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(raw: string): SemVer | null {
  const match = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function versionScore(v: SemVer): number {
  return v.major * 10_000 + v.minor * 100 + v.patch;
}

async function getInstalledVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function getNpmLatestVersion(): Promise<string | null> {
  try {
    const response = await fetchWithRetry(NPM_LATEST_URL, undefined, 1, 2000, 15_000);
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

export default async function sensor(): Promise<string> {
  const log = createSensorLogger(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const [installedRaw, latestRaw] = await Promise.all([
    getInstalledVersion(),
    getNpmLatestVersion(),
  ]);

  if (!installedRaw || !latestRaw) {
    log(`could not determine versions (installed=${installedRaw ?? "?"}, latest=${latestRaw ?? "?"}) — skipping`);
    return "skip";
  }

  const installed = parseSemVer(installedRaw);
  const latest = parseSemVer(latestRaw);
  if (!installed || !latest) {
    log(`unparseable version string (installed="${installedRaw}", latest="${latestRaw}") — skipping`);
    return "skip";
  }

  const drift = versionScore(latest) - versionScore(installed);
  if (drift <= DRIFT_THRESHOLD_VERSIONS) {
    log(`drift within threshold (installed=${installedRaw}, latest=${latestRaw}, score-delta=${drift})`);
    return "ok";
  }

  const subject = `claude CLI drift: installed ${installedRaw} vs npm latest ${latestRaw} (score-delta ${drift})`;
  const created = insertTaskIfNew(`sensor:${SENSOR_NAME}`, {
    subject,
    description:
      `Read-only drift check. Installed claude CLI (${installedRaw}) is significantly behind ` +
      `npm registry latest (${latestRaw}). This task is informational only — do not attempt an ` +
      `in-place binary swap from inside a dispatch task (see the self-upgrade task-queue paradox, ` +
      `#21905): dispatch-lock.json is held for this task's whole duration, so there is no in-queue ` +
      `moment where "no claude subprocess is running" is true from this task's own perspective. ` +
      `Escalate to a human (SSH) or an out-of-band systemd action for the actual upgrade.`,
    priority: 6,
    model: "haiku",
  });

  if (created === null) {
    log(`drift detected (${drift}) but a pending task already exists — skipping duplicate`);
    return "ok";
  }

  log(`queued task #${created}: ${subject}`);
  return "ok";
}
