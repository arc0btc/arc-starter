import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import {
  initDatabase,
  insertWorkflow,
  getWorkflowByInstanceKey,
} from "../../src/db.ts";
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
  log(`Found ${earnings.length} unpaid earning(s) totaling ${totalSats} sats`);

  // Use today's date as the payout run key (one payout run per day max)
  const today = new Date().toISOString().slice(0, 10);
  const instanceKey = `payout-${today}`;

  // Check if a workflow already exists for today
  const existing = getWorkflowByInstanceKey(instanceKey);
  if (existing) {
    log(`Workflow already exists for ${instanceKey} (id=${existing.id}, state=${existing.current_state})`);
    return "ok";
  }

  // Create payout-distribution workflow with initial context
  const context = JSON.stringify({
    date: today,
    earnings: earnings.map((e) => ({
      id: e.id,
      address: e.address,
      amount_sats: e.amount_sats,
    })),
    totalSats,
  });

  const workflowId = insertWorkflow({
    template: "payout-distribution",
    instance_key: instanceKey,
    current_state: "fetch_unpaid",
    context,
  });

  log(`Created payout-distribution workflow id=${workflowId} for ${instanceKey} (${earnings.length} earnings, ${totalSats} sats)`);
  return "ok";
}
