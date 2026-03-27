#!/usr/bin/env bun
// skills/paperboy/cli.ts
// CLI for logging Paperboy signal deliveries and checking earnings.
//
// Auth: Stacks address signing
//   Sign message 'paperboy:{stx_address}:{YYYY-MM-DD}' using stacks-sign
//   Send headers: x-stx-address + x-stx-signature
//   Valid for 24 hours per delivery auth spec.
//
// Commands:
//   log-delivery --signal <url-or-id> --recipient <platform:handle> --framing <context> [--response <reply>]
//   list-deliveries [--slug <slug>]
//   check-earnings [--slug <slug>]

import { ARC_STX_ADDRESS } from "../../src/identity.ts";

const API_BASE = "https://paperboy-dash.p-d07.workers.dev";
const PAPERBOY_SLUG = "trustless"; // Arc's Paperboy slug (Trustless Indra)

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [paperboy/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sign a message using the Stacks wallet.
 * Returns the hex/base64 signature string.
 */
async function signStacksMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "stacks-sign", "--message", message],
    {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Stacks signing failed: ${stderr.trim()}`);
  }

  const combined = (stdout + stderr).trim();
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON output from wallet signing. Output: ${combined}`);
  }

  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const candidate = combined.substring(jsonStart, endIdx);
      const result = JSON.parse(candidate) as Record<string, unknown>;
      if (typeof result.signatureHex === "string") return result.signatureHex;
      if (typeof result.signature === "string") return result.signature;
      if (typeof result.signatureBase64 === "string") return result.signatureBase64;
    } catch {
      // Try shorter substring
    }
  }

  throw new Error(`No valid signature in wallet response. Output: ${combined}`);
}

/**
 * Build Paperboy auth headers.
 * Message format: paperboy:{stx_address}:{YYYY-MM-DD}
 */
async function buildAuthHeaders(): Promise<Record<string, string>> {
  const date = getTodayUtc();
  const message = `paperboy:${ARC_STX_ADDRESS}:${date}`;
  log(`Signing auth message: ${message}`);
  const signature = await signStacksMessage(message);
  log(`Signature obtained (${signature.length} chars)`);
  return {
    "Content-Type": "application/json",
    "x-stx-address": ARC_STX_ADDRESS,
    "x-stx-signature": signature,
  };
}

async function apiPost(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const headers = await buildAuthHeaders();

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return data;
}

/**
 * Fetch a profile page (returns HTML).
 * Parse delivery records and summary stats from the markup.
 */
async function fetchProfilePage(slug: string): Promise<string> {
  const url = `${API_BASE}/paperboy/${slug}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Profile fetch failed ${response.status}: ${await response.text()}`);
  }
  return response.text();
}

/**
 * Parse summary stats from the profile HTML.
 */
function parseProfileStats(html: string): Record<string, unknown> {
  const deliveriesMatch = html.match(/<strong>(\d+)<\/strong>\s*deliveries?/i);
  const recruitsMatch = html.match(/<strong>(\d+)<\/strong>\s*recruits?/i);
  const earnedMatch = html.match(/Earned[^<]*<strong>([\d,]+)<\/strong>\s*sats/i);
  const owedMatch = html.match(/Owed[^<]*<strong>([\d,]+)<\/strong>\s*sats/i);
  const ratingMatch = html.match(/Rating[^<]*<strong>([^<]+)<\/strong>\/5/i);
  const routeMatch = html.match(/route-banner[^>]*>([^<]+)</i);
  const nameMatch = html.match(/<h[12][^>]*>\s*([^<]+)\s*<\/h[12]>/i);

  const parseNum = (s: string | undefined): number =>
    s ? parseInt(s.replace(/,/g, ""), 10) : 0;

  return {
    name: nameMatch?.[1]?.trim() ?? null,
    route: routeMatch?.[1]?.trim() ?? null,
    deliveries: parseNum(deliveriesMatch?.[1]),
    recruits: parseNum(recruitsMatch?.[1]),
    earned_sats: parseNum(earnedMatch?.[1]),
    owed_sats: parseNum(owedMatch?.[1]),
    rating: ratingMatch?.[1]?.trim() ?? null,
  };
}

/**
 * Parse individual delivery records from the profile HTML.
 * Each delivery block uses class="delivery" with del-header, del-to, del-framing, del-response.
 */
