#!/usr/bin/env bun

/**
 * fleet-memory CLI
 *
 * Collect, merge, and distribute learnings across all fleet agents.
 * Hub-and-spoke: Arc collects from agents, merges, distributes back.
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

const FLEET_LEARNINGS_PATH = "memory/fleet-learnings.md";
const FLEET_INDEX_PATH = "memory/fleet-learnings/index.json";
const HOOK_STATE_DIR = "db/hook-state";
const HOOK_STATE_PATH = `${HOOK_STATE_DIR}/fleet-memory.json`;
const INBOX_DIR = "memory/inbox";
const SHARED_ENTRIES_DIR = "memory/shared/entries";
const SHARED_ARCHIVE_DIR = "memory/shared/archive";

// ---- Types ----

interface AgentMemory {
  agent: string;
  ok: boolean;
  patternsContent: string;
  patternsHash: string;
  patternsLineCount: number;
  error?: string;
}

interface HookState {
  lastCollectedAt: string | null;
  agentHashes: Record<string, string>;
  // Line counts at last collection — used by sensor fast check for delta estimation
  agentLineCounts: Record<string, number>;
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
    const file = Bun.file(HOOK_STATE_PATH);
    if (existsSync(HOOK_STATE_PATH)) {
      // Synchronous read for simplicity in CLI
      const text = require("node:fs").readFileSync(HOOK_STATE_PATH, "utf-8");
      const parsed = JSON.parse(text);
      return {
        lastCollectedAt: parsed.lastCollectedAt ?? null,
        agentHashes: parsed.agentHashes ?? {},
        agentLineCounts: parsed.agentLineCounts ?? {},
      };
    }
  } catch {
    // Fall through to default
  }
  return { lastCollectedAt: null, agentHashes: {}, agentLineCounts: {} };
}

async function saveHookState(state: HookState): Promise<void> {
  if (!existsSync(HOOK_STATE_DIR)) {
    mkdirSync(HOOK_STATE_DIR, { recursive: true });
  }
  await Bun.write(HOOK_STATE_PATH, JSON.stringify(state, null, 2));
}

// ---- Helpers ----

function simpleHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex").slice(0, 12);
}

function extractLearnings(patternsContent: string): string[] {
  // Split patterns.md by top-level bullet points (lines starting with "- **")
  // Each learning is a bullet point block (may span multiple lines)
  const lines = patternsContent.split("\n");
  const learnings: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // New top-level learning bullet
    if (line.match(/^- \*\*/)) {
      if (current.length > 0) {
        learnings.push(current.join("\n").trim());
      }
      current = [line];
    } else if (current.length > 0 && (line.startsWith("  ") || line.trim() === "")) {
      // Continuation of current learning (indented or blank)
      current.push(line);
    } else if (current.length > 0) {
      // Non-continuation line — flush current
      learnings.push(current.join("\n").trim());
      current = [];
    }
  }
  if (current.length > 0) {
    learnings.push(current.join("\n").trim());
  }

  return learnings.filter((l) => l.length > 20); // Skip trivially short entries
}

function normalizeForDedup(learning: string): string {
  // Extract the bold key phrase for dedup comparison
  const match = learning.match(/^\- \*\*(.+?)\*\*/);
  if (match) return match[1].toLowerCase().trim();
  return learning.slice(0, 80).toLowerCase().trim();
}

// ---- Inbox helpers ----

