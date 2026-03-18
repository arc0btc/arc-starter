// skills/arc-monitoring-service/sensor.ts
//
// Monitors registered endpoints on their configured interval.
// Runs every 1 minute, checks only endpoints that are due.
// Fires alert webhooks and creates tasks on consecutive failures.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  getDueMonitoredEndpoints,
  updateMonitoredEndpointCheck,
  updateMonitoredEndpointStatus,
  insertTask,
  pendingTaskExistsForSource,
  type MonitoredEndpoint,
} from "../../src/db.ts";

const SENSOR_NAME = "arc-monitoring-service";
const INTERVAL_MINUTES = 1;
const CHECK_TIMEOUT_MS = 10_000;
const FAILURE_THRESHOLD = 3;
const MAX_CHECKS_PER_RUN = 20; // prevent overload

const log = createSensorLogger(SENSOR_NAME);

interface CheckResult {
  endpoint_id: number;
  url: string;
  ok: boolean;
  status_code: number;
  response_ms: number;
  error: string | null;
}

async function checkEndpoint(ep: MonitoredEndpoint): Promise<CheckResult> {
  const start = performance.now();
  try {
    const response = await fetch(ep.endpoint_url, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: "follow",
    });
    const ms = Math.round(performance.now() - start);
    return {
      endpoint_id: ep.id,
      url: ep.endpoint_url,
      ok: response.ok,
      status_code: response.status,
      response_ms: ms,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    return {
      endpoint_id: ep.id,
      url: ep.endpoint_url,
      ok: false,
      status_code: 0,
      response_ms: ms,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function fireAlertWebhook(ep: MonitoredEndpoint, result: CheckResult): Promise<void> {
  if (!ep.alert_webhook) return;

  try {
    await fetch(ep.alert_webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "endpoint_down",
        endpoint_id: ep.id,
        endpoint_url: ep.endpoint_url,
        label: ep.label,
        consecutive_failures: ep.consecutive_failures + 1,
        last_error: result.error,
        checked_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    log(`alert webhook fired for endpoint ${ep.id}`);
  } catch (e) {
    log(`alert webhook failed for endpoint ${ep.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export default async function arcMonitoringServiceSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const dueEndpoints = getDueMonitoredEndpoints();
    if (dueEndpoints.length === 0) {
      log("no endpoints due for check");
      return "ok";
    }

    // Cap checks per run to avoid timeout
    const batch = dueEndpoints.slice(0, MAX_CHECKS_PER_RUN);
    log(`checking ${batch.length} endpoint(s) (${dueEndpoints.length} total due)`);

    const results = await Promise.allSettled(batch.map((ep) => checkEndpoint(ep)));

    let healthy = 0;
    let degraded = 0;

    for (let i = 0; i < batch.length; i++) {
      const ep = batch[i];
      const settled = results[i];

      if (settled.status === "rejected") {
        log(`endpoint ${ep.id} check threw: ${settled.reason}`);
        continue;
      }

      const result = settled.value;
      const newFailures = result.ok ? 0 : ep.consecutive_failures + 1;
      const statusLabel = result.ok ? "healthy" : (newFailures >= FAILURE_THRESHOLD ? "down" : "degraded");

      updateMonitoredEndpointCheck(ep.id, statusLabel, result.response_ms, newFailures);

      if (result.ok) {
        healthy++;
      } else {
        degraded++;
        log(`endpoint ${ep.id} (${ep.endpoint_url}): ${result.error} [failures: ${newFailures}]`);

        // Fire alert webhook on threshold crossing (Pro tier)
        if (newFailures === FAILURE_THRESHOLD && ep.tier === "pro") {
          await fireAlertWebhook(ep, result);
        }

        // Create alert task on threshold
        if (newFailures === FAILURE_THRESHOLD) {
          const source = `sensor:arc-monitoring-service:alert:${ep.id}`;
          if (!pendingTaskExistsForSource(source)) {
            insertTask({
              subject: `[monitoring] Endpoint down: ${ep.label || ep.endpoint_url}`,
              description: [
                `Monitored endpoint has ${FAILURE_THRESHOLD} consecutive failures.`,
                ``,
                `Endpoint ID: ${ep.id}`,
                `URL: ${ep.endpoint_url}`,
                `Label: ${ep.label ?? "(none)"}`,
                `Tier: ${ep.tier}`,
                `Owner: ${ep.owner_address ?? "API"}`,
                `Last error: ${result.error}`,
                `Response time: ${result.response_ms}ms`,
                ``,
                `Run: arc skills run --name arc-monitoring-service -- check --id ${ep.id}`,
              ].join("\n"),
              skills: JSON.stringify(["arc-monitoring-service"]),
              source,
              priority: 7,
              model: "haiku",
            });
            log(`created alert task for endpoint ${ep.id}`);
          }
        }
      }
    }

    // Expire endpoints past their expires_at
    const now = new Date().toISOString();
    for (const ep of batch) {
      if (ep.expires_at && ep.expires_at < now && ep.status === "active") {
        updateMonitoredEndpointStatus(ep.id, "expired");
        log(`expired endpoint ${ep.id}`);
      }
    }

    log(`run complete: ${healthy} healthy, ${degraded} degraded/down`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
