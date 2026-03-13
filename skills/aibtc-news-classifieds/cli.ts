#!/usr/bin/env bun
// skills/aibtc-news-classifieds/cli.ts
// Classified ads and extended API coverage for aibtc.news

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

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
  const ts = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${ts}`;
  const sig = await signMessage(message);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(ts),
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
      classifieds: Array<{ title: string; contact: string; active: boolean }>;
    };
    const duplicate = existing.classifieds.find(
      (ad) => ad.active && ad.contact === contact && ad.title === title
    );
    if (duplicate) {
      throw new Error(
        `Duplicate: an active classified with this exact title already exists for ${contact}. Use a different title or wait for expiry.`
      );
    }

    // Post via x402 payment
    log(`Posting classified: "${title}" [${category}] (5000 sats sBTC)`);
    const result = await x402Request("POST", `${API_BASE}/classifieds`, {
      title,
      body,
      category,
      contact,
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
      body: JSON.stringify({ content: flags.content }),
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

// ---- Subcommands: Briefs ----

async function cmdGetBrief(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date;

  try {
    const endpoint = date ? `/brief/${date}` : "/brief";
    const url = `${API_BASE}${endpoint}`;

    log(`Fetching brief via x402 (1000 sats sBTC): ${url}`);
    const result = await x402Request("GET", url);

    log("Brief retrieved");
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

  if (!flags.date) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- inscribe-brief --date <YYYY-MM-DD>"
    );
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) {
    console.error("Date must be YYYY-MM-DD format");
    process.exit(1);
  }

  try {
    const path = `/brief/${flags.date}/inscribe`;
    const headers = await buildAuthHeaders("POST", path);
    log(`Signing message for POST /api${path}`);

    const url = `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
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

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: arc skills run --name aibtc-news-classifieds -- <command> [flags]");
    console.error(
      "Commands: list-classifieds, get-classified, post-classified, get-signal, correct-signal, " +
        "update-beat, get-brief, inscribe-brief, streaks, list-skills"
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
      case "get-signal":
        await cmdGetSignal(commandArgs);
        break;
      case "correct-signal":
        await cmdCorrectSignal(commandArgs);
        break;
      case "update-beat":
        await cmdUpdateBeat(commandArgs);
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
