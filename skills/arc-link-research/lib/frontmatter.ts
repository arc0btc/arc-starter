#!/usr/bin/env bun

// skills/arc-link-research/lib/frontmatter.ts
//
// The machine-parseable RESEARCH FRONT-MATTER standard (research-to-SKU pipeline,
// P10B). Every research report carries a `---`-fenced front-matter block so the
// catalog (lib/catalog.ts → research/INDEX.md) can rank, dedup, and surface
// SKU candidates WITHOUT re-reading prose — the missing link between the research
// shelf and the product catalog (create-product, P10A).
//
// PURE: parse / serialize / validate only. No file IO, no network. Line-based (no
// YAML dependency — the repo has none), matching the existing src/skills.ts parser
// idiom (the same `---\n…\n---` fence + `key: value` + inline `[a, b]` arrays).

/** repos a finding touches — drives the arc-starter-vs-agent-runtime split (the
 *  "port to agent-runtime levels up every agent" call from the prompt template). */
export const REPOS_TOUCHED = ["arc-starter", "agent-runtime", "both", "neither", "unknown"] as const;
export type ReposTouched = (typeof REPOS_TOUCHED)[number];

export interface ResearchFrontmatter {
  source_url: string; // canonical source link (or "batch" / "" for multi-link reports)
  cached_path: string; // where the raw fetch is cached (provenance for the paid "verify before you buy")
  fetched_at: string; // ISO-8601
  task_id: string; // dispatch task id
  parent: string; // parent task id (batches)
  topics: string[]; // normalized topic tags — the dedup + catalog key
  arc_relevance: number; // 0–5; ≤1 = skip (anti-slop gate)
  repos_touched: ReposTouched;
  sku_candidate: boolean; // is this worth packaging as a $9 SKU?
  sku_why: string; // one-line rationale
  packaged: boolean; // has a Whop SKU already been minted from this report?
  product_id: string; // the minted Whop product id, once packaged (the catalog↔SKU join key)
}

export const RELEVANCE_MIN = 0;
export const RELEVANCE_MAX = 5;
/** Reports at/below this score are noise — skipped, not catalogued as candidates. */
export const RELEVANCE_SKIP_AT_OR_BELOW = 1;

export function emptyFrontmatter(): ResearchFrontmatter {
  return {
    source_url: "",
    cached_path: "",
    fetched_at: "",
    task_id: "",
    parent: "",
    topics: [],
    arc_relevance: 0,
    repos_touched: "unknown",
    sku_candidate: false,
    sku_why: "",
    packaged: false,
    product_id: "",
  };
}

/** Strip leading/trailing quotes from a value (matches src/skills.ts `unquote`). */
function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseBool(value: string): boolean {
  const v = unquote(value).toLowerCase();
  return v === "y" || v === "yes" || v === "true";
}

/** Parse a `topics: [a, b]` inline array OR an empty/missing value. */
function parseTopics(value: string): string[] {
  const v = value.trim();
  const inline = v.match(/^\[(.*)\]$/);
  const inner = inline ? inline[1] : v;
  return inner
    .split(",")
    .map((t) => unquote(t))
    .filter((t) => t.length > 0);
}

/**
 * Parse the front-matter block out of a report's content. Returns null if there is
 * no leading `---…---` fence (a legacy / pre-standard report). Same fence regex as
 * src/skills.ts so the two parsers never diverge on what "front-matter" means.
 */
// Keys distinctive to THIS standard. A `---` block must carry at least one to count
// as a standard research report — `source_url`/`task_id`/`parent` are excluded because
// pre-existing ad-hoc front-matter (e.g. `topic`/`generated`/`arc_task`) also uses
// `source_url`, and matching on that alone would mis-index those as empty rows.
const STANDARD_MARKER_KEYS = new Set([
  "cached_path",
  "fetched_at",
  "topics",
  "arc_relevance",
  "repos_touched",
  "sku_candidate",
  "sku_why",
  "packaged",
]);

