#!/usr/bin/env bun

/**
 * arc-roundtable CLI
 *
 * Commands:
 *   start   --topic TEXT --prompt TEXT   Create discussion, fan out to fleet
 *   status  --id N                      Show response status
 *   compile --id N                      Assemble responses into thread
 *   respond --id N --text TEXT          Record a response (used by agents)
 */

import { initDatabase, getDatabase } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

// ---- Fleet agents (same as fleet-health) ----

interface AgentConfig {
  ip: string;
  hostname: string;
}

const AGENTS: Record<string, AgentConfig> = {
  arc: { ip: "192.168.1.10", hostname: "arc" },
  spark: { ip: "192.168.1.12", hostname: "spark" },
  iris: { ip: "192.168.1.13", hostname: "iris" },
  loom: { ip: "192.168.1.14", hostname: "loom" },
  forge: { ip: "192.168.1.15", hostname: "forge" },
};

const WEB_PORT = 3000;

async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  return AGENTS[agent].ip;
}

// ---- Flag parser ----

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

// ---- DB types ----

interface Discussion {
  id: number;
  topic: string;
  prompt: string;
  started_by: string;
  status: string;
  created_at: string;
  compiled_at: string | null;
}

interface RoundtableResponse {
  id: number;
  discussion_id: number;
  agent_name: string;
  response: string | null;
  status: string;
  responded_at: string | null;
}

// ---- Commands ----

async function cmdStart(flags: Record<string, string>): Promise<void> {
  const topic = flags["topic"];
  const prompt = flags["prompt"];

  if (!topic || !prompt) {
    process.stderr.write("Error: --topic and --prompt are required\n");
    process.exit(1);
  }

  const db = getDatabase();

  // Create discussion
  const result = db.query(
    "INSERT INTO roundtable_discussions (topic, prompt) VALUES (?, ?)"
  ).run(topic, prompt);
  const discussionId = Number(result.lastInsertRowid);

  process.stdout.write(`Created discussion #${discussionId}: ${topic}\n`);

  // Create response slots and fan out to fleet
  const agentNames = Object.keys(AGENTS);
  const results: Array<{ agent: string; ok: boolean; error?: string }> = [];

  for (const name of agentNames) {
    // Create pending response row
    db.query(
      "INSERT INTO roundtable_responses (discussion_id, agent_name) VALUES (?, ?)"
    ).run(discussionId, name);

    // Fan out HTTP request
    const ip = await getAgentIp(name);
    const url = `http://${ip}:${WEB_PORT}/api/roundtable/respond`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discussion_id: discussionId, prompt }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        const data = await resp.json() as { task_id: number };
        results.push({ agent: name, ok: true });
        process.stdout.write(`  ${name}: queued (task ${data.task_id})\n`);
      } else {
        const data = await resp.json() as { error?: string };
        results.push({ agent: name, ok: false, error: data.error ?? `HTTP ${resp.status}` });
        process.stdout.write(`  ${name}: failed — ${data.error ?? `HTTP ${resp.status}`}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ agent: name, ok: false, error: message });
      process.stdout.write(`  ${name}: unreachable — ${message}\n`);
    }
  }

  const sent = results.filter((r) => r.ok).length;
  process.stdout.write(`\nFanned out to ${sent}/${agentNames.length} agents.\n`);
  process.stdout.write(`Check status: arc skills run --name arc-roundtable -- status --id ${discussionId}\n`);
}

function cmdStatus(flags: Record<string, string>): void {
  const id = parseInt(flags["id"] ?? "0");
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const db = getDatabase();
  const discussion = db.query(
    "SELECT * FROM roundtable_discussions WHERE id = ?"
  ).get(id) as Discussion | null;

  if (!discussion) {
    process.stderr.write(`Error: discussion #${id} not found\n`);
    process.exit(1);
  }

  const responses = db.query(
    "SELECT * FROM roundtable_responses WHERE discussion_id = ? ORDER BY agent_name"
  ).all(id) as RoundtableResponse[];

  process.stdout.write(`Discussion #${id}: ${discussion.topic}\n`);
  process.stdout.write(`Status: ${discussion.status} | Created: ${discussion.created_at}\n`);
  process.stdout.write(`Prompt: ${discussion.prompt.slice(0, 200)}${discussion.prompt.length > 200 ? "..." : ""}\n\n`);

  const responded = responses.filter((r) => r.status === "responded").length;
  process.stdout.write(`Responses: ${responded}/${responses.length}\n\n`);

  for (const r of responses) {
    const statusIcon = r.status === "responded" ? "[✓]" : "[ ]";
    const preview = r.response ? r.response.slice(0, 120).replace(/\n/g, " ") : "—";
    process.stdout.write(`  ${statusIcon} ${r.agent_name}: ${preview}\n`);
  }
}

