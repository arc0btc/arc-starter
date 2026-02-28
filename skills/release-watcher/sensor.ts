import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, taskExistsForSource } from "../../src/db.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SENSOR_NAME = "release-watcher";
const INTERVAL_MINUTES = 120;

const WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
];

const STATE_DIR = new URL("../../db/hook-state", import.meta.url).pathname;
const STATE_FILE = join(STATE_DIR, "release-watcher-tags.json");

interface ReleaseTagState {
  [repo: string]: string; // repo -> last seen tag
}

interface GhRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
}

async function readTagState(): Promise<ReleaseTagState> {
  try {
    const file = Bun.file(STATE_FILE);
    if (!(await file.exists())) return {};
    return (await file.json()) as ReleaseTagState;
  } catch {
    return {};
  }
}

async function writeTagState(state: ReleaseTagState): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

function fetchLatestRelease(repo: string): GhRelease | null {
  const result = spawnSync(
    "gh",
    ["api", `/repos/${repo}/releases/latest`],
    { timeout: 30_000 }
  );

  if (result.status !== 0) return null;

  try {
    const data = JSON.parse(result.stdout?.toString().trim() ?? "{}");
    return {
      tag_name: data.tag_name ?? "",
      name: data.name ?? "",
      html_url: data.html_url ?? "",
      body: data.body ?? "",
      published_at: data.published_at ?? "",
    };
  } catch {
    return null;
  }
}

export default async function releaseWatcherSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const tagState = await readTagState();
  let tasksCreated = 0;

  for (const repo of WATCHED_REPOS) {
    const release = fetchLatestRelease(repo);
    if (!release || !release.tag_name) continue;

    const knownTag = tagState[repo];
    if (knownTag === release.tag_name) continue;

    // New release detected
    const source = `sensor:release-watcher:${repo}@${release.tag_name}`;
    if (taskExistsForSource(source)) {
      // Already created a task for this tag, just update state
      tagState[repo] = release.tag_name;
      continue;
    }

    const bodyPreview = release.body
      ? release.body.slice(0, 500) + (release.body.length > 500 ? "..." : "")
      : "(no release notes)";

    insertTask({
      subject: `New release: ${repo} ${release.tag_name}`,
      description: [
        `New release detected on ${repo}`,
        `Tag: ${release.tag_name}`,
        `Name: ${release.name}`,
        `Published: ${release.published_at}`,
        `URL: ${release.html_url}`,
        "",
        "Release notes preview:",
        bodyPreview,
        "",
        "Instructions:",
        `1. Review the full release at ${release.html_url}`,
        "2. Assess impact on our projects and dependencies",
        "3. Create follow-up tasks if action is needed (dependency updates, breaking changes, etc.)",
      ].join("\n"),
      priority: 7,
      source,
    });

    tagState[repo] = release.tag_name;
    tasksCreated++;
  }

  await writeTagState(tagState);

  return tasksCreated > 0 ? "ok" : "skip";
}
