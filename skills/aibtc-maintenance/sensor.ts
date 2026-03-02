import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, taskExistsForSource } from "../../src/db.ts";
import { spawnSync } from "node:child_process";

const SENSOR_NAME = "aibtc-maintenance";
const INTERVAL_MINUTES = 15;

const WATCHED_REPOS = [
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
];

// Repos that use React/Next.js — load react-reviewer + composition-patterns for these PRs
const REACT_REPOS = new Set(["aibtcdev/landing-page"]);

const GITHUB_USER = "arc0btc";

interface PrInfo {
  repo: string;
  number: number;
  title: string;
  author: string;
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
        // Skip PRs authored by Arc — reviewing your own PR is meaningless
        if (item.author.login === GITHUB_USER) continue;

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

export default async function aibtcMaintenanceSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Check for unreviewed PRs
  const unreviewed = getUnreviewedPRs();

  for (const pr of unreviewed) {
    // Use shared canonical key so github-mentions sensor can cross-dedup
    const source = `pr-review:${pr.repo}#${pr.number}`;
    if (taskExistsForSource(source)) continue;

    const isReactRepo = REACT_REPOS.has(pr.repo);
    const skills = isReactRepo
      ? '["aibtc-maintenance","react-reviewer","composition-patterns"]'
      : '["aibtc-maintenance"]';

    const extraInstructions = isReactRepo
      ? [
          "5. Apply react-reviewer rules (CRITICAL: waterfalls + bundle; HIGH: server-side) — see skills/react-reviewer/AGENT.md.",
          "6. Apply composition-patterns rules — see skills/composition-patterns/AGENT.md.",
        ]
      : [];

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
        ...extraInstructions,
      ].join("\n"),
      skills,
      priority: 5,
      source,
    });
  }

  return "ok";
}
