// skills/arxiv-research/sensor.ts
// Sensor for arXiv paper monitoring. Fetches recent papers on LLMs/agents,
// queues a digest compilation task if new papers are found.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arxiv-research";
const INTERVAL_MINUTES = 720; // 12 hours
const ARXIV_API = "http://export.arxiv.org/api/query";
const CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.MA", "cs.SE"];
const MAX_RESULTS = 30;

const log = createSensorLogger(SENSOR_NAME);

// Dev-tools beat: keywords that indicate a paper is relevant to the dev-tools signal beat
const DEV_TOOL_PAPER_KEYWORDS = [
  /\bautonomous agent/i,
  /\bAI agent/i,
  /\bmulti[-\s]?agent/i,
  /\bMCP\b/,
  /\bmodel context protocol/i,
  /\btool[-\s]?use\b/i,
  /\bfunction[-\s]?call/i,
  /\bagent[-\s]?framework/i,
  /\borchestrat/i,
  /\bcode[-\s]?gen/i,
  /\bLLM[-\s]?routing/i,
  /\bagent[-\s]?skill/i,
  /\bagent[-\s]?infra/i,
  /\bMCP[-\s]?server/i,
  /\bagent[-\s]?tool/i,
  /\bLLM[-\s]?agent/i,
  /\bsoftware[-\s]?agent/i,
  /\bA2A\b/,
  /\bagent[-\s]?to[-\s]?agent/i,
];

function isDevToolPaper(title: string): boolean {
  return DEV_TOOL_PAPER_KEYWORDS.some((re) => re.test(title));
}

interface ArxivEntry {
  id: string;
  title: string;
  published: string;
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
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Build query: recent papers in target categories
    const catQuery = CATEGORIES.map((c) => `cat:${c}`).join("+OR+");
    const url = `${ARXIV_API}?search_query=${catQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_RESULTS}`;

    log(`fetching from arXiv: ${CATEGORIES.join(", ")} (max ${MAX_RESULTS})`);
    const response = await fetch(url, {
      headers: { "User-Agent": "Arc-Agent/1.0 (arc@arc0btc.com)" },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      log(`warn: arXiv API returned ${response.status}`);
      return "error";
    }

    const xml = await response.text();
    const entries = parseArxivFeed(xml);

    if (entries.length === 0) {
      log("no papers found in response");
      return "ok";
    }

    // Check against last fetch to see if there are new papers
    const hookState = await readHookState(SENSOR_NAME);
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

    log("queuing arxiv digest compilation task");
    insertTask({
      subject: `Compile arXiv digest — ${today} (${newCount} new papers)`,
      description:
        `${newCount} new papers found in ${CATEGORIES.join(", ")}.\n\n` +
        "Use the arxiv-research skill to compile a digest:\n" +
        "1. Run: arc skills run --name arxiv-research -- fetch\n" +
        "2. Review the fetched papers for LLM/agent relevance\n" +
        "3. Run: arc skills run --name arxiv-research -- compile\n\n" +
        "Follow AGENT.md for digest compilation instructions.\n" +
        `Output: research/arxiv/{ISO8601}_arxiv_digest.md`,
      skills: JSON.stringify(["arxiv-research"]),
      priority: 5,
      model: "sonnet",
      status: "pending",
      source,
    });

    // Dev-tools signal routing: check new papers for dev-tool relevance
    const newEntries = entries.slice(0, newCount);
    const devToolPapers = newEntries.filter((e) => isDevToolPaper(e.title));
    if (devToolPapers.length > 0) {
      const signalSource = `sensor:${SENSOR_NAME}:devtools-signal-${today}`;
      if (!pendingTaskExistsForSource(signalSource)) {
        const paperList = devToolPapers
          .slice(0, 5)
          .map((p) => `- ${p.title} (${p.id})`)
          .join("\n");
        insertTask({
          subject: `File dev-tools signal from arXiv digest (${devToolPapers.length} paper(s))`,
          description:
            `${devToolPapers.length} dev-tool-relevant papers found in today's arXiv fetch:\n\n` +
            paperList + "\n\n" +
            "Instructions:\n" +
            "1. Review the compiled digest: research/arxiv/ (latest file)\n" +
            "2. Compose a signal: arc skills run --name aibtc-news-editorial -- compose-signal --beat dev-tools\n" +
            "3. Focus on agent frameworks, tool-use, MCP, or orchestration findings\n" +
            "4. File the signal: arc skills run --name aibtc-news-editorial -- file-signal --beat dev-tools ...",
          skills: JSON.stringify(["aibtc-news-editorial", "arxiv-research"]),
          priority: 6,
          model: "sonnet",
          status: "pending",
          source: signalSource,
        });
        log(`dev-tools signal task queued (${devToolPapers.length} matching papers)`);
      }
    }

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
