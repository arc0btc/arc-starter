import { claimSensorRun, readHookState } from "../../src/sensors.ts";
import {
  initDatabase,
  insertTask,
  taskExistsForSource,
} from "../../src/db.ts";
import { spawnSync } from "node:child_process";

const SENSOR_NAME = "github-mentions";
const INTERVAL_MINUTES = 5;

interface Notification {
  id: string;
  reason: string;
  repo: string;
  type: string;
  title: string;
  url: string;
  updatedAt: string;
}

function gh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { timeout: 30_000 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
  };
}

function apiUrlToHtml(apiUrl: string): string {
  if (!apiUrl) return "";
  return apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace("/pulls/", "/pull/");
}

function fetchNotifications(since: string): Notification[] {
  const result = gh([
    "api", "/notifications",
    "--method", "GET",
    "-f", "participating=true",
    "-f", `since=${since}`,
    "--jq",
    `.[] | select(.reason == "mention" or .reason == "review_requested" or .reason == "assign") | {id: .id, reason: .reason, repo: .repository.full_name, type: .subject.type, title: .subject.title, url: .subject.url, updatedAt: .updated_at}`,
  ]);

  if (!result.ok || !result.stdout) return [];

  const notifications: Notification[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      notifications.push(JSON.parse(line) as Notification);
    } catch {
      // skip malformed lines
    }
  }
  return notifications;
}

function markThreadRead(threadId: string): void {
  gh(["api", "--method", "PATCH", `/notifications/threads/${threadId}`]);
}

export default async function githubMentionsSensor(): Promise<string> {
  initDatabase();

  // Read previous state before claiming — need the old last_ran as our `since` bound
  const prevState = await readHookState(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // First run: no prior timestamp to bound the query. Skip task creation,
  // just establish the baseline. Next run will use this timestamp as `since`.
  if (!prevState) {
    console.log(
      `[${new Date().toISOString()}] github-mentions: bootstrap — will detect new notifications from next run`
    );
    return "ok";
  }

  const notifications = fetchNotifications(prevState.last_ran);
  if (notifications.length === 0) return "ok";

  let created = 0;
  for (const n of notifications) {
    const source = `sensor:github-mentions:thread:${n.id}`;
    if (taskExistsForSource(source)) {
      markThreadRead(n.id);
      continue;
    }

    const htmlUrl = apiUrlToHtml(n.url);
    const reasonLabel =
      n.reason === "mention"
        ? "@mention"
        : n.reason === "review_requested"
          ? "review request"
          : n.reason === "assign"
            ? "assignment"
            : n.reason;

    const subjectNum = htmlUrl.split("/").pop() ?? "";
    const ghCmd =
      n.type === "PullRequest"
        ? `gh pr view --repo ${n.repo} ${subjectNum}`
        : `gh issue view --repo ${n.repo} ${subjectNum}`;

    insertTask({
      subject: `GitHub ${reasonLabel} in ${n.repo}: ${n.title}`,
      description: [
        `Notification: ${reasonLabel} on ${n.type} in ${n.repo}`,
        `Title: ${n.title}`,
        `URL: ${htmlUrl}`,
        `Thread ID: ${n.id}`,
        "",
        "Instructions:",
        `1. Read the linked ${n.type === "PullRequest" ? "PR" : "issue"}: ${ghCmd}`,
        "2. Respond helpfully — review code if requested, answer questions if mentioned, take ownership if assigned.",
        "3. Use gh CLI to post comments or reviews as appropriate.",
      ].join("\n"),
      skills: '["aibtc-maintenance"]',
      priority: n.reason === "review_requested" ? 3 : 4,
      source,
    });

    markThreadRead(n.id);
    created++;
  }

  if (created > 0) {
    console.log(
      `[${new Date().toISOString()}] github-mentions: created ${created} task(s)`
    );
  }

  return "ok";
}
