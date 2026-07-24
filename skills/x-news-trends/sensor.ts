// skills/x-news-trends/sensor.ts
//
// The News/Trends "what's hot" front door onto the Phase 2 candidate-maturation
// spine (arc-x-research-channel quest, Phase 3). Mirrors the Arxiv digest's
// operating shape (operator-locked 2026-07-13): a scheduled check-in — default
// every 24h, dial for 8h/4h via CHECKIN_INTERVAL_HOURS below — pulls X's
// purpose-built discovery surfaces, applies a standing research prompt (this
// file IS the standing prompt, replacing the operator's per-email prompt), and
// emits candidates. Each matured candidate ultimately becomes an ISO-dated
// research artifact via the UNCHANGED arc-link-research path
// (research/{ISO8601}_research.md) — same shape as arxiv-research's
// research/arxiv/{ISO8601}_arxiv_digest.md, no new artifact-writing code needed.
//
// Three lanes, three different auth/billing shapes (all confirmed LIVE this
// phase, not just inferred from docs):
//   - "trends"              WOEID trends, $0.010/request (confirmed), FLAT
//                           billing (X prices this per-request, not per
//                           resource — a 20-item response still costs $0.010).
//                           Requires OAuth 2.0 App-Only (xApiGetAppOnly) —
//                           OAuth 1.0a is explicitly REJECTED by this endpoint
//                           (403 "Unsupported Authentication").
//   - "trends-personalized" Arc's own personalized_trends (X Premium,
//                           operator-confirmed available on @arc0btc), FLAT
//                           billing, $0.010 ESTIMATED (not itemized separately
//                           on the public rate card). Uses the EXISTING OAuth
//                           1.0a xApiGet path — confirmed live to work
//                           unmodified; App-Only is explicitly REJECTED here
//                           (the opposite auth requirement from WOEID trends).
//   - "news-search"         Grok news stories + driving post IDs, PER-RESOURCE
//                           billing, $0.005/story ESTIMATED (no line item on
//                           the public rate card at all — Phase 1 console
//                           reconciliation item 1). Requires OAuth 2.0
//                           App-Only, same as WOEID trends. Every single call
//                           logs a loud, unmissable pricing warning — never
//                           let an unconfirmed price look identical to a
//                           confirmed one in the logs OR the ledger (the
//                           ledger itself carries pricing_status:"estimated").
//
// Trends do NOT produce candidates directly — WOEID/personalized trends
// return only {trend_name} (confirmed live, no post ids in either response),
// so x_research_candidate's NOT NULL UNIQUE tweet_id has nothing to key on.
// Trends instead BIAS which News-search queries run this cycle (PHASES.md:
// "Use both to bias/seed News queries and surface trending entities"). Only
// News search's cluster_posts_results[].post_id values become candidates
// (source_lane="news-search") — the maturation pass (skills/
// candidate-maturation/sensor.ts, UNCHANGED, generic over source_lane) re-
// scores them at 2-24h age exactly as it already does for keyword-rotation
// candidates.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertCandidateIfNew, type KnownSourceLane } from "../../src/candidate-spine.ts";
import { loadXCreds, xApiGet, xApiGetAppOnly } from "../social-x-posting/lib/x-api.ts";

const SENSOR_NAME = "x-news-trends";
// Cadence dial (operator-locked range: 24h default, 8h or 4h tunable) — this
// constant IS the dial, no separate config file. See the spend-modeling table
// in this phase's verify artifact before lowering it: at 4h the whole-channel
// worst case approaches the $1.00/day cap once candidate-maturation's own
// spend is added.
const CHECKIN_INTERVAL_HOURS = 24;
const INTERVAL_MINUTES = CHECKIN_INTERVAL_HOURS * 60;

const TRENDS_LANE = "trends";
const TRENDS_PERSONALIZED_LANE = "trends-personalized";
const NEWS_LANE: KnownSourceLane = "news-search"; // billing lane AND candidate source_lane — one spelling
const WOEID_WORLDWIDE = "1"; // no operator-specified WOEID; worldwide is the documented default

