import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const API_BASE = "https://aibtc.news/api";

// ---- Signal Review Sensor ----

const SIGNAL_SENSOR = "signal-review";
const SIGNAL_INTERVAL = 15;
const SIGNAL_SOURCE = "sensor:signal-review";
const signalLog = createSensorLogger(SIGNAL_SENSOR);
const BATCH_SIZE = 10;

interface Signal {
  id: string;
  headline?: string;
  btcAddress: string;
  beat: string;
  status: string;
  timestamp: string;
}

interface SignalsResponse {
  signals: Signal[];
}

const DAILY_APPROVAL_CAP = 30;

/** Count how many signals are approved for today (Pacific date). */
async function getTodayApprovedCount(): Promise<number> {
  const todayPST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
  const sinceUTC = new Date(`${todayPST}T00:00:00-07:00`).toISOString();

  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=approved&since=${sinceUTC}&limit=100`
    );
    if (!resp.ok) return 0;
    const data = (await resp.json()) as SignalsResponse;
    return (data.signals ?? []).length;
  } catch {
    return 0;
  }
}

/** Build a roster note so the reviewer knows current brief capacity. */
function rosterNote(approvedSoFar: number): string {
  if (approvedSoFar < DAILY_APPROVAL_CAP) {
    const remaining = DAILY_APPROVAL_CAP - approvedSoFar;
    return `${approvedSoFar}/${DAILY_APPROVAL_CAP} approved today — ${remaining} slot(s) remaining in the daily brief roster.`;
  }
  return `${approvedSoFar}/${DAILY_APPROVAL_CAP} approved today — roster is full. Approve strong signals anyway (status=approved). Previously approved signals that no longer fit can be displaced (status=replaced) — this is non-punitive and carries no reputation penalty.`;
}

async function signalReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(SIGNAL_SENSOR, SIGNAL_INTERVAL);
  if (!claimed) return "skip";

  signalLog("Checking for submitted signals...");

  // Roster info for reviewer context (never blocks task creation)
  const approvedToday = await getTodayApprovedCount();
  const roster = rosterNote(approvedToday);

  let signals: Signal[];
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=submitted`
    );

    if (!resp.ok) {
      signalLog(`API returned ${resp.status}`);
      return "error";
    }

    const data = (await resp.json()) as SignalsResponse;
    signals = data.signals ?? [];
  } catch (err) {
    signalLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (signals.length === 0) {
    signalLog("No submitted signals awaiting review");
    return "ok";
  }

  signalLog(`Found ${signals.length} submitted signal(s) — ${roster}`);

  signals.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const batch = signals.slice(0, BATCH_SIZE);
  const signalList = batch
    .map(
      (s) => `- ${s.id} | ${s.beat} | ${(s.headline ?? "").slice(0, 80)}`
    )
    .join("\n");

  const budgetNote = `\n\n**Roster status:** ${roster} Approve every signal that meets editorial quality standards. If the roster is full, approve strong signals and displace weaker ones (set the weaker signal to status=replaced). Displaced signals stay in signal history and can be re-promoted to approved if roster space opens. Never use rejected for displacement — rejected means editorial failure.`;

  const id = insertTaskIfNew(SIGNAL_SOURCE, {
    subject: `Review ${batch.length} submitted signal(s)${signals.length > BATCH_SIZE ? ` (${signals.length} total pending)` : ""}`,
    description: `${batch.length} signal(s) to review in this batch${signals.length > BATCH_SIZE ? ` (${signals.length} total pending — batched ${BATCH_SIZE} at a time)` : ""}.${budgetNote}\n\nBatch:\n${signalList}\n\nReview each signal using the workflow and decision rubric in aibtc-signal-review SKILL.md. If more signals remain after this batch, a follow-up task will be created on next sensor run.`,
    priority: 4,
    skills: JSON.stringify(["aibtc-signal-review", "aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  if (id !== null) {
    signalLog(`Review task created: #${id} — ${signals.length} signal(s) pending, ${roster}`);
  } else {
    signalLog("Review task already pending, skipped duplicate");
  }

  return "ok";
}

// ---- Correction Review Sensor ----

const CORRECTION_SENSOR = "correction-review";
const CORRECTION_INTERVAL = 60;
const CORRECTION_SOURCE = "sensor:correction-review";
const correctionLog = createSensorLogger(CORRECTION_SENSOR);

interface Correction {
  id: string;
  signalId: string;
  btcAddress?: string;
  claim?: string;
  correction?: string;
  status?: string;
  createdAt?: string;
}

interface CorrectionsResponse {
  corrections: Correction[];
  total?: number;
}

/**
 * Checks for pending corrections across recent signals.
 * Iterates approved, brief_included, and replaced signals and checks each for corrections.
 * Creates a review task when pending corrections are found.
 */
async function correctionReviewSensor(): Promise<string> {
  const claimed = await claimSensorRun(CORRECTION_SENSOR, CORRECTION_INTERVAL);
  if (!claimed) return "skip";

  correctionLog("Checking for pending corrections...");

  const pendingCorrections: Array<Correction & { signalHeadline?: string }> = [];

  try {
    // Fetch recent signals that could have corrections
    const statuses = ["approved", "brief_included", "replaced"];
    for (const status of statuses) {
      const resp = await fetchWithRetry(
        `${API_BASE}/signals?status=${status}&limit=50`
      );

      if (!resp.ok) {
        correctionLog(`API returned ${resp.status} for signals?status=${status}`);
        continue;
      }

      const data = (await resp.json()) as SignalsResponse;
      const signals = data.signals ?? [];

      // Check each signal for corrections
      for (const signal of signals) {
        try {
          const corrResp = await fetchWithRetry(
            `${API_BASE}/signals/${signal.id}/corrections`
          );

          if (!corrResp.ok) continue;

          const corrData = (await corrResp.json()) as CorrectionsResponse;
          const corrections = corrData.corrections ?? [];

          // Filter for pending/unreviewed corrections
          const pending = corrections.filter(
            (c) => !c.status || c.status === "pending" || c.status === "submitted"
          );

          for (const c of pending) {
            pendingCorrections.push({
              ...c,
              signalId: signal.id,
              signalHeadline: signal.headline,
            });
          }
        } catch {
          // Skip individual signal errors
        }
      }
    }
  } catch (err) {
    correctionLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (pendingCorrections.length === 0) {
    correctionLog("No pending corrections");
    return "ok";
  }

  correctionLog(`Found ${pendingCorrections.length} pending correction(s)`);

  const correctionList = pendingCorrections
    .slice(0, 20)
    .map(
      (c) => `- correction ${c.id} on signal ${c.signalId} | ${(c.signalHeadline ?? "").slice(0, 60)} | claim: ${(c.claim ?? "").slice(0, 80)}`
    )
    .join("\n");

  const id = insertTaskIfNew(CORRECTION_SOURCE, {
    subject: `Review ${pendingCorrections.length} pending correction(s)`,
    description: `${pendingCorrections.length} fact-check correction(s) awaiting publisher review.\n\nPending:\n${correctionList}\n\nReview each correction using the workflow and decision rubric in aibtc-correction-review SKILL.md.`,
    priority: 4,
    skills: JSON.stringify(["aibtc-correction-review", "aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  if (id !== null) {
    correctionLog(`Review task created: #${id} — ${pendingCorrections.length} correction(s) pending`);
  } else {
    correctionLog("Review task already pending, skipped duplicate");
  }

  return "ok";
}

// ---- Daily Report Sensor ----

const REPORT_SENSOR = "aibtc-daily-report";
const REPORT_INTERVAL = 360; // every 6 hours
const REPORT_SOURCE = "sensor:aibtc-daily-report";
const reportLog = createSensorLogger(REPORT_SENSOR);

interface DailyReport {
  date: string;
  yesterday?: string;
  signalsToday: number;
  totalSignals: number;
  totalBeats: number;
  activeCorrespondents: number;
  latestBrief: {
    date: string;
    inscribed_txid: string | null;
    inscription_id: string | null;
  };
  topAgents: Array<{ btc_address: string; signal_count: number }>;
}

/**
 * Polls /api/report every 6 hours and creates alert tasks on anomalies.
 * Pure logic, no LLM.
 */
async function dailyReportSensor(): Promise<string> {
  const claimed = await claimSensorRun(REPORT_SENSOR, REPORT_INTERVAL);
  if (!claimed) return "skip";

  reportLog("Fetching daily report...");

  let report: DailyReport;
  try {
    const resp = await fetchWithRetry(`${API_BASE}/report`);

    if (!resp.ok) {
      reportLog(`API returned ${resp.status}`);
      return "error";
    }

    report = (await resp.json()) as DailyReport;
  } catch (err) {
    reportLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  // Get current PST hour
  const nowPST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const hourPST = nowPST.getHours();

  const alerts: string[] = [];

  // No signals filed today after 6 PM PST
  if (report.signalsToday === 0 && hourPST >= 18) {
    alerts.push(`No signals filed today (${report.date}) as of ${hourPST}:00 PST`);
  }

  // Brief not compiled for yesterday
  const today = report.date;
  const yesterday = report.yesterday ?? "";
  if (report.latestBrief.date !== yesterday && report.latestBrief.date !== today) {
    alerts.push(`Latest brief is from ${report.latestBrief.date}, expected ${yesterday} or ${today}`);
  }

  // Brief not inscribed (yesterday's brief should be inscribed by now)
  if (
    report.latestBrief.date === yesterday &&
    !report.latestBrief.inscribed_txid &&
    !report.latestBrief.inscription_id
  ) {
    alerts.push(`Yesterday's brief (${yesterday}) is not inscribed`);
  }

  // No active correspondents
  if (report.activeCorrespondents === 0) {
    alerts.push("No active correspondents on aibtc.news");
  }

  if (alerts.length === 0) {
    reportLog(`Report OK: ${report.signalsToday} signals today, ${report.activeCorrespondents} correspondents, latest brief ${report.latestBrief.date}`);
    return "ok";
  }

  reportLog(`Found ${alerts.length} anomaly/anomalies`);

  const alertList = alerts.map((a) => `- ${a}`).join("\n");

  insertTaskIfNew(REPORT_SOURCE, {
    subject: `Daily report anomaly: ${alerts[0]}`,
    description: `The aibtc.news daily report (${report.date}) shows anomalies:\n\n${alertList}\n\nFull report:\n- Signals today: ${report.signalsToday}\n- Total signals: ${report.totalSignals}\n- Active correspondents: ${report.activeCorrespondents}\n- Total beats: ${report.totalBeats}\n- Latest brief: ${report.latestBrief.date} (inscribed: ${report.latestBrief.inscription_id ? "yes" : "no"})\n\nInvestigate and determine if action is needed. If this is expected (e.g., early in the day), close as completed with a note.`,
    priority: 7,
    skills: JSON.stringify(["aibtc-news-editorial"]),
  });

  return "ok";
}

// ---- Composite Default Export ----

/**
 * Runs all editorial sub-sensors in parallel. Each manages its own cadence.
 */
export default async function editorialSensor(): Promise<string> {
  initDatabase();

  const results = await Promise.allSettled([
    signalReviewSensor(),
    correctionReviewSensor(),
    dailyReportSensor(),
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
