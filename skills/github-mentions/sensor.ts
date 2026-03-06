import { claimSensorRun, createSensorLogger, readHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { taskExistsForSource } from "../../src/db.ts";
import { AIBTC_WATCHED_REPOS, classifyRepo, type RepoClass } from "../../src/constants.ts";

const SENSOR_NAME = "github-mentions";
const INTERVAL_MINUTES = 5;
const log = createSensorLogger(SENSOR_NAME);

// Repos watched by aibtc-maintenance — used for cross-sensor PR review dedup
const WATCHED_REPOS = AIBTC_WATCHED_REPOS;

// Notification reasons that always create a task regardless of repo class
const ALWAYS_ENGAGE: ReadonlySet<string> = new Set([
  "mention", "review_requested", "assign", "team_mention",
]);

// Additional reasons allowed for collaborative repos (where Arc contributes)
const COLLABORATIVE_ENGAGE: ReadonlySet<string> = new Set([
  "author", "comment", "state_change",
]);

/** Returns true if this notification warrants a task based on repo classification. */
function shouldEngage(reason: string, repoClass: RepoClass): boolean {
  // Direct engagement always passes
  if (ALWAYS_ENGAGE.has(reason)) return true;
  // Managed repos: engage on everything
  if (repoClass === "managed") return true;
  // Collaborative repos: engage on author/comment/state_change (Arc's own PRs)
  if (repoClass === "collaborative" && COLLABORATIVE_ENGAGE.has(reason)) return true;
  // External repos: only direct mentions/reviews
  return false;
}

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
  const result = Bun.spawnSync(["gh", ...args], { timeout: 30_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
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
    `.[] | select(.reason == "mention" or .reason == "review_requested" or .reason == "assign" or .reason == "author" or .reason == "comment" or .reason == "state_change" or .reason == "team_mention") | {id: .id, reason: .reason, repo: .repository.full_name, type: .subject.type, title: .subject.title, url: .subject.url, updatedAt: .updated_at}`,
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

/** Marks all notifications as read up to the given ISO timestamp (single API call). */
function markAllRead(lastReadAt: string): void {
  gh(["api", "--method", "PUT", "/notifications", "-f", `last_read_at=${lastReadAt}`]);
}

export default async function githubMentionsSensor(): Promise<string> {
  try {
    // Read previous state before claiming — need the old last_ran as our `since` bound
    const prevState = await readHookState(SENSOR_NAME);

    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    // First run: no prior timestamp to bound the query. Skip task creation,
    // just establish the baseline. Next run will use this timestamp as `since`.
    if (!prevState) {
      log("bootstrap — will detect new notifications from next run");
      return "ok";
    }

    const notifications = fetchNotifications(prevState.last_ran);
    if (notifications.length === 0) return "ok";

    let created = 0;
    let gated = 0;
    for (const n of notifications) {
      const repoClass = classifyRepo(n.repo);

      // Engagement gate: skip low-signal notifications for external/collaborative repos
      if (!shouldEngage(n.reason, repoClass)) {
        gated++;
        continue;
      }

      const threadSource = `sensor:github-mentions:thread:${n.id}`;

      // For PR review requests/assignments on watched repos, use the shared canonical
      // key so aibtc-maintenance sensor cross-deduplicates against the same record.
      const isPROnWatchedRepo =
        n.type === "PullRequest" && WATCHED_REPOS.includes(n.repo);
      const isReviewWork =
        n.reason === "review_requested" || n.reason === "assign";
      const subjectNum = n.url.split("/").pop() ?? "";

      // Canonical keys for cross-sensor dedup (shared with github-issue-monitor / aibtc-maintenance)
      const canonicalSource =
        isPROnWatchedRepo && isReviewWork
          ? `pr-review:${n.repo}#${subjectNum}`
          : n.type === "Issue"
            ? `issue:${n.repo}#${subjectNum}`
            : null;

      // Dual-key dedup: skip if either thread or canonical source already has a task
      if (
        taskExistsForSource(threadSource) ||
        (canonicalSource && taskExistsForSource(canonicalSource))
      ) {
        continue;
      }

      const htmlUrl = apiUrlToHtml(n.url);
      const reasonLabels: Record<string, string> = {
        mention: "@mention",
        review_requested: "review request",
        assign: "assignment",
        author: "update on your PR",
        comment: "comment reply",
        state_change: "state change",
        team_mention: "team @mention",
      };
      const reasonLabel = reasonLabels[n.reason] ?? n.reason;

      const ghNum = htmlUrl.split("/").pop() ?? "";
      const ghCmd =
        n.type === "PullRequest"
          ? `gh pr view --repo ${n.repo} ${ghNum}`
          : `gh issue view --repo ${n.repo} ${ghNum}`;

      // Priority: managed repos get higher priority, review requests always high
      const priority =
        n.reason === "review_requested" || n.reason === "assign"
          ? 3
          : repoClass === "managed"
            ? 4
            : 5;

      // Enrich skills based on notification type and title keywords
      const titleLower = n.title.toLowerCase();
      const extraSkills: string[] = [];
      if (n.type === "PullRequest") {
        // PR reviews always check CI status — load the skill
        extraSkills.push("github-ci-status");
      }
      if (/x402/.test(titleLower) || /agent.*collab|collab.*agent/.test(titleLower)) {
        extraSkills.push("social-agent-engagement");
      }
      if (/\bworkflow\b|ci\/cd|github.actions|\bcicd\b/.test(titleLower)) {
        extraSkills.push("arc-workflows");
      }
      const skillsArray = ["aibtc-repo-maintenance", ...extraSkills];

      // Build role-aware instructions based on repo classification
      const roleContext = repoClass === "managed"
        ? "You OWN this repo. Make decisions: fix bugs, close stale issues, merge if CI passes, write release notes."
        : repoClass === "collaborative"
          ? "You are an active contributor with production experience. Review thoroughly, add operational context, but NEVER merge — post your review and let whoabuddy decide."
          : "You were specifically asked for input. Read carefully, respond thoroughly, then move on.";

      const actionSteps = n.type === "PullRequest"
        ? [
            `1. Read the PR: ${ghCmd}`,
            `2. Read the full diff: gh pr diff --repo ${n.repo} ${ghNum}`,
            "3. Check CI status — are tests passing?",
            `4. Your role (${repoClass}): ${roleContext}`,
            "5. If reviewing, use severity labels: [blocking], [suggestion], [nit], [question].",
            "6. Post review via gh pr review. Check if aibtc-repo-maintenance already filed a review task for this PR.",
          ]
        : [
            `1. Read the issue: ${ghCmd}`,
            "2. Check for related open issues and recent PRs on this repo.",
            `3. Your role (${repoClass}): ${roleContext}`,
            "4. If you can fix it, open a PR. If not, add useful context (operational experience, cross-references).",
            "5. Use gh CLI to post comments as appropriate.",
          ];

      insertTaskIfNew(canonicalSource ?? threadSource, {
        subject: `GitHub ${reasonLabel} in ${n.repo}: ${n.title}`,
        description: [
          `Notification: ${reasonLabel} on ${n.type} in ${n.repo}`,
          `Repo class: ${repoClass} | URL: ${htmlUrl}`,
          `Title: ${n.title}`,
          "",
          "Instructions:",
          ...actionSteps,
        ].join("\n"),
        skills: JSON.stringify(skillsArray),
        priority,
        model: "sonnet",
      }, "any");

      created++;
    }

    // Batch mark-as-read: single PUT replaces N individual PATCH calls
    const latestUpdate = notifications.reduce(
      (max, n) => (n.updatedAt > max ? n.updatedAt : max),
      notifications[0].updatedAt,
    );
    markAllRead(latestUpdate);

    if (created > 0 || gated > 0) {
      log(`created ${created} task(s), gated ${gated} low-signal notification(s)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
