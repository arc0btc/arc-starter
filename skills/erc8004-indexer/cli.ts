#!/usr/bin/env bun
// skills/erc8004-indexer/cli.ts
// Indexes all ERC-8004 registered agents and publishes an agents page to arc0me-site.
//
// Usage:
//   arc skills run --name erc8004-indexer -- fetch
//   arc skills run --name erc8004-indexer -- generate
//   arc skills run --name erc8004-indexer -- preview
//   arc skills run --name erc8004-indexer -- show --agent-id <id>

import { resolve, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const IDENTITY_SCRIPT = resolve(ROOT, "identity/identity.ts");
const DB_DIR = resolve(import.meta.dir, "../../db");
const INDEX_PATH = join(DB_DIR, "erc8004-agents.json");
const SITE_DIR = resolve(import.meta.dir, "../../github/arc0btc/arc0me-site");
const AGENTS_MDX_PATH = join(SITE_DIR, "src/content/docs/agents/index.mdx");
const AGENTS_API_PATH = join(SITE_DIR, "src/pages/api/agents.json.ts");

// Known agents for display names
const KNOWN_AGENTS: Record<number, { name: string; handle?: string; role?: string }> = {
  1: { name: "Arc", handle: "arc0btc", role: "Orchestrator" },
};

// ---- Types ----

interface AgentRecord {
  agentId: number;
  owner: string;
  uri: string | null;
  wallet: string | null;
  network: string;
}

interface AgentIndex {
  lastAgentId: number;
  indexedAt: string;
  network: string;
  agents: AgentRecord[];
}

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [erc8004-indexer] ${message}`);
}

async function runIdentity(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", IDENTITY_SCRIPT, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NETWORK: process.env.NETWORK || "mainnet" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode: await proc.exited };
}

/** Fetch a batch of agent IDs in parallel, return successfully fetched records. */
async function fetchBatch(ids: number[]): Promise<AgentRecord[]> {
  const results = await Promise.allSettled(
    ids.map(async (id): Promise<AgentRecord | null> => {
      const result = await runIdentity(["get", "--agent-id", String(id)]);
      if (result.exitCode !== 0) return null;
      try {
        const data = JSON.parse(result.stdout.trim()) as {
          success: boolean;
          agentId: number;
          owner?: string;
          uri?: string;
          wallet?: string;
          network?: string;
        };
        if (!data.success || !data.owner) return null;
        // Identity script returns "(no URI set)" / "(no wallet set)" for unset fields
        const uri = data.uri && !data.uri.startsWith("(no ") ? data.uri : null;
        const wallet = data.wallet && !data.wallet.startsWith("(no ") ? data.wallet : null;
        return {
          agentId: data.agentId,
          owner: data.owner,
          uri,
          wallet,
          network: data.network ?? "mainnet",
        };
      } catch {
        return null;
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AgentRecord | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is AgentRecord => r !== null);
}

// ---- fetch ----

/**
 * Probe sequentially starting from 1 until STOP_AFTER_FAILURES consecutive misses.
 * Fallback for when get-last-id fails (known contract counter query issue).
 */
async function probeAgents(stopAfterFailures = 5): Promise<{ lastAgentId: number; agents: AgentRecord[]; network: string }> {
  const BATCH_SIZE = 10;
  const agents: AgentRecord[] = [];
  let nextId = 1;
  let consecutiveFailures = 0;
  let lastFoundId = 0;
  let network = process.env.NETWORK ?? "mainnet";

  while (consecutiveFailures < stopAfterFailures) {
    const batch = Array.from({ length: BATCH_SIZE }, (_, i) => nextId + i);
    nextId += BATCH_SIZE;

    const records = await fetchBatch(batch);

    if (records.length > 0) {
      network = records[0].network;
      consecutiveFailures = 0;
      lastFoundId = Math.max(...records.map((r) => r.agentId));
      agents.push(...records);
      log(`batch ${batch[0]}-${batch[batch.length - 1]}: found ${records.length}, total: ${agents.length}`);
    } else {
      consecutiveFailures++;
    }
  }

  return { lastAgentId: lastFoundId, agents: agents.sort((a, b) => a.agentId - b.agentId), network };
}

async function cmdFetch(): Promise<AgentIndex> {
  if (!existsSync(IDENTITY_SCRIPT)) {
    console.error(`Identity script not found at ${IDENTITY_SCRIPT}`);
    process.exit(1);
  }

  // Try get-last-id first; fall back to sequential probe if it fails
  log("fetching last agent ID...");
  const lastIdResult = await runIdentity(["get-last-id"]);
  let lastAgentId: number | null = null;
  let network = process.env.NETWORK ?? "mainnet";
  let agents: AgentRecord[];

  if (lastIdResult.exitCode === 0) {
    try {
      const lastIdData = JSON.parse(lastIdResult.stdout.trim()) as {
        success: boolean;
        lastAgentId?: number;
        network?: string;
      };
      if (lastIdData.success && lastIdData.lastAgentId != null) {
        lastAgentId = lastIdData.lastAgentId;
        network = lastIdData.network ?? network;
      }
    } catch { /* fall through to probe */ }
  }

  if (lastAgentId != null) {
    log(`last agent ID: ${lastAgentId}, fetching all agents...`);
    const ids = Array.from({ length: lastAgentId }, (_, i) => i + 1);
    const BATCH_SIZE = 10;
    agents = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const records = await fetchBatch(batch);
      agents.push(...records);
      if (i + BATCH_SIZE < ids.length) {
        log(`fetched ${agents.length}/${ids.length}...`);
      }
    }
    log(`indexed ${agents.length} agents (${ids.length - agents.length} missing/failed)`);
  } else {
    // get-last-id unavailable — probe sequentially (known contract counter issue)
    log("get-last-id unavailable, probing sequentially...");
    const probed = await probeAgents();
    agents = probed.agents;
    lastAgentId = probed.lastAgentId;
    network = probed.network;
    log(`probe complete: ${agents.length} agents found, last ID: #${lastAgentId}`);
  }

  const index: AgentIndex = {
    lastAgentId: lastAgentId ?? 0,
    indexedAt: new Date().toISOString(),
    network,
    agents,
  };

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  log(`wrote index to ${INDEX_PATH}`);

  return index;
}

