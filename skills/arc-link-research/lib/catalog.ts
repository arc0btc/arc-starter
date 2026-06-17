#!/usr/bin/env bun

// skills/arc-link-research/lib/catalog.ts
//
// The research CATALOG (research-to-SKU pipeline, P10B): turns the parsed
// front-matter of every report into research/INDEX.md, and answers the dedup query
// "is this url/topic already covered?". This is the running shelf that powers (1)
// dedup — don't re-research what's covered (anti-slop), and (2) the SKU backlog —
// the unpackaged sku_candidate reports create-product (P10A) restocks the catalog from.
//
// PURE: operates over already-parsed entries; no file IO, no network, no clock
// (the caller passes generatedAt — Date.now() is intentionally NOT used so output
// is deterministic and testable).

import type { ResearchFrontmatter } from "./frontmatter.ts";

export interface CatalogEntry {
  /** The report's filename (relative to research/), used as the INDEX link target. */
  path: string;
  fm: ResearchFrontmatter;
}

/** Normalize a URL for dedup comparison: lowercase, drop fragment/query/trailing slash. */
export function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().split("#")[0].split("?")[0].replace(/\/+$/, "");
}

/** A source_url that is not a real, dedup-able single link. Multi-link "batch" reports
 *  and empty source_urls must NOT URL-match each other (they'd all collide on the same
 *  bucket and report spurious coverage). Topic overlap is the dedup path for those. */
function isDedupableUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return u.length > 0 && u !== "batch";
}

/** Escape a value for a markdown table cell (a literal `|` or newline breaks the row). */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Sort: highest arc_relevance first, then most-recent fetched_at first. */
function byRelevanceThenRecency(a: CatalogEntry, b: CatalogEntry): number {
  if (b.fm.arc_relevance !== a.fm.arc_relevance) return b.fm.arc_relevance - a.fm.arc_relevance;
  return b.fm.fetched_at.localeCompare(a.fm.fetched_at);
}

/**
 * Reports already covering a url or any of the given topics — the dedup gate. A
 * match means "don't fork a duplicate; update the existing report if there's new
 * signal" (prompt-template discipline). URL match is exact-after-normalize; topic
 * match is any case-insensitive overlap.
 */
export function findCoverage(
  entries: CatalogEntry[],
  query: { url?: string; topics?: string[] },
): CatalogEntry[] {
  const qUrl = query.url && isDedupableUrl(query.url) ? normalizeUrl(query.url) : "";
  const qTopics = new Set((query.topics ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean));
  // NOTE: topic match is exact (case-insensitive) token equality — "x402" ≠ "x402-payments".
  // Topics should reuse existing catalog names (see REPORT-TEMPLATE §1); fuzzier matching is
  // a deferred refinement (substring match over-matches; a controlled vocab is the real fix).
  return entries.filter((e) => {
    if (qUrl && isDedupableUrl(e.fm.source_url) && normalizeUrl(e.fm.source_url) === qUrl) return true;
    if (qTopics.size > 0) {
      for (const t of e.fm.topics) if (qTopics.has(t.trim().toLowerCase())) return true;
    }
    return false;
  });
}

const yn = (b: boolean) => (b ? "y" : "n");

/**
 * Build the research/INDEX.md body. `legacyCount` = reports found without standard
 * front-matter (pre-standard); reported as a tail count so coverage is honest, not
 * silently dropped.
 */
export function buildIndex(
  entries: CatalogEntry[],
  opts: { generatedAt: string; legacyCount: number },
): string {
  const sorted = [...entries].sort(byRelevanceThenRecency);
  const skuBacklog = sorted.filter((e) => e.fm.sku_candidate && !e.fm.packaged);
  const packaged = sorted.filter((e) => e.fm.packaged);

  const lines: string[] = [
    "# Research Index",
    "",
    "Auto-generated catalog of standard-front-matter research reports — the dedup",
    "shelf + the SKU backlog. Rebuild with `arc skills run --name arc-link-research -- reindex`.",
    "Do NOT hand-edit; edit a report's front-matter then reindex.",
    "",
    `_Generated: ${opts.generatedAt} · ${sorted.length} catalogued · ` +
      `${skuBacklog.length} SKU candidate(s) unpackaged · ${packaged.length} packaged · ` +
      `${opts.legacyCount} legacy (no front-matter)_`,
    "",
    "## SKU backlog — sku_candidate, not yet packaged",
    "",
  ];

  if (skuBacklog.length === 0) {
    lines.push("_None. (A report with `sku_candidate: y` + `packaged: n` lands here — the create-product backlog.)_");
  } else {
    lines.push("| relevance | topics | repos | why it'd sell | report |");
    lines.push("|---|---|---|---|---|");
    for (const e of skuBacklog) {
      lines.push(
        `| ${e.fm.arc_relevance} | ${cell(e.fm.topics.join(", "))} | ${e.fm.repos_touched} | ${cell(e.fm.sku_why)} | [${cell(e.path)}](${e.path}) |`,
      );
    }
  }

  lines.push("", "## All catalogued reports", "");
  if (sorted.length === 0) {
    lines.push("_None yet. New reports written with standard front-matter appear here on reindex._");
  } else {
    lines.push("| relevance | topics | repos | sku? | packaged? | fetched | report |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const e of sorted) {
      lines.push(
        `| ${e.fm.arc_relevance} | ${cell(e.fm.topics.join(", "))} | ${e.fm.repos_touched} | ` +
          `${yn(e.fm.sku_candidate)} | ${yn(e.fm.packaged)} | ${cell(e.fm.fetched_at) || "—"} | [${cell(e.path)}](${e.path}) |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
