// skills/arxiv-research/sensor.ts
// Sensor for arXiv paper monitoring. Fetches recent papers on LLMs/agents,
// queues a digest compilation task if new papers are found.

import { claimSensorRun, createSensorLogger, fetchActiveBeatSlugs, HookState, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource, isBeatOnCooldown, validateSignalSubjectMatchesBeatPattern } from "../../src/db.ts";

const SENSOR_NAME = "arxiv-research";
const INTERVAL_MINUTES = 720; // 12 hours
const ARXIV_API = "http://export.arxiv.org/api/query";
const CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.MA", "cs.SE", "quant-ph"];
const MAX_RESULTS = 30;

// SIGNAL FILING DISABLED (whoabuddy directive 2026-05-19, task #17094)
// aibtc.news EIC stepped down, trading competition winding down.
// Re-enable for "what's next" policy. Digest fetch/compile remains active.
const SIGNAL_FILING_DISABLED = true;

// Default beats this sensor routes signals to. Used as fallback when /api/beats is unreachable.
const KNOWN_BEATS: string[] = ["aibtc-network", "quantum"];

const log = createSensorLogger(SENSOR_NAME);

// Infrastructure beat: aibtc-relevance filter.
// Tier 1 — specific aibtc/MCP/payment keywords (single match is sufficient).
// Tier 2 — compound match: at least one AGENT keyword AND one CRYPTO keyword.
// Papers that only match generic agent/LLM terms (e.g. "deception in Among Us") are excluded.

import {
  AIBTC_SPECIFIC_KEYWORDS,
  QUANTUM_KEYWORDS,
  AGENT_KEYWORDS,
  CRYPTO_INFRA_KEYWORDS,
} from "./lib/keywords.ts";

function isQuantumBeatPaper(title: string): boolean {
  return QUANTUM_KEYWORDS.some((re) => re.test(title));
}

function isAibtcInfraPaper(title: string): boolean {
  // Tier 1: specific aibtc keywords always qualify
  if (AIBTC_SPECIFIC_KEYWORDS.some((re) => re.test(title))) return true;
  // Tier 2: agent context + crypto/blockchain context together
  const hasAgent = AGENT_KEYWORDS.some((re) => re.test(title));
  const hasCrypto = CRYPTO_INFRA_KEYWORDS.some((re) => re.test(title));
  return hasAgent && hasCrypto;
}

interface ArxivEntry {
  id: string;
  title: string;
  published: string;
}

// Retries on HTTP 429 and network errors (including AbortError/TimeoutError) with backoff.
// Max 3 total attempts — keeps total added wait under ~45s for sensor parallelism.
async function fetchArxivWithRetry(url: string, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
        signal: AbortSignal.timeout(30000),
      });

      if (response.status !== 429) return response;

      if (attempt === maxRetries) {
        log(`warn: arXiv 429 rate-limit persists after ${maxRetries + 1} attempts — quantum signal drought likely this window`);
        return response;
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const backoffMs = retryAfterHeader
        ? Math.min(parseInt(retryAfterHeader, 10) * 1000, 30000)
        : (attempt + 1) * 5000;

      log(`warn: arXiv 429 (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms`);
      await Bun.sleep(backoffMs);
    } catch (e) {
      if (attempt === maxRetries) throw e;
      const fetchError = e as Error;
      const kind = fetchError.name === "AbortError" || fetchError.name === "TimeoutError" ? "timeout" : "network error";
      const backoffMs = (attempt + 1) * 5000;
      log(`warn: arXiv ${kind} (attempt ${attempt + 1}/${maxRetries + 1}): ${fetchError.message}, retrying in ${backoffMs}ms`);
      await Bun.sleep(backoffMs);
    }
  }

  throw new Error("unreachable");
}

function parseArxivFeed(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const id = block.match(/<id>(.*?)<\/id>/)?.[1] ?? "";
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const published = block.match(/<published>(.*?)<\/published>/)?.[1] ?? "";
    if (id && title) {
      entries.push({ id, title, published });
    }
  }

  return entries;
}

