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
//
// STANDING RESEARCH BRIEF (2026-07-13, arc-x-research-channel Phase 7 quality-fix
// pass): before this, the filed task's ENTIRE instruction was "Evaluate these links
// for mission relevance. Use: arc-link-research process --links ..." — the
// dispatched agent ran the mechanical `process` scaffold and stopped (empty
// sku_why, repos_touched:"unknown", no TL;DR — confirmed live on task #22284, the
// Phase 5 verify artifact's disclosed quality-parity gap). The operator's own
// email-batch tasks (#20099 opus, #20111 sonnet — BOTH good even on sonnet) embed a
// real editorial brief: pre-assessed relevance/angle + an explicit report-shape
// checklist + "reuse cache, don't re-run process" + a REQUIRED repo-grounded
// Arc-alignment note. The brief is the driver, not the model. buildStandingBrief
// (still used, now BY the triage task's own fan-out, see buildTriageBrief) mirrors
// that shape with data this sensor already has (discovery_context, source_lane,
// tweet text, engagement) — the operator's own "links + a prompt" input pattern,
// applied to Arc's own X research instead of an email.
//
// TWO-STAGE TRIAGE DISPATCH (2026-07-14, Phase 8 containment pass): measured
// 2026-07-14, this sensor's OLD one-task-per-candidate design cost $115.08/24h
// across 195 dispatched tasks, 64% of it paying opus/sonnet just to DECLINE junk
// (bare-t.co/RT-only candidates that could never have carried a report, plus
// off-mission stories re-declined up to 9x per viral event because nothing
// clustered same-story siblings). This sensor now:
//   1. Enriches every touched candidate with entities/referenced_tweets-derived
//      expanded URLs BEFORE scoring (updateCandidateEnrichment) — the actual root
//      cause fix; most "bare t.co" declines were never bare, just unexpanded.
//   2. Runs a cheap MECHANICAL pre-filter (isMechanicallyRejectable) that rejects
//      ONLY the structurally-zero-signal class (no URL + RT-only/thin text with no
//      mission keyword) — see src/candidate-spine.ts's module comment for exactly
//      which decline class this does and does NOT try to catch. Topical relevance
//      judgment is NEVER guessed here.
//   3. Clusters same-story survivors (computeClusterKey: canonical URL, else a
//      text-shingle key) both within this run AND against everything matured in
//      the last 24h, so one viral story collapses to ONE task lineage regardless
//      of how many sibling tweet_ids surface it.
//   4. Files exactly ONE triage task per run (not per candidate) listing every
//      surviving NEW cluster — mirrors the operator's own proven #20093 batch-
//      triage flow (read live from the DB: #20093 -> #20099/#20111). The triage
//      agent (opus, judgment work) decides RESEARCH/DECLINE per story and fans out
//      real per-topic tasks itself, each still carrying the Phase 7 standing brief.
//   5. Is bounded by a hard daily dispatch cap (MAX_SENSOR_RESEARCH_DISPATCHES_PER_DAY)
//      counted across the FULL lineage (triage + fan-out), not just top-level tasks.
//
// DEDUP: custom — this sensor's insertTask calls are deliberately NOT covered by
// pendingTaskExistsForSource/recentTaskExistsForSource: the triage task's `source` embeds a
// per-run timestamp (unique by design, so re-runs never collide on a stale in-flight task), and
// real dedup instead happens via (a) clusterIndex/computeClusterKey collapsing same-story
// candidates across runs (see markCandidateMatured calls above) and (b)
// countSensorResearchDispatchesToday's hard daily cap. See arc-skill-manager/sensor.ts's
// CUSTOM_DEDUP_MARKER for why this opts out of the generic named-helper check.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, countSensorResearchDispatchesToday } from "../../src/db.ts";
import {
  getMaturationBatch,
  expireStaleCandidates,
  markCandidateMatured,
  markCandidateRejected,
  isHighSignal,
  getRecentMaturedCandidates,
  isMechanicallyRejectable,
  computeClusterKey,
  extractExpandedUrls,
  classifyReferencedTweets,
  updateCandidateEnrichment,
  type XResearchCandidate,
  type MaturedCandidateSummary,
  type TweetEntities,
  type ReferencedTweet,
} from "../../src/candidate-spine.ts";
import { loadXCreds, xApiGet } from "../social-x-posting/lib/x-api.ts";
import { buildTriageBrief, type TriageCluster, type TriageClusterMember } from "../../src/research-brief.ts";

