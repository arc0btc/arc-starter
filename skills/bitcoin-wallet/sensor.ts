// bitcoin-wallet/sensor.ts
//
// Monitors x402 relay health every 15 minutes.
// Creates a P3 alert task if the relay is unreachable, unhealthy,
// or the sponsor has nonce gaps. Tracks state in hook-state to
// avoid alert spam (max 1 alert per 60 min).

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  fetchWithRetry,
} from "../../src/sensors.ts";
import type { HookState } from "../../src/sensors.ts";

const SENSOR_NAME = "x402-relay-health";
const INTERVAL_MINUTES = 15;
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 60 min
const TASK_SOURCE = "sensor:x402-relay-health";
const RELAY_URL = "https://x402-relay.aibtc.com";
const SPONSOR_ADDRESS = "SP1PMPPVCMVW96FSWFV30KJQ4MNBMZ8MRWR3JWQ7";

const log = createSensorLogger(SENSOR_NAME);

interface RelayHealthState extends HookState {
  last_alert_at: string | null;
  last_healthy: boolean;
  last_issues: string[];
}

interface NonceResponse {
  last_mempool_tx_nonce: number | null;
  last_executed_tx_nonce: number | null;
  possible_next_nonce: number;
  detected_missing_nonces: number[];
  detected_mempool_nonces: number[];
}

async function checkRelayHealth(): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  let relayReachable = false;

  // 1. Relay /health endpoint
  try {
    const response = await fetchWithRetry(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      relayReachable = true;
    } else {
      issues.push(`Relay returned HTTP ${response.status}`);
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "unknown error";
    issues.push(`Relay unreachable: ${errorMessage}`);
  }

  // 2. Sponsor nonce status
  try {
    const response = await fetchWithRetry(
      `https://api.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/nonces`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (response.ok) {
      const nonce = (await response.json()) as NonceResponse;
      if (nonce.detected_missing_nonces.length > 0) {
        issues.push(`Nonce gaps: [${nonce.detected_missing_nonces.join(", ")}]`);
      }
      if (nonce.detected_mempool_nonces.length > 5) {
        issues.push(`Mempool congestion: ${nonce.detected_mempool_nonces.length} pending`);
      }
    } else {
      issues.push(`Nonce API returned HTTP ${response.status}`);
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "unknown error";
    issues.push(`Nonce API unreachable: ${errorMessage}`);
  }

  return { healthy: relayReachable && issues.length === 0, issues };
}

export default async function relayHealthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const state = (await readHookState(SENSOR_NAME)) as RelayHealthState | null;
  const { healthy, issues } = await checkRelayHealth();

  // Update state with latest check result
  const now = new Date().toISOString();
  const newState: RelayHealthState = {
    last_ran: now,
    last_result: "ok",
    version: state ? state.version + 1 : 1,
    last_alert_at: state?.last_alert_at ?? null,
    last_healthy: healthy,
    last_issues: issues,
  };

  if (!healthy) {
    // Check cooldown — only alert if enough time has passed since last alert
    const lastAlert = state?.last_alert_at ? new Date(state.last_alert_at).getTime() : 0;
    const cooldownElapsed = Date.now() - lastAlert >= ALERT_COOLDOWN_MS;

    if (cooldownElapsed) {
      const issuesSummary = issues.join("; ");
      const taskId = insertTaskIfNew(TASK_SOURCE, {
        subject: `x402 relay health alert: ${issues.length} issue(s) detected`,
        description:
          `x402 relay health check failed.\n\nIssues:\n${issues.map((i) => `- ${i}`).join("\n")}\n\n` +
          `Relay: ${RELAY_URL}\nSponsor: ${SPONSOR_ADDRESS}\n\n` +
          "Investigate relay availability and sponsor nonce state. " +
          "Run: arc skills run --name wallet -- check-relay-health",
        priority: 3,
        skills: JSON.stringify(["bitcoin-wallet"]),
      });

      if (taskId !== null) {
        newState.last_alert_at = now;
        log(`alert created (task #${taskId}): ${issuesSummary}`);
      } else {
        log(`alert already queued: ${issuesSummary}`);
      }
    } else {
      log(`unhealthy but cooldown active (${issues.length} issues)`);
    }
  } else {
    log("relay healthy");
  }

  await writeHookState(SENSOR_NAME, newState);
  return healthy ? "ok" : `unhealthy: ${issues.join("; ")}`;
}
