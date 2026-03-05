import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource } from "../../src/db.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SENSOR_NAME = "github-release-watcher";
const INTERVAL_MINUTES = 360;

const WATCHED_REPOS = [
  "oven-sh/bun",
  "anthropics/claude-code",
  "anthropics/anthropic-sdk-typescript",
  "stacks-network/stacks-core",
  "stx-labs/stacks.js",
  "aibtcdev/skills",
  "aibtcdev/aibtc-mcp-server",
  "hirosystems/clarinet",
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
  const result = Bun.spawnSync(
    ["gh", "api", `/repos/${repo}/releases/latest`],
    { timeout: 30_000 }
  );

  if (result.exitCode !== 0) return null;

  try {
    const data = JSON.parse(result.stdout.toString().trim() || "{}");
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

/** Map repo → skills to load for review tasks. */
const REPO_SKILLS: Record<string, string[]> = {
  "aibtcdev/skills": ["arc-skill-manager"],
  "aibtcdev/aibtc-mcp-server": ["arc-skill-manager"],
  "stacks-network/stacks-core": ["stacks-stackspot"],
  "stx-labs/stacks.js": ["stacks-stackspot"],
};

export default async function releaseWatcherSensor(): Promise<string> {
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
    const source = `sensor:github-release-watcher:${repo}@${release.tag_name}`;
    if (taskExistsForSource(source)) {
      // Already created a task for this tag, just update state
      tagState[repo] = release.tag_name;
      continue;
    }

    const bodyPreview = release.body
      ? release.body.slice(0, 500) + (release.body.length > 500 ? "..." : "")
      : "(no release notes)";

    const repoSkills = REPO_SKILLS[repo];
    const skillsJson = repoSkills && repoSkills.length > 0 ? JSON.stringify(repoSkills) : undefined;

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
      skills: skillsJson,
      priority: 8,
      model: "haiku",
      source,
    });

    tagState[repo] = release.tag_name;
    tasksCreated++;
  }

  await writeTagState(tagState);

  return tasksCreated > 0 ? "ok" : "skip";
}