const SENSOR_NAME = "candidate-maturation";
const INTERVAL_MINUTES = 60;
const LANE = "candidate-maturation";
// Hard backstop (Phase 8 containment pass) — counts the FULL sensor-research dispatch lineage
// today (triage tasks + their per-topic fan-out children, see
// countSensorResearchDispatchesToday's doc comment), not just this sensor's own top-level
// filings. 15/day is a deliberate order-of-magnitude cut from the $115.08/195-task day this
// phase exists to fix — real research volume should be a handful of triage runs each fanning
// out a handful of genuinely research-worthy topics, not hundreds of individual judgments.
const MAX_SENSOR_RESEARCH_DISPATCHES_PER_DAY = 15;
// Bounds the SIZE of a single triage prompt (dev-council 2026-07-14, Newman + Hohpe, CONFIRMED):
// this quest's own history shows a single producer storing 251 candidates in one check-in, and
// the paging loop below can process up to 10 pages of 100 — an unbounded triage brief would
// both blow up opus input cost on a heavy news day AND ask one context to render a sound
// RESEARCH/DECLINE judgment over more stories than a single pass can reliably reason about.
// Bounding what's RENDERED also functions as a real (not just prose-instructed) ceiling on how
// much a single triage task CAN fan out — it cannot dispatch a per-topic task for a story it was
// never shown. Set well above a typical run's cluster count (66 candidates -> 52 clusters was a
// real live measurement) so ordinary days are never truncated; excess clusters are left
// genuinely 'pending' (not matured) for the next run to pick back up, same backpressure
// philosophy as the paging loop's own page-to-page deferral.
const MAX_CLUSTERS_PER_TRIAGE_BRIEF = 50;

const log = createSensorLogger(SENSOR_NAME);

/**
 * Model routing (operator directive, 2026-07-13: "never downgrade brainpower to
 * save tokens" — applied where the signal genuinely warrants it, not blanket-
 * upgraded). This lane has no separate 0-5 relevance score at filing time (only
 * isHighSignal's pass/fail gate) — engagement magnitude is the only signal in
 * hand, so route on it directly. Thresholds (dev-council 2026-07-13, Lamport
 * lens, CONFIRMED: an earlier version of this comment claimed "roughly 3x
 * isHighSignal's own threshold [5 likes/2 RTs/3 replies]" — stated precisely,
 * the actual multiples are 4x/2.5x/2.67x, and this is a per-dimension OR gate,
 * not a combined-magnitude score, so e.g. 5 RTs alone routes to opus while 19
 * likes + 4 RTs + 7 replies together does not): likes>=20 (4x), retweets>=5
 * (2.5x), OR replies>=8 (2.67x) — comfortably past "just cleared the bar" into
 * "genuinely resonating" on any ONE dimension, matching the Phase 6 close-out's
 * own observation that #20099's richest report was the one Opus worked
 * (relevance 4, 8.18M-impression source).
 */
function chooseModel(metrics: { like_count: number; retweet_count: number; reply_count: number }): "opus" | "sonnet" {
  if (metrics.like_count >= 20 || metrics.retweet_count >= 5 || metrics.reply_count >= 8) return "opus";
  return "sonnet";
}

// NOTE (Phase 8): the old buildStandingBrief() function that lived here is now dead code and
// has been removed — under the two-stage triage design below, THIS sensor never files a
// per-candidate task directly, so it never needs a per-candidate standing-brief description.
// The standing brief still applies to every per-topic task, just built BY the triage agent
// itself (buildTriageBrief in src/research-brief.ts embeds standingBriefSteps() verbatim into
// the triage task's own instructions for exactly this purpose — see that function).

interface MaturedTweet {
  id: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
  entities?: TweetEntities;
  referenced_tweets?: ReferencedTweet[];
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
    const CLUSTER_DEDUP_WINDOW_HOURS = 24;

