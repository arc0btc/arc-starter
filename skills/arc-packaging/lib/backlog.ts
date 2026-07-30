// skills/arc-packaging/lib/backlog.ts
//
// Shared SKU-backlog parsing + candidate-selection logic — the SINGLE source of truth for
// "what should be packaged next," imported by BOTH cli.ts and sensor.ts.
//
// dev-council (Kleppmann, Lamport, Newman, Fowler — 2026-07-03, unanimous across 4 of 5 lenses)
// flagged the original design's two independently-written implementations (cli.ts's
// parseSkuBacklog()+selectCandidate() vs sensor.ts's own countBacklogAtOrAbove()) as the exact
// "dual source of truth" trap arc-article-pipeline's own P2 dev-council pass already fixed once
// (see that file's getRecentSlugRows() doc comment) — and it had ALREADY diverged into a real
// bug: sensor.ts's count-comparison gate (`backlogCount <= queuedCount`) silently stalled the
// pipeline around the halfway mark, because `queuedCount` (all rows ever inserted) and
// `backlogCount` (rows still in the "not yet packaged" table) move in opposite directions as
// reports get packaged. There is now exactly one selection function; both callers ask it the
// same question ("does an eligible candidate exist right now") instead of computing two
// aggregates that can disagree.

import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

const SKU_BACKLOG_HEADING = "## SKU backlog — sku_candidate, not yet packaged";

export interface BacklogRow {
  relevance: number;
  topics: string;
  repos: string;
  skuWhy: string;
  reportFile: string;
}

export function parseSkuBacklog(indexPath: string): BacklogRow[] {
  const text = readFileSync(indexPath, "utf-8");
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === SKU_BACKLOG_HEADING);
  if (startIdx === -1) return [];

  const rows: BacklogRow[] = [];
  let sawHeader = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    // parts[0] = "" (leading pipe), [1]=relevance, [2]=topics, [3]=repos, [4]=sku_why,
    // [5]=report link markdown, [6]="" (trailing pipe)
    const parts = trimmed.split("|").map((s) => s.trim());
    if (!sawHeader) {
      if (/^relevance$/i.test(parts[1] ?? "")) sawHeader = true;
      continue;
    }
    if (/^:?-+:?$/.test((parts[1] ?? "").replace(/\s/g, ""))) continue; // markdown separator row

    const relevance = parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(relevance)) continue;
    const linkMatch = (parts[5] ?? "").match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!linkMatch) continue;

    rows.push({
      relevance,
      topics: parts[2] ?? "",
      repos: parts[3] ?? "",
      skuWhy: parts[4] ?? "",
      reportFile: linkMatch[2],
    });
  }
  return rows;
}

/**
 * The single "what's next" predicate, shared by materials (which acts on the answer) and the
 * sensor (which only needs to know whether to queue a dispatch task).
 *
 * Resume-first (dev-council: Kleppmann's dropped-CAS finding + Newman's "orphaned candidate
 * never retried" finding, both 2026-07-03): a report already sitting at 'queued' or 'claimed' —
 * an interrupted prior attempt — always wins over starting something new, so a crash between
 * `materials` and a completed `stage` gets picked back up automatically on the next cycle
 * instead of silently occupying a queue slot forever.
 */
export function selectCandidate(
  db: Database,
  indexPath: string,
  reportOverride?: string,
): BacklogRow | null {
  const allRows = parseSkuBacklog(indexPath);

  // An explicit override is deliberate human/task intent (e.g. bundling a sub-threshold report
  // into a cluster SKU per its own sku_why note) — it should not be silently vetoed by the
  // relevance>=4 gate that exists to keep the *automatic* picker on quality candidates.
  if (reportOverride) {
    return allRows.find((r) => r.reportFile === reportOverride) ?? null;
  }

  const rows = allRows.filter((r) => r.relevance >= 4);

  const stuck = db
    .query(
      "SELECT report_file FROM packaging_queue_log WHERE status IN ('queued','claimed') ORDER BY queued_at ASC LIMIT 1",
    )
    .get() as { report_file: string } | undefined;
  if (stuck) {
    const row = rows.find((r) => r.reportFile === stuck.report_file);
    if (row) return row;
    // Fell out of the live backlog table (packaged another way, or the report's front-matter
    // was hand-edited) but the queue row isn't 'packaged' — surface it anyway so a resume
    // attempt is still possible instead of silently stranding it.
    return {
      relevance: 0,
      topics: "",
      repos: "",
      skuWhy: "(resumed from packaging_queue_log — not present in the live SKU backlog table)",
      reportFile: stuck.report_file,
    };
  }

  if (rows.length === 0) return null;
  const queued = new Set(
    (db.query("SELECT report_file FROM packaging_queue_log").all() as { report_file: string }[]).map(
      (r) => r.report_file,
    ),
  );
  const ordered = [...rows].sort((a, b) =>
    b.relevance !== a.relevance ? b.relevance - a.relevance : a.reportFile.localeCompare(b.reportFile),
  );
  return ordered.find((r) => !queued.has(r.reportFile)) ?? null;
}
