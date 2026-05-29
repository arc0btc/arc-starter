// skills/arc-peer-inbox/sensor.ts
//
// Consumes file-based inbox messages written to inbox/arc/ by peer agents.
// Each unprocessed .md file → one task ("Peer inbox message from <sender>").
// Processed files are moved to inbox/arc/processed/ for audit trail.
//
// Counterpart to .claude/hooks/inbox-write.sh, which writes Arc's outbound
// results to inbox/<peer>/<ts>.md after each dispatch cycle.

import { join } from "node:path";
import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync } from "node:fs";
import { claimSensorRun, createSensorLogger, insertTask, pendingTaskExistsForSource } from "../../src/sensors.ts";

const SENSOR_NAME = "arc-peer-inbox";
const INTERVAL_MINUTES = 1;

const ROOT = new URL("../../", import.meta.url).pathname;
const INBOX_DIR = join(ROOT, "inbox", "arc");
const PROCESSED_DIR = join(INBOX_DIR, "processed");

const log = createSensorLogger(SENSOR_NAME);

export default async function arcPeerInboxSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (!existsSync(INBOX_DIR)) {
    return "ok";
  }

  let allEntries: string[];
  try {
    allEntries = readdirSync(INBOX_DIR);
  } catch {
    return "ok";
  }

  const mdFiles = allEntries.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) {
    return "ok";
  }

  log(`${mdFiles.length} file(s) in inbox/arc/`);

  mkdirSync(PROCESSED_DIR, { recursive: true });

  let queued = 0;
  for (const filename of mdFiles) {
    const filePath = join(INBOX_DIR, filename);
    const source = `sensor:arc-peer-inbox:${filename}`;

    if (pendingTaskExistsForSource(source)) {
      log(`skip ${filename} — task already pending`);
      continue;
    }

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Parse frontmatter fields: from, task_id, status
    const fromMatch = content.match(/^from:\s*(.+)$/m);
    const sender = fromMatch?.[1]?.trim() ?? "unknown";
    const timestampMatch = filename.match(/^(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
    const timestamp = timestampMatch?.[1] ?? filename.replace(".md", "");

    insertTask({
      subject: `Peer inbox message from ${sender} (${timestamp})`,
      description: [
        `File-based inbox message received from ${sender}.`,
        `Source file: inbox/arc/${filename}`,
        ``,
        `Read skills/arc-peer-inbox/SKILL.md before responding.`,
        ``,
        `Message content:`,
        `---`,
        content,
      ].join("\n"),
      skills: JSON.stringify(["arc-peer-inbox", "contacts"]),
      priority: 3,
      model: "sonnet",
      source,
    });

    // Archive to processed/ — if rename fails, dedup via source prevents re-queue
    try {
      renameSync(filePath, join(PROCESSED_DIR, filename));
    } catch {
      log(`warn: could not move ${filename} to processed/ — dedup will catch re-run`);
    }

    queued++;
    log(`queued task for ${filename} from ${sender}`);
  }

  return `ok: ${queued} queued`;
}