function cmdCompile(flags: Record<string, string>): void {
  const id = parseInt(flags["id"] ?? "0");
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const db = getDatabase();
  const discussion = db.query(
    "SELECT * FROM roundtable_discussions WHERE id = ?"
  ).get(id) as Discussion | null;

  if (!discussion) {
    process.stderr.write(`Error: discussion #${id} not found\n`);
    process.exit(1);
  }

  const responses = db.query(
    "SELECT * FROM roundtable_responses WHERE discussion_id = ? ORDER BY responded_at ASC"
  ).all(id) as RoundtableResponse[];

  const responded = responses.filter((r) => r.status === "responded");

  // Build threaded document
  const lines: string[] = [
    `# Roundtable: ${discussion.topic}`,
    "",
    `**Started:** ${discussion.created_at}`,
    `**Responses:** ${responded.length}/${responses.length}`,
    "",
    "## Prompt",
    "",
    discussion.prompt,
    "",
    "## Responses",
    "",
  ];

  for (const r of responses) {
    if (r.status === "responded" && r.response) {
      lines.push(`### ${r.agent_name}`);
      lines.push(`*${r.responded_at}*`);
      lines.push("");
      lines.push(r.response);
      lines.push("");
    } else {
      lines.push(`### ${r.agent_name}`);
      lines.push("*(no response)*");
      lines.push("");
    }
  }

  const compiled = lines.join("\n");
  process.stdout.write(compiled);

  // Mark as compiled
  db.query(
    "UPDATE roundtable_discussions SET status = 'compiled', compiled_at = datetime('now') WHERE id = ?"
  ).run(id);
}

async function cmdRespond(flags: Record<string, string>): Promise<void> {
  const id = parseInt(flags["id"] ?? "0");
  const text = flags["text"];

  if (!id || !text) {
    process.stderr.write("Error: --id and --text are required\n");
    process.exit(1);
  }

  const db = getDatabase();

  // Find this agent's name from the local identity
  const agentName = getLocalAgentName();

  // Update the response row locally
  const result = db.query(
    `UPDATE roundtable_responses
     SET response = ?, status = 'responded', responded_at = datetime('now')
     WHERE discussion_id = ? AND agent_name = ?`
  ).run(text, id, agentName);

  if (result.changes === 0) {
    db.query(
      `INSERT INTO roundtable_responses (discussion_id, agent_name, response, status, responded_at)
       VALUES (?, ?, ?, 'responded', datetime('now'))`
    ).run(id, agentName, text);
  }

  process.stdout.write(`Response recorded locally for discussion #${id} as ${agentName}\n`);

  // POST response back to Arc (the orchestrator) so it appears in the compiled result
  const arcIp = await getAgentIp("arc");
  const arcUrl = `http://${arcIp}:${WEB_PORT}/api/roundtable/receive`;
  try {
    const resp = await fetch(arcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discussion_id: id, agent_name: agentName, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      process.stdout.write(`Response sent back to Arc orchestrator\n`);
    } else {
      process.stdout.write(`Warning: could not send to Arc (HTTP ${resp.status})\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`Warning: could not reach Arc at ${arcUrl} — ${message}\n`);
  }
}

function getLocalAgentName(): string {
  // Derive from hostname or fall back to "arc"
  try {
    const hostname = require("node:os").hostname();
    // Hostnames: spark, iris, loom, forge, or the main arc host
    if (hostname in AGENTS) return hostname;
    return "arc";
  } catch {
    return "arc";
  }
}

// ---- Main ----

async function main(): Promise<void> {
  initDatabase();

  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "start":
      await cmdStart(flags);
      break;
    case "status":
      cmdStatus(flags);
      break;
    case "compile":
      cmdCompile(flags);
      break;
    case "respond":
      cmdRespond(flags);
      break;
    case "help":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown command '${command}'\n`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  process.stdout.write(`
arc-roundtable — Inter-agent structured discussions

USAGE
  bun skills/arc-roundtable/cli.ts <command> [flags]

COMMANDS
  start   --topic TEXT --prompt TEXT   Create discussion, fan out to fleet
  status  --id N                      Show response collection status
  compile --id N                      Assemble responses into threaded doc
  respond --id N --text TEXT          Record a response (used by agents)
  help                               Show this help

EXAMPLES
  bun skills/arc-roundtable/cli.ts start --topic "Fleet priorities" --prompt "What should we focus on this week?"
  bun skills/arc-roundtable/cli.ts status --id 1
  bun skills/arc-roundtable/cli.ts compile --id 1
`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
