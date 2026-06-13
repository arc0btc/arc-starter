// skills/arxiv-distill/sensor.ts
//
// 12h cadence. Detects the newest research/arxiv/*_arxiv_digest.md and, if
// it's newer than the last distilled digest (tracked in hook-state), queues
// ONE sonnet task that produces 3-5 ISO8601-stamped nuggets in
// artifacts/distilled/arxiv/.
//
// Each nugget is one short claim with citation, classified into a distill
// topic (quantum-pqc / aibtc-infra / agent-architecture). Consumers (blog
// draft, paid synthesis, X research-highlight beat) read these via
// src/artifacts.ts → recentArtifacts().
//
// Gate: WORKFLOWS_ are unrelated; we use ARXIV_DISTILL_ENABLED=true. Default OFF
// until the first smoke test passes.

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

export const SENSOR_NAME = "arxiv-distill";
const INTERVAL_MINUTES = 12 * 60;
const ARXIV_DIR = resolve(import.meta.dir, "../../research/arxiv");
const log = createSensorLogger(SENSOR_NAME);

/** Newest `*_arxiv_digest.md` filename (basename only). null when none exist. */
function newestDigestBasename(): string | null {
  if (!existsSync(ARXIV_DIR)) return null;
  const files = readdirSync(ARXIV_DIR)
    .filter((f) => f.endsWith("_arxiv_digest.md"))
    .sort();
  return files.at(-1) ?? null;
}

/** Public for tick-distill CLI helper. */
export async function pollArxivDistill(): Promise<"ok" | "skip"> {
  if (Bun.env.ARXIV_DISTILL_ENABLED !== "true" && Bun.env.ARC_DISTILL_FORCE !== "1") {
    log("disabled (ARXIV_DISTILL_ENABLED=false) — awaiting first smoke + sign-off");
    return "skip";
  }

  const newest = newestDigestBasename();
  if (!newest) {
    log("no arxiv digest on disk — skip");
    return "skip";
  }

  const state = await readHookState(SENSOR_NAME);
  const lastDistilled = state?.lastDistilledDigest as string | undefined;
  if (lastDistilled === newest) {
    log(`already distilled ${newest} — skip`);
    return "skip";
  }

  // Extract digest's own timestamp from filename for source-key disambiguation.
  // Pattern: 2026-06-12T02:07:13Z_arxiv_digest.md → 2026-06-12T02:07:13Z
  const digestIso = newest.replace(/_arxiv_digest\.md$/, "");
  const source = `sensor:arxiv-research:distill-${digestIso}`;
  if (pendingTaskExistsForSource(source)) {
    log(`distill task already queued for ${digestIso} — skip`);
    return "skip";
  }

  const digestPath = resolve(ARXIV_DIR, newest);
  const taskId = insertTask({
    subject: `Distill arXiv digest ${digestIso} into 3-5 nuggets`,
    description: [
      `Source digest: ${digestPath}`,
      "",
      "## Goal",
      "Read the digest. Pick the 3-5 papers worth surfacing across Arc's channels (blog,",
      "X, paid whop). For each picked paper, write one nugget into the artifact pool via",
      "`writeDistilled` (in src/artifacts.ts). Use `classifyTopic(title, abstract)` from",
      "skills/arxiv-research/lib/keywords.ts to pick the topic slug — three are allowed:",
      "  - quantum-pqc            (PQC / Bitcoin-quantum threats)",
      "  - aibtc-infra            (MCP / agent payments / Bitcoin tooling)",
      "  - agent-architecture     (multi-agent, orchestration, autonomous reasoning)",
      "",
      "## Constraints (hard)",
      "- ≤ 1200 chars per nugget (writeDistilled enforces this)",
      "- Direct quote + 1-sentence framing. Distillation = SELECTION, not paraphrase.",
      "- Include arxiv ID in `citation` (e.g. \"arxiv:2606.13639\")",
      "- Each nugget classified into exactly one topic",
      "- `suggested_channels` per nugget (always include `reactive` so the nugget",
      "  can surface in a whop reply when a member's question touches the topic):",
      "    quantum-pqc          → [\"x\", \"blog\", \"whop-chat\", \"reactive\"]",
      "    aibtc-infra          → [\"x\", \"blog\", \"whop-chat\", \"reactive\"]",
      "    agent-architecture   → [\"blog\", \"whop-chat\", \"reactive\"] (skip x — too dense)",
      "",
      "## Steps",
      "1. Read the digest at the path above.",
      "2. Pick 3-5 papers from the Highlights section.",
      "3. For each, write a TypeScript snippet that calls writeDistilled. Run it via:",
      "   `bun -e '...'` to execute, OR use the Write tool to create a small one-off",
      "   script that imports writeDistilled and calls it for each nugget.",
      "4. Verify each writeDistilled returned an id; spot-check the JSON file landed.",
      "5. Close completed with --summary describing topics chosen and any digest entries",
      "   intentionally dropped (e.g. \"3 quantum + 1 aibtc-infra; agent-architecture",
      "   bucket skipped this digest — only generic LLM scaling papers, no Bitcoin tie\").",
      "",
      "## Skipping is OK",
      "If the digest has < 3 papers worth distilling, write 0-2 nuggets and close",
      "completed with summary explaining why. Quality bar > quota.",
    ].join("\n"),
    skills: JSON.stringify(["arxiv-research", "arxiv-distill"]),
    priority: 5,
    model: "sonnet",
    status: "pending",
    source,
  });

  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: state?.last_ran ?? new Date().toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastDistilledDigest: newest,
  });

  log(`queued distill task ${taskId} for ${newest}`);
  return "ok";
}

export default async function arxivDistillSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    return await pollArxivDistill();
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    return "skip";
  }
}
