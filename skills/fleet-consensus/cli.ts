#!/usr/bin/env bun

/**
 * fleet-consensus CLI
 *
 * Commands:
 *   propose  --topic TEXT --description TEXT --action TEXT [--threshold 3] [--expires-in 60]
 *   vote     --id N --vote approve|reject|abstain [--reason TEXT]
 *   status   --id N
 *   finalize --id N
 *   list     [--status open|approved|rejected|expired]
 */

import { initDatabase, getDatabase } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

// ---- Fleet agents ----

interface AgentConfig {
  ip: string;
  hostname: string;
}

const AGENTS: Record<string, AgentConfig> = {
  spark: { ip: "192.168.1.12", hostname: "spark" },
  iris: { ip: "192.168.1.13", hostname: "iris" },
  loom: { ip: "192.168.1.14", hostname: "loom" },
  forge: { ip: "192.168.1.15", hostname: "forge" },
};

const ALL_VOTERS = ["arc", "spark", "iris", "loom", "forge"];
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

interface Proposal {
  id: number;
  topic: string;
  description: string;
  action_payload: string | null;
  threshold: number;
  total_voters: number;
  status: string;
  proposed_by: string;
  created_at: string;
  resolved_at: string | null;
  expires_at: string;
}

interface Vote {
  id: number;
  proposal_id: number;
  agent_name: string;
  vote: string;
  reasoning: string | null;
  voted_at: string;
}

// ---- Helpers ----

function getLocalAgentName(): string {
  try {
    const hostname = require("node:os").hostname();
    if (hostname in AGENTS) return hostname;
    return "arc";
  } catch {
    return "arc";
  }
}

function tallyVotes(votes: Vote[]): { approve: number; reject: number; abstain: number } {
  const tally = { approve: 0, reject: 0, abstain: 0 };
  for (const v of votes) {
    if (v.vote === "approve") tally.approve++;
    else if (v.vote === "reject") tally.reject++;
    else tally.abstain++;
  }
  return tally;
}

// ---- Commands ----

async function cmdPropose(flags: Record<string, string>): Promise<void> {
  const topic = flags["topic"];
  const description = flags["description"];
  const action = flags["action"] ?? null;
  const threshold = parseInt(flags["threshold"] ?? "3");
  const expiresInMin = parseInt(flags["expires-in"] ?? "60");

  if (!topic || !description) {
    process.stderr.write("Error: --topic and --description are required\n");
    process.exit(1);
  }

  if (threshold < 1 || threshold > ALL_VOTERS.length) {
    process.stderr.write(`Error: --threshold must be 1-${ALL_VOTERS.length}\n`);
    process.exit(1);
  }

  const db = getDatabase();
  const proposedBy = getLocalAgentName();

  const result = db.query(
    `INSERT INTO consensus_proposals (topic, description, action_payload, threshold, total_voters, proposed_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))`
  ).run(topic, description, action, threshold, ALL_VOTERS.length, proposedBy, expiresInMin);
  const proposalId = Number(result.lastInsertRowid);

  process.stdout.write(`Created proposal #${proposalId}: ${topic}\n`);
  process.stdout.write(`Threshold: ${threshold}-of-${ALL_VOTERS.length} | Expires in: ${expiresInMin}min\n\n`);

  // Record proposer's auto-vote as approve (proposer implicitly approves)
  db.query(
    `INSERT INTO consensus_votes (proposal_id, agent_name, vote, reasoning, voted_at)
     VALUES (?, ?, 'approve', 'Proposer auto-approve', datetime('now'))`
  ).run(proposalId, proposedBy);
  process.stdout.write(`  ${proposedBy}: auto-approve (proposer)\n`);

  // Fan out to remote agents (skip self)
  const remoteAgents = Object.keys(AGENTS).filter(a => a !== proposedBy);
  const results: Array<{ agent: string; ok: boolean; error?: string }> = [];

  for (const name of remoteAgents) {
    const ip = await getAgentIp(name);
    const url = `http://${ip}:${WEB_PORT}/api/consensus/vote`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_id: proposalId, topic, description }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        const data = await resp.json() as { task_id: number };
        results.push({ agent: name, ok: true });
        process.stdout.write(`  ${name}: vote requested (task ${data.task_id})\n`);
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
  process.stdout.write(`\nFanned out to ${sent}/${remoteAgents.length} remote agents.\n`);
  process.stdout.write(`Check status: arc skills run --name fleet-consensus -- status --id ${proposalId}\n`);
}