// Confirmed, Phase 1 console reconciliation §3.
const TRENDS_COST_USD = 0.01;
// News pricing is UNKNOWN (Phase 1 console reconciliation §1 — no line item on
// the public rate card for /2/news/search). Using the non-owned post-read rate
// as a conservative, CLEARLY-FLAGGED ESTIMATE (a "story" resource is
// structurally the closest analog to a post resource) — never silently
// treated as confirmed. Verify the real price in-console before trusting this
// number; see docs/observations/2026-07-13-x-console-reconciliation.md item 1.
const NEWS_COST_USD_ESTIMATE = 0.005;

// Mission-query seed list — same vocabulary as the retired social-x-ecosystem
// KEYWORDS list. Run all 4 every check-in (check-in cadence is far less
// frequent than the old 15-min rotation, so no rotation is needed here).
const MISSION_QUERIES = [
  "Bitcoin AI agent",
  "autonomous AI agents crypto",
  "Stacks blockchain STX",
  "AI developer tools agent framework",
];

// Trend-bias allowlist — a trend name containing (case-insensitive) any of
// these substrings is mission-relevant enough to bias a News query slot.
const MISSION_TERMS = ["bitcoin", "crypto", "stacks", "agent", " ai ", "llm", "claude", "x402", "stx"];

const MAX_POST_IDS_PER_STORY = 10; // bound candidate volume per story

const log = createSensorLogger(SENSOR_NAME);

interface TrendItem {
  trend_name: string;
}

interface NewsStory {
  id?: string;
  rest_id?: string;
  name: string;
  summary: string;
  category?: string;
  cluster_posts_results?: { post_id: string }[];
  contexts?: {
    entities?: {
      events?: string[];
      organizations?: string[];
      people?: string[];
      places?: string[];
      products?: string[];
    };
  };
}

function flattenEntities(story: NewsStory): string[] {
  const entities = story.contexts?.entities;
  if (!entities) return [];
  const all = [
    ...(entities.events ?? []),
    ...(entities.organizations ?? []),
    ...(entities.people ?? []),
    ...(entities.places ?? []),
    ...(entities.products ?? []),
  ];
  return Array.from(new Set(all));
}

function pickTrendBiasedQueries(trendNames: string[]): { queries: string[]; biasedWith?: string } {
  const queries = [...MISSION_QUERIES];
  const lowerTerms = MISSION_TERMS.map((t) => t.toLowerCase());
  for (const name of trendNames) {
    const lower = name.toLowerCase();
    if (lowerTerms.some((t) => lower.includes(t)) && !queries.includes(name)) {
      queries[queries.length - 1] = name;
      return { queries, biasedWith: name };
    }
  }
  return { queries };
}

