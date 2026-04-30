#!/usr/bin/env bun

export {};

const FETCH_TIMEOUT_MS = 15_000;

interface CheckResult {
  check: string;
  ok: boolean;
  detail: string;
  responseTimeMs?: number;
  responseBody?: string;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function timedFetch(url: string): Promise<{ status: number; body: string; responseTimeMs: number } | { error: string; responseTimeMs: number }> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    const body = await response.text();
    return { status: response.status, body, responseTimeMs: Date.now() - start };
  } catch (fetchError) {
    return { error: fetchError instanceof Error ? fetchError.message : String(fetchError), responseTimeMs: Date.now() - start };
  }
}

async function runChecks(verbose: boolean): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // arc0.me checks
  const arc0meMain = await timedFetch("https://arc0.me");
  if ("error" in arc0meMain) {
    results.push({ check: "arc0me-reachable", ok: false, detail: `Fetch failed: ${arc0meMain.error}`, responseTimeMs: arc0meMain.responseTimeMs });
  } else {
    results.push({
      check: "arc0me-reachable",
      ok: arc0meMain.status === 200,
      detail: `HTTP ${arc0meMain.status}`,
      responseTimeMs: arc0meMain.responseTimeMs,
      ...(verbose ? { responseBody: arc0meMain.body.slice(0, 500) } : {}),
    });

    const linksToArc0btc = arc0meMain.body.includes("arc0btc.com");
    results.push({ check: "arc0me-links-to-arc0btc", ok: linksToArc0btc, detail: linksToArc0btc ? "Found" : "DRIFT: Missing" });
  }

  const arc0meServices = await timedFetch("https://arc0.me/services");
  if ("error" in arc0meServices) {
    results.push({ check: "arc0me-no-services", ok: true, detail: "Unreachable (expected)", responseTimeMs: arc0meServices.responseTimeMs });
  } else {
    const hasServices = arc0meServices.status === 200;
    results.push({
      check: "arc0me-no-services",
      ok: !hasServices,
      detail: hasServices ? "DRIFT: /services/ exists" : `HTTP ${arc0meServices.status} (expected)`,
      responseTimeMs: arc0meServices.responseTimeMs,
    });
  }

  const arc0meX402 = await timedFetch("https://arc0.me/.well-known/x402");
  if ("error" in arc0meX402) {
    results.push({ check: "arc0me-no-x402", ok: true, detail: "Unreachable (expected)", responseTimeMs: arc0meX402.responseTimeMs });
  } else {
    const hasX402 = arc0meX402.status === 200;
    results.push({
      check: "arc0me-no-x402",
      ok: !hasX402,
      detail: hasX402 ? "DRIFT: x402 exists" : `HTTP ${arc0meX402.status} (expected)`,
      responseTimeMs: arc0meX402.responseTimeMs,
    });
  }

  // arc0btc.com checks
  const arc0btcMain = await timedFetch("https://arc0btc.com");
  if ("error" in arc0btcMain) {
    results.push({ check: "arc0btc-reachable", ok: false, detail: `Fetch failed: ${arc0btcMain.error}`, responseTimeMs: arc0btcMain.responseTimeMs });
  } else {
    results.push({
      check: "arc0btc-reachable",
      ok: arc0btcMain.status === 200,
      detail: `HTTP ${arc0btcMain.status}`,
      responseTimeMs: arc0btcMain.responseTimeMs,
      ...(verbose ? { responseBody: arc0btcMain.body.slice(0, 500) } : {}),
    });

    const hasServicesContent = arc0btcMain.body.toLowerCase().includes("service");
    results.push({ check: "arc0btc-has-services", ok: hasServicesContent, detail: hasServicesContent ? "Found" : "DRIFT: Missing" });

    const linksToArc0me = arc0btcMain.body.includes("arc0.me");
    results.push({ check: "arc0btc-links-to-arc0me", ok: linksToArc0me, detail: linksToArc0me ? "Found" : "DRIFT: Missing" });
  }

  const arc0btcX402 = await timedFetch("https://arc0btc.com/.well-known/x402");
  if ("error" in arc0btcX402) {
    results.push({ check: "arc0btc-has-x402", ok: false, detail: `Fetch failed: ${arc0btcX402.error}`, responseTimeMs: arc0btcX402.responseTimeMs });
  } else {
    const hasX402 = arc0btcX402.status === 200;
    results.push({
      check: "arc0btc-has-x402",
      ok: hasX402,
      detail: hasX402 ? "Present" : `DRIFT: Missing (HTTP ${arc0btcX402.status})`,
      responseTimeMs: arc0btcX402.responseTimeMs,
    });
  }

  return results;
}

function printUsage(): void {
  console.log(`site-consistency — Cross-site drift detection

Usage:
  arc skills run --name site-consistency -- check [--verbose]

Subcommands:
  check       Run all consistency checks (JSON output)
  help        Show this help

Flags:
  --verbose   Include response bodies and extra diagnostics`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "check": {
      const flags = parseFlags(args.slice(1));
      const verbose = flags["verbose"] === true;
      const results = await runChecks(verbose);
      const failures = results.filter((r) => !r.ok);

      const output = {
        timestamp: new Date().toISOString(),
        totalChecks: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
        results,
      };

      console.log(JSON.stringify(output, null, 2));
      if (failures.length > 0) process.exit(1);
      break;
    }
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n`);
      process.exit(1);
  }
}

main().catch((cliError) => {
  process.stderr.write(`Error: ${cliError instanceof Error ? cliError.message : String(cliError)}\n`);
  process.exit(1);
});