export default async function arxivResearchSensor(): Promise<string> {
  // Read before claiming so we can release the interval on failure
  let hookState: HookState | null | undefined;
  try {
    hookState = await readHookState(SENSOR_NAME);
  } catch (e) {
    log(`warn: failed to read hookState: ${(e as Error).message}`);
  }

  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Fetch live beat status; fall back to KNOWN_BEATS on API failure
    const liveBeats = await fetchActiveBeatSlugs();
    const activeBeats = liveBeats !== null
      ? KNOWN_BEATS.filter((slug) => liveBeats.has(slug))
      : KNOWN_BEATS;
    if (liveBeats !== null && activeBeats.length < KNOWN_BEATS.length) {
      const retired = KNOWN_BEATS.filter((slug) => !liveBeats.has(slug));
      log(`warn: beat(s) no longer active on /api/beats: ${retired.join(", ")}`);
    }
    if (activeBeats.length === 0) {
      log("no active beats per /api/beats — skipping");
      return "skip";
    }

    // Build query: recent papers in target categories
    const catQuery = CATEGORIES.map((c) => `cat:${c}`).join("+OR+");
    const url = `${ARXIV_API}?search_query=${catQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_RESULTS}`;

    log(`fetching from arXiv: ${CATEGORIES.join(", ")} (max ${MAX_RESULTS})`);
    const response = await fetchArxivWithRetry(url);

    if (!response.ok) {
      if (response.status === 429) {
        log("error: arXiv 429 exhausted all retries — quantum signal drought expected this window");
      } else {
        log(`warn: arXiv API returned ${response.status}`);
      }
      // Release interval: reset last_ran to epoch so next sensor tick can retry immediately
      await writeHookState(SENSOR_NAME, {
        ...hookState,
        last_ran: new Date(0).toISOString(),
        last_result: "error",
        version: (hookState?.version ?? 0) + 1,
      });
      return "error";
    }

    const xml = await response.text();
    const entries = parseArxivFeed(xml);

    if (entries.length === 0) {
      log("no papers found in response");
      return "ok";
    }

    // Check against last fetch to see if there are new papers
    const lastSeenId = hookState?.lastSeenId as string | undefined;

    let newCount = entries.length;
    if (lastSeenId) {
      const lastIdx = entries.findIndex((e) => e.id === lastSeenId);
      newCount = lastIdx === -1 ? entries.length : lastIdx;
    }

    // Update hook state with latest paper ID
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (hookState?.version ?? 0) + 1,
      lastSeenId: entries[0].id,
      lastFetchCount: entries.length,
      newPaperCount: newCount,
    });

    log(`found ${entries.length} papers (${newCount} new since last check)`);

    if (newCount === 0) {
      log("no new papers; skipping task creation");
      return "ok";
    }

    // Queue digest compilation task
    const today = new Date().toISOString().split("T")[0];
    const source = `sensor:${SENSOR_NAME}:digest-${today}`;

    if (pendingTaskExistsForSource(source)) {
      log("digest task already queued for today");
      return "ok";
    }

    log("queuing arxiv digest fetch+compile task");
    insertTask({
      subject: `Fetch and compile arXiv digest — ${today} (${newCount} new papers)`,
      description:
        `${newCount} new papers found in ${CATEGORIES.join(", ")}.\n\n` +
        "Run these two CLI commands in sequence — the CLI handles all scoring and formatting automatically, no manual review needed:\n" +
        "1. arc skills run --name arxiv-research -- fetch\n" +
        "2. arc skills run --name arxiv-research -- compile\n\n" +
        `Output: research/arxiv/{ISO8601}_arxiv_digest.md`,
      skills: JSON.stringify(["arxiv-research"]),
      priority: 5,
      model: "haiku",
      status: "pending",
      source,
    });

    // Infrastructure signal routing: check new papers for aibtc-network relevance
    const newEntries = entries.slice(0, newCount);
    const infraPapers = newEntries.filter((e) => isAibtcInfraPaper(e.title));
    if (infraPapers.length > 0 && activeBeats.includes("aibtc-network")) {
      const signalSource = `sensor:${SENSOR_NAME}:infra-signal-${today}`;
      if (SIGNAL_FILING_DISABLED) {
        log(`signal filing disabled (whoabuddy 2026-05-19, task #17094) — would have queued aibtc-network signal for ${infraPapers.length} paper(s)`);
      } else if (isBeatOnCooldown("aibtc-network", 60)) {
        log("beat cooldown active for aibtc-network (60min) — skipping infrastructure signal task");
      } else if (!pendingTaskExistsForSource(signalSource)) {
        const paperList = infraPapers
          .slice(0, 5)
          .map((p) => `- ${p.title} (${p.id})`)
          .join("\n");
        const infraSignalSubject = `File aibtc-network signal from arXiv digest (${infraPapers.length} paper(s))`;
        if (!validateSignalSubjectMatchesBeatPattern(infraSignalSubject, "aibtc-network")) {
          log(`error: subject does not match BEAT_SUBJECT_PATTERNS for aibtc-network: "${infraSignalSubject}"`);
          throw new Error(`Subject validation failed for beat aibtc-network: "${infraSignalSubject}"`);
        }
        insertTask({
          subject: infraSignalSubject,
          description:
            `${infraPapers.length} aibtc-relevant papers found in today's arXiv fetch:\n\n` +
            paperList + "\n\n" +
            "Instructions (work from the paper list above — no compiled digest required):\n" +
            "1. The paper titles and arXiv IDs above are your source material; fetch abstracts if needed: arc skills run --name arxiv-research -- fetch\n" +
            "2. Confirm papers have direct aibtc network relevance (MCP, relay tooling, Bitcoin/Stacks infra, agent payment systems)\n" +
            "3. Compose a signal: arc skills run --name aibtc-news-editorial -- compose-signal --beat aibtc-network\n" +
            "4. Focus on MCP protocol advances, agent infrastructure, Bitcoin/Stacks tooling, or relay/payment channels\n" +
            "5. File the signal: arc skills run --name aibtc-news-editorial -- file-signal --beat aibtc-network ...",
          skills: JSON.stringify(["aibtc-news-editorial", "arxiv-research"]),
          priority: 6,
          model: "sonnet",
          status: "pending",
          source: signalSource,
        });
        log(`aibtc-network signal task queued (${infraPapers.length} matching papers)`);
      }
    }

    // Quantum beat signal routing: check new papers for quantum-computing/Bitcoin security relevance
    const quantumPapers = newEntries.filter((e) => isQuantumBeatPaper(e.title));
    if (quantumPapers.length > 0 && activeBeats.includes("quantum")) {
      const quantumSource = `sensor:${SENSOR_NAME}:quantum-signal-${today}`;
      if (SIGNAL_FILING_DISABLED) {
        log(`signal filing disabled (whoabuddy 2026-05-19, task #17094) — would have queued quantum signal for ${quantumPapers.length} paper(s)`);
      } else if (isBeatOnCooldown("quantum", 60)) {
        log("beat cooldown active for quantum (60min) — skipping quantum signal task");
      } else if (!pendingTaskExistsForSource(quantumSource)) {
        const paperList = quantumPapers
          .slice(0, 5)
          .map((p) => `- ${p.title} (${p.id})`)
          .join("\n");
        const quantumSignalSubject = `File quantum beat signal from arXiv digest (${quantumPapers.length} paper(s))`;
        if (!validateSignalSubjectMatchesBeatPattern(quantumSignalSubject, "quantum")) {
          log(`error: subject does not match BEAT_SUBJECT_PATTERNS for quantum: "${quantumSignalSubject}"`);
          throw new Error(`Subject validation failed for beat quantum: "${quantumSignalSubject}"`);
        }
        insertTask({
          subject: quantumSignalSubject,
          description:
            `${quantumPapers.length} quantum-relevant paper(s) found in today's arXiv fetch:\n\n` +
            paperList + "\n\n" +
            "Instructions (work from the paper list above — no compiled digest required):\n" +
            "1. The paper titles and arXiv IDs above are your source material; if you need abstracts run: arc skills run --name arxiv-research -- fetch\n" +
            "2. Confirm papers address quantum computing impacts on Bitcoin (ECDSA/SHA-256 threats, post-quantum BIPs, Shor/Grover relevance, timeline assessments, NIST PQC standards)\n" +
            "3. Pick the top 1-3 most newsworthy papers from the list above\n" +
            "4. Compose a signal: arc skills run --name aibtc-news-editorial -- compose-signal --beat quantum\n" +
            "5. Focus on concrete threats, timeline estimates, or post-quantum proposals (BIP-360/P2QRH, lattice-based schemes)\n" +
            "6. File the signal: arc skills run --name aibtc-news-editorial -- file-signal --beat quantum ...",
          skills: JSON.stringify(["aibtc-news-editorial", "arxiv-research"]),
          priority: 6,
          model: "sonnet",
          status: "pending",
          source: quantumSource,
        });
        log(`quantum signal task queued (${quantumPapers.length} matching papers)`);
      }
    }

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    // Release interval: reset last_ran to epoch so next sensor tick can retry immediately
    await writeHookState(SENSOR_NAME, {
      ...hookState,
      last_ran: new Date(0).toISOString(),
      last_result: "error",
      version: (hookState?.version ?? 0) + 1,
    });
    return "error";
  }
}
