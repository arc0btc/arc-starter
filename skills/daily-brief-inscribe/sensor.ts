import { existsSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

import { getUTCInfo } from "../../src/time.ts";

const SENSOR_NAME = "daily-brief-inscribe";
const POLL_INTERVAL = 30; // check every 30 min
const TARGET_HOUR_UTC = 7; // 07:00 UTC — 2 hours after compile at 05:00 UTC
const TASK_SOURCE = "sensor:daily-brief-inscribe";
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

// Path to the child-inscription CLI (installed in skills/child-inscription/)
const CHILD_INSCRIPTION_CLI = join(
  import.meta.dir,
  "../child-inscription/child-inscription.ts"
);

/**
 * Check whether the inscription tooling is available before queuing a task.
 */
function checkPrerequisites(): { ok: boolean; reason?: string } {
  if (!existsSync(CHILD_INSCRIPTION_CLI)) {
    return {
      ok: false,
      reason: "missing-child-inscription-cli: skill not found at skills/child-inscription/child-inscription.ts",
    };
  }
  return { ok: true };
}

export default async function dailyBriefInscribeSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: utcDate } = getUTCInfo(now);

  // Only fire at 07:00 UTC
  if (hour !== TARGET_HOUR_UTC) return "skip";

  // Brief covers the previous UTC day (sensor fires 2 hours after compile at 05:00 UTC)
  const yesterdayUTC = new Date(now);
  yesterdayUTC.setUTCDate(yesterdayUTC.getUTCDate() - 1);
  const briefDate = yesterdayUTC.toISOString().slice(0, 10);

  // Dedup: only fire once per UTC calendar day (keyed on today's date)
  const state = await readHookState(SENSOR_NAME);
  if (state?.last_fired_date === utcDate) return "skip";

  // Prerequisite: child-inscription CLI must exist
  const prereq = checkPrerequisites();
  if (!prereq.ok) {
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { version: 0 }),
      last_ran: now.toISOString(),
      last_result: `skip:${prereq.reason}`,
      version: (state?.version ?? 0) + 1,
    });
    return "skip";
  }

  // Prerequisite: compiled brief must exist for yesterday
  try {
    const resp = await fetchWithRetry(`${API_BASE}/brief/${briefDate}`);
    if (!resp.ok) {
      log(`No brief found for ${briefDate} (API returned ${resp.status}) -- skipping inscription`);
      await writeHookState(SENSOR_NAME, {
        ...(state ?? { version: 0 }),
        last_ran: now.toISOString(),
        last_result: `skip:no-brief-${resp.status}`,
        version: (state?.version ?? 0) + 1,
        // Do NOT update last_fired_date -- allows retry if brief appears later
      });
      return "skip";
    }

    const data = (await resp.json()) as { compiledAt?: string | null };
    if (!data.compiledAt) {
      log(`Brief for ${briefDate} exists but not compiled yet -- skipping inscription`);
      await writeHookState(SENSOR_NAME, {
        ...(state ?? { version: 0 }),
        last_ran: now.toISOString(),
        last_result: "skip:brief-not-compiled",
        version: (state?.version ?? 0) + 1,
      });
      return "skip";
    }

    log(`Compiled brief found for ${briefDate} (compiled at ${data.compiledAt})`);
  } catch (err) {
    log(`Error checking brief: ${err instanceof Error ? err.message : String(err)} -- skipping`);
    return "error";
  }

  // Pre-flight: check SegWit BTC balance via mempool API
  const BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
  const MIN_BALANCE_SATS = 10_000;
  try {
    const mempoolResp = await fetchWithRetry(`https://mempool.space/api/address/${BTC_ADDRESS}`);
    if (mempoolResp.ok) {
      const addrData = (await mempoolResp.json()) as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
      };
      const balance = addrData.chain_stats.funded_txo_sum - addrData.chain_stats.spent_txo_sum;
      if (balance < MIN_BALANCE_SATS) {
        log(`SegWit balance too low for inscription: ${balance} sats (need >= ${MIN_BALANCE_SATS}). Creating funding escalation.`);
        await writeHookState(SENSOR_NAME, {
          ...(state ?? { version: 0 }),
          last_ran: now.toISOString(),
          last_result: `skip:low-balance-${balance}`,
          version: (state?.version ?? 0) + 1,
          // Do NOT set last_fired_date — allow retry after funding
        });
        insertTaskIfNew(TASK_SOURCE, {
          subject: `Fund SegWit wallet for inscription (balance: ${balance} sats)`,
          description: [
            `The SegWit wallet (${BTC_ADDRESS}) has ${balance} sats, below the ${MIN_BALANCE_SATS} sat minimum for inscriptions.`,
            `Brief for ${briefDate} is ready to inscribe but cannot proceed without funding.`,
            ``,
            `Send BTC to: ${BTC_ADDRESS}`,
            `Recommended: 100,000 sats (~1 month of daily inscriptions).`,
          ].join("\n"),
          priority: 3,
          skills: JSON.stringify(["bitcoin-wallet"]),
        });
        return "ok";
      }
      log(`SegWit balance: ${balance} sats — sufficient for inscription`);
    }
  } catch (err) {
    log(`Balance check failed (proceeding anyway): ${err instanceof Error ? err.message : String(err)}`);
  }

  // All prerequisites pass — queue the first script task and mark date as fired.
  // Safe to set last_fired_date now: the task queue handles retries (max 3 per phase),
  // and each phase queues its own continuation. Failures are visible in arc status.
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    last_fired_date: utcDate,
  });

  insertTaskIfNew(TASK_SOURCE, {
    subject: `Inscribe brief ${briefDate} (phase: fetch)`,
    description: `Start the daily brief inscription pipeline for ${briefDate}.\n\nThe script runs one phase per dispatch, queuing continuations automatically.`,
    priority: 3,
    skills: JSON.stringify(["bitcoin-wallet", "child-inscription", "aibtc-news-classifieds"]),
    script: `bun run scripts/inscribe-brief.ts run --date ${briefDate}`,
  });

  log(`Queued inscription task for ${briefDate}`);
  return "ok";
}