function parseInboxFile(filename: string): InboxEntry | null {
  try {
    const text = require("node:fs").readFileSync(`${INBOX_DIR}/${filename}`, "utf-8") as string;
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
    return { id, topics, source, created, ...(expires ? { expires } : {}), content, filename };
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

// ---- Core: fetch memory from one agent ----

async function fetchAgentMemory(
  agent: string,
  password: string
): Promise<AgentMemory> {
  try {
    const ip = await getAgentIp(agent);

    // Read patterns.md from remote agent
    const result = await ssh(
      ip,
      password,
      `cat ${REMOTE_ARC_DIR}/memory/patterns.md 2>/dev/null || echo ""`
    );

    if (!result.ok) {
      return {
        agent,
        ok: false,
        patternsContent: "",
        patternsHash: "",
        error: result.stderr.trim() || `exit ${result.exitCode}`,
      };
    }

    const content = result.stdout;
    return {
      agent,
      ok: true,
      patternsContent: content,
      patternsHash: simpleHash(content),
      patternsLineCount: content.split("\n").length,
    };
  } catch (error) {
    return {
      agent,
      ok: false,
      patternsContent: "",
      patternsHash: "",
      error: error instanceof Error ? error.message : String(error),
    };
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
    `Collecting learnings from ${agents.length} agent(s): ${agents.join(", ")}${dryRun ? " [DRY RUN]" : ""}\n`
  );

  // 1. Fetch patterns.md from all agents in parallel
  const results = await Promise.allSettled(
    agents.map((agent) => fetchAgentMemory(agent, password))
  );

  const memories: AgentMemory[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agent: agents[i],
      ok: false,
      patternsContent: "",
      patternsHash: "",
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      patternsLineCount: 0,
    };
  });

  // 2. Load existing fleet-learnings and hook state
  const state = loadHookState();
  let existingLearnings = "";
  try {
    existingLearnings = require("node:fs").readFileSync(
      FLEET_LEARNINGS_PATH,
      "utf-8"
    );
  } catch {
    existingLearnings = "";
  }

  // Build dedup set from existing fleet-learnings
  const existingKeys = new Set<string>();
  for (const learning of extractLearnings(existingLearnings)) {
    existingKeys.add(normalizeForDedup(learning));
  }

  // Also dedup against Arc's own patterns.md
  try {
    const arcPatterns = require("node:fs").readFileSync(
      "memory/patterns.md",
      "utf-8"
    );
    for (const learning of extractLearnings(arcPatterns)) {
      existingKeys.add(normalizeForDedup(learning));
    }
  } catch {
    // Arc patterns.md might not exist in edge cases
  }

  // 3. Extract new learnings from each agent
  const newEntries: Array<{ agent: string; learning: string }> = [];

  for (const mem of memories) {
    if (!mem.ok) {
      process.stdout.write(`  ${mem.agent}: FAILED — ${mem.error}\n`);
      continue;
    }

    // Skip if hash unchanged since last collection
    if (state.agentHashes[mem.agent] === mem.patternsHash) {
      process.stdout.write(`  ${mem.agent}: unchanged (hash ${mem.patternsHash})\n`);
      continue;
    }

    const agentLearnings = extractLearnings(mem.patternsContent);
    let newCount = 0;

    for (const learning of agentLearnings) {
      const key = normalizeForDedup(learning);
      if (!existingKeys.has(key)) {
        newEntries.push({ agent: mem.agent, learning });
        existingKeys.add(key); // Prevent cross-agent dupes within same collection
        newCount++;
      }
    }

    process.stdout.write(
      `  ${mem.agent}: ${agentLearnings.length} total, ${newCount} new (hash ${mem.patternsHash})\n`
    );

    // Update hash and line count in state (line count used by sensor fast check)
    state.agentHashes[mem.agent] = mem.patternsHash;
    state.agentLineCounts[mem.agent] = mem.patternsLineCount;
  }

  if (newEntries.length === 0) {
    process.stdout.write("\nNo new learnings to merge.\n");
    if (!dryRun) {
      state.lastCollectedAt = new Date().toISOString();
      await saveHookState(state);
      // Initialize fleet-learnings.md if it doesn't exist yet
      if (!existsSync(FLEET_LEARNINGS_PATH)) {
        const timestamp = new Date().toISOString().slice(0, 10);
        await Bun.write(
          FLEET_LEARNINGS_PATH,
          `# Fleet Learnings\n\n*Cross-agent learnings collected by fleet-memory. Auto-generated — do not edit manually.*\n*Distributed to all agents. Reference during dispatch for cross-domain context.*\n\n*First collected: ${timestamp}. No new unique learnings found (agents share Arc's patterns.md baseline).*\n`
        );
        process.stdout.write(`Created ${FLEET_LEARNINGS_PATH} (baseline, no new entries)\n`);
      }
    }
    return;
  }

  // 4. Format new entries
  const timestamp = new Date().toISOString().slice(0, 10);
  const sections = new Map<string, string[]>();

  for (const entry of newEntries) {
    const list = sections.get(entry.agent) ?? [];
    list.push(entry.learning);
    sections.set(entry.agent, list);
  }

  let appendBlock = `\n\n## Collected ${timestamp}\n`;
  for (const [agent, learnings] of sections) {
    appendBlock += `\n### From ${agent}\n\n`;
    for (const l of learnings) {
      appendBlock += `${l}\n\n`;
    }
  }

  if (dryRun) {
    process.stdout.write(`\n--- Would append (${newEntries.length} entries) ---\n`);
    process.stdout.write(appendBlock);
    process.stdout.write("\n--- End dry run ---\n");
    return;
  }

  // 5. Write to fleet-learnings.md
  let fileContent = existingLearnings;
  if (!fileContent) {
    fileContent = `# Fleet Learnings\n\n*Cross-agent learnings collected by fleet-memory. Auto-generated — do not edit manually.*\n*Distributed to all agents. Reference during dispatch for cross-domain context.*\n`;
  }
  fileContent += appendBlock;

  await Bun.write(FLEET_LEARNINGS_PATH, fileContent);
  state.lastCollectedAt = new Date().toISOString();
  await saveHookState(state);

  process.stdout.write(
    `\nAppended ${newEntries.length} new learning(s) to ${FLEET_LEARNINGS_PATH}\n`
  );
}

