#!/usr/bin/env bun
// skills/dao-zero-authority/cli.ts
//
// CLI for DAO governance: track DAOs, list proposals, vote.
//
// Usage: bun skills/dao-zero-authority/cli.ts <command> [options]

import { join } from "node:path";
import { ARC_STX_ADDRESS } from "../../src/identity.ts";

const HIRO_API = "https://api.mainnet.hiro.so";
const DAOS_PATH = join(import.meta.dir, "daos.json");
const FETCH_TIMEOUT_MS = 15_000;

// ---- Types ----

interface DaoFunctions {
  getProposalCount: string;
  getProposal: string;
  vote: string;
  getVotingPower: string;
}

interface TrackedDao {
  contract: string;
  label: string;
  addedAt: string;
  functions?: Partial<DaoFunctions>;
  lastKnownCount?: number;
}

interface DaosConfig {
  daos: TrackedDao[];
  defaults: {
    functions: DaoFunctions;
  };
}

// ---- Config I/O ----

async function readConfig(): Promise<DaosConfig> {
  try {
    return (await Bun.file(DAOS_PATH).json()) as DaosConfig;
  } catch {
    return {
      daos: [],
      defaults: {
        functions: {
          getProposalCount: "get-proposal-count",
          getProposal: "get-proposal",
          vote: "vote",
          getVotingPower: "get-voting-power",
        },
      },
    };
  }
}

async function writeConfig(config: DaosConfig): Promise<void> {
  await Bun.write(DAOS_PATH, JSON.stringify(config, null, 2) + "\n");
}

// ---- Hiro API ----

function splitContract(contract: string): { address: string; name: string } {
  const dot = contract.indexOf(".");
  if (dot === -1) throw new Error(`Invalid contract ID: ${contract} (expected ADDRESS.NAME)`);
  return { address: contract.slice(0, dot), name: contract.slice(dot + 1) };
}

