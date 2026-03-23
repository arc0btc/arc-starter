import {
  claimSensorRun,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "signal-review";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE = "sensor:signal-review";
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

/** Batch size: how many signals to include per review task. */
const BATCH_SIZE = 25;

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

/**
 * Checks for submitted signals awaiting publisher review.
 * Creates a batch review task when unreviewed signals are found.
 */
export default async function signalReviewSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("Checking for submitted signals...");

  let signals: Signal[];
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=submitted`
    );

    if (!resp.ok) {
      log(`API returned ${resp.status}`);
      return "error";
    }

    const data = (await resp.json()) as SignalsResponse;
    signals = data.signals ?? [];
  } catch (err) {
    log(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  if (signals.length === 0) {
    log("No submitted signals awaiting review");
    return "ok";
  }

  log(`Found ${signals.length} submitted signal(s)`);

  // Sort by timestamp (oldest first)
  signals.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Take a batch
  const batch = signals.slice(0, BATCH_SIZE);
  const signalList = batch
    .map(
      (s) => `- ${s.id} | ${s.beat} | ${(s.headline ?? "").slice(0, 80)}`
    )
    .join("\n");

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Review ${signals.length} submitted signal(s)`,
    description: `${signals.length} signal(s) awaiting publisher review.\n\nOldest batch (${batch.length}):\n${signalList}\n\nWorkflow:\n1. For each signal, run: arc skills run --name aibtc-news-classifieds -- get-signal --id <id>\n2. Evaluate: news value, specificity, sourcing, relevance to beat\n3. Approve quality signals: arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status approved\n4. Reject low-quality with feedback: arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status rejected --feedback "<reason>"\n\nQuality gates:\n- APPROVE: specific claims, named sources, data points, timely, relevant to beat, clear writing\n- REJECT: generic essays, no specific news hook, promotional, duplicate/stale, unsourced claims, typos or grammatical errors in title/body, title that doesn't make clear sense\n\nWriting rejection feedback:\nThe --feedback text is auto-sent to the agent via x402 inbox. Write it so they can fix and resubmit:\n- Be specific: quote the problem ("title 'Bitconi Prce Dips' has typos" not "has errors")\n- Be actionable: say what to fix ("fix the typo in the title and add a source" not "improve quality")\n- Be concise: one or two sentences max\n- Example: "Title has a typo and doesn't clearly convey the news. Fix spelling, make the headline specific (what happened, to whom, when), and resubmit."\n\nIf more than ${BATCH_SIZE} signals remain after this batch, a follow-up task will be created on next sensor run.`,
    priority: 6,
    skills: JSON.stringify(["aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  if (id !== null) {
    log(`Review task created: #${id} — ${signals.length} signal(s) pending`);
  } else {
    log("Review task already pending, skipped duplicate");
  }

  return "ok";
}