    // Cross-run cluster-collapse index (Phase 8, supersedes the discovery_context-only
    // incident index): everything matured in the window, keyed by cluster_key (canonical
    // URL, else text-shingle — see computeClusterKey). A survivor in THIS run whose
    // cluster_key matches an entry here is the SAME story as something already dispatched
    // today — it collapses into that existing task lineage instead of triggering a new
    // triage/fan-out. Built once up front; this run's OWN new clusters aren't added here
    // until after the triage task is filed (they have no task id yet).
    //
    // `m.research_task_id !== null` guard (dev-council 2026-07-14, Kleppmann + Lamport +
    // Newman, CONFIRMED): a candidate matured via the cap-hit sentinel path below is stamped
    // `research_task_id=null` but STILL carries its real cluster_key. Without this guard, that
    // row becomes a permanent dedup magnet — every future sibling of that exact story, for the
    // rest of the 24h window, "cluster-dedups" onto the SAME null task and is marked matured
    // with no research ever dispatched. A cap-hit is supposed to be a temporary DEFERRAL; a
    // null-task cluster index entry silently turns it into a permanent SUPPRESSION of that
    // whole story. Excluding null-task rows here means a cap-dropped story's next sibling is
    // treated as a fresh, un-clustered survivor — it can seed a new triage attempt once the cap
    // has headroom again, instead of inheriting the drop forever.
    const clusterIndex = new Map<string, MaturedCandidateSummary>();
    for (const m of getRecentMaturedCandidates(CLUSTER_DEDUP_WINDOW_HOURS)) {
      if (m.cluster_key && m.research_task_id !== null && !clusterIndex.has(m.cluster_key)) {
        clusterIndex.set(m.cluster_key, m);
      }
    }

    interface Survivor {
      candidate: XResearchCandidate;
      tweet: MaturedTweet;
      expandedUrls: string[];
      clusterKey: string | null;
    }
    const survivors: Survivor[] = [];

    let totalDue = 0;
    let totalStillPending = 0;
    let totalMechanicallyRejected = 0;
    let totalClusterDeduped = 0;
    let totalNotReturned = 0;
    let iterations = 0;

    while (iterations < MAX_MATURATION_ITERATIONS) {
      const batch = getMaturationBatch(2, 24, 100);
      if (batch.length === 0) break;
      iterations++;
      totalDue += batch.length;
      log(`maturation batch ${iterations}: ${batch.length} candidate(s) due for re-score`);

      // ONE batched read per page — up to 100 ids, one metered call on the named
      // "candidate-maturation" lane. "entities,referenced_tweets" added (Phase 8) — X bills
      // per RESOURCE returned, not per field, so this is a zero-marginal-cost addition on an
      // already-billed read; it's the actual root-cause fix for "bare t.co" declines.
      const ids = batch.map((c) => c.tweet_id).join(",");
      const result = await xApiGet(
        "/tweets",
        creds,
        { ids, "tweet.fields": "created_at,public_metrics,entities,referenced_tweets" },
        { owned: false, lane: LANE }
      );

      const returned = (result["data"] as MaturedTweet[] | undefined) ?? [];
      const returnedById = new Map(returned.map((t) => [t.id, t]));

      let stillPendingThisPage = 0;
      let mechRejectedThisPage = 0;
      let clusterDedupedThisPage = 0;
      let notReturnedThisPage = 0;
      let survivorsThisPage = 0;

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
          if (changes > 0) notReturnedThisPage++;
          continue;
        }

        // Enrich BEFORE scoring (Phase 8) — every touched candidate gets a fresh
        // entities/referenced_tweets look regardless of eventual outcome (still-pending,
        // mechanically-rejected, cluster-deduped, or survivor), so the "expanded URLs now
        // stored" fix applies uniformly, not just to candidates that go on to dispatch.
        const existingUrls: string[] = candidate.urls ? JSON.parse(candidate.urls) : [];
        const expandedUrls = Array.from(
          new Set([...extractExpandedUrls(tweet.entities, candidate.tweet_id), ...existingUrls])
        );
        const { isRetweet, isQuote } = classifyReferencedTweets(tweet.referenced_tweets);
        updateCandidateEnrichment(candidate.tweet_id, { expandedUrls, isRetweet, isQuote });

        if (!isHighSignal(tweet.public_metrics)) {
          // Hasn't cleared the bar YET — leave 'pending' so it gets another look as
          // it ages further, until expireStaleCandidates retires it past 24h.
          stillPendingThisPage++;
          continue;
        }

        // Mechanical pre-filter (Phase 8) — rejects ONLY the structurally-zero-signal class
        // (no URL + RT-only/thin text with no mission keyword). Never guesses topical
        // relevance — see isMechanicallyRejectable's doc comment and the module header.
        const mech = isMechanicallyRejectable({
          expandedUrls,
          isRetweet,
          textSnippet: candidate.text_snippet ?? "",
        });
        if (mech.reject) {
          const { changes } = markCandidateRejected(candidate.tweet_id, mech.reason);
          if (changes > 0) mechRejectedThisPage++;
          log(`mechanical-reject: ${candidate.tweet_id} — ${mech.reason}`);
          continue;
        }