function cmdVote(flags: Record<string, string>): void {
  const id = parseInt(flags["id"] ?? "0");
  const voteValue = flags["vote"];
  const reason = flags["reason"] ?? null;

  if (!id || !voteValue) {
    process.stderr.write("Error: --id and --vote are required\n");
    process.exit(1);
  }

  const validVotes = new Set(["approve", "reject", "abstain"]);
  if (!validVotes.has(voteValue)) {
    process.stderr.write("Error: --vote must be approve, reject, or abstain\n");
    process.exit(1);
  }

  const db = getDatabase();
  const agentName = getLocalAgentName();

  // Check proposal exists and is open
  const proposal = db.query(
    "SELECT * FROM consensus_proposals WHERE id = ?"
  ).get(id) as Proposal | null;

  if (!proposal) {
    process.stderr.write(`Error: proposal #${id} not found\n`);
    process.exit(1);
  }

  if (proposal.status !== "open") {
    process.stderr.write(`Error: proposal #${id} is already ${proposal.status}\n`);
    process.exit(1);
  }

  // Check if already voted
  const existing = db.query(
    "SELECT id FROM consensus_votes WHERE proposal_id = ? AND agent_name = ?"
  ).get(id, agentName);

  if (existing) {
    // Update existing vote
    db.query(
      `UPDATE consensus_votes SET vote = ?, reasoning = ?, voted_at = datetime('now')
       WHERE proposal_id = ? AND agent_name = ?`
    ).run(voteValue, reason, id, agentName);
    process.stdout.write(`Vote updated for proposal #${id}: ${voteValue} (${agentName})\n`);
  } else {
    db.query(
      `INSERT INTO consensus_votes (proposal_id, agent_name, vote, reasoning, voted_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(id, agentName, voteValue, reason);
    process.stdout.write(`Vote recorded for proposal #${id}: ${voteValue} (${agentName})\n`);
  }

  // Auto-finalize check
  autoFinalize(id);
}

function cmdStatus(flags: Record<string, string>): void {
  const id = parseInt(flags["id"] ?? "0");
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  const db = getDatabase();
  const proposal = db.query(
    "SELECT * FROM consensus_proposals WHERE id = ?"
  ).get(id) as Proposal | null;

  if (!proposal) {
    process.stderr.write(`Error: proposal #${id} not found\n`);
    process.exit(1);
  }

  const votes = db.query(
    "SELECT * FROM consensus_votes WHERE proposal_id = ? ORDER BY voted_at ASC"
  ).all(id) as Vote[];

  const tally = tallyVotes(votes);
  const voted = new Set(votes.map(v => v.agent_name));
  const pending = ALL_VOTERS.filter(a => !voted.has(a));

  process.stdout.write(`Proposal #${id}: ${proposal.topic}\n`);
  process.stdout.write(`Status: ${proposal.status} | Threshold: ${proposal.threshold}-of-${proposal.total_voters}\n`);
  process.stdout.write(`Created: ${proposal.created_at} | Expires: ${proposal.expires_at}\n`);
  process.stdout.write(`Proposed by: ${proposal.proposed_by}\n\n`);
  process.stdout.write(`Description: ${proposal.description}\n`);
  if (proposal.action_payload) {
    process.stdout.write(`Action: ${proposal.action_payload}\n`);
  }
  process.stdout.write(`\nVotes: ${votes.length}/${proposal.total_voters} (approve: ${tally.approve}, reject: ${tally.reject}, abstain: ${tally.abstain})\n\n`);

  for (const v of votes) {
    const icon = v.vote === "approve" ? "[+]" : v.vote === "reject" ? "[-]" : "[~]";
    const reasonStr = v.reasoning ? ` — ${v.reasoning}` : "";
    process.stdout.write(`  ${icon} ${v.agent_name}: ${v.vote}${reasonStr}\n`);
  }

  if (pending.length > 0) {
    process.stdout.write(`\n  Pending: ${pending.join(", ")}\n`);
  }
}

function cmdFinalize(flags: Record<string, string>): void {
  const id = parseInt(flags["id"] ?? "0");
  if (!id) {
    process.stderr.write("Error: --id is required\n");
    process.exit(1);
  }

  autoFinalize(id);
}

function autoFinalize(proposalId: number): void {
  const db = getDatabase();
  const proposal = db.query(
    "SELECT * FROM consensus_proposals WHERE id = ?"
  ).get(proposalId) as Proposal | null;

  if (!proposal || proposal.status !== "open") return;

  const votes = db.query(
    "SELECT * FROM consensus_votes WHERE proposal_id = ?"
  ).all(proposalId) as Vote[];

  const tally = tallyVotes(votes);

  // Check approval threshold
  if (tally.approve >= proposal.threshold) {
    db.query(
      "UPDATE consensus_proposals SET status = 'approved', resolved_at = datetime('now') WHERE id = ?"
    ).run(proposalId);
    process.stdout.write(`\nProposal #${proposalId} APPROVED (${tally.approve}/${proposal.threshold} approvals)\n`);
    return;
  }

  // Check rejection: if enough rejections that approval is impossible
  const maxPossibleApprovals = proposal.total_voters - tally.reject;
  if (maxPossibleApprovals < proposal.threshold) {
    db.query(
      "UPDATE consensus_proposals SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?"
    ).run(proposalId);
    process.stdout.write(`\nProposal #${proposalId} REJECTED (${tally.reject} rejections, approval impossible)\n`);
    return;
  }

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(proposal.expires_at + "Z");
  if (now > expiresAt) {
    db.query(
      "UPDATE consensus_proposals SET status = 'expired', resolved_at = datetime('now') WHERE id = ?"
    ).run(proposalId);
    process.stdout.write(`\nProposal #${proposalId} EXPIRED (deadline passed, ${tally.approve}/${proposal.threshold} approvals)\n`);
    return;
  }
}

function cmdList(flags: Record<string, string>): void {
  const status = flags["status"];
  const db = getDatabase();

  let proposals: Proposal[];
  if (status) {
    proposals = db.query(
      "SELECT * FROM consensus_proposals WHERE status = ? ORDER BY created_at DESC LIMIT 20"
    ).all(status) as Proposal[];
  } else {
    proposals = db.query(
      "SELECT * FROM consensus_proposals ORDER BY created_at DESC LIMIT 20"
    ).all() as Proposal[];
  }

  if (proposals.length === 0) {
    process.stdout.write("No proposals found.\n");
    return;
  }

  process.stdout.write(`${"ID".padEnd(5)} ${"Status".padEnd(10)} ${"Threshold".padEnd(10)} ${"Votes".padEnd(8)} Topic\n`);
  process.stdout.write(`${"─".repeat(5)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(40)}\n`);

  for (const p of proposals) {
    const votes = db.query(
      "SELECT vote FROM consensus_votes WHERE proposal_id = ?"
    ).all(p.id) as Array<{ vote: string }>;
    const approveCount = votes.filter(v => v.vote === "approve").length;

    process.stdout.write(
      `${String(p.id).padEnd(5)} ${p.status.padEnd(10)} ${`${p.threshold}-of-${p.total_voters}`.padEnd(10)} ${`${approveCount}/${votes.length}`.padEnd(8)} ${p.topic}\n`
    );
  }
}

// ---- Main ----

async function main(): Promise<void> {
  initDatabase();

  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "propose":
      await cmdPropose(flags);
      break;
    case "vote":
      cmdVote(flags);
      break;
    case "status":
      cmdStatus(flags);
      break;
    case "finalize":
      cmdFinalize(flags);
      break;
    case "list":
      cmdList(flags);
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
fleet-consensus — 3-of-5 fleet consensus protocol

USAGE
  bun skills/fleet-consensus/cli.ts <command> [flags]

COMMANDS
  propose  --topic TEXT --description TEXT [--action TEXT] [--threshold 3] [--expires-in 60]
           Create proposal, auto-approve as proposer, fan out vote requests to fleet
  vote     --id N --vote approve|reject|abstain [--reason TEXT]
           Cast or update a vote on an open proposal
  status   --id N
           Show proposal details and vote tally
  finalize --id N
           Check quorum and resolve proposal (also runs automatically after each vote)
  list     [--status open|approved|rejected|expired]
           List recent proposals

EXAMPLES
  bun skills/fleet-consensus/cli.ts propose --topic "Deploy v6" --description "Push v6 to production" --threshold 3
  bun skills/fleet-consensus/cli.ts vote --id 1 --vote approve --reason "Tests pass, looks good"
  bun skills/fleet-consensus/cli.ts status --id 1
`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