export default async function xNewsTrendsSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log(`check-in started (cadence: ${CHECKIN_INTERVAL_HOURS}h)`);

    const creds = await loadXCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    const trendNames: string[] = [];

    // ---- WOEID trends (App-Only, flat-billed, confirmed price) ----
    try {
      const result = await xApiGetAppOnly(
        `/trends/by/woeid/${WOEID_WORLDWIDE}`,
        creds,
        {},
        { lane: TRENDS_LANE, costUsd: TRENDS_COST_USD, billMode: "flat", pricingStatus: "confirmed" },
      );
      const items = (result["data"] as TrendItem[] | undefined) ?? [];
      log(`WOEID trends (worldwide): ${items.length} item(s)`);
      for (const t of items) if (t.trend_name) trendNames.push(t.trend_name);
    } catch (e) {
      log(`warn: WOEID trends failed: ${(e as Error).message}`);
    }

    // ---- Personalized trends (existing OAuth 1.0a path, flat-billed, estimated price) ----
    try {
      const result = await xApiGet(
        "/users/personalized_trends",
        creds,
        {},
        { lane: TRENDS_PERSONALIZED_LANE, costUsd: TRENDS_COST_USD, billMode: "flat", pricingStatus: "estimated" },
      );
      const items = (result["data"] as TrendItem[] | undefined) ?? [];
      log(`personalized trends: ${items.length} item(s)`);
      for (const t of items) if (t.trend_name) trendNames.push(t.trend_name);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes("401") || message.includes("403")) {
        log(
          `blocked: personalized_trends auth rejected (${message}). Documented blocker — see verify artifact.`,
        );
      } else {
        log(`warn: personalized_trends failed (non-auth error): ${message}`);
      }
    }

    // ---- Trend-biased query selection ----
    const { queries, biasedWith } = pickTrendBiasedQueries(trendNames);
    log(
      biasedWith
        ? `queries this check-in (trend-biased with "${biasedWith}"): ${queries.join(" | ")}`
        : `queries this check-in (no mission-relevant trend found, static list): ${queries.join(" | ")}`,
    );

    // ---- News search producer (App-Only, per-resource-billed, ESTIMATED price) ----
    let storiesSeen = 0;
    let candidatesStored = 0;

    for (const query of queries) {
      try {
        log(
          `⚠️ PRICING UNCONFIRMED: /2/news/search billed at conservative estimate ` +
            `$${NEWS_COST_USD_ESTIMATE}/resource (no public rate-card line item — Phase 1 console ` +
            `reconciliation item 1). Verify the real price in the X developer console before trusting ` +
            `this lane's budget number.`,
        );
        const result = await xApiGetAppOnly(
          "/news/search",
          creds,
          {
            query,
            max_results: "10",
            max_age_hours: "24",
            "news.fields": "category,name,summary,cluster_posts_results,contexts",
          },
          { lane: NEWS_LANE, costUsd: NEWS_COST_USD_ESTIMATE, pricingStatus: "estimated" },
        );
        const stories = (result["data"] as NewsStory[] | undefined) ?? [];
        storiesSeen += stories.length;
        log(`news search "${query}": ${stories.length} stor${stories.length === 1 ? "y" : "ies"}`);

        for (const story of stories) {
          const entities = flattenEntities(story);
          const discoveryContext = `News: ${story.name} [${story.category ?? "uncategorized"}]`;
          const textSnippet =
            story.summary + (entities.length ? ` | Entities: ${entities.join(", ")}` : "");
          // Dedup WITHIN the story BEFORE capping (dev-council/Kleppmann lens,
          // 2026-07-13): cluster_posts_results can list the same post_id more
          // than once (observed live) — slicing first would let duplicates
          // consume the MAX_POST_IDS_PER_STORY budget and silently reduce how
          // many DISTINCT candidates a story yields.
          const postIds = Array.from(
            new Set((story.cluster_posts_results ?? []).map((p) => p.post_id)),
          ).slice(0, MAX_POST_IDS_PER_STORY);

          for (const postId of postIds) {
            const inserted = insertCandidateIfNew({
              tweet_id: postId,
              // Reuse the same NEWS_LANE constant used for billing above
              // (dev-council/Fowler lens, 2026-07-13) rather than a second
              // hand-typed "news-search" literal — one spelling, one place to
              // change if this lane is ever renamed.
              source_lane: NEWS_LANE,
              first_seen: new Date().toISOString(),
              text_snippet: textSnippet,
              urls: [`https://x.com/i/status/${postId}`],
              discovery_context: discoveryContext,
            });
            if (inserted) candidatesStored++;
          }
        }
      } catch (e) {
        log(`warn: news search "${query}" failed: ${(e as Error).message}`);
      }
    }

    log(
      `completed: ${trendNames.length} trend name(s) seen, ${queries.length} quer${
        queries.length === 1 ? "y" : "ies"
      } run, ${storiesSeen} stor${storiesSeen === 1 ? "y" : "ies"} seen, ${candidatesStored} candidate(s) stored`,
    );
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return `error: ${error.message}`;
  }
}
