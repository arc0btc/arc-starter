#!/usr/bin/env bun
// skills/aibtc-news-classifieds/cli.ts
// Classified ads and extended API coverage for aibtc.news

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getContactByAddress, insertContactInteraction } from "../contact-registry/schema.ts";

const API_BASE = "https://aibtc.news/api";
const VALID_CATEGORIES = ["ordinals", "services", "agents", "wanted"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [aibtc-news-classifieds/cli] ${message}`);
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

async function apiGet(endpoint: string): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
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

interface ClassifiedRecord {
  btcAddress: string | undefined;
  headline: string;
  stxAddress: string | undefined;
  payerStxAddress: string | undefined;
  paidAmount: number;
}

async function fetchClassifiedRecord(classifiedId: string): Promise<ClassifiedRecord> {
  const raw = (await apiGet(`/classifieds/${classifiedId}`)) as {
    classified?: { contact?: string; headline?: string; placedBy?: string; payerStxAddress?: string; paidAmount?: number };
    contact?: string;
    headline?: string;
    placedBy?: string;
    payerStxAddress?: string;
    paidAmount?: number;
  };

  const inner = raw.classified ?? raw;
  return {
    btcAddress: inner.contact,
    headline: inner.headline ?? "(unknown)",
    stxAddress: inner.placedBy,
    payerStxAddress: inner.payerStxAddress ?? inner.placedBy,
    paidAmount: inner.paidAmount ?? 30000,
  };
}

/**
 * Send an x402 inbox message. Spawns the wallet skill. Throws on failure.
 */
async function sendX402InboxMessage(btcAddress: string, stxAddress: string, content: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--",
      "x402", "send-inbox-message",
      "--recipient-btc-address", btcAddress,
      "--recipient-stx-address", stxAddress,
      "--content", content,
    ],
    { cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`x402 send failed (exit ${exitCode}): ${(stdout + stderr).slice(0, 300)}`);
  }
}

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
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
    throw new Error(`Wallet signing failed: ${stderr}`);
  }

  const combined = (stdout + stderr).trim();
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON output from wallet signing. Output: ${combined}`);
  }

  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const potentialJson = combined.substring(jsonStart, endIdx);
      const result = JSON.parse(potentialJson);
      if (result.signatureBase64) return result.signatureBase64;
      if (result.signature) return result.signature;
    } catch {
      // Try shorter substring
    }
  }

  throw new Error(`No valid signature in wallet response. Output: ${combined}`);
}

/**
 * Execute an x402-paid request via the wallet skill's x402 runner.
 * Returns parsed JSON response from the endpoint.
 */
async function x402Request(
  method: string,
  url: string,
  data?: Record<string, unknown>
): Promise<unknown> {
  const args = [
    "bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--",
    "x402", "execute-endpoint",
    "--method", method,
    "--url", url,
    "--auto-approve",
  ];

  if (data) {
    args.push("--data", JSON.stringify(data));
  }

  log(`x402 request: ${method} ${url}`);

  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // Check for rate limit in stderr or stdout
    const combined = stdout + stderr;
    const retryMatch = combined.match(/retry.after[:\s]*(\d+)/i)
      || combined.match(/(\d+)\s*(?:seconds?|s)\s*remaining/i);
    if (retryMatch || combined.includes("429") || combined.includes("rate limit")) {
      const retrySeconds = retryMatch ? parseInt(retryMatch[1], 10) : undefined;
      const retryAt = retrySeconds
        ? new Date(Date.now() + retrySeconds * 1000).toISOString()
        : undefined;
      throw new Error(
        `Rate limited (429).${retrySeconds ? ` Retry after ${retrySeconds}s (${retryAt}).` : ""} Raw: ${combined.slice(0, 300)}`
      );
    }
    throw new Error(`x402 request failed (exit ${exitCode}): ${combined.slice(0, 500)}`);
  }

  // Parse JSON from stdout (wallet runner outputs JSON)
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON in x402 response. Output: ${trimmed.slice(0, 300)}`);
  }

  // Find the outermost JSON object
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  return JSON.parse(trimmed.substring(jsonStart, jsonEnd));
}

async function buildAuthHeaders(
  method: string,
  path: string
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${timestamp}`;
  const sig = await signMessage(message);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

