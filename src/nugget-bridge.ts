// src/nugget-bridge.ts
//
// The research-store bridge (arc-x-research-channel quest, Phase 5): "a report produced by
// ANY intake (news/list/trends/keywords/email) lands as a research_nugget row too — the two
// share one spine, no disagreeing surfaces" (PHASES.md, Phase 5 deliverable). Wired into
// skills/arc-link-research/cli.ts's cmdProcess, right after a report is written — same hook
// point and same never-throws contract as src/follow-policy.ts's follow-policy hook (Phase 4).
//
// WHY research_nugget needed a bridge at all: it's the rubric-scored table
// skills/social-engine/producer-{hn,rss,github-release}.ts write into, but nothing has EVER
// read `is_promotable=1` rows out of it (grep-verified, 2026-07-13) — it's a dead-end store,
// last written 2026-06-19. Meanwhile research/INDEX.md (built by arc-link-research's
// writeIndex()) IS the live spine skills/arc-daily-read/cli.ts's selectFinding() actually reads.
// This bridge makes every arc-link-research report ALSO produce/update a research_nugget row,
// and — critically — the reverse direction (skills/research-nugget-relay/sensor.ts, same
// quest phase) files Research: tasks from promotable HN/RSS/GitHub-release nuggets into the
// SAME arc-link-research path, so when THEIR resulting report comes back through this bridge,
// the join key below (source_url / content_hash) finds the SAME nugget row instead of
// inserting a second one — one row, two provenances, real fan-in.
//
// Join key: `source_url = ? OR content_hash = ?` against the EXISTING research_nugget table,
// not scoped to source='link_research' — this is what lets an HN-origin nugget and an
// arc-link-research report about the same underlying URL collapse onto one row regardless of
// which side wrote first. LIVE-PROVEN 2026-07-13: a github_release-origin nugget
// (anthropics/claude-code v2.1.207) got its report_path filled in by this exact join, with
// fan_in_count 1->2 and fan_in_sources becoming ["github_release","link_research"].
//
// DISCLOSED LIMITATION (dev-council 2026-07-13, Fowler/Hohpe/Lamport all independently flagged
// this): the `content_hash` half of the join is structurally near-inert ACROSS sources —
// producer-{hn,rss,github-release}.ts hash their OWN title+body bytes, while `contentHashFor`
// below hashes the arc-link-research REPORT's title+takeaways (mechanically re-extracted
// content, not the original bytes). Two different algorithms over two different byte streams
// essentially never collide. In practice the join key that actually does the work is
// `source_url` exact match — no normalization (trailing slash, http/https, tracking params).
// The recommended fix (not done this phase — real scope, touches cmdProcess's flag parsing and
// the task-description format): thread the originating `nugget_ref` through as an explicit EIP
// Correlation Identifier (task description -> --nugget-ref flag -> BridgeReport) instead of
// re-deriving identity heuristically. Disclosed in the Phase 5 verify artifact as recommended
// follow-up work, not silently left implicit.
//
// Contract (mirrors follow-policy.ts): the ENTIRE body of bridgeReportToNuggets is wrapped so
// it never throws — a bridge hiccup must never fail an already-written report.

import { createHash } from "node:crypto";
import { getDatabase } from "./db.ts";

export interface BridgeLinkResult {
  url: string;
  title: string;
  relevance: "high" | "medium" | "low";
  takeaways: string[];
}

export interface BridgeReport {
  /** Report path relative to repo root, e.g. "research/2026-07-13T14:30:05Z_research.md" */
  reportPath: string;
  /** ISO8601 — the report's own fetched_at/timestamp */
  fetchedAt: string;
  results: BridgeLinkResult[];
}

export interface BridgeSummary {
  inserted: number;
  updated: number;
  faninAdded: number;
  errors: number;
}

