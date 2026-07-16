#!/usr/bin/env bun
/**
 * skills/social-engine/cli.ts
 *
 * THE single reply entrypoint the dispatch flow uses.
 *
 * Both reply intents route here:
 *   - reactive  (mentions): the mentions sensor task instructs the dispatch LLM to call
 *                `arc skills run --name social-engine -- reply --tweet-id <id> --text "<reply>" --x-lead-id <author_id>`
 *   - proactive (cohort reply-guy): the cohort/affinity selector calls sendReply() (or this CLI).
 *
 * This wraps sendReply() (reply-send.ts), which is the ONLY code path allowed to
 * send a reply: canonical source_key UNIQUE dedup (<=1 reply/thread ALL-TIME, day-independent),
 * outbound_enabled kill switch, in-txn budget debit, reply-restriction 403 → skip.
 *
 * The legacy `social-x-posting -- reply` command now delegates here too, so no
 * un-deduped direct send remains.
 */

import { Database } from "bun:sqlite";
import { sendReply } from "./reply-send.ts";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

async function cmdReply(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  const tweetId = flags["tweet-id"];
  if (!text || tweetId === undefined || tweetId === "true") {
    console.log(
      "Usage: reply --tweet-id <id> --text <reply text> --tweet-created-at <iso timestamp> [--account <handle>] [--x-lead-id <author_id>]",
    );
    process.exit(1);
  }

  const replyResult = await sendReply({
    threadRef: tweetId,
    text,
    tweetCreatedAt: flags["tweet-created-at"],
    accountHandle: flags["account"],
    xLeadId: flags["x-lead-id"],
  });

  console.log(JSON.stringify(replyResult, null, 2));

  switch (replyResult.outcome) {
    case "sent":
    case "already_exists":
      process.exit(0);
    case "skipped":
    case "blocked":
      // Non-error terminal states (e.g. reply-restriction, dedup, budget/kill switch).
      process.exit(3);
    default:
      process.exit(1); // unknown (ambiguous / auth) — surfaces for operator attention
  }
}

function cmdKillSwitch(sub: string | undefined, flags: Record<string, string>): void {
  const db = new Database(DB_PATH);
  try {
    const row = db
      .query("SELECT value, updated_at FROM agent_config WHERE key='outbound_enabled'")
      .get() as { value: string; updated_at: string } | null;

    if (sub === "status" || sub === undefined) {
      console.log(JSON.stringify({ outbound_enabled: row?.value ?? "missing", updated_at: row?.updated_at ?? null }, null, 2));
      return;
    }

    if (sub === "enable") {
      const reason = flags["reason"];
      if (!reason || reason === "true") {
        console.log("Usage: kill-switch enable --reason \"<operator-confirmed explanation>\"");
        console.log("Requires explicit operator sign-off — this is a one-way safety gate by design.");
        process.exit(1);
      }
      const nowIso = new Date().toISOString();
      db.run(
        `INSERT INTO agent_config(key,value,updated_at) VALUES('outbound_enabled','true',?)
         ON CONFLICT(key) DO UPDATE SET value='true', updated_at=excluded.updated_at`,
        [nowIso],
      );
      console.log(JSON.stringify({ outbound_enabled: "true", updated_at: nowIso, reason }, null, 2));
      return;
    }

    console.log("Usage: kill-switch status | kill-switch enable --reason \"<text>\"");
    process.exit(1);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "reply":
      await cmdReply(flags);
      break;
    case "kill-switch":
      cmdKillSwitch(args[1], flags);
      break;
    default:
      console.log(`social-engine — unified outbound reply lane

Commands:
  reply  --tweet-id <id> --text <text> --tweet-created-at <iso timestamp> [--account <handle>] [--x-lead-id <author_id>]
         Send ONE reply through the canonical admission path (dedup + kill switch + budget).
         --tweet-created-at is required (ISO8601); omitting it blocks with 'missing_tweet_age'.
         This is the only sanctioned way to reply on X. Exit 0=sent/already-exists,
         3=skipped/blocked (dedup, budget, kill switch, reply-restriction), 1=unknown.

  kill-switch status
         Print current outbound_enabled value + last updated_at.
  kill-switch enable --reason "<text>"
         Flip outbound_enabled back to true. Requires --reason. Every other code path
         only ever sets this to false (see skills/social-engine/SKILL.md); this is the
         sole sanctioned re-enable path, intended for use ONLY after explicit operator
         sign-off on a specific trip/incident.
`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
