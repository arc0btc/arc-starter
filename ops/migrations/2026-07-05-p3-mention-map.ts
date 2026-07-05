// arc-demand-gen P3: mention-map schema migration.
// Convergent, not just "runs twice without erroring": re-running always reconciles curated
// content to the `seeds` list below (edit an alias/note and re-run — it lands), while a row
// whose content already matches the seed is left byte-identical (including its original
// mention_curated_at, so re-runs don't smear a fake "just curated" timestamp across old rows).
// Extends social_accounts (does NOT rebuild it); adds one new small additive table
// (article_mention_log) mirroring the CRM's source_key-dedup pattern instead of forcing
// incompatible values into outbound_action/engagement_log's CHECK-constrained enums
// (outbound_action.lane IN ('post','reply') would need a full table rebuild to extend safely —
// out of scope, real production risk to P1's just-hardened budget logic; engagement_log has no
// account-reference column at all).
//
// dev-council (5-lens: fowler, hohpe, kleppmann, lamport, newman) reviewed this script before it
// touched live data. Applied fixes: (1) whole run wrapped in one transaction — no half-applied
// state on interruption; (2) PRAGMA busy_timeout so a concurrent dispatch-loop writer backs off
// instead of throwing SQLITE_BUSY mid-migration; (3) convergent UPSERT instead of
// skip-if-already-flagged (the original bug: re-running after editing a seed's aliases silently
// dropped the edit); (4) json_valid CHECK on mention_aliases so a malformed manual edit fails
// fast at write time, not at read time inside a dispatch tick; (5) removed the unused
// `isExisting` field (dead code the review flagged as documenting a discarded design).
// FK targets confirmed live before shipping: article_queue_log.article_n IS the PRIMARY KEY
// (PRAGMA table_info confirmed pk=1) and social_accounts.id is the PRIMARY KEY — both FK
// declarations below are valid, not landmines.
//
// Run from ~/arc-starter on the Arc VM: ~/.bun/bin/bun ops/migrations/2026-07-05-p3-mention-map.ts
// Safe to run more than once.

import { Database } from "bun:sqlite";

const db = new Database("db/arc.sqlite");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

