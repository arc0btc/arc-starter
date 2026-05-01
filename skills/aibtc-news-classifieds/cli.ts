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

async function apiPatch(
  endpoint: string,
  body: Record<string, unknown>,
  auth?: { address: string; signature: string; timestamp: number }
): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    headers["X-BTC-Address"] = auth.address;
    headers["X-BTC-Signature"] = auth.signature;
    const timestamp = auth.timestamp > 1e12 ? Math.floor(auth.timestamp / 1000) : auth.timestamp;
    headers["X-BTC-Timestamp"] = String(timestamp);
  }
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

async function cmdCheckClassifiedStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const address = flags.address || ARC_BTC_ADDRESS;

  try {
    log(`Checking classified status for agent: ${address}`);
    const data = (await apiGet(`/classifieds?agent=${address}`)) as {
      classifieds: Array<{
        id: string;
        title: string;
        status?: string;
        active?: boolean;
        createdAt?: string;
        expiresAt?: string;
      }>;
    };

    const ads = data.classifieds ?? [];
    if (ads.length === 0) {
      log("No classifieds found for this agent");
      console.log(JSON.stringify({ address, classifieds: [] }, null, 2));
      return;
    }

    for (const ad of ads) {
      const status = ad.status ?? (ad.active ? "active" : "unknown");
      log(`[${ad.id}] "${ad.title}" — status: ${status}`);
      if (status === "pending_review") {
        log(`  → Awaiting editorial approval`);
      } else if (status === "rejected") {
        log(`  → REJECTED by editorial review`);
      } else if (status === "approved" || ad.active) {
        log(`  → Live on marketplace`);
      }
    }

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
    // Check for duplicate ads — check both marketplace (approved) and agent-scoped (pending_review)
    // After PR #144, pending_review ads don't appear in the marketplace view, so check both endpoints
    log("Checking for duplicate classifieds (active + pending_review)");
    const [marketplaceData, agentData] = await Promise.all([
      apiGet("/classifieds") as Promise<{ classifieds: Array<{ title: string; contact: string; active: boolean; status?: string }> }>,
      apiGet(`/classifieds?agent=${contact}`) as Promise<{ classifieds: Array<{ title: string; contact: string; status?: string }> }>,
    ]);
    const allAds = [
      ...(marketplaceData.classifieds ?? []),
      ...(agentData.classifieds ?? []),
    ];
    const duplicate = allAds.find(
      (ad) =>
        ad.contact === contact &&
        ad.title === title &&
        (ad.status === "pending_review" || ad.status === "approved")
    );
    if (duplicate) {
      throw new Error(
        `Duplicate: a classified with this exact title already exists for ${contact} (status: ${(duplicate as { status?: string }).status ?? "active"}). Use a different title or wait for expiry.`
      );
    }

    // Post via x402 payment
    log(`Posting classified: "${title}" [${category}] (3000 sats sBTC)`);
    const result = (await x402Request("POST", `${API_BASE}/classifieds`, {
      title,
      body,
      category,
      contact,
    })) as { ok?: boolean; status?: string; message?: string; id?: string };

    // Treat any ok:true response as success — status field indicates editorial state, not payment success
    // POST /api/classifieds now returns status:"pending_review" with message:"Classified submitted for editorial review"
    if (result.status === "pending_review") {
      log(`Classified submitted for editorial review (id: ${result.id ?? "unknown"})`);
      log("Ad is NOT yet live — awaiting approval. Check status with: check-classified-status");
    } else {
      log("Classified posted successfully and is active");
    }
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

  if (!flags.id || (!flags.content && !flags.disclosure)) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- correct-signal --id <id> [--content <text>] [--disclosure <text>]"
    );
    process.exit(1);
  }

  if (flags.content && flags.content.length > 500) {
    console.error(`Correction too long: ${flags.content.length}/500 chars`);
    process.exit(1);
  }

  try {
    // Use header-based auth: "PATCH /api/signals/{id}:unix_seconds"
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `PATCH /api/signals/${flags.id}:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);
    log(`Got signature: ${signature.slice(0, 20)}...`);

    const body: Record<string, unknown> = {
      btc_address: ARC_BTC_ADDRESS,
    };
    if (flags.content) body.content = flags.content;
    if (flags.disclosure) body.disclosure = flags.disclosure;

    const result = await apiPatch(`/signals/${flags.id}`, body, {
      address: ARC_BTC_ADDRESS,
      signature,
      timestamp,
    });

    log("Signal corrected");
    console.log(JSON.stringify(result, null, 2));
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
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `PATCH /api/beats:${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);

    const body: Record<string, unknown> = {
      slug: flags.beat,
      btc_address: ARC_BTC_ADDRESS,
    };
    if (flags.description) body.description = flags.description;
    if (flags.color) body.color = flags.color;

    const result = await apiPatch("/beats", body, {
      address: ARC_BTC_ADDRESS,
      signature,
      timestamp,
    });

    log("Beat updated");
    console.log(JSON.stringify(result, null, 2));
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
    const timestamp = new Date().toISOString();
    const message = `SIGNAL|inscribe-brief|${flags.date}|${ARC_BTC_ADDRESS}|${timestamp}`;
    log(`Signing message: ${message}`);

    const signature = await signMessage(message);

    // POST to inscribe endpoint
    const url = `${API_BASE}/brief/${flags.date}/inscribe`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        btcAddress: ARC_BTC_ADDRESS,
        signature,
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

    log("Brief inscription recorded");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    console.error(JSON.stringify({ error: errorMessage }, null, 2));
    process.exit(1);
  }
}

async function cmdGetInscription(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.date) {
    console.error(
      "Usage: arc skills run --name aibtc-news-classifieds -- get-inscription --date <YYYY-MM-DD>"
    );
    process.exit(1);
  }

  try {
    const data = await apiGet(`/brief/${flags.date}/inscription`);
    log("Got inscription status");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error: ${message}`);
    console.error(JSON.stringify({ error: message }, null, 2));
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
      "Commands: list-classifieds, get-classified, check-classified-status, post-classified, get-signal, correct-signal, " +
        "update-beat, get-brief, inscribe-brief, get-inscription, streaks, list-skills"
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
      case "check-classified-status":
        await cmdCheckClassifiedStatus(commandArgs);
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
      case "get-inscription":
        await cmdGetInscription(commandArgs);
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
