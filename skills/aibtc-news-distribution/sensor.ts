// skills/aibtc-news-distribution/sensor.ts
// aibtc.news distribution CONSUMER (P14). Each tick, selects the most-recent unconsumed artifact
// TAGGED for the `aibtc-news` channel (the suggested_channels asymmetry guarantee) and dispatches
// ONE compose+file-signal task. The signal is filed via the existing `aibtc-news-editorial`
// file-signal CLI with a per-artifact `--source aibtc-news:<id>` ledger key (news_signal_log) — so
// the FILE is exactly-once even if this sensor and dispatch both retry.
//
// Empty pool is EXPECTED until a producer tags content for `aibtc-news` (P16 quote-cards / a distill
// pass) — the consumer DEFERS, it does not error. Mirrors the P13 nostr consumer 1:1.
//
// NOTE: this is a SEPARATE lane from skills/aibtc-news-editorial/sensor.ts, whose streak/market
// auto-filing is operator-DISABLED (SIGNAL_FILING_DISABLED, task #17094, 2026-05-19, "re-enable for
// what's next policy"). P14 IS that "what's next": distributing Arc's genuine distilled work as
// intelligence signals — a top-of-funnel touch driving toward the paid room, NOT competition
// streak-gaming. The old flag stays untouched; this lane has its own gate below.

import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { getDatabase } from "../../src/db.ts";
import { ARTIFACT_TYPES, recentArtifacts, markConsumed, renderInline } from "../../src/artifacts.ts";

const SENSOR_NAME = "aibtc-news-distribution";
const INTERVAL_MINUTES = 5;
// Flip to false to pause the consumer without removing the skill. ON by default: with an empty
// pool it simply defers, and the news_signal_log ledger makes the eventual FILE exactly-once.
const NEWS_DISTRIBUTION_ENABLED = false; // PAUSED 2026-06-14: filing is PAID (x402 ~100 sats/signal) — operator spend decision pending (P14 verify artifact)
const POOL_LOOKBACK_HOURS = 24 * 7; // a week — distilled nuggets aren't minute-critical
const ACTIVE_BEATS = ["aibtc-network", "bitcoin-macro", "quantum"]; // confirmed live 2026-06-14

const log = createSensorLogger(SENSOR_NAME);

export default async function run(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";
  if (!NEWS_DISTRIBUTION_ENABLED) return "skip";
  try {
    // Gather unconsumed aibtc-news-tagged artifacts across every type (recentArtifacts is per-type;
    // the channel anti-join excludes already-consumed rows).
    const candidates = [];
    for (const type of ARTIFACT_TYPES) {
      candidates.push(
        ...recentArtifacts(type, { channel: "aibtc-news", sinceHours: POOL_LOOKBACK_HOURS, limit: 3 }),
      );
    }
    if (candidates.length === 0) {
      log(
        "no aibtc-news-tagged artifacts in the pool — deferring (empty-pool is expected until a producer tags content; P16)",
      );
      return "ok";
    }

    // Most recent first; file one per tick (steady drip — well within the 1-signal-per-beat-per-4h
    // rate limit and 6/day cap). Iterate so a single already-dispatched-but-unconsumed artifact (a
    // crash between dispatch and markConsumed) can't starve the rest (P13 cairn finding).
    candidates.sort((a, b) => (a.produced_at < b.produced_at ? 1 : -1));
    for (const artifact of candidates) {
      const source = `aibtc-news:${artifact.id}`;

      let nuggetBlock = "";
      try {
        nuggetBlock =
          "\n## Source nugget\nUse it as the spine; cite a PUBLIC reachable source.\n\n" +
          renderInline([artifact], 1200);
      } catch (e) {
        log(`nugget render failed for ${artifact.id}: ${e instanceof Error ? e.message : String(e)}`);
      }

      const description = [
        `File ONE aibtc.news intelligence signal derived from this pooled artifact.`,
        nuggetBlock,
        "",
        `Pick the best-fit ACTIVE beat: ${ACTIVE_BEATS.join(", ")}.`,
        "  - aibtc-network = the aibtc agent ecosystem (agents, skills, tooling, MCP, orchestration,",
        "    infrastructure, the agent economy) — Arc's own engineering work product fits here.",
        "  - bitcoin-macro = BTC price / ETF / institutional / regulatory / macro.",
        "  - quantum = quantum computing vs Bitcoin (ECDSA/SHA-256 threats, post-quantum BIPs).",
        "If the nugget fits no active beat well, DEFER — close completed with 'no good beat fit'.",
        "",
        "Voice: Economist register — data-rich, precise, no hype. Read",
        "skills/aibtc-news-editorial/SKILL.md (claim/evidence/implication structure; --tags is",
        "comma-separated, NOT JSON; --headline required, <=120 chars). Cite a PUBLIC reachable source",
        "(an Arc blog post on arc0.me, or the nugget's arxiv/GitHub URL) in --sources — internal repo",
        "paths are NOT reachable and the judge-signal pre-flight will fail them.",
        "",
        "File (keep the --source EXACTLY as shown — it dedups a replay via news_signal_log):",
        `  arc skills run --name aibtc-news-editorial -- file-signal --beat <slug> \\`,
        `    --headline "<=120 chars>" --claim "<text>" --evidence "<text>" --implication "<text>" \\`,
        `    --sources '[{"url":"https://...","title":"..."}]' --tags "a,b" --source ${source}`,
        "The built-in judge-signal pre-flight gates quality; if it fails, refine and retry or DEFER —",
        "do NOT pass --force.",
      ].join("\n");

      const taskId = insertTaskIfNew(
        source,
        {
          subject: `aibtc.news signal from artifact: ${artifact.title}`,
          description,
          skills: JSON.stringify(["aibtc-news-editorial", "bitcoin-wallet"]),
          priority: 5,
          model: "sonnet",
        },
        "any", // exactly-once ever per artifact (belt-and-suspenders with markConsumed + the FILE ledger)
      );

      if (taskId !== null) {
        markConsumed(artifact.id, artifact.type, "aibtc-news", taskId);
        log(`queued aibtc.news signal task ${taskId} for artifact ${artifact.id} (${source})`);
        return "ok"; // one per tick
      }

      // Already dispatched (taskExistsForSource) but not yet consumed — reconcile so it stops being
      // re-selected, then advance to the next candidate.
      const existing = getDatabase()
        .query("SELECT id FROM tasks WHERE source = ? ORDER BY id DESC LIMIT 1")
        .get(source) as { id: number } | undefined;
      if (existing) {
        markConsumed(artifact.id, artifact.type, "aibtc-news", existing.id);
        log(`reconciled already-dispatched artifact ${artifact.id} (task ${existing.id}); advancing`);
      } else {
        log(`artifact ${artifact.id} blocked by subject dedup; advancing`);
      }
    }

    log("all aibtc-news-tagged candidates already dispatched — nothing new to queue");
    return "ok";
  } catch (e) {
    log(`error: ${(e as Error).message}`);
    return "error";
  }
}
