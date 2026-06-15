// skills/snippet-producer/sensor.ts
//
// P16 — quote-card / snippet PRODUCER. The producer that finally feeds the empty
// social pools. P12 (X cadence) and P13 (Nostr consumer) are live consumers, but
// the pools sit empty for `x`/`nostr` because the three existing distillers
// (arxiv/council/watch-interior) tag mostly blog/whop-chat. This sensor detects the
// newest PUBLISHED blog post not yet chopped and dispatches ONE sonnet task that
// chops it into 3-5 shareable quote-card snippets written into the source-artifact
// pool as type `snippet`, tagged suggested_channels ["x","nostr"]. The X cadence
// (blog-snippet beat) + the Nostr consumer then drip them out, each exactly-once via
// their own --source POST ledgers (x_post_log / nostr_post_log).
//
// Why a new ArtifactType (`snippet`): the Nostr consumer iterates ALL ARTIFACT_TYPES
// (auto-picks snippet up for channel nostr), and the X cadence gets an explicit
// blog-snippet beat — so snippets reach exactly the social channels without polluting
// the arxiv research-highlight / council agent-philosophy beats with blog echoes.
//
// Per-blog dedup: createSourceLedger("snippet_source_log") keyed on
// snippet-producer:<date-slug> — a published post is chopped exactly once (a re-run
// won't re-chop). Recorded at dispatch (mirrors arxiv-distill's lastDistilledDigest);
// chopping is cheap + reversible — clear the ledger row to re-chop, unlike a paid send.

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { insertTask } from "../../src/db.ts";
import { createSourceLedger } from "../../src/source-ledger.ts";

export const SENSOR_NAME = "snippet-producer";
const INTERVAL_MINUTES = 60;
// Canonical published-blog source — the same dir the blog-publishing sensor reads.
const BLOG_DIR = resolve(import.meta.dir, "../../github/arc0btc/arc0me-site/src/content/docs/blog");
const log = createSensorLogger(SENSOR_NAME);

// Per-blog dedup ledger (shared helper — forge's P14 carry-forward, used since P15).
const ledger = createSourceLedger({
  table: "snippet_source_log",
  idColumn: "blog_slug",
  extraColumns: [{ name: "snippet_count", type: "INTEGER" }],
});

interface PublishedPost {
  postId: string; // "YYYY-MM-DD-slug"
  date: string; // "YYYY-MM-DD"
  title: string;
  path: string;
}

/** Minimal frontmatter read — title + draft flag. */
function readFrontmatter(content: string): { title?: string; draft?: boolean } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: { title?: string; draft?: boolean } = {};
  for (const line of match[1].split("\n")) {
    if (line.startsWith("title:")) out.title = line.replace(/^title:\s*["']?/, "").replace(/["']?\s*$/, "");
    if (line.startsWith("draft:")) out.draft = line.includes("true");
  }
  return out;
}

/** Newest PUBLISHED (draft:false) blog post by filename date. null when none. */
function newestPublishedPost(): PublishedPost | null {
  if (!existsSync(BLOG_DIR)) return null;
  let newest: PublishedPost | null = null;
  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith(".mdx") || file === "index.mdx") continue;
    const m = file.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.mdx$/);
    if (!m) continue;
    const date = m[1];
    const slug = m[2];
    const path = join(BLOG_DIR, file);
    let fm: { title?: string; draft?: boolean };
    try {
      fm = readFrontmatter(readFileSync(path, "utf-8"));
    } catch {
      continue;
    }
    if (fm.draft !== false) continue; // only published posts
    const postId = `${date}-${slug}`;
    if (!newest || date > newest.date || (date === newest.date && postId > newest.postId)) {
      newest = { postId, date, title: fm.title ?? slug, path };
    }
  }
  return newest;
}

/** Public for a tick helper / smoke test. */
export async function pollSnippetProducer(): Promise<"ok" | "skip"> {
  if (Bun.env.SNIPPET_PRODUCER_ENABLED !== "true" && Bun.env.ARC_DISTILL_FORCE !== "1") {
    log("disabled (SNIPPET_PRODUCER_ENABLED=false) — awaiting enable");
    return "skip";
  }

  const post = newestPublishedPost();
  if (!post) {
    log("no published blog post on disk — skip");
    return "skip";
  }

  const source = `snippet-producer:${post.postId}`;
  if (ledger.has(source)) {
    log(`newest published post ${post.postId} already chopped — skip`);
    return "skip";
  }

  const taskId = insertTask({
    subject: `Chop blog "${post.title}" into 3-5 quote-card snippets`,
    description: [
      `Source blog post (PUBLISHED): ${post.path}`,
      `Blog id: ${post.postId}`,
      "",
      "## Goal",
      "Read the post. Pull the 3-5 sharpest, most quote-worthy standalone ideas and write",
      "each as ONE shareable quote-card snippet into the source-artifact pool via",
      "`writeDistilled` (in src/artifacts.ts). These feed Arc's X cadence (blog-snippet beat)",
      "and the Nostr outlet — the snippet you write IS what gets posted, near-verbatim.",
      "",
      "## writeDistilled fields (per snippet)",
      "  type:               \"snippet\"",
      "  topic:              a short slug for the idea (e.g. \"eval-theater\", \"floor-raising\")",
      "  title:              a 3-6 word handle for the snippet",
      "  nugget:             the FINISHED, postable quote-card text — ≤ 280 chars so it fits an",
      "                      X post AND a Nostr kind:1 note. A standalone chapter, not \"I wrote",
      "                      a blog about X\". One idea. Dry, structural, owns the screwup.",
      "  citation:           `blog:" + post.postId + "`",
      "  suggested_channels: [\"x\", \"nostr\"]",
      "  produced_at:        new Date().toISOString()",
      "",
      "## Voice",
      "Read skills/arc-brand-voice/CHANNELS.md §x (the learning-together register — each post a",
      "chapter that picks up a thread / admits the unsolved / invites the reader). §nostr shares it.",
      "",
      "## Constraints (hard)",
      "- Each nugget ≤ 280 chars (so the consumer posts it near-verbatim to X and Nostr).",
      "- DISTINCT excerpts — do NOT reproduce the whole post; each is one sharp idea.",
      "- Selection over invention — pull real lines/ideas from the post.",
      "- 3-5 snippets. If the post only yields 1-2 genuinely shareable ideas, write those and",
      "  document the rest skipped. Quality bar > quota.",
      "",
      "## Steps",
      "1. Read the post at the path above.",
      "2. For each snippet, call writeDistilled — run a one-off script via `bun -e '...'` or the",
      "   Write tool (import { writeDistilled } from \"./src/artifacts.ts\").",
      "3. Verify each writeDistilled returned an id; spot-check a JSON file landed in",
      "   artifacts/distilled/snippet/.",
      "4. Close completed with --summary: how many snippets, which ideas, any intentionally dropped.",
    ].join("\n"),
    skills: JSON.stringify(["snippet-producer", "arc-brand-voice"]),
    priority: 5,
    model: "sonnet",
    status: "pending",
    source,
  });

  // Record at dispatch so the post is chopped exactly once. The chop is cheap +
  // reversible (clear the row to re-chop), so record-at-dispatch is safe here.
  ledger.record(source, post.postId, { snippet_count: 0 });

  log(`queued snippet chop task ${taskId} for ${post.postId}`);
  return "ok";
}

export default async function snippetProducerSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";
  try {
    return await pollSnippetProducer();
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return "skip";
  }
}
