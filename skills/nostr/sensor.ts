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

import { claimSensorRun, createSensorLogger, insertTaskIfNew, readHookState, writeHookState } from "../../src/sensors.ts";
import { taskExistsForSource, getDatabase } from "../../src/db.ts";
import { ARTIFACT_TYPES, recentArtifacts, markConsumed, renderInline } from "../../src/artifacts.ts";
import { PRODUCT_PAGE_URL, PAID_ROOM_PRODUCT_URL } from "../../src/constants.ts";

const SENSOR_NAME = "nostr-consumer";
const INTERVAL_MINUTES = 5;
// Set NOSTR_CONSUMER_ENABLED=false in .env to pause the consumer without removing
// the skill. ON by default (P13 live): with an empty pool it simply defers, and
// the nostr_post_log ledger makes the eventual POST exactly-once.
const NOSTR_CONSUMER_ENABLED = Bun.env.NOSTR_CONSUMER_ENABLED !== "false";
const POOL_LOOKBACK_HOURS = 24 * 7; // a week — Nostr notes aren't time-critical

// AI-098 (satisfies AI-088): 1-in-N soft CTA cadence for Nostr posts.
// Every Nth task gets a soft CTA appended — give-3x discipline: the note's
// artifact-driven content IS the give; the CTA is additive, not the primary ask.
// N=4: every 4th Nostr dispatch carries the product mention.
// SOUL.md: no adverbs, direct, earned-click framing.
const NOSTR_CTA_CADENCE = 4;

const log = createSensorLogger(SENSOR_NAME);

export default async function run(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";
  if (!NOSTR_CONSUMER_ENABLED) return "skip";
  try {
    // AI-098: read CTA cadence counter from hook state.
    const hookState = await readHookState(SENSOR_NAME);
    const nostrCtaCount = (hookState?.nostr_cta_count as number | undefined) ?? 0;
    const isCTATick = nostrCtaCount % NOSTR_CTA_CADENCE === 0;

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

      // AI-098: soft CTA block appended on every Nth tick (give-3x discipline: the
      // note's artifact content IS the give; the CTA is additive, not the primary ask).
      // SOUL.md voice: direct, no adverbs, earned-click framing; no FREEMONTH (product step).
      // Membership CTA optional add if they seem like a recurring-room person.
      const ctaBlock = isCTATick
        ? [
            "",
            "## Soft CTA (1-in-4 cadence — AI-098)",
            "After posting the note, IF the engagement is genuine and the note resonates,",
            "add a brief follow-up note or reply mentioning where this work lives:",
            `  This is the kind of thing I work through in the open — report, receipts, and all. ${PRODUCT_PAGE_URL}`,
            `  (If they seem like a recurring-room person: ${PAID_ROOM_PRODUCT_URL} — first month free, code FREEMONTH)`,
            "Voice (SOUL.md): earned-click framing; no adverbs; give-3x discipline — the artifact note",
            "above is the give. The CTA is additive; only append if the note delivered real value.",
            "If it doesn't feel earned, skip the CTA entirely.",
          ].join("\n")
        : "";

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
        ctaBlock,
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
        // AI-098: increment CTA counter so the modulo cadence advances each dispatch.
        await writeHookState(SENSOR_NAME, {
          ...hookState,
          last_ran: hookState?.last_ran ?? new Date().toISOString(),
          last_result: "ok",
          version: (hookState?.version ?? 0) + 1,
          nostr_cta_count: nostrCtaCount + 1,
        } as Parameters<typeof writeHookState>[1]);
        log(`queued nostr note task ${taskId} for artifact ${artifact.id} (${source})${isCTATick ? " [CTA tick]" : ""}`);
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
