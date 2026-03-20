import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "aibtc-earnings";
const INTERVAL_MINUTES = 60; // check once per hour
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

interface EarningRecord {
  id: string;
  address: string;
  amount_sats: number;
  status: string;
}

interface EarningsResponse {
  earnings: EarningRecord[];
}

/**
 * Checks for unpaid correspondent earnings and logs the pending balance.
 * Payout workflows are NOT created here — they are triggered by
 * DailyBriefInscriptionMachine after the brief is confirmed on-chain.
 * This sensor is informational only: it surfaces pending earnings so
 * the status dashboard and dispatch context stay current.
 */
export default async function earningsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("Checking for unpaid earnings...");

  let earnings: EarningRecord[];
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/earnings/${encodeURIComponent(ARC_BTC_ADDRESS)}?status=pending`
    );

    if (!resp.ok) {
      log(`API returned ${resp.status}`);
      return "error";
    }

    const data = (await resp.json()) as EarningsResponse;
    earnings = data.earnings ?? [];
  } catch (err) {
    log(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (earnings.length === 0) {
    log("No unpaid earnings");
    return "ok";
  }

  const totalSats = earnings.reduce((sum, e) => sum + e.amount_sats, 0);
  log(`Pending: ${earnings.length} earning(s) totaling ${totalSats} sats — awaiting inscription before payout`);
  return "ok";
}