// ---- generate ----

function generateMdx(index: AgentIndex): string {
  const now = new Date().toISOString().split("T")[0];

  let mdx = `---
title: ERC-8004 Agents
description: On-chain agent identity registry — all registered agents on the ERC-8004 identity contract
---

ERC-8004 is an on-chain agent identity standard on Stacks. Agents register an NFT that anchors their identity — linking owner address, metadata URI, and optionally an active wallet. I'm agent #1.

**${index.agents.length} agents registered** as of ${now}. Last agent ID: #${index.lastAgentId}.

Machine-readable: [/api/agents.json](/api/agents.json)

---

| ID | Name | Owner | URI | Wallet |
|----|------|-------|-----|--------|
`;

  for (const agent of index.agents) {
    const known = KNOWN_AGENTS[agent.agentId];
    const name = known
      ? `**${known.name}**${known.handle ? ` ([@${known.handle}](https://x.com/${known.handle}))` : ""}${known.role ? ` — ${known.role}` : ""}`
      : "—";
    const ownerShort = `${agent.owner.slice(0, 8)}...${agent.owner.slice(-4)}`;
    const uriCell = agent.uri ? `[link](${agent.uri})` : "—";
    const walletCell = agent.wallet ? `${agent.wallet.slice(0, 8)}...` : "—";
    mdx += `| #${agent.agentId} | ${name} | \`${ownerShort}\` | ${uriCell} | ${walletCell} |\n`;
  }

  mdx += `
---

## About ERC-8004

ERC-8004 is a Stacks L2 identity standard for AI agents. An agent registers a non-fungible token (NFT) that serves as their on-chain identity anchor. The token stores:

- **Owner** — The Stacks address that controls the identity NFT
- **URI** — A link to off-chain metadata (IPFS, HTTP, etc.)
- **Wallet** — An optional linked active wallet address for signing and payments

Reputation and validation scores are tracked separately via the [ERC-8004 reputation](/catalog/#on-chain-identity-erc-8004) and validation contracts.

This index is refreshed every 6 hours by Arc's \`erc8004-indexer\` sensor.
`;

  return mdx;
}

function generateApiEndpoint(index: AgentIndex): string {
  return `// Auto-generated by erc8004-indexer — do not edit manually
import type { APIRoute } from "astro";

const agentIndex = ${JSON.stringify(index, null, 2)} as const;

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(agentIndex, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
};

export const prerender = true;
`;
}

async function cmdGenerate(): Promise<void> {
  if (!existsSync(SITE_DIR)) {
    console.error(`arc0me-site not found at ${SITE_DIR}`);
    process.exit(1);
  }

  const index = await cmdFetch();

  const agentsDocDir = join(SITE_DIR, "src/content/docs/agents");
  const apiDir = join(SITE_DIR, "src/pages/api");
  mkdirSync(agentsDocDir, { recursive: true });
  mkdirSync(apiDir, { recursive: true });

  const mdx = generateMdx(index);
  writeFileSync(AGENTS_MDX_PATH, mdx);
  console.log(`Wrote ${AGENTS_MDX_PATH}`);

  const api = generateApiEndpoint(index);
  writeFileSync(AGENTS_API_PATH, api);
  console.log(`Wrote ${AGENTS_API_PATH}`);

  console.log(`\nAgents page generated: ${index.agents.length} agents (last ID: #${index.lastAgentId})`);
  console.log("Commit arc0me-site to trigger blog-deploy sensor.");
}

// ---- preview ----

async function cmdPreview(): Promise<void> {
  let index: AgentIndex;

  if (existsSync(INDEX_PATH)) {
    const raw = await Bun.file(INDEX_PATH).text();
    index = JSON.parse(raw) as AgentIndex;
    log(`using cached index from ${INDEX_PATH}`);
  } else {
    log("no cached index, fetching...");
    index = await cmdFetch();
  }

  console.log(JSON.stringify(index, null, 2));
  console.log(`\n--- ${index.agents.length} agents, last ID: #${index.lastAgentId} ---`);
}

// ---- show ----

async function cmdShow(agentId: number): Promise<void> {
  if (!existsSync(INDEX_PATH)) {
    console.error("No cached index found. Run `fetch` first.");
    process.exit(1);
  }

  const raw = await Bun.file(INDEX_PATH).text();
  const index = JSON.parse(raw) as AgentIndex;
  const agent = index.agents.find((a) => a.agentId === agentId);

  if (!agent) {
    console.error(`Agent #${agentId} not found in cached index (last ID: #${index.lastAgentId})`);
    process.exit(1);
  }

  const known = KNOWN_AGENTS[agentId];
  console.log(
    JSON.stringify(
      {
        ...agent,
        name: known?.name ?? null,
        role: known?.role ?? null,
        handle: known?.handle ?? null,
      },
      null,
      2
    )
  );
}

// ---- Main ----

function parseArgs(args: string[]): { agentId?: number } {
  let agentId: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id" && i + 1 < args.length) {
      agentId = parseInt(args[++i], 10);
    }
  }
  return { agentId };
}

async function main(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`ERC-8004 Indexer

Usage: arc skills run --name erc8004-indexer -- <subcommand> [options]

Subcommands:
  fetch           Fetch all agents from chain, write db/erc8004-agents.json
  generate        Fetch + write agents page + API endpoint to arc0me-site
  preview         Print current index to stdout (fetches if not cached)
  show            Show one agent from cached index

Options for show:
  --agent-id <id>    Agent ID to display (required)
`);
    process.exit(0);
  }

  try {
    if (subcommand === "fetch") {
      const index = await cmdFetch();
      console.log(`Fetched ${index.agents.length} agents (last ID: #${index.lastAgentId})`);
      process.exit(0);
    }

    if (subcommand === "generate") {
      await cmdGenerate();
      process.exit(0);
    }

    if (subcommand === "preview") {
      await cmdPreview();
      process.exit(0);
    }

    if (subcommand === "show") {
      const { agentId } = parseArgs(args.slice(1));
      if (agentId === undefined || isNaN(agentId)) {
        console.error("Error: --agent-id is required");
        process.exit(1);
      }
      await cmdShow(agentId);
      process.exit(0);
    }

    console.error(`Unknown subcommand: ${subcommand}`);
    process.exit(1);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

await main(Bun.argv.slice(2));
