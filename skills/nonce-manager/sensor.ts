// skills/nonce-manager/sensor.ts
// Periodic nonce health check — detects drift between local state and chain truth.
// Calls syncNonce() which self-heals as a side effect.

import { claimSensorRun, insertTaskIfNew, createSensorLogger } from "../../src/sensors.ts";
import { getStatus, syncNonce } from "./nonce-store.js";

const SENSOR_NAME = "nonce-health";
const INTERVAL_MINUTES = 15;
const SENDER_STX = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
const DRIFT_THRESHOLD = 2;

const log = createSensorLogger(SENSOR_NAME);

export default async function nonceSensor(): Promise<"skip" | void> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const localState = getStatus(SENDER_STX);
  if (!localState || !("nextNonce" in localState)) {
    log("no local nonce state — skipping");
    return;
  }

  const localNext = (localState as { nextNonce: number }).nextNonce;

  try {
    const hiro = await syncNonce(SENDER_STX);
    const drift = localNext - hiro.nonce;

    if (Math.abs(drift) > DRIFT_THRESHOLD) {
      log(`DRIFT: local=${localNext} chain=${hiro.nonce} drift=${drift}`);
      insertTaskIfNew(`sensor:${SENSOR_NAME}`, {
        subject: `Nonce drift detected: local=${localNext} vs chain=${hiro.nonce} (drift=${drift})`,
        description:
          `The nonce-health sensor detected a nonce drift of ${drift}. ` +
          `syncNonce() has been called to correct the local state.\n\n` +
          `Missing nonces: ${hiro.detectedMissing.join(", ") || "none"}\n` +
          `Mempool pending: ${hiro.mempoolPending}`,
        priority: 3,
        skills: JSON.stringify(["nonce-manager", "relay-diagnostic"]),
      });
    } else {
      log(`healthy: next=${hiro.nonce} mempool=${hiro.mempoolPending} missing=${hiro.detectedMissing.length}`);
    }
  } catch (err) {
    log(`hiro fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
