// skills/candidate-maturation/sensor.ts
//
// The re-scoring half of the Option B candidate-maturation spine
// (arc-x-research-channel quest, Phase 2). Discovery lanes (currently
// social-x-ecosystem's keyword rotation; news-search/trends/list-roster join in
// Phases 3-4) STORE candidates on first sight via src/candidate-spine.ts instead
// of judging them at birth. This sensor is the ONLY place engagement is judged:
// once a candidate has aged 2-24h since first_seen, it's re-scored against FRESH
// metrics (fetched via batched GET /2/tweets?ids= — up to 100 ids per metered
// read on the named "candidate-maturation" lane) and, if it clears the same
// isHighSignal bar the old at-birth judge used, files a Research: task into
// the SAME arc-link-research path the working operator-email intake uses.
//
// PAGING (2026-07-13, arc-x-research-channel Phase 3, dev-council/Newman lens):
// a single run pages through ALL due candidates in ≤100-id batches, not just
// one 100-candidate batch — a single scheduled producer (x-news-trends) was
// observed live to store 251 candidates in one check-in, and capping this pass
// at one page meant the tail sat billed-but-unread until it expired at 24h.
// Same-UTC-day per-id dedup makes paging free if pages ever overlap.
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

    const creds = await loadXCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    // Drain the WHOLE due set this cycle in ≤100-id pages, not just one
    // 100-candidate batch (dev-council/Newman lens, 2026-07-13, Phase 3 —
    // CONFIRMED, live-observed: a single scheduled producer (x-news-trends)
    // stored 251 candidates in ONE check-in run. `getMaturationBatch`'s
    // `ORDER BY first_seen ASC LIMIT 100` always returned the SAME oldest 100
    // once one pass had already looked at them, so the tail ~150 sat
    // 'pending' — billed for discovery, never re-scored — until
    // `expireStaleCandidates(24)` retired them unread. This is exactly the
    // scaling limit Phase 2's own council disclosed ("once Phase 3/4's
    // combined inflow exceeds [100/hr], oldest candidates could expire
    // unread") — it went live the moment Phase 3 shipped a real producer.
    // Same-UTC-day per-tweet-id dedup (billResourceRead) means paging costs
    // nothing extra if a page happens to overlap a previous one — X only
    // bills for ids not already billed in this lane today.
    const MAX_MATURATION_ITERATIONS = 10; // bounds worst case at 1000 candidates/cycle
    let totalDue = 0;
    let totalMatured = 0;
    let totalStillPending = 0;
    let totalRejected = 0;
    let iterations = 0;

    while (iterations < MAX_MATURATION_ITERATIONS) {
      const batch = getMaturationBatch(2, 24, 100);
      if (batch.length === 0) break;
      iterations++;
      totalDue += batch.length;
      log(`maturation batch ${iterations}: ${batch.length} candidate(s) due for re-score`);

      // ONE batched read per page — up to 100 ids, one metered call on the
      // named "candidate-maturation" lane (NOT the generic "tweets" lane
      // fetchRecentPostMetrics uses for the same endpoint — a fresh named
      // lane per quest binding constraint, via xApiGet's opts.lane override,
      // Phase 2).
      const ids = batch.map((c) => c.tweet_id).join(",");
      const result = await xApiGet(
        "/tweets",
        creds,
        { ids, "tweet.fields": "created_at,public_metrics" },
        { owned: false, lane: LANE }
      );

      const returned = (result["data"] as MaturedTweet[] | undefined) ?? [];
      const returnedById = new Map(returned.map((t) => [t.id, t]));

      let maturedThisPage = 0;
      let rejectedThisPage = 0;
      let stillPendingThisPage = 0;

      for (const candidate of batch as XResearchCandidate[]) {
        const tweet = returnedById.get(candidate.tweet_id);

        if (!tweet) {
          // X no longer returns this id (deleted/protected/suspended since
          // discovery) — it will never mature. Reject now rather than re-trying
          // every cycle until it eventually expires. The `AND status='pending'`
          // guard inside markCandidateRejected (dev-council/Lamport lens,
          // 2026-07-13) makes this a no-op (changes: 0) if another overlapping
          // run already transitioned this row — don't double-count it.
          const { changes } = markCandidateRejected(candidate.tweet_id);
          if (changes > 0) rejectedThisPage++;
          continue;
        }

        if (!isHighSignal(tweet.public_metrics)) {
          // Hasn't cleared the bar YET — leave 'pending' so it gets another look as
          // it ages further, until expireStaleCandidates retires it past 24h.
          stillPendingThisPage++;
          continue;
        }

        const source = `sensor:${SENSOR_NAME}:${candidate.tweet_id}`;
        if (recentTaskExistsForSource(source, 24 * 60)) {
          // Already filed (shouldn't normally happen — a candidate is marked
          // 'matured' in the same pass that files its task — but guards a
          // partial-write retry). `null` = "matured via a pre-existing task, id
          // not re-looked-up here" — NEVER write a sentinel like 0 into
          // research_task_id (REFERENCES tasks(id), no task id 0 exists;
          // dev-council/Fowler + Kleppmann lenses, 2026-07-13), and distinct from
          // insertTask's own -1 (github-escalation-guard) sentinel handled below.
          markCandidateMatured(candidate.tweet_id, null);
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
          stillPendingThisPage++;
          continue;
        }

        // `AND status='pending'` inside markCandidateMatured (dev-council/Lamport
        // lens, 2026-07-13) makes this the linearization point for this
        // candidate's state transition: changes===0 means another overlapping
        // run already matured/rejected/expired it first. A task was still filed
        // above in that (rare, single-systemd-timer-in-practice) race — this
        // doesn't retract it, it just avoids double-counting the maturation.
        const { changes } = markCandidateMatured(candidate.tweet_id, taskId);
        if (changes > 0) {
          maturedThisPage++;
          log(`matured candidate ${candidate.tweet_id} -> task ${taskId}`);
        } else {
          log(`warn: candidate ${candidate.tweet_id} was already transitioned by another run — task ${taskId} filed but not counted as this run's maturation`);
        }
      }

      totalMatured += maturedThisPage;
      totalStillPending += stillPendingThisPage;
      totalRejected += rejectedThisPage;

      // Stop paging once a page comes back short of the 100-id cap (there's
      // nothing left due right now) OR once a FULL page produced zero state
      // transitions (every candidate in it is still 'pending' — re-querying
      // the identical oldest-100 set again THIS run would just re-read the
      // same rows for no new outcome; they'll be picked up again next cycle
      // as they age further).
      if (batch.length < 100 || (maturedThisPage === 0 && rejectedThisPage === 0)) break;
    }

    if (totalDue === 0) {
      log("no candidates due for maturation (2-24h window empty)");
      return "ok";
    }

    log(
      `completed: ${iterations} page(s), ${totalDue} due, ${totalMatured} matured (task filed), ${totalStillPending} still pending, ${totalRejected} rejected (absent from response)`
    );
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
