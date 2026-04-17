import { claimSensorRun, createSensorLogger, readHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { pendingTaskExistsForSource, recentTaskExistsForSource, taskExistsForSourcePrefix } from "../../src/db.ts";
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

/** Returns true if arc0btc has already submitted a review on this PR. */
function arcHasReviewedPR(repo: string, prNum: string): boolean {
  if (!prNum) return false;
  const result = gh([
    "pr", "view", prNum,
    "--repo", repo,
    "--json", "reviews",
    "--jq", '.reviews[] | select(.author.login == "arc0btc") | .state',
  ]);
  if (!result.ok || !result.stdout.trim()) return false;
  return true;
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

      // For PRs on watched repos, use the shared canonical key so
      // aibtc-maintenance sensor cross-deduplicates against the same record.
      // This applies to ALL notification reasons (mention, comment, etc.),
      // not just review_requested/assign — any notification about a PR that
      // already has a review task should be suppressed.
      const isPROnWatchedRepo =
        n.type === "PullRequest" && WATCHED_REPOS.includes(n.repo);
      const isReviewWork =
        n.reason === "review_requested" || n.reason === "assign";
      const subjectNum = n.url.split("/").pop() ?? "";

      // PrLifecycleMachine handles review_requested/assign on watched repos —
      // the workflow creates review tasks via state transitions, including re-reviews.
      if (isPROnWatchedRepo && isReviewWork) {
        gated++;
        continue;
      }

      // For PRs on watched repos, only mention/team_mention create tasks.
      // Skip comment / state_change / author — these are status updates, not action requests.
      const isDirectRequest =
        isReviewWork || n.reason === "mention" || n.reason === "team_mention";
      if (isPROnWatchedRepo && !isDirectRequest) {
        gated++;
        continue;
      }

      // If Arc already has a review on this PR, skip — avoids duplicate review tasks from
      // repeated @mentions after a prior review was completed. Genuine re-reviews flow
      // through arc-workflows via reviewCycle state transitions.
      if (isPROnWatchedRepo && arcHasReviewedPR(n.repo, subjectNum)) {
        gated++;
        continue;
      }

      // Canonical keys for cross-sensor dedup (shared with github-issue-monitor)
      const canonicalSource =
        isPROnWatchedRepo
          ? `pr-review:${n.repo}#${subjectNum}`
          : n.type === "Issue"
            ? `issue:${n.repo}#${subjectNum}`
            : null;

      // Dual-key dedup: skip if either thread or canonical source has an existing task.
      // Watched-repo PRs use prefix-based ALL-status dedup to catch arc-workflows' ":v1" tasks
      // and prevent re-queuing after completion. Non-watched PRs use pending-only (single source).
      // Issues suppress re-creation within 24h to prevent flood from multiple @mentions.
      const prPrefixDedup = isPROnWatchedRepo && canonicalSource && taskExistsForSourcePrefix(canonicalSource);
      const pendingDedup = !isPROnWatchedRepo && canonicalSource && pendingTaskExistsForSource(canonicalSource);
      if (
        pendingTaskExistsForSource(threadSource) ||
        prPrefixDedup ||
        pendingDedup ||
        (canonicalSource && n.type === "Issue" && recentTaskExistsForSource(canonicalSource, 1440))
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
      if (/classified|aibtc.?news|news.?classifieds/.test(titleLower)) {
        extraSkills.push("aibtc-news-classifieds");
      }
      if (/bitflow/i.test(n.repo) || /bitflow/i.test(titleLower)) {
        extraSkills.push("defi-bitflow");
      }
      if (/\bzest\b/i.test(n.repo) || /\bzest\b/i.test(titleLower)) {
        extraSkills.push("defi-zest");
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
            `3. Load full conversation context: gh pr view --repo ${n.repo} ${ghNum} --comments`,
            "4. Check CI status — are tests passing?",
            `5. Your role (${repoClass}): ${roleContext}`,
            "6. Review with severity labels: [blocking], [suggestion], [nit], [question].",
            "7. Decide: approve (gh pr review --approve) or request changes (gh pr review --request-changes). Do NOT post generic comment-only reviews.",
            "8. Check if aibtc-repo-maintenance already filed a review for this PR — avoid duplicate reviews.",
            "9. If this is a re-review, reference your previous review and focus on whether prior feedback was addressed.",
          ]
        : [
            `1. Read the issue: ${ghCmd}`,
            "2. Check for related open issues and recent PRs on this repo.",
            `3. Your role (${repoClass}): ${roleContext}`,
            "4. If you can fix it, open a PR. If not, add useful context (operational experience, cross-references).",
            "5. Use gh CLI to post comments as appropriate.",
          ];

      // Pending dedup: allows re-engagement when previous task completed/failed
      // (e.g., re-review requests on PRs already reviewed, new mentions on handled issues)
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
      }, "pending");

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
