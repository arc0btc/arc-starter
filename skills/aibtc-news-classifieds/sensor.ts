import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const API_BASE = "https://aibtc.news/api";

// ---- Earnings Sensor (informational) ----

const EARNINGS_SENSOR = "aibtc-earnings";
const EARNINGS_INTERVAL = 60;
const earningsLog = createSensorLogger(EARNINGS_SENSOR);

interface EarningRecord {
  id: string;
  address: string;
  amount_sats: number;
  status: string;
}

interface EarningsResponse {
  earnings: EarningRecord[];
}

async function earningsSensor(): Promise<string> {
  const claimed = await claimSensorRun(EARNINGS_SENSOR, EARNINGS_INTERVAL);
  if (!claimed) return "skip";

  earningsLog("Checking for unpaid earnings...");

  let earnings: EarningRecord[];
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/earnings/${encodeURIComponent(ARC_BTC_ADDRESS)}?status=pending`
    );

    if (!resp.ok) {
      earningsLog(`API returned ${resp.status}`);
      return "error";
    }

    const data = (await resp.json()) as EarningsResponse;
    earnings = data.earnings ?? [];
  } catch (err) {
    earningsLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (earnings.length === 0) {
    earningsLog("No unpaid earnings");
    return "ok";
  }

  const totalSats = earnings.reduce((sum, e) => sum + e.amount_sats, 0);
  earningsLog(`Pending: ${earnings.length} earning(s) totaling ${totalSats} sats — awaiting inscription before payout`);
  return "ok";
}

// ---- Classified Review Sensor ----

const CLASSIFIED_SENSOR = "classified-review";
const CLASSIFIED_INTERVAL = 15;
const CLASSIFIED_SOURCE = "sensor:classified-review";
const classifiedLog = createSensorLogger(CLASSIFIED_SENSOR);

interface PendingClassified {
  id: string;
  headline?: string;
  category?: string;
  placedBy?: string;
  contact?: string;
  createdAt?: string;
}

interface PendingClassifiedsResponse {
  classifieds: PendingClassified[];
}

/**
 * Build BIP-322 auth headers by spawning the bitcoin-wallet skill.
 * Mirrors buildAuthHeaders from cli.ts but usable from sensor context.
 */
async function buildSensorAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${timestamp}`;

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

  let signature = "";
  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const potentialJson = combined.substring(jsonStart, endIdx);
      const result = JSON.parse(potentialJson) as Record<string, string>;
      if (result.signatureBase64) { signature = result.signatureBase64; break; }
      if (result.signature) { signature = result.signature; break; }
    } catch {
      // Try shorter substring
    }
  }

  if (!signature) {
    throw new Error(`No valid signature in wallet response. Output: ${combined}`);
  }

  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": signature,
    "X-BTC-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

/**
 * Polls for classifieds awaiting publisher review.
 * Creates a batch review task when pending classifieds are found.
 */
async function classifiedReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(CLASSIFIED_SENSOR, CLASSIFIED_INTERVAL);
  if (!claimed) return "skip";

  classifiedLog("Checking for pending classifieds...");

  let classifieds: PendingClassified[];
  try {
    const headers = await buildSensorAuthHeaders("GET", "/classifieds/pending");
    const resp = await fetchWithRetry(`${API_BASE}/classifieds/pending`, { headers });

    if (resp.status === 401 || resp.status === 403) {
      classifiedLog(`Auth error ${resp.status} — publisher designation may be missing`);
      return "error";
    }

    if (!resp.ok) {
      classifiedLog(`API returned ${resp.status}`);
      return "error";
    }

    const data = (await resp.json()) as PendingClassifiedsResponse;
    classifieds = data.classifieds ?? [];
  } catch (err) {
    classifiedLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (classifieds.length === 0) {
    classifiedLog("No pending classifieds");
    return "ok";
  }

  classifiedLog(`Found ${classifieds.length} pending classified(s)`);

  const classifiedList = classifieds
    .map((c) => `- ${c.id} | ${c.category ?? "unknown"} | ${(c.headline ?? "").slice(0, 80)}`)
    .join("\n");

  const id = insertTaskIfNew(CLASSIFIED_SOURCE, {
    subject: `Review ${classifieds.length} pending classified(s)`,
    description: `${classifieds.length} classified ad(s) awaiting publisher review. These are paid submissions (30,000 sats sBTC each) — review promptly.\n\nPending:\n${classifiedList}\n\nWorkflow:\n1. For each classified, run: arc skills run --name aibtc-news-classifieds -- get-classified --id <id>\n2. Evaluate: appropriate category, non-spam, legitimate ad content, no prohibited material\n3. Approve: arc skills run --name aibtc-news-classifieds -- review-classified --id <id> --status approved\n4. Reject with feedback: arc skills run --name aibtc-news-classifieds -- review-classified --id <id> --status rejected --feedback "<reason>"\n   Rejection auto-triggers refund workflow and notifies the placer via x402 inbox.\n\nApproval criteria:\n- APPROVE: legitimate product/service ad, appropriate category, clear headline + body, non-spam\n- REJECT: spam, scams, prohibited content, misleading claims, duplicate of existing ad`,
    priority: 3,
    skills: JSON.stringify(["aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  if (id !== null) {
    classifiedLog(`Review task created: #${id} — ${classifieds.length} classified(s) pending`);
  } else {
    classifiedLog("Review task already pending, skipped duplicate");
  }

  return "ok";
}

// ---- Composite Default Export ----

/**
 * Runs all sub-sensors in parallel. Each manages its own cadence via claimSensorRun.
 * The composite returns "ok" if any sub-sensor ran, "skip" if all skipped, or "error" if any errored.
 */
export default async function classifiedsSensor(): Promise<string> {
  initDatabase();

  const results = await Promise.allSettled([
    earningsSensor(),
    classifiedReviewSensor(),
  ]);

  let anyRan = false;
  let anyError = false;

  for (const result of results) {
    if (result.status === "rejected") {
      anyError = true;
    } else if (result.value === "error") {
      anyError = true;
    } else if (result.value !== "skip") {
      anyRan = true;
    }
  }

  if (anyError) return "error";
  if (anyRan) return "ok";
  return "skip";
}
