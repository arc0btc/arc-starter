#!/usr/bin/env bun

/**
 * fleet-memory CLI v2
 *
 * Collect, merge, and distribute learnings across all fleet agents.
 * Hub-and-spoke: Arc collects from agents (entry-based sync), merges, distributes back.
 *
 * v2: Replaces hash-based patterns.md diffing with entry ID delta sync.
 * Each agent maintains memory/shared/index.json + memory/shared/entries/*.md
 */

import { parseFlags } from "../../src/utils.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
  resolveAgents,
} from "../../src/ssh.ts";
import { existsSync, mkdirSync, renameSync, unlinkSync, readdirSync } from "node:fs";

// ---- Constants ----

const FLEET_INDEX_PATH = "memory/fleet-learnings/index.json";
const REMOTE_SHARED_INDEX = "memory/shared/index.json";
const REMOTE_SHARED_ENTRIES_DIR = "memory/shared/entries";
const HOOK_STATE_DIR = "db/hook-state";
const HOOK_STATE_PATH = `${HOOK_STATE_DIR}/fleet-memory.json`;
const INBOX_DIR = "memory/inbox";
const SHARED_ENTRIES_DIR = "memory/shared/entries";
const SHARED_ARCHIVE_DIR = "memory/shared/archive";

// ---- Types ----

interface IndexEntry {
  id: string;
  topics: string[];
  content: string;
  source: string;
  created: string;
  expires?: string;
}

interface FleetIndex {
  topicMap: Record<string, string[]>;
  entries: IndexEntry[];
}

interface HookState {
  lastCollectedAt: string | null;
  // Remote entry count at last collection — used by sensor for delta detection
  agentRemoteCounts: Record<string, number>;
}

interface InboxEntry {
  id: string;
  topics: string[];
  source: string;
  created: string;
  expires?: string;
  content: string;
  filename: string;
}

// ---- Hook state ----

function loadHookState(): HookState {
  try {
    if (existsSync(HOOK_STATE_PATH)) {
      const text = require("node:fs").readFileSync(HOOK_STATE_PATH, "utf-8");
      const parsed = JSON.parse(text);
      return {
        lastCollectedAt: parsed.lastCollectedAt ?? null,
        agentRemoteCounts: parsed.agentRemoteCounts ?? {},
      };
    }
  } catch {
    // Fall through to default
  }
  return { lastCollectedAt: null, agentRemoteCounts: {} };
}

async function saveHookState(state: HookState): Promise<void> {
  if (!existsSync(HOOK_STATE_DIR)) {
    mkdirSync(HOOK_STATE_DIR, { recursive: true });
  }
  await Bun.write(HOOK_STATE_PATH, JSON.stringify(state, null, 2));
}

// ---- Index helpers ----

function loadLocalIndex(): FleetIndex {
  try {
    if (existsSync(FLEET_INDEX_PATH)) {
      const text = require("node:fs").readFileSync(FLEET_INDEX_PATH, "utf-8");
      return JSON.parse(text) as FleetIndex;
    }
  } catch {
    // Fall through
  }
  return { topicMap: {}, entries: [] };
}

