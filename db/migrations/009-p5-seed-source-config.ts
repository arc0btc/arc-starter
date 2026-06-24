/**
 * P5 Seed: Source Config
 * Seeds research_source_config with one row per ingestion source.
 * Requires user_version >= 4 (008-p5-research-inputs.ts must run first).
 * Uses INSERT OR IGNORE for idempotency.
 *
 * Usage: bun run 009-p5-seed-source-config.ts <path-to-db>
 */

import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun run 009-p5-seed-source-config.ts <path-to-db>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");

const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number };
console.log(`[009-p5-seed] Current user_version: ${user_version}`);

if (user_version < 4) {
  console.error(`[009-p5-seed] Requires user_version >= 4. Got ${user_version}. Run 008-p5-research-inputs.ts first.`);
  db.close();
  process.exit(1);
}

let passed = 0;
let failed = 0;

function step(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${(e as Error).message}`);
    failed++;
    throw e;
  }
}

const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const sources = [
  {
    source: "hn",
    enabled: 1,
    preflight_status: "pending",
    fetch_interval_minutes: 360,
    config_json: JSON.stringify({
      api: "https://hn.algolia.com/api/v1/search",
      query: "agents OR LLM OR \"AI agents\" OR bitcoin OR stacks OR \"MCP\" OR \"Clarity\"",
      tags: "story",
      hitsPerPage: 20,
      description: "Hacker News Algolia API — public, no auth, 3s rate limit"
    })
  },
  {
    source: "reddit",
    enabled: 1,
    preflight_status: "pending",
    fetch_interval_minutes: 360,
    config_json: JSON.stringify({
      api: "https://www.reddit.com/r/{sub}.json",
      subreddits: ["MachineLearning", "LocalLLaMA", "bitcoin", "btc", "AIAgents"],
      limit: 20,
      user_agent: "Arc-Agent/1.0 (research-reader; arc@arc0btc.com)",
      policy: "READ-ONLY public JSON API. No auth. robots.txt allows /r/*.json",
      description: "Reddit public JSON API — read-only, no auth required"
    })
  },
  {
    source: "rss",
    enabled: 1,
    preflight_status: "pending",
    fetch_interval_minutes: 720,
    config_json: JSON.stringify({
      feeds: [
        { url: "https://simonwillison.net/atom/everything/", name: "Simon Willison" },
        { url: "https://writings.stephenwolfram.com/feed/", name: "Stephen Wolfram" },
        { url: "https://jackclarkfromuk.substack.com/feed", name: "Jack Clark (ImportAI)" }
      ],
      max_body_chars: 500,
      description: "RSS/Atom feeds — public, no auth required"
    })
  },
  {
    source: "github_release",
    enabled: 1,
    preflight_status: "pending",
    fetch_interval_minutes: 360,
    config_json: JSON.stringify({
      repos: [
        "oven-sh/bun",
        "anthropics/claude-code",
        "stacks-network/stacks-core",
        "aibtcdev/aibtc-mcp-server",
        "x402Stacks/x402-stacks"
      ],
      tool: "gh CLI (authenticated on VM)",
      dedup_key: "{owner}/{repo}@{tag_name}",
      description: "GitHub releases via gh CLI — distinct from github-release-watcher (that creates tasks; this ingests nuggets)"
    })
  }
];

try {
  db.exec("BEGIN");

  for (const src of sources) {
    step(`INSERT OR IGNORE source config: ${src.source}`, () => {
      db.exec(`
        INSERT OR IGNORE INTO research_source_config
          (source, enabled, preflight_status, fetch_interval_minutes, config_json, updated_at)
        VALUES
          ('${src.source}', ${src.enabled}, '${src.preflight_status}', ${src.fetch_interval_minutes},
           '${src.config_json.replace(/'/g, "''")}', '${now}')
      `);
    });
  }

  db.exec("COMMIT");
  console.log(`\n[009-p5-seed] Seed complete. ${passed} steps passed, ${failed} failed.`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`[009-p5-seed] Seed FAILED — rolled back: ${(e as Error).message}`);
  db.close();
  process.exit(1);
}

// Verify rows
const rows = db.prepare("SELECT source, enabled, preflight_status FROM research_source_config ORDER BY source").all() as Array<{ source: string; enabled: number; preflight_status: string }>;
console.log("\n[009-p5-seed] Seeded source configs:");
for (const r of rows) {
  console.log(`  ${r.source}: enabled=${r.enabled}, preflight=${r.preflight_status}`);
}

db.close();
