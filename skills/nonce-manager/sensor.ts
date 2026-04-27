// skills/nonce-manager/sensor.ts
// Periodic receipt-driven reconciliation of pending broadcasts.
//
// Each cycle polls aibtc.com payment-status (for x402-sponsored) and Hiro tx
// detail (for direct broadcasts), transitioning nonce_broadcasts rows from
// pending → confirmed | rejected | expired. Phantoms are surfaced via a task
// only when one is freshly detected — repeat phantoms don't re-page.
//
// Defensive: any throw during reconcile is caught and logged; the sensor
// returns "error" rather than crashing the sensors process.

import { claimSensorRun, insertTaskIfNew, createSensorLogger } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";
import { initNonceManagerSchema } from "./schema.js";
import { reconcile } from "./reconcile.js";

const SENSOR_NAME = "nonce-reconcile";
const INTERVAL_MINUTES = 1;

const log = createSensorLogger(SENSOR_NAME);

export default async function nonceReconcileSensor(): Promise<string> {
  initDatabase();
  initNonceManagerSchema();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let summary;
  try {
    summary = await reconcile();
  } catch (err) {
    log(`reconcile threw: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (summary.polled === 0) return "ok";

  const headline = `polled=${summary.polled} confirmed=${summary.confirmed} rejected=${summary.rejected} expired=${summary.expired} pending=${summary.still_pending} skipped=${summary.skipped} errors=${summary.errors}`;
  log(headline);

  if (summary.phantoms.length > 0) {
    // Surface freshly-detected phantoms as a single task so an operator can decide
    // whether to gap-fill. Dedup by listing the (address, nonce) tuples in the
    // task source — same set won't re-queue.
    const key = summary.phantoms
      .map((p) => `${p.address}:${p.nonce}`)
      .sort()
      .join(",");
    const id = insertTaskIfNew(`sensor:${SENSOR_NAME}:phantoms:${key}`, {
      subject: `Nonce phantoms detected: ${summary.phantoms.length} (${headline})`,
      description: [
        `The reconciler found nonces that were released as "broadcast" but the chain (or relay) reports the tx never reached terminal success.`,
        ``,
        ...summary.phantoms.map(
          (p) => `- nonce=${p.nonce} address=${p.address} source=${p.source} outcome=${p.outcome}${p.detail ? ` — ${p.detail}` : ""}${p.txid ? ` txid=${p.txid}` : ""}`,
        ),
        ``,
        `These are gaps on chain. Operator can run \`bun scripts/nonce-gap-fill.ts\` with the listed nonces (after dry-run) to unstick anything held behind them.`,
        ``,
        `Reconciler summary: ${headline}`,
      ].join("\n"),
      priority: 3,
      skills: JSON.stringify(["nonce-manager"]),
    });
    if (id !== null) {
      log(`queued phantom alert task #${id} for ${summary.phantoms.length} entries`);
    }
  }

  return "ok";
}