async function saveLocalIndex(index: FleetIndex): Promise<void> {
  const dir = FLEET_INDEX_PATH.split("/").slice(0, -1).join("/");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(FLEET_INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

/** Parse a frontmatter entry file */
function parseEntryFile(text: string, filename: string): InboxEntry | null {
  const fmMatch = text.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const content = fmMatch[2].trim();
  const id = fm.match(/^id:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const topicsLine = fm.match(/^topics:\s*\[(.+)\]$/m)?.[1];
  const topics = topicsLine ? topicsLine.split(",").map((t) => t.trim()) : [];
  const source = fm.match(/^source:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
  const created = fm.match(/^created:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const expires = fm.match(/^expires:\s*(.+)$/m)?.[1]?.trim();
  if (!id || !created) return null;
  return { id, topics, source, created, ...(expires ? { expires } : {}), content, filename };
}

/** Format an IndexEntry as a frontmatter file */
function formatEntryFile(entry: IndexEntry): string {
  return [
    "---",
    `id: ${entry.id}`,
    `topics: [${entry.topics.join(", ")}]`,
    `source: ${entry.source}`,
    `created: ${entry.created}`,
    ...(entry.expires ? [`expires: ${entry.expires}`] : []),
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}

// ---- Remote index fetch ----

async function fetchRemoteIndex(
  ip: string,
  password: string
): Promise<{ ok: boolean; index: FleetIndex; error?: string }> {
  const result = await ssh(
    ip,
    password,
    `cat ${REMOTE_ARC_DIR}/${REMOTE_SHARED_INDEX} 2>/dev/null || echo "{}"`
  );
  if (!result.ok) {
    return { ok: false, index: { topicMap: {}, entries: [] }, error: result.stderr.trim() };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim() || "{}") as Partial<FleetIndex>;
    return {
      ok: true,
      index: {
        topicMap: parsed.topicMap ?? {},
        entries: parsed.entries ?? [],
      },
    };
  } catch {
    return { ok: false, index: { topicMap: {}, entries: [] }, error: "invalid JSON in remote index" };
  }
}

// ---- Inbox helpers ----

function parseInboxFile(filename: string): InboxEntry | null {
  try {
    const text = require("node:fs").readFileSync(`${INBOX_DIR}/${filename}`, "utf-8") as string;
    return parseEntryFile(text, filename);
  } catch {
    return null;
  }
}

function listInboxEntries(): InboxEntry[] {
  try {
    if (!existsSync(INBOX_DIR)) return [];
    const files = readdirSync(INBOX_DIR).filter((f) => f.endsWith(".md"));
    return files.map(parseInboxFile).filter(Boolean) as InboxEntry[];
  } catch {
    return [];
  }
}

// ---- Subcommands ----

async function cmdCollect(
  agents: string[],
  flags: Record<string, string>
): Promise<void> {
  const dryRun = flags["dry-run"] !== undefined;
  const password = await getSshPassword();

  process.stdout.write(
    `Collecting entries from ${agents.length} agent(s): ${agents.join(", ")}${dryRun ? " [DRY RUN]" : ""}\n`
  );

  // 1. Load local index — build set of known entry IDs for dedup
  const localIndex = loadLocalIndex();
  const knownIds = new Set(localIndex.entries.map((e) => e.id));
  const state = loadHookState();

  interface AgentResult {
    agent: string;
    ok: boolean;
    newEntries: IndexEntry[];
    remoteCount: number;
    error?: string;
  }

  // 2. Fetch remote indexes and new entry files in parallel per agent
  const settled = await Promise.allSettled(
    agents.map(async (agent): Promise<AgentResult> => {
      const ip = await getAgentIp(agent);

      const { ok, index: remoteIndex, error } = await fetchRemoteIndex(ip, password);
      if (!ok) {
        return { agent, ok: false, newEntries: [], remoteCount: 0, error };
      }

      const remoteCount = remoteIndex.entries.length;
      const newIds = remoteIndex.entries
        .map((e) => e.id)
        .filter((id) => !knownIds.has(id));

      if (newIds.length === 0) {
        return { agent, ok: true, newEntries: [], remoteCount };
      }

      // Fetch each new entry file from remote
      const newEntries: IndexEntry[] = [];
      for (const id of newIds) {
        const entryResult = await ssh(
          ip,
          password,
          `cat ${REMOTE_ARC_DIR}/${REMOTE_SHARED_ENTRIES_DIR}/${id}.md 2>/dev/null || echo ""`
        );

        if (entryResult.ok && entryResult.stdout.trim()) {
          const parsed = parseEntryFile(entryResult.stdout, `${id}.md`);
          if (parsed) {
            const entry: IndexEntry = {
              id: parsed.id,
              topics: parsed.topics,
              content: parsed.content,
              source: parsed.source,
              created: parsed.created,
              ...(parsed.expires ? { expires: parsed.expires } : {}),
            };
            newEntries.push(entry);
            knownIds.add(id); // prevent cross-agent dupes within same collection run
            continue;
          }
        }

        // Entry file missing — fall back to inline data from remote index
        const remoteEntry = remoteIndex.entries.find((e) => e.id === id);
        if (remoteEntry) {
          newEntries.push(remoteEntry);
          knownIds.add(id);
        }
      }

      return { agent, ok: true, newEntries, remoteCount };
    })
  );

  const results: AgentResult[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      newEntries: [],
      remoteCount: 0,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  // 3. Report per-agent results
  const allNew: IndexEntry[] = [];
  for (const result of results) {
    if (!result.ok) {
      process.stdout.write(`  ${result.agent}: FAILED — ${result.error}\n`);
      continue;
    }
    process.stdout.write(
      `  ${result.agent}: ${result.remoteCount} remote entries, ${result.newEntries.length} new\n`
    );
    allNew.push(...result.newEntries);
  }

  if (allNew.length === 0) {
    process.stdout.write("\nNo new entries to collect.\n");
    if (!dryRun) {
      state.lastCollectedAt = new Date().toISOString();
      for (const result of results) {
        if (result.ok) state.agentRemoteCounts[result.agent] = result.remoteCount;
      }
      await saveHookState(state);
    }
    return;
  }

  if (dryRun) {
    process.stdout.write(`\n--- Would add ${allNew.length} entr${allNew.length === 1 ? "y" : "ies"} ---\n`);
    for (const entry of allNew) {
      const snippet = entry.content.length > 80 ? entry.content.slice(0, 77) + "..." : entry.content;
      process.stdout.write(`  [${entry.id}] from ${entry.source}: ${snippet}\n`);
    }
    process.stdout.write("--- End dry run ---\n");
    return;
  }

  // 4. Write new entry files locally and update index
  mkdirSync(SHARED_ENTRIES_DIR, { recursive: true });
  for (const entry of allNew) {
    await Bun.write(`${SHARED_ENTRIES_DIR}/${entry.id}.md`, formatEntryFile(entry));
    localIndex.entries.push(entry);
  }

  await saveLocalIndex(localIndex);
  state.lastCollectedAt = new Date().toISOString();
  for (const result of results) {
    if (result.ok) state.agentRemoteCounts[result.agent] = result.remoteCount;
  }
  await saveHookState(state);

  process.stdout.write(
    `\nCollected ${allNew.length} new entr${allNew.length === 1 ? "y" : "ies"} into ${FLEET_INDEX_PATH}\n`
  );
}

async function cmdDistribute(
  agents: string[],
  _flags: Record<string, string>
): Promise<void> {
  const password = await getSshPassword();

  const localIndex = loadLocalIndex();
  if (localIndex.entries.length === 0) {
    process.stdout.write("No entries in local index — nothing to distribute.\n");
    return;
  }

  const indexJson = JSON.stringify(localIndex, null, 2) + "\n";
  process.stdout.write(
    `Distributing index (${localIndex.entries.length} entries) to ${agents.length} agent(s)\n`
  );

  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);

      // Ensure remote directories exist
      const mkdirResult = await ssh(
        ip,
        password,
        `mkdir -p ${REMOTE_ARC_DIR}/${REMOTE_SHARED_ENTRIES_DIR}`
      );
      if (!mkdirResult.ok) {
        throw new Error(`mkdir failed: ${mkdirResult.stderr}`);
      }

      // Read remote index to determine which entries are new for this agent
      const { ok: remoteOk, index: remoteIndex } = await fetchRemoteIndex(ip, password);
      const remoteIds = new Set(remoteOk ? remoteIndex.entries.map((e) => e.id) : []);
      const newForAgent = localIndex.entries.filter((e) => !remoteIds.has(e.id));

      // Write new entry files to remote
      for (const entry of newForAgent) {
        // Load from local file if available; reconstruct from index data if not
        let entryContent: string;
        const localFilePath = `${SHARED_ENTRIES_DIR}/${entry.id}.md`;
        if (existsSync(localFilePath)) {
          entryContent = require("node:fs").readFileSync(localFilePath, "utf-8") as string;
        } else {
          entryContent = formatEntryFile(entry);
        }

        const writeResult = await ssh(
          ip,
          password,
          `cat > ${REMOTE_ARC_DIR}/${REMOTE_SHARED_ENTRIES_DIR}/${entry.id}.md << 'FLEET_ENTRY_EOF'\n${entryContent}\nFLEET_ENTRY_EOF`
        );
        if (!writeResult.ok) {
          throw new Error(`write entry ${entry.id} failed: ${writeResult.stderr}`);
        }
      }

      // Write full index.json to remote shared location
      const writeIndexResult = await ssh(
        ip,
        password,
        `cat > ${REMOTE_ARC_DIR}/${REMOTE_SHARED_INDEX} << 'FLEET_INDEX_EOF'\n${indexJson}\nFLEET_INDEX_EOF`
      );
      if (!writeIndexResult.ok) {
        throw new Error(`write index failed: ${writeIndexResult.stderr}`);
      }

      return { agent, newCount: newForAgent.length };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const agent = agents[i];
    if (r.status === "fulfilled") {
      const { newCount } = r.value as { newCount: number };
      process.stdout.write(`  ${agent}: OK (+${newCount} new entries)\n`);
    } else {
      process.stdout.write(
        `  ${agent}: FAILED — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}\n`
      );
    }
  }

  const ok = results.filter((r) => r.status === "fulfilled").length;
  process.stdout.write(`\nDistributed to ${ok}/${agents.length} agent(s)\n`);
}

async function cmdStatus(
  agents: string[],
  _flags: Record<string, string>
): Promise<void> {
  const state = loadHookState();
  const password = await getSshPassword();

  const localIndex = loadLocalIndex();
  process.stdout.write("Fleet Memory Status\n");
  process.stdout.write(`  Last collected: ${state.lastCollectedAt ?? "never"}\n`);
  process.stdout.write(
    `  Local index: ${localIndex.entries.length} entries, ${Object.keys(localIndex.topicMap).length} skill mappings\n`
  );

  // Check remote index entry counts
  process.stdout.write("\n  Remote shared/index.json:\n");
  const checks = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const { ok, index: remoteIndex, error } = await fetchRemoteIndex(ip, password);
      if (!ok) return { agent, count: null as number | null, error };
      return { agent, count: remoteIndex.entries.length, error: undefined };
    })
  );

  for (const check of checks) {
    if (check.status === "fulfilled") {
      const { agent, count, error } = check.value;
      if (count === null) {
        process.stdout.write(`    ${agent}: unreachable (${error ?? "unknown"})\n`);
      } else {
        const lastKnown = state.agentRemoteCounts[agent] ?? 0;
        const delta = count - lastKnown;
        const deltaStr =
          delta > 0 ? ` (+${delta} not yet collected)` : delta < 0 ? ` (${Math.abs(delta)} fewer than last)` : " (in sync)";
        process.stdout.write(`    ${agent}: ${count} entries${deltaStr}\n`);
      }
    } else {
      process.stdout.write(`    ??: error\n`);
    }
  }
}

async function cmdFull(
  agents: string[],
  flags: Record<string, string>
): Promise<void> {
  process.stdout.write("=== Phase 1: Collect ===\n\n");
  await cmdCollect(agents, flags);
  process.stdout.write("\n=== Phase 2: Distribute ===\n\n");
  await cmdDistribute(agents, flags);
}

// ---- Search ----

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const keyword = flags["keyword"]?.toLowerCase();
  const topic = flags["topic"]?.toLowerCase();
  const source = flags["source"]?.toLowerCase();
  const freshOnly = flags["fresh-only"] !== undefined;

  const index = loadLocalIndex();
  if (index.entries.length === 0) {
    process.stdout.write(`No entries in ${FLEET_INDEX_PATH}\n`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const matches = index.entries.filter((entry) => {
    if (freshOnly && entry.expires && entry.expires < today) return false;
    if (source && entry.source.toLowerCase() !== source) return false;
    if (topic && !entry.topics.some((t) => t.toLowerCase() === topic)) return false;
    if (keyword && !entry.content.toLowerCase().includes(keyword)) return false;
    return true;
  });

  matches.sort((a, b) => b.created.localeCompare(a.created));

  if (matches.length === 0) {
    process.stdout.write("No matching entries found.\n");
    return;
  }

  process.stdout.write(`Found ${matches.length} matching entr${matches.length === 1 ? "y" : "ies"}:\n\n`);
  for (const entry of matches) {
    const expired = entry.expires && entry.expires < today ? " [EXPIRED]" : "";
    const expireStr = entry.expires ? ` · expires ${entry.expires}` : "";
    process.stdout.write(
      `[${entry.id}] ${entry.created} · source: ${entry.source} · topics: ${entry.topics.join(", ")}${expireStr}${expired}\n`
    );
    const snippet = entry.content.length > 200 ? entry.content.slice(0, 197) + "..." : entry.content;
    process.stdout.write(`  ${snippet}\n\n`);
  }
}

// ---- Suggest ----

async function cmdSuggest(flags: Record<string, string>): Promise<void> {
  const content = flags["content"];
  const topicsRaw = flags["topics"];
  const source = flags["source"] ?? "arc";
  const expires = flags["expires"];

  if (!content) {
    process.stderr.write("Error: --content is required\n");
    process.exit(1);
  }
  if (!topicsRaw) {
    process.stderr.write("Error: --topics is required (comma-separated)\n");
    process.exit(1);
  }

  const topics = topicsRaw.split(",").map((t) => t.trim());
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-${Date.now().toString(36)}`;

  mkdirSync(INBOX_DIR, { recursive: true });

  const fmLines = [
    "---",
    `id: ${id}`,
    `topics: [${topics.join(", ")}]`,
    `source: ${source}`,
    `created: ${today}`,
    ...(expires ? [`expires: ${expires}`] : []),
    "---",
  ];

  const filename = `${id}.md`;
  await Bun.write(`${INBOX_DIR}/${filename}`, `${fmLines.join("\n")}\n\n${content}\n`);

  process.stdout.write(`Suggested entry written to ${INBOX_DIR}/${filename}\n`);
  process.stdout.write(`  id: ${id}\n`);
  process.stdout.write(`  topics: ${topics.join(", ")}\n`);
  process.stdout.write(`  source: ${source}\n`);
}

// ---- Review ----

async function cmdReview(flags: Record<string, string>): Promise<void> {
  const listOnly = flags["list"] !== undefined;
  const acceptId = flags["accept"];
  const rejectId = flags["reject"];
  const acceptAll = flags["accept-all"] !== undefined;
  const rejectAll = flags["reject-all"] !== undefined;

  const entries = listInboxEntries();

  if (entries.length === 0) {
    process.stdout.write("Inbox is empty — nothing to review.\n");
    return;
  }

  if (listOnly || (!acceptId && !rejectId && !acceptAll && !rejectAll)) {
    process.stdout.write(
      `Fleet Memory Inbox — ${entries.length} pending entr${entries.length === 1 ? "y" : "ies"}:\n\n`
    );
    for (const entry of entries) {
      const expireStr = entry.expires ? ` · expires ${entry.expires}` : "";
      process.stdout.write(
        `[${entry.id}] source: ${entry.source} · topics: ${entry.topics.join(", ")}${expireStr}\n`
      );
      const snippet = entry.content.length > 200 ? entry.content.slice(0, 197) + "..." : entry.content;
      process.stdout.write(`  ${snippet}\n\n`);
    }
    process.stdout.write(
      "Use --accept <id> / --reject <id> / --accept-all / --reject-all to process\n"
    );
    return;
  }

  let toAccept: InboxEntry[] = [];
  let toReject: InboxEntry[] = [];

  if (acceptAll) {
    toAccept = [...entries];
  } else if (rejectAll) {
    toReject = [...entries];
  } else {
    if (acceptId) {
      const entry = entries.find(
        (e) => e.id === acceptId || e.filename === acceptId || e.filename === `${acceptId}.md`
      );
      if (!entry) {
        process.stderr.write(`Error: entry '${acceptId}' not found in inbox\n`);
        process.exit(1);
      }
      toAccept = [entry];
    }
    if (rejectId) {
      const entry = entries.find(
        (e) => e.id === rejectId || e.filename === rejectId || e.filename === `${rejectId}.md`
      );
      if (!entry) {
        process.stderr.write(`Error: entry '${rejectId}' not found in inbox\n`);
        process.exit(1);
      }
      toReject = [entry];
    }
  }

  const index = loadLocalIndex();
  if (toAccept.length > 0) mkdirSync(SHARED_ENTRIES_DIR, { recursive: true });
  if (toReject.length > 0) mkdirSync(SHARED_ARCHIVE_DIR, { recursive: true });

  for (const entry of toAccept) {
    const already = index.entries.find((e) => e.id === entry.id);
    if (already) {
      process.stdout.write(`  SKIP ${entry.id} — already in index\n`);
      unlinkSync(`${INBOX_DIR}/${entry.filename}`);
      continue;
    }
    const indexEntry: IndexEntry = {
      id: entry.id,
      topics: entry.topics,
      content: entry.content,
      source: entry.source,
      created: entry.created,
      ...(entry.expires ? { expires: entry.expires } : {}),
    };
    index.entries.push(indexEntry);
    renameSync(`${INBOX_DIR}/${entry.filename}`, `${SHARED_ENTRIES_DIR}/${entry.filename}`);
    process.stdout.write(`  ACCEPTED ${entry.id} → ${SHARED_ENTRIES_DIR}/${entry.filename}\n`);
  }

  for (const entry of toReject) {
    renameSync(`${INBOX_DIR}/${entry.filename}`, `${SHARED_ARCHIVE_DIR}/${entry.filename}`);
    process.stdout.write(`  REJECTED ${entry.id} → ${SHARED_ARCHIVE_DIR}/${entry.filename}\n`);
  }

  if (toAccept.length > 0) {
    await saveLocalIndex(index);
    process.stdout.write(`\nIndex updated: ${index.entries.length} total entr${index.entries.length === 1 ? "y" : "ies"}\n`);
  }

  const total = toAccept.length + toReject.length;
  process.stdout.write(
    `Reviewed ${total} entr${total === 1 ? "y" : "ies"}: ${toAccept.length} accepted, ${toReject.length} rejected\n`
  );
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-memory — Collect, merge, and distribute learnings across fleet agents

Usage:
  arc skills run --name fleet-memory -- <command> [options]

Commands:
  collect      Fetch index.json from agents, merge new entries into local index
               --dry-run             Show what would be added without writing

  distribute   Push local index.json + new entries to all agents via SSH

  status       Show collection state, entry counts, and remote sync status

  full         Run collect + distribute in sequence

  search       Search fleet-learnings index (memory/fleet-learnings/index.json)
               --keyword TEXT        Filter by keyword in entry content
               --topic TEXT          Filter by topic tag
               --source AGENT        Filter by source agent name
               --fresh-only          Exclude expired entries

  suggest      Write a new entry to memory/inbox/ for review
               --content TEXT        The learning (required)
               --topics tag1,tag2    Topic tags (required)
               --source AGENT        Source agent (default: arc)
               --expires DATE        Optional expiry date (YYYY-MM-DD)

  review       Accept or reject inbox entries; accepted entries go to index.json
               --list                Show all pending inbox entries (default when no action given)
               --accept ID           Accept a specific entry by id
               --reject ID           Reject a specific entry by id
               --accept-all          Accept all pending inbox entries
               --reject-all          Reject all pending inbox entries

Options:
  --agents spark,iris   Comma-separated agent list (default: all; not used by search/suggest/review)

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];
  const { flags } = parseFlags(args.slice(1));

  let agents: string[];
  try {
    agents = resolveAgents(flags["agents"]);
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }

  switch (sub) {
    case "collect":
      await cmdCollect(agents, flags);
      break;
    case "distribute":
      await cmdDistribute(agents, flags);
      break;
    case "status":
      await cmdStatus(agents, flags);
      break;
    case "full":
      await cmdFull(agents, flags);
      break;
    case "search":
      await cmdSearch(flags);
      break;
    case "suggest":
      await cmdSuggest(flags);
      break;
    case "review":
      await cmdReview(flags);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
