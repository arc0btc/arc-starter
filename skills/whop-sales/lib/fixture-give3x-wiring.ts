#!/usr/bin/env bun
// skills/whop-sales/lib/fixture-give3x-wiring.ts
//
// P5 arc-demand-flywheel (2026-07-03) — isolated verification that the give-3x
// observability wiring (x_reply_log -> processXReplyLog -> arc_replies_to_them)
// actually works, rather than trusting the code comments that claim it does.
//
// This is a FIXTURE, not a live test: it never touches the real db/arc.sqlite
// or db/whop-leads.json. It creates a throwaway sqlite db in a temp directory,
// chdir()s the process into that directory (initDatabase() in src/db.ts opens
// "db/arc.sqlite" relative to CWD — a real behavior, not something this fixture
// invents), pre-seeds one unconsumed x_reply_log row, then calls the real
// processXReplyLog() against an in-memory RelationshipStore and asserts the
// increment + idempotency on a second run.
//
// Usage: bun skills/whop-sales/lib/fixture-give3x-wiring.ts

import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  // Safety guard (dev-council kleppmann, latent finding): this fixture's
  // isolation depends entirely on being the FIRST thing in the process to
  // trigger src/db.ts's initDatabase() singleton. If this file were ever
  // imported into a long-running process that already opened the real
  // db/arc.sqlite (instead of run standalone via `bun run <this file>`),
  // getDatabase() would silently return the REAL handle post-chdir, and
  // processXReplyLog would mark real x_reply_log rows consumed. Refuse to run
  // any other way than as the direct entrypoint.
  if (!import.meta.main) {
    throw new Error(
      "fixture-give3x-wiring.ts must be run standalone (bun run skills/whop-sales/lib/fixture-give3x-wiring.ts), " +
        "never imported into another process — isolation depends on being first to touch src/db.ts's singleton.",
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "give3x-fixture-"));
  const dbDir = join(tmpRoot, "db");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "arc.sqlite");

  // Pre-seed one unconsumed outbound-reply row (same schema social-x-posting/cli.ts creates).
  const seedDb = new Database(dbPath);
  seedDb.run(
    `CREATE TABLE IF NOT EXISTS x_reply_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       replied_to_tweet_id TEXT NOT NULL,
       reply_tweet_id TEXT,
       x_lead_author_id TEXT,
       replied_at TEXT NOT NULL,
       consumed_at TEXT
     )`,
  );
  seedDb
    .query(
      "INSERT INTO x_reply_log (replied_to_tweet_id, reply_tweet_id, x_lead_author_id, replied_at) VALUES (?, ?, ?, ?)",
    )
    .run("fixture-tweet-1", "fixture-reply-1", "fixture-author-1", new Date().toISOString());
  seedDb.close();

  const origCwd = process.cwd();
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  let exitCode = 0;
  try {
    process.chdir(tmpRoot);

    const { processXReplyLog } = await import("./lead-source.ts");

    const store = {
      updated_at: new Date(0).toISOString(),
      users: {
        "fixture-author-1": {
          user_id: "fixture-author-1",
          username: "fixture_user",
          display_name: "Fixture User",
          first_seen: new Date(0).toISOString(),
          last_seen: new Date(0).toISOString(),
          message_count: 1,
          arc_replies_to_them: 0,
          their_replies_to_arc: 0,
          recent_interactions: [],
          notes: [] as string[],
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const bumped1 = await processXReplyLog(store, log);
    const after1 = store.users["fixture-author-1"].arc_replies_to_them;

    const bumped2 = await processXReplyLog(store, log);
    const after2 = store.users["fixture-author-1"].arc_replies_to_them;

    console.log("--- give-3x wiring fixture (isolated, throwaway db) ---");
    console.log(logs.join("\n"));
    console.log(`run 1: bumped=${bumped1} arc_replies_to_them=${after1}`);
    console.log(`run 2 (idempotency check): bumped=${bumped2} arc_replies_to_them=${after2}`);

    if (after1 !== 1) {
      throw new Error(`FAIL: expected arc_replies_to_them=1 after first run, got ${after1}`);
    }
    if (bumped2 !== 0 || after2 !== 1) {
      throw new Error(
        `FAIL: expected idempotent no-op on second run (bumped=0, value stays 1), got bumped=${bumped2} value=${after2}`,
      );
    }
    console.log("PASS: give-3x wiring (x_reply_log -> arc_replies_to_them) verified in isolation, idempotent on re-run.");
  } catch (e) {
    console.error("FIXTURE FAILED:", e instanceof Error ? e.message : String(e));
    exitCode = 1;
  } finally {
    process.chdir(origCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main();
