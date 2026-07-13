// skills/candidate-maturation/sensor.ts
//
// The re-scoring half of the Option B candidate-maturation spine
// (arc-x-research-channel quest, Phase 2). Discovery lanes (currently
// social-x-ecosystem's keyword rotation; news-search/trends/list-roster join in
// Phases 3-4) STORE candidates on first sight via src/candidate-spine.ts instead
// of judging them at birth. This sensor is the ONLY place engagement is judged:
// once a candidate has aged 2-24h since first_seen, it's re-scored against FRESH
// metrics (fetched via one batched GET /2/tweets?ids= — up to 100 ids in a SINGLE
// metered read on the named "candidate-maturation" lane) and, if it clears the
// same isHighSignal bar the old at-birth judge used, files a Research: task into
// the SAME arc-link-research path the working operator-email intake uses.
//
// Not owned by social-x-ecosystem: this is shared spine infrastructure every
// future X discovery lane feeds, so it lives as its own skill.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { recentTaskExistsForSource, insertTask } from "../../src/db.ts";
import {
  getMaturationBatch,
  expireStaleCandidates,
  markCandidateMatured,
  markCandidateRejected,
  isHighSignal,
  type XResearchCandidate,
} from "../../src/candidate-spine.ts";
import { loadXCreds, xApiGet } from "../social-x-posting/lib/x-api.ts";

const SENSOR_NAME = "candidate-maturation";
const INTERVAL_MINUTES = 60;
const LANE = "candidate-maturation";

const log = createSensorLogger(SENSOR_NAME);

interface MaturedTweet {
  id: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

export default async function candidateMaturationSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Housekeeping first, no API call: retire anything that aged past the
    // maturation window (24h) without being re-scored yet.
    const expiredCount = expireStaleCandidates(24);
    if (expiredCount > 0) log(`expired ${expiredCount} stale candidate(s) (>24h, never matured)`);

    const batch = getMaturationBatch(24, 2, 100);
    if (batch.length === 0) {
      log("no candidates due for maturation (2-24h window empty)");
      return "ok";
    }

    log(`maturation batch: ${batch.length} candidate(s) due for re-score`);

    const creds = await loadXCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    // ONE batched read for the whole due set — up to 100 ids, one metered call on
    // the named "candidate-maturation" lane (NOT the generic "tweets" lane
    // fetchRecentPostMetrics uses for the same endpoint — a fresh named lane per
    // quest binding constraint, via xApiGet's opts.lane override, Phase 2).
    const ids = batch.map((c) => c.tweet_id).join(",");
    const result = await xApiGet(
      "/tweets",
      creds,
      { ids, "tweet.fields": "created_at,public_metrics" },
      { owned: false, lane: LANE }
    );

    const returned = (result["data"] as MaturedTweet[] | undefined) ?? [];
    const returnedById = new Map(returned.map((t) => [t.id, t]));

    let matured = 0;
    let rejectedAbsent = 0;
    let stillPending = 0;

    for (const candidate of batch as XResearchCandidate[]) {
      const tweet = returnedById.get(candidate.tweet_id);

      if (!tweet) {
        // X no longer returns this id (deleted/protected/suspended since
        // discovery) — it will never mature. Reject now rather than re-trying
        // every cycle until it eventually expires.
        markCandidateRejected(candidate.tweet_id);
        rejectedAbsent++;
        continue;
      }

      if (!isHighSignal(tweet.public_metrics)) {
        // Hasn't cleared the bar YET — leave 'pending' so it gets another look as
        // it ages further, until expireStaleCandidates retires it past 24h.
        stillPending++;
        continue;
      }

      const source = `sensor:${SENSOR_NAME}:${candidate.tweet_id}`;
      if (recentTaskExistsForSource(source, 24 * 60)) {
        // Already filed (shouldn't normally happen — a candidate is marked
        // 'matured' in the same pass that files its task — but guards a
        // partial-write retry). 0 = "matured via a pre-existing task, id not
        // re-looked-up here" — distinct from insertTask's own -1
        // (github-escalation-guard) sentinel.
        markCandidateMatured(candidate.tweet_id, 0);
        continue;
      }

      const urls: string[] = candidate.urls ? JSON.parse(candidate.urls) : [];
      const linkList = urls.join(", ");
      const metrics = tweet.public_metrics!;

      const taskId = insertTask({
        subject: `Research: ecosystem signal — matured candidate (${candidate.discovery_context ?? candidate.source_lane})`,
        description: [
          `Source: candidate-maturation re-score (originally discovered via ${candidate.source_lane}${candidate.discovery_context ? ` — "${candidate.discovery_context}"` : ""})`,
          `Tweet ID: ${candidate.tweet_id}`,
          `Author ID: ${candidate.author_id ?? "unknown"}`,
          `First seen: ${candidate.first_seen}`,
          `Text: ${candidate.text_snippet ?? ""}`,
          `Links: ${linkList}`,
          "",
          `Engagement at maturation: ${metrics.like_count} likes, ${metrics.retweet_count} RTs, ${metrics.reply_count} replies`,
          "",
          "Evaluate these links for mission relevance. Use:",
          `  arc skills run --name arc-link-research -- process --links "${linkList}"`,
        ].join("\n"),
        skills: JSON.stringify(["arc-link-research"]),
        priority: 7,
        model: "sonnet",
        source,
      });

      if (taskId === -1) {
        // insertTask's own github-escalation-guard sentinel (src/db.ts) — should
        // never fire for a "Research: ecosystem signal" subject, but if it does,
        // don't record a fake match: leave the candidate pending for the next
        // pass rather than falsely marking it matured with no real task behind it.
        log(`warn: insertTask blocked (github-escalation-guard) for candidate ${candidate.tweet_id} — left pending`);
        stillPending++;
        continue;
      }

      markCandidateMatured(candidate.tweet_id, taskId);
      matured++;
      log(`matured candidate ${candidate.tweet_id} -> task ${taskId}`);
    }

    log(
      `completed: ${batch.length} due, ${matured} matured (task filed), ${stillPending} still pending, ${rejectedAbsent} rejected (absent from response)`
    );
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