function validateBtcAddress(address: string): boolean {
  return /^bc1[a-zA-HJ-NP-Z0-9]{25,87}$/.test(address);
}

// ---- Subcommands: Classifieds ----

async function cmdListClassifieds(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const category = flags.category as Category | undefined;

  if (category && !VALID_CATEGORIES.includes(category)) {
    console.error(`Invalid category: ${category}. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  try {
    const endpoint = category ? `/classifieds?category=${category}` : "/classifieds";
    const data = await apiGet(endpoint);
    log("Listed classifieds");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdGetClassified(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    console.error("Usage: arc skills run --name aibtc-news-classifieds -- get-classified --id <id>");
    process.exit(1);
  }

  try {
    const data = await apiGet(`/classifieds/${flags.id}`);
    log("Got classified");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdPostClassified(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.title || !flags.body || !flags.category) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- post-classified --title <text> --body <text> --category <cat> [--contact <addr>]"
    );
    console.error(`Categories: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  const title = flags.title;
  const body = flags.body;
  const category = flags.category as Category;
  const contact = flags.contact || ARC_BTC_ADDRESS;

  if (!VALID_CATEGORIES.includes(category)) {
    console.error(`Invalid category: ${category}. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  if (title.length > 200) {
    console.error(`Title too long: ${title.length} chars (keep under 200)`);
    process.exit(1);
  }

  if (body.length > 1000) {
    console.error(`Body too long: ${body.length} chars (keep under 1000)`);
    process.exit(1);
  }

  if (!validateBtcAddress(contact)) {
    console.error(`Invalid BTC address: ${contact}`);
    process.exit(1);
  }

  try {
    // Check for duplicate active ads
    log("Checking for duplicate active classifieds");
    const existing = (await apiGet("/classifieds")) as {
      classifieds: Array<{ title: string; placedBy: string; active: boolean }>;
    };
    const duplicate = existing.classifieds.find(
      (ad) => ad.active && ad.placedBy === contact && ad.title === title
    );
    if (duplicate) {
      throw new Error(
        `Duplicate: an active classified with this exact title already exists for ${contact}. Use a different title or wait for expiry.`
      );
    }

    // Post via x402 payment
    log(`Posting classified: "${title}" [${category}] (5000 sats sBTC)`);
    const result = await x402Request("POST", `${API_BASE}/classifieds`, {
      headline: title,
      body,
      category,
      btc_address: contact,
    });

    log("Classified posted successfully");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Signals (Extended) ----

async function cmdGetSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    console.error("Usage: arc skills run --name aibtc-news-classifieds -- get-signal --id <id>");
    process.exit(1);
  }

  try {
    const data = await apiGet(`/signals/${flags.id}`);
    log("Got signal");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdCorrectSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id || !flags.content) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- correct-signal --id <id> --content <text>"
    );
    process.exit(1);
  }

  if (flags.content.length > 500) {
    console.error(`Correction too long: ${flags.content.length}/500 chars`);
    process.exit(1);
  }

  try {
    const path = `/signals/${flags.id}`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Signing message for PATCH /api${path}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ btc_address: ARC_BTC_ADDRESS, content: flags.content }),
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

    log("Signal corrected");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Beats (Extended) ----

async function cmdUpdateBeat(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.beat) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- update-beat --beat <slug> [--description <text>] [--color <hex>]"
    );
    process.exit(1);
  }

  if (!flags.description && !flags.color) {
    console.error("Provide at least --description or --color to update");
    process.exit(1);
  }

  if (flags.color && !/^#[0-9A-Fa-f]{6}$/.test(flags.color)) {
    console.error("Invalid color format (must be #RRGGBB)");
    process.exit(1);
  }

  if (flags.description && flags.description.length > 500) {
    console.error(`Description too long: ${flags.description.length}/500 chars`);
    process.exit(1);
  }

  try {
    const path = `/beats/${flags.beat}`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Signing message for PATCH /api${path}`);

    const body: Record<string, unknown> = {};
    if (flags.description) body.description = flags.description;
    if (flags.color) body.color = flags.color;

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
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

    log("Beat updated");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    console.error(JSON.stringify({ error: errorMessage }, null, 2));
    process.exit(1);
  }
}

async function cmdDeleteBeat(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.beat) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- delete-beat --beat <slug>"
    );
    process.exit(1);
  }

  try {
    const path = `/beats/${flags.beat}`;
    const headers = await buildAuthHeaders("DELETE", path);
    log(`Deleting beat: ${flags.beat}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ btc_address: ARC_BTC_ADDRESS }),
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

    log("Beat deleted");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    console.error(JSON.stringify({ error: errorMessage }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Briefs ----

async function cmdGetBrief(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date;

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("--date must be YYYY-MM-DD format");
    process.exit(1);
  }

  try {
    const endpoint = date ? `/brief/${date}` : "/brief";
    const url = `${API_BASE}${endpoint}`;

    log(`Fetching brief via x402 (1000 sats sBTC): ${url}`);
    const raw = await x402Request("GET", url);
    const result = raw as Record<string, unknown>;

    // Surface included signals with positions for clarity
    const includedSignals = result.included_signals ?? result.includedSignals;
    const signalCount = Array.isArray(includedSignals) ? includedSignals.length : 0;

    log(`Brief retrieved — ${signalCount} included signal(s)`);

    if (signalCount > 0 && Array.isArray(includedSignals)) {
      const summary = (includedSignals as Array<Record<string, unknown>>).map((s) => ({
        position: s.position,
        signalId: s.signalId ?? s.signal_id,
        beatSlug: s.beatSlug ?? s.beat_slug,
        headline: s.headline,
      }));
      log(`Included signals: ${JSON.stringify(summary)}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdInscribeBrief(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.date || !flags["inscription-id"]) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- inscribe-brief --date <YYYY-MM-DD> --inscription-id <id>"
    );
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) {
    console.error("Date must be YYYY-MM-DD format");
    process.exit(1);
  }

  const inscriptionId = flags["inscription-id"].trim();
  if (inscriptionId.length === 0) {
    console.error("--inscription-id cannot be empty");
    process.exit(1);
  }

  try {
    const path = `/brief/${flags.date}/inscribe`;
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `POST /api${path}:${timestamp}`;
    const signature = await signMessage(message);
    const headers: Record<string, string> = {
      "X-BTC-Address": ARC_BTC_ADDRESS,
      "X-BTC-Signature": signature,
      "X-BTC-Timestamp": String(timestamp),
      "Content-Type": "application/json",
    };
    log(`Signing message for POST /api${path}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ btc_address: ARC_BTC_ADDRESS, signature, inscription_id: inscriptionId }),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "0", 10);
      const retrySeconds = retryAfter > 0 ? retryAfter : 3600;
      log(`Rate limited by aibtc.news — Retry-After: ${retrySeconds}s`);
      console.error(JSON.stringify({
        error: "rate_limited",
        retry_after: retrySeconds,
        message: `Rate limited. Do NOT retry for ${retrySeconds} seconds. Wait until the rate-limit window resets before calling inscribe-brief again for any date.`,
      }, null, 2));
      process.exit(1);
    }

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${text}`);
    }

    log("Brief inscription recorded");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    console.error(JSON.stringify({ error: errorMessage }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Discovery ----

async function cmdStreaks(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const agent = flags.agent;

  if (agent && !validateBtcAddress(agent)) {
    console.error(`Invalid BTC address: ${agent}`);
    process.exit(1);
  }

  try {
    const endpoint = agent ? `/streaks?address=${agent}` : "/streaks";
    const data = await apiGet(endpoint);
    log("Got streaks");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdListSkills(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    const params = new URLSearchParams();
    if (flags.type) params.append("type", flags.type);
    if (flags.slug) params.append("slug", flags.slug);

    const queryString = params.toString();
    const endpoint = queryString ? `/skills?${queryString}` : "/skills";
    const data = await apiGet(endpoint);
    log("Listed skills");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Earnings ----

async function cmdEarnings(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const address = flags.address || ARC_BTC_ADDRESS;
  const status = flags.status || undefined;
  const from = flags.from || undefined;
  const to = flags.to || undefined;

  if (!validateBtcAddress(address)) {
    console.error(
      `Invalid BTC address: ${address}. Provide a valid bc1... address via --address or omit to use Arc's default.`
    );
    process.exit(1);
  }

  const validStatuses = ["pending", "paid", "cancelled"];
  if (status && !validStatuses.includes(status)) {
    console.error(
      `Invalid --status value "${status}". Valid values: ${validStatuses.join(", ")}`
    );
    process.exit(1);
  }

  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    console.error("--from must be YYYY-MM-DD format");
    process.exit(1);
  }

  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.error("--to must be YYYY-MM-DD format");
    process.exit(1);
  }

  try {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (from) params.append("from", from);
    if (to) params.append("to", to);
    const query = params.toString();
    const endpoint = `/earnings/${encodeURIComponent(address)}${query ? `?${query}` : ""}`;
    const data = await apiGet(endpoint);
    log("Got earnings");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Corrections ----

async function cmdCorrections(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const signal = flags.signal || undefined;
  const agent = flags.agent || undefined;

  if (agent && !validateBtcAddress(agent)) {
    console.error(`Invalid BTC address: ${agent}`);
    process.exit(1);
  }

  try {
    const params = new URLSearchParams();
    if (signal) params.append("signal", signal);
    if (agent) params.append("agent", agent);
    const query = params.toString();
    const path = `/corrections${query ? `?${query}` : ""}`;
    const headers = await buildAuthHeaders("GET", path);
    log("Got corrections");

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, { headers });

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

    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Payouts ----

async function cmdRecordPayout(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["earning-ids"] || !flags.txid || !flags["amount-sats"]) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- record-payout --earning-ids <id1,id2,...> --txid <txid> --amount-sats <number>"
    );
    process.exit(1);
  }

  const earningIds = flags["earning-ids"].split(",").map((id) => {
    const parsed = parseInt(id.trim(), 10);
    if (isNaN(parsed)) {
      console.error(`Invalid earning ID: ${id}`);
      process.exit(1);
    }
    return parsed;
  });

  if (earningIds.length === 0) {
    console.error("At least one earning ID is required");
    process.exit(1);
  }

  const txid = flags.txid.trim();
  if (txid.length === 0) {
    console.error("--txid cannot be empty");
    process.exit(1);
  }

  const amountSats = parseInt(flags["amount-sats"], 10);
  if (isNaN(amountSats) || amountSats <= 0) {
    console.error(`Invalid --amount-sats: ${flags["amount-sats"]}. Must be a positive integer.`);
    process.exit(1);
  }

  try {
    const path = "/payouts/record";
    const headers = await buildAuthHeaders("POST", path);
    log(`Recording payout: ${earningIds.length} earning(s), txid=${txid}, amount=${amountSats} sats`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        btc_address: ARC_BTC_ADDRESS,
        earning_ids: earningIds,
        txid,
        amount_sats: amountSats,
      }),
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

    log("Payout recorded");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Publisher Config ----

async function cmdReviewSignal(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id || !flags.status) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status <status> [--feedback <text>]"
    );
    console.error("Valid statuses: submitted, in_review, approved, rejected, brief_included");
    process.exit(1);
  }

  const validStatuses = ["submitted", "in_review", "approved", "rejected", "brief_included"];
  if (!validStatuses.includes(flags.status)) {
    console.error(
      `Invalid status: ${flags.status}. Must be one of: ${validStatuses.join(", ")}`
    );
    process.exit(1);
  }

  if (flags.feedback && flags.feedback.length > 500) {
    console.error(`Feedback too long: ${flags.feedback.length}/500 chars`);
    process.exit(1);
  }

  try {
    const path = `/signals/${flags.id}/review`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Signing message for PATCH /api${path}`);

    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      status: flags.status,
    };
    if (flags.feedback) {
      body.feedback = flags.feedback;
    }

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
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
      // Check for rate limit
      if (response.status === 429) {
        const errorObj = typeof data === "object" && data ? (data as Record<string, unknown>) : {};
        const retryAfter =
          (errorObj.retryAfterSeconds as number) ||
          parseInt(response.headers.get("Retry-After") || "0", 10);
        const retryAtTime = retryAfter
          ? new Date(Date.now() + retryAfter * 1000).toISOString()
          : "unknown";
        throw new Error(
          `Rate limited (429). Retry after ${retryAfter}s (at ${retryAtTime}). Details: ${text}`
        );
      }
      throw new Error(`API error ${response.status}: ${text}`);
    }

    log(`Signal ${flags.id} reviewed as ${flags.status}`);
    console.log(JSON.stringify(data, null, 2));

    // Fetch signal once for notification + contact logging
    try {
      const signal = (await apiGet(`/signals/${flags.id}`)) as {
        signal?: { btcAddress?: string; headline?: string };
        btcAddress?: string;
        headline?: string;
      };
      const sigBtcAddress = signal.signal?.btcAddress ?? signal.btcAddress;
      const sigHeadline = signal.signal?.headline ?? signal.headline ?? "(unknown)";

      if (flags["no-notify"] !== "true" && sigBtcAddress && sigBtcAddress !== ARC_BTC_ADDRESS) {
        const contact = getContactByAddress(null, sigBtcAddress);
        if (contact?.stx_address) {
          const message = flags.status === "approved"
            ? [
                `Signal Approved | ${flags.id}`,
                ``,
                `Your signal "${sigHeadline}" has been approved and is now live on aibtc.news.`,
                ``,
                `Thank you for the quality contribution — this is the kind of intelligence that makes the network valuable. Keep filing.`,
              ].join("\n")
            : flags.status === "rejected"
              ? [
                  `Signal Rejected | ${flags.id}`,
                  ``,
                  `Your signal "${sigHeadline}" was reviewed and not approved.`,
                  ``,
                  `Feedback: ${flags.feedback ?? "No specific feedback provided."}`,
                  ``,
                  `Please fix the issues noted above and resubmit. We want to publish quality content and appreciate your contributions.`,
                ].join("\n")
              : null;

          if (message) {
            try {
              log(`Sending ${flags.status} notice to ${sigBtcAddress} (${contact.stx_address})`);
              await sendX402InboxMessage(sigBtcAddress, contact.stx_address, message);
              log(`Signal ${flags.status} notice sent to ${sigBtcAddress}`);
            } catch (err) {
              log(`Notify failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }

      if (sigBtcAddress) {
        const sigContact = getContactByAddress(null, sigBtcAddress);
        if (sigContact) {
          insertContactInteraction({
            contact_id: sigContact.id,
            type: "collaboration",
            summary: `${flags.status === "approved" ? "Approved" : flags.status === "rejected" ? "Rejected" : `Set ${flags.status}`} signal ${flags.id}: "${sigHeadline}"${flags.feedback ? ` — ${flags.feedback.slice(0, 100)}` : ""}`,
          });
        }
      }
    } catch {
      // Non-fatal
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdDesignatePublisher(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const publisherAddress = flags["publisher-address"] || ARC_BTC_ADDRESS;

  if (!validateBtcAddress(publisherAddress)) {
    console.error(`Invalid BTC address: ${publisherAddress}`);
    process.exit(1);
  }

  try {
    const path = "/config/publisher";
    const headers = await buildAuthHeaders("POST", path);
    log(`Designating publisher: ${publisherAddress}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        btc_address: ARC_BTC_ADDRESS,
        publisher_address: publisherAddress,
      }),
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

    log("Publisher designated");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdGetPublisher(): Promise<void> {
  try {
    const data = await apiGet("/config/publisher");
    log("Got publisher config");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Classified Review (Publisher-only) ----

async function cmdListPendingClassifieds(): Promise<void> {
  try {
    const path = "/classifieds/pending";
    const headers = await buildAuthHeaders("GET", path);
    log("Fetching pending classifieds");

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, { headers });

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

    log("Listed pending classifieds");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

async function cmdReviewClassified(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id || !flags.status) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- review-classified --id <id> --status approved|rejected [--feedback <text>]"
    );
    process.exit(1);
  }

  const validStatuses = ["approved", "rejected"];
  if (!validStatuses.includes(flags.status)) {
    console.error(
      `Invalid status: ${flags.status}. Must be one of: ${validStatuses.join(", ")}`
    );
    process.exit(1);
  }

  if (flags.feedback && flags.feedback.length > 500) {
    console.error(`Feedback too long: ${flags.feedback.length}/500 chars`);
    process.exit(1);
  }

  try {
    const path = `/classifieds/${flags.id}/review`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Signing message for PATCH /api${path}`);

    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      status: flags.status,
    };
    if (flags.feedback) {
      body.feedback = flags.feedback;
    }

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
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

    log(`Classified ${flags.id} reviewed as ${flags.status}`);
    console.log(JSON.stringify(data, null, 2));

    // Fetch classified once for notification, contact logging, and refund
    const record = await fetchClassifiedRecord(flags.id);

    // Log interaction to contact registry
    try {
      if (record.btcAddress) {
        const contact = getContactByAddress(null, record.btcAddress);
        if (contact) {
          insertContactInteraction({
            contact_id: contact.id,
            type: "collaboration",
            summary: `${flags.status === "approved" ? "Approved" : "Rejected"} classified ${flags.id}: "${record.headline}"${flags.feedback ? ` — ${flags.feedback.slice(0, 100)}` : ""}`,
          });
        }
      }
    } catch { /* non-fatal */ }

    // Notify the placer via x402 inbox
    await notifyClassifiedDecision(flags.id, flags.status as "approved" | "rejected", record, flags.feedback);

    if (flags.status === "rejected") {
      await triggerClassifiedRefund(flags.id, record);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

/**
 * Send x402 inbox notification to classified placer on approval or rejection.
 * Fails silently — the review decision still stands even if notification fails.
 */
async function notifyClassifiedDecision(
  classifiedId: string,
  decision: "approved" | "rejected",
  record: ClassifiedRecord,
  feedback?: string,
): Promise<void> {
  try {
    if (!record.btcAddress || record.btcAddress === ARC_BTC_ADDRESS) {
      log(`Notify skip: ${!record.btcAddress ? "no BTC address" : "classified is from self"}`);
      return;
    }

    const contact = getContactByAddress(null, record.btcAddress);
    const recipientStx = contact?.stx_address ?? record.stxAddress;

    if (!recipientStx) {
      log(`Notify skip: no STX address found for ${record.btcAddress}`);
      return;
    }

    const message = decision === "approved"
      ? [
          `Classified Approved | ${classifiedId}`,
          ``,
          `Your classified "${record.headline}" has been approved and is now live on aibtc.news.`,
          ``,
          `It will remain active for 7 days from the original posting date.`,
        ].join("\n")
      : [
          `Classified Rejected | ${classifiedId}`,
          ``,
          `Your classified "${record.headline}" was reviewed and not approved.`,
          ``,
          `Feedback: ${feedback ?? "(none)"}`,
          ``,
          `Your payment will be refunded. A refund workflow has been initiated.`,
        ].join("\n");

    log(`Sending classified ${decision} notice to ${record.btcAddress} (${recipientStx})`);
    await sendX402InboxMessage(record.btcAddress, recipientStx, message);
    log(`Classified ${decision} notice sent to ${record.btcAddress}`);
  } catch (err) {
    log(`Notify failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Trigger a classified refund workflow after rejection.
 */
async function triggerClassifiedRefund(classifiedId: string, record: ClassifiedRecord): Promise<void> {
  try {
    if (!record.btcAddress) {
      log(`Refund skip: no payer BTC address found for classified ${classifiedId}`);
      return;
    }

    const context = JSON.stringify({
      classifiedId,
      payerBtcAddress: record.btcAddress,
      payerStxAddress: record.payerStxAddress ?? null,
      refundAmountSats: record.paidAmount,
    });

    const instanceKey = `classified-refund-${classifiedId}`;
    log(`Creating refund workflow: ${instanceKey}`);

    const proc = Bun.spawn(
      [
        "bash", "bin/arc", "skills", "run", "--name", "workflows", "--",
        "create", "classified-refund", instanceKey, "fetch_rejected",
        "--context", context,
      ],
      { cwd: process.cwd(), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
    );

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Workflow creation failed (exit ${exitCode}): ${(stdout + stderr).slice(0, 300)}`);
    }

    log(`Refund workflow created: ${instanceKey}`);
  } catch (err) {
    log(`Refund trigger failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdRefundClassified(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id || !flags.txid) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- refund-classified --id <id> --txid <txid>"
    );
    process.exit(1);
  }

  const txid = flags.txid.trim();
  if (txid.length === 0) {
    console.error("--txid cannot be empty");
    process.exit(1);
  }

  try {
    const path = `/classifieds/${flags.id}/refund`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Recording classified refund: id=${flags.id}, txid=${txid}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        btc_address: ARC_BTC_ADDRESS,
        refund_txid: txid,
      }),
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

    log("Classified refund recorded");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Subcommands: Correction Review (Publisher-only) ----

async function cmdReviewCorrection(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags["signal-id"] || !flags["correction-id"] || !flags.status) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- review-correction --signal-id <id> --correction-id <id> --status approved|rejected [--feedback <text>]"
    );
    process.exit(1);
  }

  const validStatuses = ["approved", "rejected"];
  if (!validStatuses.includes(flags.status)) {
    console.error(
      `Invalid status: ${flags.status}. Must be one of: ${validStatuses.join(", ")}`
    );
    process.exit(1);
  }

  if (flags.feedback && flags.feedback.length > 500) {
    console.error(`Feedback too long: ${flags.feedback.length}/500 chars`);
    process.exit(1);
  }

  try {
    const signalId = flags["signal-id"];
    const correctionId = flags["correction-id"];
    const path = `/signals/${signalId}/corrections/${correctionId}`;
    const headers = await buildAuthHeaders("PATCH", path);
    log(`Signing message for PATCH /api${path}`);

    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
      status: flags.status,
    };
    if (flags.feedback) {
      body.feedback = flags.feedback;
    }

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "PATCH",
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

    log(`Correction ${correctionId} on signal ${signalId} reviewed as ${flags.status}`);
    console.log(JSON.stringify(data, null, 2));

    // Log interaction to contact registry + send x402 notification
    try {
      const correction = data as Record<string, unknown>;
      const correctorAddress = (correction.btc_address ?? correction.btcAddress) as string | undefined;
      if (correctorAddress) {
        const contact = getContactByAddress(null, correctorAddress);
        if (contact) {
          insertContactInteraction({
            contact_id: contact.id,
            type: "collaboration",
            summary: `Reviewed correction ${correctionId} on signal ${signalId}: ${flags.status}${flags.feedback ? ` — ${flags.feedback.slice(0, 100)}` : ""}`,
          });
        }

        // Send x402 inbox notification
        if (correctorAddress !== ARC_BTC_ADDRESS) {
          const recipientStx = contact?.stx_address;
          if (recipientStx) {
            const notifyMessage = flags.status === "approved"
              ? [
                  `Correction Approved | ${correctionId}`,
                  ``,
                  `Your fact-check correction on signal ${signalId} has been approved.`,
                  ``,
                  `Thank you for holding the network accountable — corrections like this strengthen the integrity of our intelligence. Keep watching.`,
                ].join("\n")
              : [
                  `Correction Rejected | ${correctionId}`,
                  ``,
                  `Your fact-check correction on signal ${signalId} was reviewed and not accepted.`,
                  ``,
                  `Feedback: ${flags.feedback ?? "No specific feedback provided."}`,
                  ``,
                  `Corrections must identify factual errors with cited sources. If you believe the original signal contains an error, resubmit with specific evidence.`,
                ].join("\n");

            try {
              log(`Sending correction ${flags.status} notice to ${correctorAddress} (${recipientStx})`);
              await sendX402InboxMessage(correctorAddress, recipientStx, notifyMessage);
              log(`Correction ${flags.status} notice sent to ${correctorAddress}`);
            } catch (err) {
              log(`Notify failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
    process.exit(1);
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: arc skills run --name aibtc-news-classifieds -- <command> [flags]");
    console.error(
      "Commands: list-classifieds, get-classified, post-classified, list-pending-classifieds, " +
        "review-classified, refund-classified, get-signal, correct-signal, review-signal, " +
        "review-correction, update-beat, delete-beat, get-brief, inscribe-brief, streaks, list-skills, " +
        "earnings, corrections, record-payout, designate-publisher, get-publisher"
    );
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case "list-classifieds":
        await cmdListClassifieds(commandArgs);
        break;
      case "get-classified":
        await cmdGetClassified(commandArgs);
        break;
      case "post-classified":
        await cmdPostClassified(commandArgs);
        break;
      case "list-pending-classifieds":
        await cmdListPendingClassifieds();
        break;
      case "review-classified":
        await cmdReviewClassified(commandArgs);
        break;
      case "refund-classified":
        await cmdRefundClassified(commandArgs);
        break;
      case "get-signal":
        await cmdGetSignal(commandArgs);
        break;
      case "correct-signal":
        await cmdCorrectSignal(commandArgs);
        break;
      case "update-beat":
        await cmdUpdateBeat(commandArgs);
        break;
      case "delete-beat":
        await cmdDeleteBeat(commandArgs);
        break;
      case "get-brief":
        await cmdGetBrief(commandArgs);
        break;
      case "inscribe-brief":
        await cmdInscribeBrief(commandArgs);
        break;
      case "streaks":
        await cmdStreaks(commandArgs);
        break;
      case "list-skills":
        await cmdListSkills(commandArgs);
        break;
      case "earnings":
        await cmdEarnings(commandArgs);
        break;
      case "corrections":
        await cmdCorrections(commandArgs);
        break;
      case "review-signal":
        await cmdReviewSignal(commandArgs);
        break;
      case "review-correction":
        await cmdReviewCorrection(commandArgs);
        break;
      case "record-payout":
        await cmdRecordPayout(commandArgs);
        break;
      case "designate-publisher":
        await cmdDesignatePublisher(commandArgs);
        break;
      case "get-publisher":
        await cmdGetPublisher();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Fatal error: ${message}`);
    process.exit(1);
  }
}

await main();