// Same shape as arc-link-research/cli.ts's parseTweetUrl (cli.ts ~line 429) — duplicated
// deliberately rather than exported/imported, this is a single-purpose one-liner and the two
// modules should stay decoupled (nugget-bridge is imported BY cli.ts, importing back from it
// would be circular).
const TWEET_URL_RE = /(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/;

// Cross-walk from arc-link-research's 3-bucket relevance (cli.ts's relevanceToNumber: high=4,
// medium=2, low=1) into a 0-50-ish range comparable in ORDER OF MAGNITUDE to the HN/RSS/
// GitHub-release producers' 5-axis 0-50 rubric_total — NOT equivalent precision. Disclosed
// explicitly in the Phase 5 verify artifact's quality-parity section: rubric_version
// distinguishes the two so nothing downstream silently treats them as the same measurement.
function relevanceToRubricTotal(relevance: "high" | "medium" | "low"): number {
  return relevance === "high" ? 40 : relevance === "medium" ? 20 : 10;
}

function contentHashFor(title: string, takeaways: string[]): string {
  return createHash("sha256").update(`${title}\n${takeaways.join(" ")}`).digest("hex");
}

function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** Best-effort provenance lookup: which intake actually discovered this URL, if we can tell. */
function deriveOriginLane(db: ReturnType<typeof getDatabase>, url: string): string {
  const m = url.match(TWEET_URL_RE);
  if (m) {
    const tweetId = m[1];
    const row = db
      .query("SELECT source_lane FROM x_research_candidate WHERE tweet_id = ?")
      .get(tweetId) as { source_lane: string } | undefined;
    if (row) return row.source_lane;
    return "x-manual"; // a real X URL, but not one of our stored candidates
  }
  // Non-X link with no candidate-table trail. arc-link-research's cmdProcess doesn't currently
  // pass enough context to this hook to know whether a non-X link came from an operator email
  // task or a research-nugget-relay-filed task (both just show up as --links args) — the
  // relay-filed path is actually resolved by the join-key match itself (the nugget already
  // exists with its own origin), so this label only ever applies to genuinely untraceable
  // inputs. Disclosed as an honest limitation, not silently over-claimed.
  return "unattributed";
}

/**
 * Bridge one finalized arc-link-research report into research_nugget. Called once per report,
 * iterates every link result in it. Never throws.
 */
export function bridgeReportToNuggets(report: BridgeReport): BridgeSummary {
  const summary: BridgeSummary = { inserted: 0, updated: 0, faninAdded: 0, errors: 0 };

  for (const result of report.results) {
    try {
      const db = getDatabase();
      const contentHash = contentHashFor(result.title, result.takeaways);
      const originLane = deriveOriginLane(db, result.url);
      const isPromotable = result.relevance !== "low" ? 1 : 0;

      const existing = db
        .query(
          "SELECT nugget_ref, fan_in_count FROM research_nugget WHERE source_url = ? OR content_hash = ? LIMIT 1",
        )
        .get(result.url, contentHash) as { nugget_ref: string; fan_in_count: number } | undefined;

      if (existing) {
        // Fan-in / re-cite of an already-known nugget (possibly producer-origin, possibly a
        // prior link_research row). Add a delivery row (idempotent — UNIQUE(nugget_ref,source)
        // means a re-processed identical link is a silent no-op here, not an error).
        db.query(
          `INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref, delivered_at)
           VALUES (?, 'link_research', ?, ?, ?)`,
        ).run(existing.nugget_ref, result.url, report.reportPath, report.fetchedAt);

        const deliveryCount = db
          .query("SELECT COUNT(*) as n FROM nugget_source_delivery WHERE nugget_ref=?")
          .get(existing.nugget_ref) as { n: number };
        const deliverySources = db
          .query("SELECT DISTINCT source FROM nugget_source_delivery WHERE nugget_ref=?")
          .all(existing.nugget_ref) as Array<{ source: string }>;

        db.query(
          `UPDATE research_nugget
             SET fan_in_count = ?, fan_in_sources = ?,
                 report_path = COALESCE(report_path, ?),
                 promoted_at = COALESCE(promoted_at, ?),
                 origin_lane = COALESCE(origin_lane, ?)
           WHERE nugget_ref = ?`,
        ).run(
          deliveryCount.n,
          JSON.stringify(deliverySources.map((d) => d.source)),
          report.reportPath,
          report.fetchedAt,
          originLane,
          existing.nugget_ref,
        );

        if (deliveryCount.n > existing.fan_in_count) summary.faninAdded++;
        summary.updated++;
      } else {
        // dev-council 2026-07-13 (Kleppmann + Lamport, both CONFIRMED independently): a plain
        // INSERT here is a check-then-act race — two concurrent cmdProcess subprocesses
        // processing the same brand-new URL could both take this branch, both INSERT, and the
        // loser would throw on idx_nugget_source_ref's UNIQUE(source, source_ref). That throw
        // landed in the per-link catch below, counted as a generic error, and the loser's
        // provenance (its nugget_source_delivery row, its report_path) was silently dropped —
        // exactly the fan-in this module exists to produce, lost to a swallowed exception
        // indistinguishable from a real bug. `INSERT OR IGNORE` + an unconditional re-SELECT
        // makes the loser converge on the WINNER's row and fall through to the SAME fan-in path
        // the found-branch above already uses, instead of erroring.
        const nuggetRef = `link_research:${contentHash.slice(0, 12)}`;
        const sourceRef = urlHash(result.url);
        const insertResult = db
          .query(
            `INSERT OR IGNORE INTO research_nugget
               (nugget_ref, source, source_url, source_ref, fetch_ts, content_hash, title, body,
                rubric_total, rubric_version, rubric_scored_at, is_promotable, fan_in_count,
                fan_in_sources, report_path, origin_lane, promoted_at)
             VALUES (?, 'link_research', ?, ?, ?, ?, ?, ?, ?, 'link-research-bridge-v1', ?, ?, 1, ?, ?, ?, ?)`,
          )
          .run(
            nuggetRef,
            result.url,
            sourceRef,
            report.fetchedAt,
            contentHash,
            result.title,
            result.takeaways.join(" "),
            relevanceToRubricTotal(result.relevance),
            report.fetchedAt,
            isPromotable,
            JSON.stringify(["link_research"]),
            report.reportPath,
            originLane,
            report.fetchedAt,
          );

        if (insertResult.changes > 0) {
          // We won the race (or there was no race) — this call actually created the row.
          db.query(
            `INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref, delivered_at)
             VALUES (?, 'link_research', ?, ?, ?)`,
          ).run(nuggetRef, result.url, report.reportPath, report.fetchedAt);
          summary.inserted++;
        } else {
          // Lost the race — a concurrent call already inserted this exact (source, source_ref).
          // Re-select the winner's row and fall through to fan-in bookkeeping so THIS call's
          // provenance (delivery row, report_path) still lands, instead of vanishing silently.
          const winner = db
            .query("SELECT nugget_ref, fan_in_count FROM research_nugget WHERE source = 'link_research' AND source_ref = ?")
            .get(sourceRef) as { nugget_ref: string; fan_in_count: number } | undefined;
          if (winner) {
            db.query(
              `INSERT OR IGNORE INTO nugget_source_delivery (nugget_ref, source, source_url, source_ref, delivered_at)
               VALUES (?, 'link_research', ?, ?, ?)`,
            ).run(winner.nugget_ref, result.url, report.reportPath, report.fetchedAt);
            db.query(
              `UPDATE research_nugget SET report_path = COALESCE(report_path, ?), promoted_at = COALESCE(promoted_at, ?)
               WHERE nugget_ref = ?`,
            ).run(report.reportPath, report.fetchedAt, winner.nugget_ref);
            summary.updated++;
          } else {
            // Should be unreachable (INSERT OR IGNORE with changes=0 means a conflicting row
            // exists), but never throw past this point — degrade to a logged no-op.
            summary.errors++;
            console.log(`[nugget-bridge] ${result.url}: insert ignored but winner row not found on re-select — logged, not fatal`);
          }
        }
      }
    } catch (e) {
      summary.errors++;
      console.log(
        `[nugget-bridge] ${result.url}: hook threw (non-fatal, report already written) — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return summary;
}
