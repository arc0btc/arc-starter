// skills/nostr/sensor.ts
// Nostr pool CONSUMER. Each tick, selects the most-recent unconsumed artifact
// TAGGED for the `nostr` channel (the suggested_channels asymmetry guarantee) and
// dispatches one compose+post task. The note is posted via `skills/nostr` with a
// per-artifact `--source nostr:<id>` ledger key — so the POST is exactly-once even
// if this sensor and dispatch both retry.
//
// Empty pool is EXPECTED until a producer tags content for `nostr` (P16 quote-cards
// is the likely producer) — the consumer DEFERS, it does not error. Mirrors the
// suggested_channels consumer pattern (whop-forum/public-forum/x), keyed per artifact.

import { createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { taskExistsForSource, getDatabase } from "../../src/db.ts";
import { ARTIFACT_TYPES, recentArtifacts, markConsumed, renderInline } from "../../src/artifacts.ts";

const SENSOR_NAME = "nostr-consumer";
// Flip to false to pause the consumer without removing the skill. ON by default:
// with an empty pool it simply defers, and the nostr_post_log ledger makes the
// eventual POST exactly-once.
const NOSTR_CONSUMER_ENABLED = true;
const POOL_LOOKBACK_HOURS = 24 * 7; // a week — Nostr notes aren't time-critical

const log = createSensorLogger(SENSOR_NAME);

export default async function run(): Promise<string> {
  if (!NOSTR_CONSUMER_ENABLED) return "skip";
  try {
    // Gather unconsumed nostr-tagged artifacts across every type (recentArtifacts
    // is per-type; the channel anti-join excludes already-consumed rows).
    const candidates = [];
    for (const type of ARTIFACT_TYPES) {
      candidates.push(...recentArtifacts(type, { channel: "nostr", sinceHours: POOL_LOOKBACK_HOURS, limit: 3 }));
    }
    if (candidates.length === 0) {
      log("no nostr-tagged artifacts in the pool — deferring (empty-pool is expected until a producer tags content; P16)");
      return "ok";
    }

    // Most recent first; post one per tick (steady drip, never a burst). Iterate so a
    // single already-dispatched-but-unconsumed artifact (a crash between dispatch and
    // markConsumed) can't starve the rest — we reconcile it and move to the next (cairn finding).
    candidates.sort((a, b) => (a.produced_at < b.produced_at ? 1 : -1));
    for (const artifact of candidates) {
      const source = `nostr:${artifact.id}`;

      let nuggetBlock = "";
      try {
        nuggetBlock = "\n## Source nugget\nUse it as the spine; cite the source.\n\n" + renderInline([artifact], 1200);
      } catch (e) {
        log(`nugget render failed for ${artifact.id}: ${e instanceof Error ? e.message : String(e)}`);
      }

      const description = [
        `Compose ONE Nostr note (kind:1) from this pooled artifact and post it.`,
        nuggetBlock,
        "",
        "Voice: read skills/arc-brand-voice/CHANNELS.md §nostr (shares the X register —",
        "structural, dry, owns screwups, learning-together: a chapter, not an announcement).",
        "Keep it tight (≤ ~280 chars works well); one idea; end on a sharp line or a real question.",
        "If nothing is genuinely worth saying, DEFER — close completed with 'nothing to post'.",
        "",
        "Post (keep the --source exactly as shown — it dedups a replay via nostr_post_log):",
        `  arc skills run --name nostr -- post --content "<text>" [--tags a,b] --source ${source}`,
        "Then confirm the returned eventId / relays.",
      ].join("\n");

      const taskId = insertTaskIfNew(
        source,
        {
          subject: `Nostr note from artifact: ${artifact.title}`,
          description,
          skills: JSON.stringify(["nostr", "arc-brand-voice"]),
          priority: 5,
          model: "sonnet",
        },
        "any", // exactly-once ever per artifact (belt-and-suspenders with markConsumed + the POST ledger)
      );

      if (taskId !== null) {
        markConsumed(artifact.id, artifact.type, "nostr", taskId);
        log(`queued nostr note task ${taskId} for artifact ${artifact.id} (${source})`);
        return "ok"; // one per tick
      }

      // Already dispatched (taskExistsForSource) but not yet consumed — reconcile so it
      // stops being re-selected, then advance to the next candidate.
      const existing = getDatabase()
        .query("SELECT id FROM tasks WHERE source = ? ORDER BY id DESC LIMIT 1")
        .get(source) as { id: number } | undefined;
      if (existing) {
        markConsumed(artifact.id, artifact.type, "nostr", existing.id);
        log(`reconciled already-dispatched artifact ${artifact.id} (task ${existing.id}); advancing`);
      } else {
        log(`artifact ${artifact.id} blocked by subject dedup; advancing`);
      }
    }

    log("all nostr-tagged candidates already dispatched — nothing new to queue");
    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
