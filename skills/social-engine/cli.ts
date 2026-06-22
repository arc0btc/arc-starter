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

import { sendReply } from "./reply-send.ts";

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
      "Usage: reply --tweet-id <id> --text <reply text> [--account <handle>] [--x-lead-id <author_id>]",
    );
    process.exit(1);
  }

  const replyResult = await sendReply({
    threadRef: tweetId,
    text,
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "reply":
      await cmdReply(flags);
      break;
    default:
      console.log(`social-engine — unified outbound reply lane

Commands:
  reply  --tweet-id <id> --text <text> [--account <handle>] [--x-lead-id <author_id>]
         Send ONE reply through the canonical admission path (dedup + kill switch + budget).
         This is the only sanctioned way to reply on X. Exit 0=sent/already-exists,
         3=skipped/blocked (dedup, budget, kill switch, reply-restriction), 1=unknown.
`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