async function callReadOnly(
  contract: string,
  functionName: string,
  args: string[] = [],
): Promise<Record<string, unknown> | null> {
  const { address, name } = splitContract(contract);
  const url = `${HIRO_API}/v2/contracts/call-read/${address}/${name}/${functionName}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ARC_STX_ADDRESS,
        arguments: args,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Read-only call failed: ${functionName} on ${contract} → HTTP ${res.status}`);
      const body = await res.text().catch(() => "");
      if (body) console.error(`Response: ${body.slice(0, 500)}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

function encodeUint(value: number): string {
  const hex = value.toString(16).padStart(32, "0");
  return "0x01" + hex;
}

function parseClarityUint(result: Record<string, unknown>): number | null {
  if (!result.okay || result.okay !== true) return null;
  const hex = result.result as string | undefined;
  if (!hex || typeof hex !== "string") return null;
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.startsWith("01") && clean.length === 34) {
      const numHex = clean.slice(clean.length - 8);
      return parseInt(numHex, 16);
    }
    return null;
  } catch {
    return null;
  }
}

async function getContractInterface(contract: string): Promise<Record<string, unknown> | null> {
  const { address, name } = splitContract(contract);
  const url = `${HIRO_API}/v2/contracts/interface/${address}/${name}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

// ---- Commands ----

async function cmdListDaos(): Promise<void> {
  const config = await readConfig();
  if (config.daos.length === 0) {
    console.log(JSON.stringify({ daos: [], message: "No DAOs tracked. Use add-dao to start tracking." }));
    return;
  }
  console.log(JSON.stringify({
    daos: config.daos.map((d) => ({
      contract: d.contract,
      label: d.label,
      addedAt: d.addedAt,
      lastKnownCount: d.lastKnownCount ?? 0,
      functions: { ...config.defaults.functions, ...d.functions },
    })),
  }, null, 2));
}

async function cmdAddDao(contract: string, label: string): Promise<void> {
  if (!contract || !label) {
    console.error("Usage: add-dao --contract <ADDRESS.NAME> --label <name>");
    process.exit(1);
  }

  // Validate contract format
  splitContract(contract);

  const config = await readConfig();

  // Check for duplicates
  if (config.daos.some((d) => d.contract === contract)) {
    console.error(`DAO ${contract} is already tracked.`);
    process.exit(1);
  }

  // Verify contract exists by checking its interface
  console.error(`Verifying contract ${contract}...`);
  const iface = await getContractInterface(contract);
  if (!iface) {
    console.error(`Warning: Could not fetch interface for ${contract}. Adding anyway.`);
  } else {
    const functions = (iface.functions ?? []) as Array<{ name: string }>;
    const fnNames = functions.map((f) => f.name);
    console.error(`Contract has ${fnNames.length} functions: ${fnNames.slice(0, 10).join(", ")}${fnNames.length > 10 ? "..." : ""}`);

    // Check for expected DAO functions
    const expected = Object.values(config.defaults.functions);
    const missing = expected.filter((fn) => !fnNames.includes(fn));
    if (missing.length > 0) {
      console.error(`Warning: Contract missing expected functions: ${missing.join(", ")}`);
      console.error(`You may need to specify custom function names with daos.json.`);
    }
  }

  config.daos.push({
    contract,
    label,
    addedAt: new Date().toISOString(),
  });

  await writeConfig(config);
  console.log(JSON.stringify({ success: true, message: `Added DAO: ${label} (${contract})` }));
}

async function cmdRemoveDao(contract: string): Promise<void> {
  if (!contract) {
    console.error("Usage: remove-dao --contract <ADDRESS.NAME>");
    process.exit(1);
  }

  const config = await readConfig();
  const before = config.daos.length;
  config.daos = config.daos.filter((d) => d.contract !== contract);

  if (config.daos.length === before) {
    console.error(`DAO ${contract} not found in tracking list.`);
    process.exit(1);
  }

  await writeConfig(config);
  console.log(JSON.stringify({ success: true, message: `Removed DAO: ${contract}` }));
}

async function cmdProposals(contract: string): Promise<void> {
  if (!contract) {
    console.error("Usage: proposals --contract <ADDRESS.NAME>");
    process.exit(1);
  }

  const config = await readConfig();
  const dao = config.daos.find((d) => d.contract === contract);
  const fns = { ...config.defaults.functions, ...dao?.functions };

  // Get proposal count
  const countResult = await callReadOnly(contract, fns.getProposalCount);
  if (!countResult) {
    console.error(`Could not read proposal count from ${contract}`);
    process.exit(1);
  }

  const count = parseClarityUint(countResult);
  if (count === null) {
    console.log(JSON.stringify({
      contract,
      rawCountResponse: countResult,
      message: "Could not parse proposal count. Raw response included.",
    }, null, 2));
    return;
  }

  console.error(`Found ${count} proposals on ${contract}`);

  // Fetch each proposal (last 10 max to avoid rate limits)
  const start = Math.max(1, count - 9);
  const proposals: Array<{ id: number; raw: Record<string, unknown> | null }> = [];

  for (let i = start; i <= count; i++) {
    const result = await callReadOnly(contract, fns.getProposal, [encodeUint(i)]);
    proposals.push({ id: i, raw: result });
  }

  console.log(JSON.stringify({
    contract,
    label: dao?.label ?? "(untracked)",
    totalProposals: count,
    showing: { from: start, to: count },
    proposals,
  }, null, 2));
}

async function cmdProposal(contract: string, id: number): Promise<void> {
  if (!contract || isNaN(id)) {
    console.error("Usage: proposal --contract <ADDRESS.NAME> --id <number>");
    process.exit(1);
  }

  const config = await readConfig();
  const dao = config.daos.find((d) => d.contract === contract);
  const fns = { ...config.defaults.functions, ...dao?.functions };

  const result = await callReadOnly(contract, fns.getProposal, [encodeUint(id)]);
  if (!result) {
    console.error(`Could not fetch proposal #${id} from ${contract}`);
    process.exit(1);
  }

  // Also check voting power
  const powerResult = await callReadOnly(
    contract,
    fns.getVotingPower,
    [`0x0516${Buffer.from(ARC_STX_ADDRESS).toString("hex")}`],
  );

  console.log(JSON.stringify({
    contract,
    label: dao?.label ?? "(untracked)",
    proposalId: id,
    proposal: result,
    arcVotingPower: powerResult,
    arcAddress: ARC_STX_ADDRESS,
  }, null, 2));
}

async function cmdVote(contract: string, id: number, direction: string): Promise<void> {
  if (!contract || isNaN(id) || !["for", "against"].includes(direction)) {
    console.error("Usage: vote --contract <ADDRESS.NAME> --id <number> --direction for|against");
    process.exit(1);
  }

  // Voting requires a contract call transaction — not a read-only operation.
  // This outputs the transaction parameters for the wallet skill to execute.
  const config = await readConfig();
  const dao = config.daos.find((d) => d.contract === contract);
  const fns = { ...config.defaults.functions, ...dao?.functions };
  const { address, name } = splitContract(contract);

  console.log(JSON.stringify({
    action: "vote",
    contract,
    label: dao?.label ?? "(untracked)",
    proposalId: id,
    direction,
    transaction: {
      contractAddress: address,
      contractName: name,
      functionName: fns.vote,
      functionArgs: [
        { type: "uint", value: id },
        { type: "bool", value: direction === "for" },
      ],
    },
    note: "Execute this transaction via wallet skill contract-call or x402 sponsored transaction.",
  }, null, 2));
}

async function cmdStatus(): Promise<void> {
  const config = await readConfig();

  if (config.daos.length === 0) {
    console.log(JSON.stringify({
      trackedDaos: 0,
      message: "No DAOs tracked. Use add-dao to start monitoring governance.",
      arcAddress: ARC_STX_ADDRESS,
    }, null, 2));
    return;
  }

  const daoStatuses: Array<Record<string, unknown>> = [];

  for (const dao of config.daos) {
    const fns = { ...config.defaults.functions, ...dao.functions };

    const countResult = await callReadOnly(dao.contract, fns.getProposalCount);
    const count = countResult ? parseClarityUint(countResult) : null;

    daoStatuses.push({
      contract: dao.contract,
      label: dao.label,
      totalProposals: count,
      lastKnownCount: dao.lastKnownCount ?? 0,
      newSinceLastCheck: count !== null && dao.lastKnownCount !== undefined
        ? Math.max(0, count - dao.lastKnownCount)
        : "unknown",
    });
  }

  console.log(JSON.stringify({
    trackedDaos: config.daos.length,
    arcAddress: ARC_STX_ADDRESS,
    daos: daoStatuses,
  }, null, 2));
}

// ---- Argument parsing ----

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// ---- Main ----

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "list-daos":
    await cmdListDaos();
    break;
  case "add-dao":
    await cmdAddDao(getFlag(args, "--contract") ?? "", getFlag(args, "--label") ?? "");
    break;
  case "remove-dao":
    await cmdRemoveDao(getFlag(args, "--contract") ?? "");
    break;
  case "proposals":
    await cmdProposals(getFlag(args, "--contract") ?? "");
    break;
  case "proposal":
    await cmdProposal(
      getFlag(args, "--contract") ?? "",
      parseInt(getFlag(args, "--id") ?? "NaN", 10),
    );
    break;
  case "vote":
    await cmdVote(
      getFlag(args, "--contract") ?? "",
      parseInt(getFlag(args, "--id") ?? "NaN", 10),
      getFlag(args, "--direction") ?? "",
    );
    break;
  case "status":
    await cmdStatus();
    break;
  default:
    console.error(`zero-authority CLI

Commands:
  list-daos                                     List tracked DAOs
  add-dao --contract <ADDR.NAME> --label <name> Track a DAO contract
  remove-dao --contract <ADDR.NAME>             Stop tracking a DAO
  proposals --contract <ADDR.NAME>              List proposals
  proposal --contract <ADDR.NAME> --id <N>      Get proposal details
  vote --contract <ADDR.NAME> --id <N> --direction for|against
  status                                        Governance overview`);
    process.exit(command ? 1 : 0);
}
