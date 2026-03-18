// credential-health/sensor.ts
//
// Validates credential store health every 60 minutes.
// Checks: store unlock, credential readability, API connectivity for known endpoints.
// Writes failures to memory/topics/integrations.md and creates a task if issues found.

import { join } from "node:path";
import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { credentials } from "../../src/credentials.ts";
import { verifyCloudflareToken } from "../../src/cloudflare.ts";

const SENSOR_NAME = "credential-health";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:credential-health";

const log = createSensorLogger(SENSOR_NAME);

const ROOT = new URL("../../", import.meta.url).pathname;
const INTEGRATIONS_TOPIC = join(ROOT, "memory", "topics", "integrations.md");

/** Known API endpoints that can be health-checked. Maps service name to a check function. */
const API_CHECKS: Record<string, (creds: Map<string, string>) => Promise<string | null>> = {
  /** Email worker — GET /api/stats should return 200 */
  "arc-email-sync": async (creds) => {
    const baseUrl = creds.get("api_base_url");
    const apiKey = creds.get("admin_api_key");
    if (!baseUrl || !apiKey) return "missing api_base_url or admin_api_key";
    try {
      const response = await fetch(`${baseUrl}/api/stats`, {
        headers: { "X-Admin-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return `HTTP ${response.status}`;
      return null; // healthy
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },

  /** Email worker (legacy service name) */
  email: async (creds) => {
    const baseUrl = creds.get("api_base_url");
    const apiKey = creds.get("admin_api_key");
    if (!baseUrl || !apiKey) return "missing api_base_url or admin_api_key";
    try {
      const response = await fetch(`${baseUrl}/api/stats`, {
        headers: { "X-Admin-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return `HTTP ${response.status}`;
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },

  /** Cloudflare — verify token with account-scoped endpoint (user-scoped returns 401 for account-scoped tokens) */
  cloudflare: async (_creds) => {
    const result = await verifyCloudflareToken();
    if (!result.ok) return result.error ?? "verification failed";
    return null;
  },
};

interface HealthFailure {
  service: string;
  key?: string;
  reason: string;
}

/** Check that every credential in the store is readable (non-empty value). */
function checkReadability(): HealthFailure[] {
  const failures: HealthFailure[] = [];
  const entries = credentials.list();

  for (const entry of entries) {
    const value = credentials.get(entry.service, entry.key);
    if (value === null || value.length === 0) {
      failures.push({ service: entry.service, key: entry.key, reason: "empty or null value" });
    }
  }

  return failures;
}

/** Run API connectivity checks for services that have known endpoints. */
async function checkConnectivity(): Promise<HealthFailure[]> {
  const failures: HealthFailure[] = [];
  const entries = credentials.list();

  // Group credentials by service
  const serviceKeys = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    if (!serviceKeys.has(entry.service)) {
      serviceKeys.set(entry.service, new Map());
    }
    const value = credentials.get(entry.service, entry.key);
    if (value) {
      serviceKeys.get(entry.service)!.set(entry.key, value);
    }
  }

  // Run checks for services with known endpoints
  const checks = Object.entries(API_CHECKS).filter(([svc]) => serviceKeys.has(svc));

  const results = await Promise.allSettled(
    checks.map(async ([svc, checkFn]) => {
      const error = await checkFn(serviceKeys.get(svc)!);
      if (error) {
        failures.push({ service: svc, reason: `API check failed: ${error}` });
      }
    }),
  );

  // Catch unexpected rejections
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const reason = (results[i] as PromiseRejectedResult).reason;
      failures.push({
        service: checks[i][0],
        reason: `API check threw: ${reason instanceof Error ? reason.message : String(reason)}`,
      });
    }
  }

  return failures;
}

/** Append failure report to memory/topics/integrations.md */
async function writeFailuresToMemory(failures: HealthFailure[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const lines = failures.map((f) => {
    const keyPart = f.key ? `/${f.key}` : "";
    return `  - \`${f.service}${keyPart}\`: ${f.reason}`;
  });

  const entry = [
    "",
    `**[FLAG] Credential health check failures (${timestamp}):**`,
    ...lines,
    "",
  ].join("\n");

  const file = Bun.file(INTEGRATIONS_TOPIC);
  const existing = (await file.exists()) ? await file.text() : "## Integration Learnings\n";
  await Bun.write(INTEGRATIONS_TOPIC, existing.trimEnd() + "\n" + entry);
}

export default async function credentialHealthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Step 1: Unlock store
  try {
    await credentials.unlock();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log(`store unlock failed: ${reason}`);

    await writeFailuresToMemory([{ service: "credential-store", reason: `unlock failed: ${reason}` }]);

    insertTaskIfNew(TASK_SOURCE, {
      subject: "credential health: store unlock failed",
      description: `The credential store could not be unlocked. Error: ${reason}. Check ARC_CREDS_PASSWORD and ~/.aibtc/credentials.enc integrity.`,
      priority: 3,
      model: "sonnet",
      skills: JSON.stringify(["arc-credentials", "credential-health"]),
    });

    return "error";
  }

  // Step 2: Check readability
  const readFailures = checkReadability();

  // Step 3: Check API connectivity
  const apiFailures = await checkConnectivity();

  const allFailures = [...readFailures, ...apiFailures];

  if (allFailures.length === 0) {
    const entries = credentials.list();
    log(`all ${entries.length} credentials healthy, ${Object.keys(API_CHECKS).length} API checks passed`);
    return "ok";
  }

  // Report failures
  log(`${allFailures.length} failure(s) detected`);
  for (const f of allFailures) {
    const keyPart = f.key ? `/${f.key}` : "";
    log(`  FAIL: ${f.service}${keyPart} — ${f.reason}`);
  }

  await writeFailuresToMemory(allFailures);

  const summary = allFailures.map((f) => {
    const keyPart = f.key ? `/${f.key}` : "";
    return `${f.service}${keyPart}: ${f.reason}`;
  }).join("; ");

  insertTaskIfNew(TASK_SOURCE, {
    subject: `credential health: ${allFailures.length} failure(s) detected`,
    description: `Credential health check found issues:\n\n${summary}\n\nCheck memory/topics/integrations.md for details. Run: arc creds list`,
    priority: 3,
    model: "sonnet",
    skills: JSON.stringify(["arc-credentials", "credential-health"]),
  });

  return "ok";
}