async function cmdDistribute(
  agents: string[],
  flags: Record<string, string>
): Promise<void> {
  const password = await getSshPassword();

  if (!existsSync(FLEET_LEARNINGS_PATH)) {
    process.stderr.write(
      `Error: ${FLEET_LEARNINGS_PATH} does not exist. Run 'collect' first.\n`
    );
    process.exit(1);
  }

  const content = require("node:fs").readFileSync(FLEET_LEARNINGS_PATH, "utf-8");
  const hash = simpleHash(content);
  process.stdout.write(
    `Distributing fleet-learnings.md (${content.length} bytes, hash ${hash}) to ${agents.length} agent(s)\n`
  );

  // SCP fleet-learnings.md to each agent in parallel
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);

      // Ensure memory directory exists, then write file
      const mkdirResult = await ssh(
        ip,
        password,
        `mkdir -p ${REMOTE_ARC_DIR}/memory`
      );
      if (!mkdirResult.ok) {
        throw new Error(`mkdir failed: ${mkdirResult.stderr}`);
      }

      // Use SSH + stdin to write file (avoids SCP complications with sshpass)
      const escaped = content.replace(/'/g, "'\\''");
      const writeResult = await ssh(
        ip,
        password,
        `cat > ${REMOTE_ARC_DIR}/${FLEET_LEARNINGS_PATH} << 'FLEET_MEMORY_EOF'\n${content}\nFLEET_MEMORY_EOF`
      );

      if (!writeResult.ok) {
        throw new Error(`write failed: ${writeResult.stderr}`);
      }

      return agent;
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const agent = agents[i];
    if (r.status === "fulfilled") {
      process.stdout.write(`  ${agent}: OK\n`);
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

  process.stdout.write("Fleet Memory Status\n");
  process.stdout.write(`  Last collected: ${state.lastCollectedAt ?? "never"}\n`);

  // Check local fleet-learnings
  if (existsSync(FLEET_LEARNINGS_PATH)) {
    const content = require("node:fs").readFileSync(FLEET_LEARNINGS_PATH, "utf-8");
    const entries = extractLearnings(content);
    process.stdout.write(
      `  Fleet learnings: ${entries.length} entries (${content.length} bytes)\n`
    );
  } else {
    process.stdout.write("  Fleet learnings: not yet created\n");
  }

  process.stdout.write("\n  Agent hashes (last collected):\n");
  for (const agent of agents) {
    const hash = state.agentHashes[agent] ?? "(not collected)";
    process.stdout.write(`    ${agent}: ${hash}\n`);
  }

  // Check remote fleet-learnings presence
  process.stdout.write("\n  Remote fleet-learnings.md:\n");
  const checks = await Promise.allSettled(
    agents.map(async (agent) => {
      const ip = await getAgentIp(agent);
      const result = await ssh(
        ip,
        password,
        `wc -c < ${REMOTE_ARC_DIR}/${FLEET_LEARNINGS_PATH} 2>/dev/null || echo "missing"`
      );
      return {
        agent,
        result: result.ok ? result.stdout.trim() : "unreachable",
      };
    })
  );

  for (const check of checks) {
    if (check.status === "fulfilled") {
      const { agent, result } = check.value;
      const display =
        result === "missing"
          ? "not distributed"
          : result === "unreachable"
            ? "unreachable"
            : `${result} bytes`;
      process.stdout.write(`    ${agent}: ${display}\n`);
    } else {
      process.stdout.write(`    ??: error\n`);
    }
  }
}

// ---- Index types ----

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

// ---- Search command ----

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const keyword = flags["keyword"]?.toLowerCase();
  const topic = flags["topic"]?.toLowerCase();
  const source = flags["source"]?.toLowerCase();
  const freshOnly = flags["fresh-only"] !== undefined;

  let index: FleetIndex;
  try {
    const text = require("node:fs").readFileSync(FLEET_INDEX_PATH, "utf-8");
    index = JSON.parse(text) as FleetIndex;
  } catch {
    process.stderr.write(`Error: could not read ${FLEET_INDEX_PATH}\n`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);

  const matches = index.entries.filter((entry) => {
    // Fresh-only: skip expired entries
    if (freshOnly && entry.expires && entry.expires < today) return false;

    // Source filter
    if (source && entry.source.toLowerCase() !== source) return false;

    // Topic filter
    if (topic && !entry.topics.some((t) => t.toLowerCase() === topic)) return false;

    // Keyword filter (searches content)
    if (keyword && !entry.content.toLowerCase().includes(keyword)) return false;

    return true;
  });

  // Sort newest first
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
    // Snippet: truncate content to 200 chars
    const snippet = entry.content.length > 200 ? entry.content.slice(0, 197) + "..." : entry.content;
    process.stdout.write(`  ${snippet}\n\n`);
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

// ---- Suggest: write an inbox entry ----

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

// ---- Review: accept/reject inbox entries ----

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

  // List mode or no action
  if (listOnly || (!acceptId && !rejectId && !acceptAll && !rejectAll)) {
    process.stdout.write(
      `Fleet Memory Inbox — ${entries.length} pending entr${entries.length === 1 ? "y" : "ies"}:\n\n`
    );
    for (const entry of entries) {
      const expireStr = entry.expires ? ` · expires ${entry.expires}` : "";
      process.stdout.write(
        `[${entry.id}] source: ${entry.source} · topics: ${entry.topics.join(", ")}${expireStr}\n`
      );
      const snippet =
        entry.content.length > 200 ? entry.content.slice(0, 197) + "..." : entry.content;
      process.stdout.write(`  ${snippet}\n\n`);
    }
    process.stdout.write(
      "Use --accept <id> / --reject <id> / --accept-all / --reject-all to process\n"
    );
    return;
  }

  // Resolve which entries to accept / reject
  let toAccept: InboxEntry[] = [];
  let toReject: InboxEntry[] = [];

  if (acceptAll) {
    toAccept = [...entries];
  } else if (rejectAll) {
    toReject = [...entries];
  } else {
    if (acceptId) {
      const entry = entries.find(
        (e) =>
          e.id === acceptId ||
          e.filename === acceptId ||
          e.filename === `${acceptId}.md`
      );
      if (!entry) {
        process.stderr.write(`Error: entry '${acceptId}' not found in inbox\n`);
        process.exit(1);
      }
      toAccept = [entry];
    }
    if (rejectId) {
      const entry = entries.find(
        (e) =>
          e.id === rejectId ||
          e.filename === rejectId ||
          e.filename === `${rejectId}.md`
      );
      if (!entry) {
        process.stderr.write(`Error: entry '${rejectId}' not found in inbox\n`);
        process.exit(1);
      }
      toReject = [entry];
    }
  }

  // Load index
  let index: FleetIndex;
  try {
    const text = require("node:fs").readFileSync(FLEET_INDEX_PATH, "utf-8") as string;
    index = JSON.parse(text) as FleetIndex;
  } catch {
    index = { topicMap: {}, entries: [] };
  }

  // Ensure target dirs exist
  if (toAccept.length > 0) mkdirSync(SHARED_ENTRIES_DIR, { recursive: true });
  if (toReject.length > 0) mkdirSync(SHARED_ARCHIVE_DIR, { recursive: true });

  // Process accepts
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

  // Process rejects
  for (const entry of toReject) {
    renameSync(`${INBOX_DIR}/${entry.filename}`, `${SHARED_ARCHIVE_DIR}/${entry.filename}`);
    process.stdout.write(`  REJECTED ${entry.id} → ${SHARED_ARCHIVE_DIR}/${entry.filename}\n`);
  }

  // Persist updated index
  if (toAccept.length > 0) {
    await Bun.write(FLEET_INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
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
  collect      Fetch patterns.md from agents, extract new learnings, merge into fleet-learnings.md
               --dry-run             Show what would be added without writing

  distribute   Push fleet-learnings.md to all agents via SSH

  status       Show collection state, entry counts, and distribution status

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