function hasColumn(table: string, column: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function tableExists(name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

// --- Seed / curate operator-maintained mention candidates ---
// Source: docs/specs/2026-07-05-arc-demand-gen-target-list.md (P0, live aibtc.com registry +
// operator ground-truth cross-check). Only candidates with a CONFIRMED X handle in that doc are
// seeded here. Micro Basilisk has no confirmed X handle in the target list (aibtc inbox + .btc
// name only) — deliberately NOT seeded; disclosed in docs/specs/2026-07-05-arc-demand-gen-
// mention-map-schema.md rather than invented.

type SeedRow = {
  handle: string;
  aliases: string[];
  notes: Record<string, string>;
};

const seeds: SeedRow[] = [
  {
    handle: "biwas_xyz",
    aliases: ["biwas", "Quasar Garuda", "x402.biwas.xyz"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "Operates x402.biwas.xyz, one of the 4 curated x402 sources named in QUEST.md. Operator-ground-truth 'strongest target.' erc8004AgentId 5.",
    },
  },
  {
    handle: "marshallmixing",
    aliases: ["Sonic Mast"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "AIBTC Network correspondent on aibtc.news. Builds DeFi skills and agent tooling on Stacks. Genesis Agent #50, sonic-mast.btc.",
    },
  },
  {
    handle: "theendaoment",
    aliases: ["Tiny Marten"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "Agent #3, #1 leaderboard. Runs its own Bounty Board, Agent Order Book, Agent Intelligence, aibtc.news Signal. erc8004AgentId 33, tinymarten.btc.",
    },
  },
  {
    handle: "joaopedronbello",
    aliases: ["Long Lens"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "Bitflow ambassador; tracks AIBTC, Stacks, sBTC AND x402 signals; files source-backed news. erc8004AgentId 434.",
    },
  },
  {
    handle: "whatcoulditmeme",
    aliases: ["Spectral Seed", "PowForge"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "PowForge identity-score oracle. Bitcoin-secured proof-of-work attestations. @powforge/identity SDK on npm.",
    },
  },
  {
    handle: "zks_lucky",
    aliases: ["Modest Spoke"],
    notes: {
      source: "arc-demand-gen-p0-target-list",
      why_relevant:
        "Bitcoin/Stacks developer utility agent: builds paid APIs, storage/query tools, signing/verification tools. erc8004AgentId 363.",
    },
  },
];

const run = db.transaction(() => {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  console.log("=== social_accounts: mention-map columns ===");
  const newColumns: [string, string][] = [
    ["mention_candidate", "INTEGER NOT NULL DEFAULT 0"],
    [
      "mention_aliases",
      "TEXT CHECK(mention_aliases IS NULL OR json_valid(mention_aliases))",
    ],
    ["mention_curated_by", "TEXT"],
    ["mention_curated_at", "TEXT"],
    ["mention_notes", "TEXT"],
  ];
  for (const [col, ddl] of newColumns) {
    if (hasColumn("social_accounts", col)) {
      console.log(`  SKIP (exists): ${col}`);
      continue;
    }
    db.exec(`ALTER TABLE social_accounts ADD COLUMN ${col} ${ddl}`);
    console.log(`  ADDED: ${col} ${ddl}`);
  }

  console.log("=== article_mention_log ===");
  if (tableExists("article_mention_log")) {
    console.log("  SKIP (exists): article_mention_log");
  } else {
    // `handle` is a deliberate point-in-time snapshot (what was actually tagged in the
    // article text at mention time), not a live join cache — audit-log semantics, not a
    // second source of truth for "what is this account's current handle" (that question
    // always goes through account_id -> social_accounts.handle).
    db.exec(`
      CREATE TABLE article_mention_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE,
        article_n INTEGER NOT NULL REFERENCES article_queue_log(article_n),
        account_id INTEGER NOT NULL REFERENCES social_accounts(id),
        handle TEXT NOT NULL,
        matched_alias TEXT NOT NULL,
        surfaced_in TEXT NOT NULL CHECK(surfaced_in IN ('body','companionPost','both')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
    console.log("  CREATED: article_mention_log");
  }

  console.log("=== seeding/curating mention candidates (convergent upsert) ===");
  for (const seed of seeds) {
    const desiredAliases = JSON.stringify(seed.aliases);
    const desiredNotes = JSON.stringify(seed.notes);
    const existing = db
      .query(
        "SELECT id, mention_candidate, mention_aliases, mention_notes, mention_curated_at FROM social_accounts WHERE handle = ?"
      )
      .get(seed.handle) as
      | {
          id: number;
          mention_candidate: number;
          mention_aliases: string | null;
          mention_notes: string | null;
          mention_curated_at: string | null;
        }
      | undefined;

    if (existing) {
      const alreadyConverged =
        existing.mention_candidate === 1 &&
        existing.mention_aliases === desiredAliases &&
        existing.mention_notes === desiredNotes;
      if (alreadyConverged) {
        console.log(`  NO-OP (content unchanged): ${seed.handle} (id=${existing.id})`);
        continue;
      }
      // Preserve the original curation timestamp unless this account has never been curated
      // before — re-running with an edited alias/note should not look like a brand-new
      // curation event.
      const curatedAt = existing.mention_curated_at ?? now;
      db.query(
        `UPDATE social_accounts
         SET mention_candidate = 1,
             mention_aliases = ?,
             mention_curated_by = 'jason',
             mention_curated_at = ?,
             mention_notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(desiredAliases, curatedAt, desiredNotes, now, existing.id);
      console.log(`  RECONCILED: ${seed.handle} (id=${existing.id})`);
    } else {
      db.query(
        `INSERT INTO social_accounts
           (handle, platform, targeting_status, is_agent, research_seed,
            research_seed_watermark, mention_candidate, mention_aliases,
            mention_curated_by, mention_curated_at, mention_notes, created_at, updated_at)
         VALUES (?, 'x', 'eligible', 1, 1,
                 'arc-demand-gen-p3-mention-map', 1, ?,
                 'jason', ?, ?, ?, ?)`
      ).run(seed.handle, desiredAliases, now, desiredNotes, now, now);
      console.log(`  INSERTED new row: ${seed.handle}`);
    }
  }
});

run();

console.log("=== final state ===");
console.log(
  db
    .query(
      "SELECT id, handle, mention_candidate, mention_aliases, mention_curated_at FROM social_accounts WHERE mention_candidate=1 ORDER BY id"
    )
    .all()
);
console.log(
  "mention_candidate count:",
  db.query("SELECT COUNT(*) c FROM social_accounts WHERE mention_candidate=1").get()
);

db.close();
