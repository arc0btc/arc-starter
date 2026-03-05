import { claimSensorRun, createSensorLogger, readHookState, pendingTaskExistsForSource, insertTask } from "../../src/sensors.ts";

const SENSOR_NAME = "ci-status";
const INTERVAL_MINUTES = 15;
const ACTOR = "arc0btc";

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  head_branch: string;
  event: string;
  created_at: string;
  html_url: string;
}

const log = createSensorLogger(SENSOR_NAME);

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["gh", ...args], { timeout: 30_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

/** Discover repos where we have open PRs. */
function getWatchedRepos(): string[] {
  const result = gh([
    "search", "prs",
    "--author", ACTOR,
    "--state", "open",
    "--json", "repository",
    "--jq", ".[].repository.nameWithOwner",
  ]);

  if (!result.ok || !result.stdout) return [];

  const repos = [...new Set(result.stdout.split("\n").filter(Boolean))];
  return repos;
}

/** Fetch recent failed workflow runs for a repo, filtered to our actor. */
function getFailedRuns(repo: string, since: string): WorkflowRun[] {
  const result = gh([
    "api", `repos/${repo}/actions/runs`,
    "-f", `actor=${ACTOR}`,
    "-f", "per_page=20",
    "--jq",
    `.workflow_runs[] | select(.conclusion == "failure" and .created_at >= "${since}") | {id, name, status, conclusion, head_branch, event, created_at, html_url}`,
  ]);

  if (!result.ok || !result.stdout) return [];

  const runs: WorkflowRun[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      runs.push(JSON.parse(line) as WorkflowRun);
    } catch {
      // skip malformed lines
    }
  }
  return runs;
}

export default async function ciStatusSensor(): Promise<string> {
  const prevState = await readHookState(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Bootstrap: establish baseline, create no tasks on first run
  if (!prevState) {
    log("bootstrap — will detect CI failures from next run");
    return "ok";
  }

  const since = prevState.last_ran;
  const repos = getWatchedRepos();

  if (repos.length === 0) {
    log("no repos with open PRs found");
    return "ok";
  }

  log(`checking ${repos.length} repo(s): ${repos.join(", ")}`);

  let created = 0;
  for (const repo of repos) {
    const failedRuns = getFailedRuns(repo, since);

    for (const run of failedRuns) {
      const source = `sensor:ci-status:run:${run.id}`;
      if (pendingTaskExistsForSource(source)) continue;

      insertTask({
        subject: `CI failure in ${repo}: ${run.name} (${run.head_branch})`,
        description: [
          `Workflow "${run.name}" failed in ${repo}`,
          `Branch: ${run.head_branch}`,
          `Event: ${run.event}`,
          `Run: ${run.html_url}`,
          `Created: ${run.created_at}`,
          "",
          "Instructions:",
          `1. View failure logs: gh run view --repo ${repo} ${run.id} --log-failed`,
          `2. Check if the failure is in our code or flaky infrastructure`,
          `3. If our code: fix, commit, and push`,
          `4. If flaky: note it in task summary and close`,
        ].join("\n"),
        skills: '["ci-status"]',
        priority: 3,
        model: "sonnet",
        source: source,
      });

      created++;
    }
  }

  if (created > 0) {
    log(`created ${created} task(s) for failed CI runs`);
  } else {
    log("no new CI failures detected");
  }

  return "ok";
}
