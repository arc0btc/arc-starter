import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import {
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";

const SENSOR_NAME = "site-consistency";
const INTERVAL_MINUTES = 1440; // daily
const SOURCE = `sensor:${SENSOR_NAME}`;
const FETCH_TIMEOUT_MS = 15_000;

interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
}

async function fetchPage(url: string): Promise<{ status: number; body: string } | { error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (fetchError) {
    return { error: fetchError instanceof Error ? fetchError.message : String(fetchError) };
  }
}

async function checkArc0me(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Main page should be reachable
  const main = await fetchPage("https://arc0.me");
  if ("error" in main) {
    results.push({ check: "arc0me-reachable", ok: false, detail: `Fetch failed: ${main.error}` });
    return results;
  }
  results.push({ check: "arc0me-reachable", ok: main.status === 200, detail: `HTTP ${main.status}` });

  // Should NOT have /services/ route (blog only)
  const services = await fetchPage("https://arc0.me/services");
  if ("error" in services) {
    results.push({ check: "arc0me-no-services", ok: true, detail: "Route unreachable (expected)" });
  } else {
    const hasServices = services.status === 200;
    results.push({
      check: "arc0me-no-services",
      ok: !hasServices,
      detail: hasServices ? "DRIFT: /services/ exists on arc0.me (should be blog only)" : `HTTP ${services.status} (not found, as expected)`,
    });
  }

  // Should NOT have x402 endpoints
  const x402 = await fetchPage("https://arc0.me/.well-known/x402");
  if ("error" in x402) {
    results.push({ check: "arc0me-no-x402", ok: true, detail: "x402 endpoint unreachable (expected)" });
  } else {
    const hasX402 = x402.status === 200;
    results.push({
      check: "arc0me-no-x402",
      ok: !hasX402,
      detail: hasX402 ? "DRIFT: x402 endpoint exists on arc0.me" : `HTTP ${x402.status} (not found, as expected)`,
    });
  }

  // Check that arc0.me links to arc0btc.com
  if ("body" in main) {
    const linksToArc0btc = main.body.includes("arc0btc.com");
    results.push({
      check: "arc0me-links-to-arc0btc",
      ok: linksToArc0btc,
      detail: linksToArc0btc ? "Cross-link to arc0btc.com found" : "DRIFT: No link to arc0btc.com on arc0.me",
    });
  }

  return results;
}

async function checkArc0btc(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Main page should be reachable
  const main = await fetchPage("https://arc0btc.com");
  if ("error" in main) {
    results.push({ check: "arc0btc-reachable", ok: false, detail: `Fetch failed: ${main.error}` });
    return results;
  }
  results.push({ check: "arc0btc-reachable", ok: main.status === 200, detail: `HTTP ${main.status}` });

  // Should have services content
  if ("body" in main) {
    const hasServicesContent = main.body.toLowerCase().includes("service");
    results.push({
      check: "arc0btc-has-services",
      ok: hasServicesContent,
      detail: hasServicesContent ? "Services content found" : "DRIFT: No services content on arc0btc.com",
    });

    // Should link back to arc0.me
    const linksToArc0me = main.body.includes("arc0.me");
    results.push({
      check: "arc0btc-links-to-arc0me",
      ok: linksToArc0me,
      detail: linksToArc0me ? "Cross-link to arc0.me found" : "DRIFT: No link to arc0.me on arc0btc.com",
    });
  }

  // Should have x402 endpoint
  const x402 = await fetchPage("https://arc0btc.com/.well-known/x402");
  if ("error" in x402) {
    results.push({ check: "arc0btc-has-x402", ok: false, detail: `x402 fetch failed: ${x402.error}` });
  } else {
    const hasX402 = x402.status === 200;
    results.push({
      check: "arc0btc-has-x402",
      ok: hasX402,
      detail: hasX402 ? "x402 endpoint present" : `DRIFT: x402 endpoint missing (HTTP ${x402.status})`,
    });
  }

  return results;
}

export default async function siteConsistencySensor(): Promise<string> {
  const log = createSensorLogger(SENSOR_NAME);

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("running cross-site consistency checks");

  try {
    const [arc0meResults, arc0btcResults] = await Promise.all([
      checkArc0me(),
      checkArc0btc(),
    ]);

    const allResults = [...arc0meResults, ...arc0btcResults];
    const failures = allResults.filter((r) => !r.ok);

    if (failures.length > 0) {
      log(`${failures.length} drift issue(s) detected`);

      if (pendingTaskExistsForSource(SOURCE)) {
        log("pending task already exists, skipping task creation");
        return "ok";
      }

      const failureSummary = failures.map((f) => `- ${f.check}: ${f.detail}`).join("\n");

      insertTask({
        subject: `Site consistency drift detected: ${failures.length} issue(s)`,
        description: `Cross-site consistency check found drift between arc0.me and arc0btc.com.\n\n**Failures:**\n${failureSummary}\n\n**All results:**\n${allResults.map((r) => `- ${r.check}: ${r.ok ? "OK" : "FAIL"} — ${r.detail}`).join("\n")}`,
        skills: JSON.stringify(["site-consistency", "arc0btc-site-health"]),
        source: SOURCE,
        priority: 3,
        model: "sonnet",
      });

      log("created P3 fix task for drift issues");
    } else {
      log("all checks passed — sites consistent");
    }

    return "ok";
  } catch (sensorError) {
    log(`error: ${sensorError instanceof Error ? sensorError.message : String(sensorError)}`);
    return "error";
  }
}