        const clusterKey = computeClusterKey({ expandedUrls, textSnippet: candidate.text_snippet ?? "" });
        const existingCluster = clusterKey ? clusterIndex.get(clusterKey) : undefined;
        if (existingCluster) {
          log(
            `cluster-dedup: candidate ${candidate.tweet_id} collapses into existing story ` +
              `(task ${existingCluster.research_task_id}), key="${clusterKey}"`
          );
          markCandidateMatured(candidate.tweet_id, existingCluster.research_task_id, clusterKey);
          clusterDedupedThisPage++;
          continue;
        }

        // A genuine new survivor — collected for this run's own clustering + triage,
        // NOT marked matured yet (that happens after the triage task exists, below, so
        // research_task_id can point at it).
        survivors.push({ candidate, tweet, expandedUrls, clusterKey });
        survivorsThisPage++;
      }

      totalStillPending += stillPendingThisPage;
      totalMechanicallyRejected += mechRejectedThisPage;
      totalClusterDeduped += clusterDedupedThisPage;
      totalNotReturned += notReturnedThisPage;

      // Stop paging once a page comes back short of the 100-id cap (nothing left due right
      // now) OR once a FULL page produced zero state transitions (every candidate in it is
      // still 'pending' — re-querying the identical oldest-100 set again THIS run would just
      // re-read the same rows for no new outcome).
      if (
        batch.length < 100 ||
        (survivorsThisPage === 0 && mechRejectedThisPage === 0 && clusterDedupedThisPage === 0 && notReturnedThisPage === 0)
      )
        break;
    }

    if (totalDue === 0) {
      log("no candidates due for maturation (2-24h window empty)");
      return "ok";
    }

    // ---- In-run story clustering + two-stage triage dispatch (Phase 8) ----
    // Group every NEW survivor (across ALL pages this run) by cluster_key — this collapses
    // same-story siblings discovered across different pages within this single run, on top
    // of the cross-run collapse already applied above.
    const newClustersAll = new Map<string, Survivor[]>();
    for (const s of survivors) {
      const groupKey = s.clusterKey ?? `singleton:${s.candidate.tweet_id}`;
      const group = newClustersAll.get(groupKey) ?? [];
      group.push(s);
      newClustersAll.set(groupKey, group);
    }

    // Bound triage-brief size (Phase 8, dev-council/Newman+Hohpe — see
    // MAX_CLUSTERS_PER_TRIAGE_BRIEF's doc comment): rank clusters by aggregate engagement,
    // process only the top N this run. Anything beyond the bound is left genuinely 'pending'
    // (never touched by markCandidateMatured below) — the NEXT run re-evaluates it fresh,
    // same backpressure the paging loop already applies page-to-page.
    function clusterEngagement(members: Survivor[]): number {
      return members.reduce(
        (max, m) =>
          Math.max(
            max,
            (m.tweet.public_metrics?.like_count ?? 0) +
              (m.tweet.public_metrics?.retweet_count ?? 0) * 2 +
              (m.tweet.public_metrics?.reply_count ?? 0) * 2
          ),
        0
      );
    }
    const rankedClusters = Array.from(newClustersAll.entries()).sort(
      ([, a], [, b]) => clusterEngagement(b) - clusterEngagement(a)
    );
    const newClusters = new Map(rankedClusters.slice(0, MAX_CLUSTERS_PER_TRIAGE_BRIEF));
    const deferredClusterCount = rankedClusters.length - newClusters.size;
    if (deferredClusterCount > 0) {
      const deferredCandidateCount = rankedClusters
        .slice(MAX_CLUSTERS_PER_TRIAGE_BRIEF)
        .reduce((n, [, members]) => n + members.length, 0);
      log(
        `brief-size bound: ${newClustersAll.size} storie(s) this run exceeds MAX_CLUSTERS_PER_TRIAGE_BRIEF ` +
          `(${MAX_CLUSTERS_PER_TRIAGE_BRIEF}) — processing the top ${newClusters.size} by engagement, ` +
          `deferring ${deferredClusterCount} lower-engagement storie(s) (${deferredCandidateCount} candidate(s)) to next run`
      );
    }
    const survivorsThisRun = Array.from(newClusters.values()).reduce((n, members) => n + members.length, 0);

    let totalMatured = 0;
    let triageTaskId: number | null = null;

    if (newClusters.size > 0) {
      const dispatchCount = countSensorResearchDispatchesToday();
      if (dispatchCount >= MAX_SENSOR_RESEARCH_DISPATCHES_PER_DAY) {
        // Hard backstop hit (Phase 8) — the exact invisibility this containment pass exists
        // to fix. Don't silently drop these candidates OR silently keep dispatching past the
        // cap: log loudly, and mark them matured-without-task (same null-research_task_id
        // sentinel already used elsewhere) so they don't churn 'pending' forever re-costing a
        // read every future maturation pass.
        log(
          `CAP HIT: ${dispatchCount}/${MAX_SENSOR_RESEARCH_DISPATCHES_PER_DAY} sensor research dispatches already filed today — ` +
            `skipping triage task this run, ${survivorsThisRun} candidate(s) across ${newClusters.size} storie(s) left un-dispatched (marked matured, no task)`
        );
        for (const [, members] of newClusters) {
          for (const s of members) {
            const { changes } = markCandidateMatured(s.candidate.tweet_id, null, s.clusterKey);
            if (changes > 0) totalMatured++;
          }
        }
      } else {
        const triageClusters: TriageCluster[] = Array.from(newClusters.entries()).map(([groupKey, members]) => {
          const aggMetrics = members.reduce(
            (agg, m) => ({
              like_count: Math.max(agg.like_count, m.tweet.public_metrics?.like_count ?? 0),
              retweet_count: Math.max(agg.retweet_count, m.tweet.public_metrics?.retweet_count ?? 0),
              reply_count: Math.max(agg.reply_count, m.tweet.public_metrics?.reply_count ?? 0),
            }),
            { like_count: 0, retweet_count: 0, reply_count: 0 }
          );
          return {
            clusterKey: groupKey.startsWith("singleton:") ? null : groupKey,
            suggestedModel: chooseModel(aggMetrics),
            members: members.map(
              (m): TriageClusterMember => ({
                tweetId: m.candidate.tweet_id,
                authorId: m.candidate.author_id ?? undefined,
                textSnippet: m.candidate.text_snippet ?? "",
                links: m.expandedUrls,
                likeCount: m.tweet.public_metrics?.like_count ?? 0,
                retweetCount: m.tweet.public_metrics?.retweet_count ?? 0,
                replyCount: m.tweet.public_metrics?.reply_count ?? 0,
                discoveryContext: m.candidate.discovery_context ?? undefined,
              })
            ),
          };
        });

        const runTimestamp = new Date().toISOString();
        const filedTaskId = insertTask({
          subject: `Triage: X research batch (${runTimestamp.slice(0, 10)}, ${triageClusters.length} stor${
            triageClusters.length === 1 ? "y" : "ies"
          } from ${survivorsThisRun} candidate(s))`,
          description: buildTriageBrief(triageClusters),
          skills: JSON.stringify(["arc-link-research"]),
          priority: 6,
          model: "opus", // judgment work — operator directive: never downgrade brainpower to save tokens
          source: `sensor:${SENSOR_NAME}:triage:${runTimestamp}`,
        });

        if (filedTaskId === -1) {
          // insertTask's own github-escalation-guard sentinel — should never fire for a
          // "Triage: X research batch" subject, but if it does, leave every survivor
          // genuinely 'pending' (do NOT mark matured) so the NEXT run retries them, rather
          // than permanently orphaning research_task_id=null for a block that isn't a
          // deliberate cap/policy decision.
          log(`warn: insertTask blocked (github-escalation-guard) for the triage task — ${survivorsThisRun} candidate(s) left pending for next run`);
        } else {
          triageTaskId = filedTaskId;
          for (const [groupKey, members] of newClusters) {
            const clusterKey = groupKey.startsWith("singleton:") ? null : groupKey;
            for (const m of members) {
              const { changes } = markCandidateMatured(m.candidate.tweet_id, triageTaskId, clusterKey);
              if (changes > 0) totalMatured++;
            }
            if (clusterKey && !clusterIndex.has(clusterKey)) {
              clusterIndex.set(clusterKey, {
                tweet_id: members[0].candidate.tweet_id,
                discovery_context: members[0].candidate.discovery_context,
                research_task_id: triageTaskId,
                cluster_key: clusterKey,
              });
            }
          }
          log(`filed triage task #${triageTaskId}: ${triageClusters.length} storie(s), ${survivors.length} candidate(s)`);
        }
      }
    }

    log(
      `completed: ${iterations} page(s), ${totalDue} due, ${totalMatured} matured ` +
        `(via ${triageTaskId ? `triage task #${triageTaskId}` : newClusters.size > 0 ? "cap-hit sentinel / pending retry" : "n/a"}), ` +
        `${totalClusterDeduped} cluster-deduped (existing story, no new task), ${totalMechanicallyRejected} mechanically rejected, ` +
        `${totalStillPending} still pending, ${totalNotReturned} rejected (absent from response)`
    );
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return `error: ${error.message}`;
  }
}