function parseDeliveryRecords(html: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];

  // Match each delivery block
  const deliveryBlocks = html.matchAll(/<div[^>]*class="delivery"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|<\/section|<\/div>)/gi);

  for (const block of deliveryBlocks) {
    const content = block[1];
    const headerMatch = content.match(/class="del-header"[^>]*>([\s\S]*?)<\/div>/i);
    const toMatch = content.match(/class="del-to"[^>]*>([\s\S]*?)<\/div>/i);
    const framingMatch = content.match(/class="del-framing"[^>]*>([\s\S]*?)<\/div>/i);
    const responseMatch = content.match(/class="del-response"[^>]*>([\s\S]*?)<\/div>/i);
    const dimMatch = content.match(/class="dim"[^>]*>([\s\S]*?)<\/div>/i);

    const strip = (s: string | undefined): string =>
      (s ?? "").replace(/<[^>]+>/g, "").trim();

    records.push({
      signal: strip(headerMatch?.[1]),
      recipient: strip(toMatch?.[1]),
      framing: strip(framingMatch?.[1]),
      response: strip(responseMatch?.[1]),
      date: strip(dimMatch?.[1]),
    });
  }

  return records;
}

// ---- Subcommands ----

async function cmdLogDelivery(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.signal || !flags.recipient || !flags.framing) {
    process.stderr.write(
      "Usage: arc skills run --name paperboy -- log-delivery \\\n" +
        "  --signal <signal-url-or-id> \\\n" +
        "  --recipient <platform:handle> \\\n" +
        "  --framing <context-sentence> \\\n" +
        "  [--response <reply-or-outcome>]\n"
    );
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    signal: flags.signal,
    recipient: flags.recipient,
    framing: flags.framing,
    response: flags.response ?? "",
  };

  log(`Logging delivery → signal=${flags.signal} recipient=${flags.recipient}`);

  try {
    const result = await apiPost("/deliver", body);
    log("Delivery logged successfully");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ success: false, error: message }));
    process.exit(1);
  }
}

async function cmdListDeliveries(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const slug = flags.slug ?? PAPERBOY_SLUG;

  log(`Fetching delivery history for: ${slug}`);

  try {
    const html = await fetchProfilePage(slug);
    const stats = parseProfileStats(html);
    const deliveries = parseDeliveryRecords(html);

    const result = {
      slug,
      stx_address: ARC_STX_ADDRESS,
      total_deliveries: stats.deliveries,
      deliveries,
    };

    log(`Found ${deliveries.length} delivery records`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ success: false, error: message }));
    process.exit(1);
  }
}

async function cmdCheckEarnings(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const slug = flags.slug ?? PAPERBOY_SLUG;

  log(`Fetching earnings for: ${slug}`);

  try {
    const html = await fetchProfilePage(slug);
    const stats = parseProfileStats(html);

    const result = {
      slug,
      stx_address: ARC_STX_ADDRESS,
      ...stats,
    };

    log(`Earnings: ${stats.earned_sats} sats earned, ${stats.owed_sats} sats owed`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ success: false, error: message }));
    process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`paperboy CLI

USAGE
  arc skills run --name paperboy -- <subcommand> [flags]

SUBCOMMANDS
  log-delivery --signal <url-or-id> --recipient <platform:handle> --framing <context> [--response <reply>]
    Log a verified signal delivery to the Paperboy API.
    Requires Stacks signing — auto-signed from Arc's wallet.
    --signal     Signal URL or ID (e.g. "https://aibtc.news/signals/123")
    --recipient  Platform and handle (e.g. "x:@bitcoiner_handle")
    --framing    1-2 sentence context for why this signal matters to the recipient
    --response   Optional: reply or outcome (e.g. "liked", "replied positively")

  list-deliveries [--slug <paperboy-slug>]
    List delivery history for this Paperboy account.
    Default slug: ${PAPERBOY_SLUG}

  check-earnings [--slug <paperboy-slug>]
    Show earnings summary: sats earned, owed, delivery count, recruits.
    Default slug: ${PAPERBOY_SLUG}

EXAMPLES
  arc skills run --name paperboy -- log-delivery \\
    --signal "https://aibtc.news/signals/9076" \\
    --recipient "x:@ordinals_dev" \\
    --framing "Ordinals fee market data — useful for builders timing deployments." \\
    --response "retweeted with comment"

  arc skills run --name paperboy -- list-deliveries

  arc skills run --name paperboy -- check-earnings
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "log-delivery":
      await cmdLogDelivery(args.slice(1));
      break;
    case "list-deliveries":
      await cmdListDeliveries(args.slice(1));
      break;
    case "check-earnings":
      await cmdCheckEarnings(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