export function parseFrontmatter(content: string): ResearchFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = emptyFrontmatter();
  let sawStandardMarker = false;

  for (const line of fmMatch[1].split("\n")) {
    const trimmed = line.trim();
    const kv = trimmed.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue ?? "";
    if (STANDARD_MARKER_KEYS.has(key)) sawStandardMarker = true;

    switch (key) {
      case "source_url":
      case "cached_path":
      case "fetched_at":
      case "task_id":
      case "parent":
      case "sku_why":
      case "product_id":
        fm[key] = unquote(value);
        break;
      case "topics":
        fm.topics = parseTopics(value);
        break;
      case "arc_relevance": {
        const n = Number(unquote(value));
        fm.arc_relevance = Number.isFinite(n) ? n : 0;
        break;
      }
      case "repos_touched": {
        const v = unquote(value) as ReposTouched;
        fm.repos_touched = (REPOS_TOUCHED as readonly string[]).includes(v) ? v : "unknown";
        break;
      }
      case "sku_candidate":
        fm.sku_candidate = parseBool(value);
        break;
      case "packaged":
        fm.packaged = parseBool(value);
        break;
      default:
        break; // unknown key — ignore (forward-compatible)
    }
  }

  // A `---…---` fence that carries no standard-distinctive key (a stray markdown rule,
  // or a pre-standard ad-hoc block) is NOT a standard research report — treat as legacy
  // so the catalog never indexes an empty/misleading row.
  return sawStandardMarker ? fm : null;
}

/** Serialize front-matter into the canonical `---`-fenced block (newline-terminated). */
export function serializeFrontmatter(fm: ResearchFrontmatter): string {
  const yn = (b: boolean) => (b ? "y" : "n");
  return [
    "---",
    `source_url: ${fm.source_url}`,
    `cached_path: ${fm.cached_path}`,
    `fetched_at: ${fm.fetched_at}`,
    `task_id: ${fm.task_id}`,
    `parent: ${fm.parent}`,
    `topics: [${fm.topics.join(", ")}]`,
    `arc_relevance: ${fm.arc_relevance}`,
    `repos_touched: ${fm.repos_touched}`,
    `sku_candidate: ${yn(fm.sku_candidate)}`,
    `sku_why: ${fm.sku_why}`,
    `packaged: ${yn(fm.packaged)}`,
    `product_id: ${fm.product_id}`,
    "---",
    "",
  ].join("\n");
}

/**
 * Validate a parsed front-matter for the required-for-catalog fields. Returns a list
 * of human-readable warnings (empty = clean). Non-fatal: a report with warnings is
 * still indexed, but the warnings tell the agent/operator what to fix.
 */
export function validateFrontmatter(fm: ResearchFrontmatter): string[] {
  const warnings: string[] = [];
  if (!fm.fetched_at) warnings.push("missing fetched_at (ISO-8601)");
  if (fm.topics.length === 0) warnings.push("no topics (the dedup + catalog key)");
  if (!Number.isInteger(fm.arc_relevance) || fm.arc_relevance < RELEVANCE_MIN || fm.arc_relevance > RELEVANCE_MAX)
    warnings.push(`arc_relevance ${fm.arc_relevance} out of range ${RELEVANCE_MIN}–${RELEVANCE_MAX}`);
  // Anti-slop: a report at/below the skip threshold probably shouldn't be a catalogued
  // report at all (a one-line "skipped, why" note is the right output for thin links).
  else if (fm.arc_relevance <= RELEVANCE_SKIP_AT_OR_BELOW)
    warnings.push(`arc_relevance ${fm.arc_relevance} at/below skip threshold (${RELEVANCE_SKIP_AT_OR_BELOW}) — should this be a one-line skip note, not a report?`);
  if (!(REPOS_TOUCHED as readonly string[]).includes(fm.repos_touched))
    warnings.push(`repos_touched '${fm.repos_touched}' not one of ${REPOS_TOUCHED.join("|")}`);
  if (fm.sku_candidate && !fm.sku_why) warnings.push("sku_candidate=y but no sku_why (one-line rationale required)");
  // Tie the SKU flag to its buy-reason: a sellable report's value IS the repo-grounded
  // Arc-alignment; `unknown` means that work wasn't done (or wasn't recorded) — a
  // sku_candidate with unknown repos is the anti-slop tell (council lumen).
  if (fm.sku_candidate && fm.repos_touched === "unknown")
    warnings.push("sku_candidate=y but repos_touched=unknown — a sellable report's buy-reason is repo-grounded Arc-alignment; ground it (arc-starter|agent-runtime|both)");
  return warnings;
}
