import { claimSensorRun } from "../../src/sensors.ts";
import { insertTask, taskExistsForSource } from "../../src/db.ts";
import { AIBTC_WATCHED_REPOS } from "../../src/constants.ts";

const SENSOR_NAME = "aibtc-repo-maintenance";
const INTERVAL_MINUTES = 15;

const WATCHED_REPOS = AIBTC_WATCHED_REPOS;

// Repos that use React/Next.js — load react-reviewer + composition-patterns for these PRs
const REACT_REPOS = new Set(["aibtcdev/landing-page"]);

const GITHUB_USER = "arc0btc";

interface PrInfo {
  repo: string;
  number: number;
  title: string;
  author: string;
}

function getUnreviewedPRs(): PrInfo[] {
  // Build a single GraphQL query that fetches open PRs from all watched repos at once.
  // Each repo becomes an aliased field (repo0, repo1, …) to avoid name collisions.
  const fragments = WATCHED_REPOS.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `repo${i}: repository(owner: "${owner}", name: "${name}") {
      pullRequests(states: OPEN, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          number
          title
          author { login }
          reviews(first: 50) { nodes { author { login } } }
        }
      }
    }`;
  });

  const query = `query { ${fragments.join("\n")} }`;

  const result = Bun.spawnSync(
    ["gh", "api", "graphql", "-f", `query=${query}`],
    { timeout: 30_000 },
  );
  if (result.exitCode !== 0) return [];

  let data: Record<string, { pullRequests: { nodes: Array<{
    number: number;
    title: string;
    author: { login: string };
    reviews: { nodes: Array<{ author: { login: string } }> };
  }> } }>;

  try {
    const parsed = JSON.parse(result.stdout.toString().trim()) as { data: typeof data };
    data = parsed.data;
  } catch {
    return [];
  }

  const prs: PrInfo[] = [];
  for (let i = 0; i < WATCHED_REPOS.length; i++) {
    const repoData = data[`repo${i}`];
    if (!repoData) continue;
    const repo = WATCHED_REPOS[i];

    for (const item of repoData.pullRequests.nodes) {
      // Skip PRs authored by Arc — reviewing your own PR is meaningless
      if (item.author.login === GITHUB_USER) continue;

      const reviewed = item.reviews.nodes.some(
        (r) => r.author.login === GITHUB_USER,
      );
      if (!reviewed) {
        prs.push({ repo, number: item.number, title: item.title, author: item.author.login });
      }
    }
  }

  return prs;
}

export default async function aibtcMaintenanceSensor(): Promise<string> {
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
      ? '["aibtc-repo-maintenance","dev-react-review","dev-react-composition","dev-web-design"]'
      : '["aibtc-repo-maintenance"]';

    const extraInstructions = isReactRepo
      ? [
          "5. Apply react-reviewer rules (CRITICAL: waterfalls + bundle; HIGH: server-side) — see skills/dev-react-review/AGENT.md.",
          "6. Apply composition-patterns rules — see skills/dev-react-composition/AGENT.md.",
          "7. Apply web-design accessibility/UX rules for UI-touching files — see skills/dev-web-design/AGENT.md.",
        ]
      : [];

    insertTask({
      subject: `Review PR #${pr.number} on ${pr.repo}: ${pr.title}`,
      description: [
        `PR #${pr.number} on ${pr.repo} by ${pr.author}`,
        `Title: ${pr.title}`,
        "",
        "Instructions:",
        "1. Read skills/aibtc-repo-maintenance/AGENT.md before acting.",
        `2. Run: arc skills run --name aibtc-maintenance -- review-pr --repo ${pr.repo} --pr ${pr.number}`,
        "3. Analyze the diff for correctness and known operational issues.",
        "4. Post a review via gh pr review.",
        ...extraInstructions,
      ].join("\n"),
      skills,
      priority: 5,
      model: "sonnet",
      source,
    });
  }

  return "ok";
}
