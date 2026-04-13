import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, insertWorkflow, getWorkflowByInstanceKey, taskExistsForSource } from "../../src/db.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SENSOR_NAME = "github-release-watcher";
const INTERVAL_MINUTES = 60;

const WATCHED_REPOS = [
  "oven-sh/bun",
  "anthropics/claude-code",
  "anthropics/anthropic-sdk-typescript",
  "stacks-network/stacks-core",
  "stx-labs/stacks.js",
  "aibtcdev/skills",
  "aibtcdev/aibtc-mcp-server",
  "hirosystems/clarinet",
  "supermemory-ai/supermemory",
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
  "anthropics/claude-code": ["claude-code-releases"],
  "aibtcdev/skills": ["arc-skill-manager"],
  "aibtcdev/aibtc-mcp-server": ["arc-skill-manager"],
  "stacks-network/stacks-core": ["stacks-stackspot"],
  "stx-labs/stacks.js": ["stacks-stackspot"],
};

/** Repos that get a dedicated research task instead of a generic review task. */
const RESEARCH_REPOS = new Set(["anthropics/claude-code"]);

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

    // Skip empty-body releases (no notes to review)
    if (!release.body || release.body.trim() === "") {
      console.log(`[release-watcher] Skipping ${repo}@${release.tag_name} (empty body)`);
      tagState[repo] = release.tag_name;
      continue;
    }

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

    if (RESEARCH_REPOS.has(repo)) {
      // Dedicated applicability research task — Sonnet-level, structured report
      insertTask({
        subject: `New release: ${repo} ${release.tag_name}`,
        description: [
          `New Claude Code release detected.`,
          `Tag: ${release.tag_name}`,
          `Name: ${release.name}`,
          `Published: ${release.published_at}`,
          `URL: ${release.html_url}`,
          "",
          "Release notes preview:",
          bodyPreview,
          "",
          "Instructions:",
          "Read AGENT.md for this skill (claude-code-releases) — it contains the full research workflow.",
          "Assess applicability across three lenses: Arc, AIBTC, agent-general.",
          "Write report to research/claude-code-releases/ and create follow-up tasks for any action items.",
        ].join("\n"),
        skills: skillsJson,
        priority: 6,
        model: "sonnet",
        source,
      });
    } else {
      // Use workflow for assess→integrate chain tracking
      const wfKey = `new-release:${repo}@${release.tag_name}`;
      if (!getWorkflowByInstanceKey(wfKey)) {
        insertWorkflow({
          template: "new-release",
          instance_key: wfKey,
          current_state: "detected",
          context: JSON.stringify({
            repo,
            version: release.tag_name,
            releaseUrl: release.html_url,
            skills: repoSkills || [],
          }),
        });
      }
    }

    // For aibtcdev/skills releases, also queue a landing-page content review
    if (repo === "aibtcdev/skills") {
      const lpSource = `sensor:github-release-watcher:landing-page-review:${repo}@${release.tag_name}`;
      if (!taskExistsForSource(lpSource)) {
        insertTask({
          subject: `Review aibtcdev/landing-page for ${release.tag_name} content gaps`,
          description: [
            `New aibtcdev/skills release: ${release.tag_name}`,
            `URL: ${release.html_url}`,
            "",
            "Release notes preview:",
            bodyPreview,
            "",
            "Review the landing page for content gaps introduced by this release:",
            "- llms.txt: does it list all current skills accurately?",
            "- Feature/capability descriptions: do they reflect new or updated skills?",
            "- User and agent experience docs: are they current?",
            "- Navigation / skills catalog page: any additions needed?",
            "",
            `Compare landing page content against the changes in ${release.html_url}`,
            "Create follow-up tasks for any gaps found.",
          ].join("\n"),
          skills: JSON.stringify(["aibtc-repo-maintenance", "dev-landing-page-review"]),
          priority: 6,
          model: "sonnet",
          source: lpSource,
        });
        tasksCreated++;
      }
    }

    tagState[repo] = release.tag_name;
    tasksCreated++;
  }

  await writeTagState(tagState);

  return tasksCreated > 0 ? "ok" : "skip";
}
