import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { spawnSync } from "node:child_process";

const SENSOR_NAME = "aibtc-maintenance";
const INTERVAL_MINUTES = 15;

const WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
];

const GITHUB_USER = "arc0btc";

interface PrInfo {
  repo: string;
  number: number;
  title: string;
  author: string;
}

interface NotificationInfo {
  repo: string;
  type: string;
  title: string;
  url: string;
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { timeout: 30_000 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
  };
}

function getUnreviewedPRs(): PrInfo[] {
  const prs: PrInfo[] = [];

  for (const repo of WATCHED_REPOS) {
    const result = gh([
      "pr", "list",
      "--repo", repo,
      "--state", "open",
      "--json", "number,title,author,reviews",
      "--limit", "10",
    ]);

    if (!result.ok) continue;

    try {
      const items = JSON.parse(result.stdout) as Array<{
        number: number;
        title: string;
        author: { login: string };
        reviews: Array<{ author: { login: string }; state: string }>;
      }>;

      for (const item of items) {
        const reviewed = item.reviews.some(
          (r) => r.author.login === GITHUB_USER
        );
        if (!reviewed) {
          prs.push({
            repo,
            number: item.number,
            title: item.title,
            author: item.author.login,
          });
        }
      }
    } catch {
      // malformed JSON, skip
    }
  }

  return prs;
}

function getMentionNotifications(): NotificationInfo[] {
  const notifications: NotificationInfo[] = [];

  const result = gh([
    "api", "notifications",
    "--jq", `.[] | select(.reason == "mention" or .reason == "review_requested") | {repo: .repository.full_name, type: .subject.type, title: .subject.title, url: .subject.url}`,
  ]);

  if (!result.ok || !result.stdout) return notifications;

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as NotificationInfo;
      if (WATCHED_REPOS.includes(item.repo)) {
        notifications.push(item);
      }
    } catch {
      // skip malformed lines
    }
  }

  return notifications;
}

export default async function aibtcMaintenanceSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Check for unreviewed PRs
  const unreviewed = getUnreviewedPRs();

  for (const pr of unreviewed) {
    const source = `sensor:aibtc-maintenance:pr:${pr.repo}#${pr.number}`;
    if (pendingTaskExistsForSource(source)) continue;

    insertTask({
      subject: `Review PR #${pr.number} on ${pr.repo}: ${pr.title}`,
      description: [
        `PR #${pr.number} on ${pr.repo} by ${pr.author}`,
        `Title: ${pr.title}`,
        "",
        "Instructions:",
        "1. Read skills/aibtc-maintenance/AGENT.md before acting.",
        `2. Run: arc skills run --name aibtc-maintenance -- review-pr --repo ${pr.repo} --pr ${pr.number}`,
        "3. Analyze the diff for correctness and known operational issues.",
        "4. Post a review via gh pr review.",
      ].join("\n"),
      skills: '["aibtc-maintenance"]',
      priority: 5,
      source,
    });
  }

  // Check for @mentions and review requests
  const mentions = getMentionNotifications();

  if (mentions.length > 0) {
    const source = "sensor:aibtc-maintenance:mentions";
    if (!pendingTaskExistsForSource(source)) {
      insertTask({
        subject: `${mentions.length} GitHub mention(s) in watched repos`,
        description: [
          "Read skills/aibtc-maintenance/AGENT.md before acting.",
          "",
          "Notifications:",
          ...mentions.map((m) => `- [${m.type}] ${m.repo}: ${m.title}`),
          "",
          "Instructions:",
          "1. Review each notification and respond with relevant context.",
          "2. Mark notifications as read after handling.",
        ].join("\n"),
        skills: '["aibtc-maintenance"]',
        priority: 4,
        source,
      });
    }
  }

  return "ok";
}
