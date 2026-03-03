#!/usr/bin/env bun
// skills/quorumclaw/cli.ts
// QuorumClaw agent-multisig API coordination CLI.
// Usage: arc skills run --name quorumclaw -- <subcommand> [flags]
//
// Wraps the QuorumClaw REST API for multi-agent Bitcoin Taproot multisig.
// Crypto primitives (key derivation, Schnorr signing) live in taproot-multisig + wallet skills.

import { resolve } from "node:path";

const API_BASE = "https://agent-multisig-api-production.up.railway.app";
const ARC_AGENT_ID = "arc0btc";
const TAPROOT_RUNNER = resolve(import.meta.dir, "../taproot-multisig/taproot-runner.ts");
const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");

// ---- Types ----

interface AgentRecord {
  id: string;
  publicKey: string;
  provider: string;
  name?: string;
}

interface MultisigRecord {
  id: string;
  name: string;
  address: string;
  chainId: string;
  threshold: number;
  agents: AgentRecord[];
}

interface ProposalRecord {
  id: string;
  multisigId: string;
  status: string;
  sighashes: string[];
  signatures: Array<{ agentId: string; signature: string }>;
  outputs: Array<{ address: string; amount: string }>;
  note?: string;
  txid?: string;
}

interface InviteSlot {
  name?: string;
  publicKey?: string;
  joinedAt?: string;
  sessionId?: string;
  isMe?: boolean;
}

interface InviteRecord {
  id: string;
  name: string;
  chainId: string;
  threshold: number;
  slots: InviteSlot[];
  createdAt: string;
  agentId?: string;
  multisigId?: string;
}

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [quorumclaw/cli] ${msg}`);
}

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

function requireFlag(flags: Record<string, string>, name: string, usage: string): string {
  if (!flags[name]) {
    process.stderr.write(`Error: --${name} is required\n\n${usage}\n`);
    process.exit(1);
  }
  return flags[name];
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;
  log(`${method} ${url}`);

  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API ${method} ${path} → invalid JSON: ${text}`);
  }
}

async function getArcInternalPubKey(): Promise<string> {
  log("fetching Arc's Taproot internal pubkey via taproot-runner");

  const { getCredential } = await import("../../src/credentials.ts");
  const password = await getCredential("wallet", "password");
  const walletId = await getCredential("wallet", "id");

  if (!password || !walletId) {
    throw new Error("wallet/password and wallet/id must be set in credential store");
  }

  const proc = Bun.spawn(["bun", "run", TAPROOT_RUNNER, "get-pubkey"], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WALLET_ID: walletId,
      WALLET_PASSWORD: password,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`taproot-runner get-pubkey failed: ${stderr.trim() || stdout.trim()}`);
  }

  const parsed = JSON.parse(stdout.trim()) as { internalPubKey?: string };
  if (!parsed.internalPubKey) {
    throw new Error(`taproot-runner get-pubkey returned no internalPubKey: ${stdout.trim()}`);
  }

  return parsed.internalPubKey;
}

async function signDigest(digest: string): Promise<{ signature: string; publicKey: string }> {
  log(`signing sighash digest: ${digest.slice(0, 16)}...`);

  const { getCredential } = await import("../../src/credentials.ts");
  const password = await getCredential("wallet", "password");
  const walletId = await getCredential("wallet", "id");

  if (!password || !walletId) {
    throw new Error("wallet/password and wallet/id must be set in credential store");
  }

  const WALLET_RUNNER = resolve(import.meta.dir, "../../github/aibtcdev/skills/wallet/sign-runner.ts");

  const proc = Bun.spawn(
    ["bun", "run", WALLET_RUNNER, "schnorr-sign-digest", digest],
    {
      cwd: ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        WALLET_ID: walletId,
        WALLET_PASSWORD: password,
      },
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`sign-runner failed: ${stderr.trim() || stdout.trim()}`);
  }

  const parsed = JSON.parse(stdout.trim()) as { signature?: string; publicKey?: string };
  if (!parsed.signature || !parsed.publicKey) {
    throw new Error(`sign-runner returned incomplete result: ${stdout.trim()}`);
  }

  return { signature: parsed.signature, publicKey: parsed.publicKey };
}

// ---- Subcommands ----

async function cmdRegisterAgent(): Promise<void> {
  log("registering Arc with QuorumClaw");

  const pubKey = await getArcInternalPubKey();
  log(`got internalPubKey: ${pubKey.slice(0, 16)}...`);

  const result = await apiRequest<AgentRecord>("POST", "/v1/agents", {
    id: ARC_AGENT_ID,
    publicKey: pubKey,
    provider: "aibtc",
    name: "Arc",
  });

  console.log(JSON.stringify({ success: true, agent: result }));
}

async function cmdAgentStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const agentId = flags["agent-id"] ?? ARC_AGENT_ID;

  log(`fetching agent status for: ${agentId}`);
  const result = await apiRequest<AgentRecord>("GET", `/v1/agents/${agentId}`);
  console.log(JSON.stringify({ success: true, agent: result }));
}

async function cmdCreateMultisig(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- create-multisig --name <name> --threshold <n> --agents <json-array>";
  const flags = parseFlags(args);
  const name = requireFlag(flags, "name", usage);
  const threshold = parseInt(requireFlag(flags, "threshold", usage), 10);
  const agentsJson = requireFlag(flags, "agents", usage);

  if (isNaN(threshold) || threshold < 1) {
    process.stderr.write("Error: --threshold must be a positive integer\n");
    process.exit(1);
  }

  let agents: AgentRecord[];
  try {
    agents = JSON.parse(agentsJson) as AgentRecord[];
  } catch {
    process.stderr.write(`Error: --agents must be valid JSON array\n  Got: ${agentsJson}\n`);
    process.exit(1);
  }

  if (threshold > agents.length) {
    process.stderr.write(`Error: threshold (${threshold}) cannot exceed agent count (${agents.length})\n`);
    process.exit(1);
  }

  log(`creating ${threshold}-of-${agents.length} multisig: ${name}`);

  const result = await apiRequest<MultisigRecord>("POST", "/v1/multisigs", {
    name,
    chainId: "bitcoin-mainnet",
    threshold,
    agents,
  });

  console.log(JSON.stringify({ success: true, multisig: result }));
}

async function cmdGetMultisig(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- get-multisig --id <multisig-id>";
  const flags = parseFlags(args);
  const id = requireFlag(flags, "id", usage);

  log(`fetching multisig: ${id}`);
  const result = await apiRequest<MultisigRecord>("GET", `/v1/multisigs/${id}`);
  console.log(JSON.stringify({ success: true, multisig: result }));
}

async function cmdCreateProposal(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- create-proposal --multisig-id <id> --to <address> --amount <sats> [--fee-rate <sats/vb>] [--note <text>]";
  const flags = parseFlags(args);
  const multisigId = requireFlag(flags, "multisig-id", usage);
  const toAddress = requireFlag(flags, "to", usage);
  const amount = requireFlag(flags, "amount", usage);
  const feeRate = flags["fee-rate"] ? parseInt(flags["fee-rate"], 10) : 5;
  const note = flags["note"];

  log(`creating proposal: ${amount} sats → ${toAddress} (fee: ${feeRate} sat/vb)`);

  const body: Record<string, unknown> = {
    multisigId,
    outputs: [{ address: toAddress, amount }],
    feeRate,
  };
  if (note) body.note = note;

  const result = await apiRequest<ProposalRecord>("POST", "/v1/proposals", body);
  console.log(JSON.stringify({ success: true, proposal: result }));
}

async function cmdGetProposal(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- get-proposal --id <proposal-id>";
  const flags = parseFlags(args);
  const id = requireFlag(flags, "id", usage);

  log(`fetching proposal: ${id}`);
  const result = await apiRequest<ProposalRecord>("GET", `/v1/proposals/${id}`);
  console.log(JSON.stringify({ success: true, proposal: result }));
}

async function cmdSignProposal(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- sign-proposal --id <proposal-id>";
  const flags = parseFlags(args);
  const id = requireFlag(flags, "id", usage);

  log(`fetching proposal ${id} for signing`);
  const proposal = await apiRequest<ProposalRecord>("GET", `/v1/proposals/${id}`);

  if (!proposal.sighashes || proposal.sighashes.length === 0) {
    console.log(JSON.stringify({ success: false, error: "No sighashes found in proposal" }));
    process.exit(1);
  }

  log(`proposal has ${proposal.sighashes.length} sighash(es) to sign`);
  log(`outputs: ${JSON.stringify(proposal.outputs)}`);

  const results: Array<{ sighash: string; submitted: boolean }> = [];

  for (const sighash of proposal.sighashes) {
    log(`signing sighash: ${sighash.slice(0, 16)}...`);
    const { signature } = await signDigest(sighash);

    log("submitting signature to QuorumClaw");
    await apiRequest("POST", `/v1/proposals/${id}/sign`, {
      agentId: ARC_AGENT_ID,
      signature,
    });

    results.push({ sighash, submitted: true });
    log(`signature submitted for sighash ${sighash.slice(0, 16)}...`);
  }

  console.log(JSON.stringify({ success: true, proposalId: id, signed: results }));
}

async function cmdFinalizeProposal(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- finalize-proposal --id <proposal-id>";
  const flags = parseFlags(args);
  const id = requireFlag(flags, "id", usage);

  log(`finalizing proposal: ${id}`);
  const result = await apiRequest<ProposalRecord>("POST", `/v1/proposals/${id}/finalize`);
  console.log(JSON.stringify({ success: true, proposal: result }));
}

async function cmdBroadcastProposal(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- broadcast-proposal --id <proposal-id>";
  const flags = parseFlags(args);
  const id = requireFlag(flags, "id", usage);

  log(`broadcasting proposal: ${id}`);
  const result = await apiRequest<{ txid?: string } & ProposalRecord>("POST", `/v1/proposals/${id}/broadcast`);
  console.log(JSON.stringify({ success: true, txid: result.txid, proposal: result }));
}

async function cmdListProposals(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- list-proposals --multisig-id <id>";
  const flags = parseFlags(args);
  const multisigId = requireFlag(flags, "multisig-id", usage);

  log(`listing proposals for multisig: ${multisigId}`);
  const result = await apiRequest<ProposalRecord[]>("GET", `/v1/multisigs/${multisigId}/proposals`);
  console.log(JSON.stringify({ success: true, proposals: result }));
}

async function cmdCreateInvite(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- create-invite --name <name> --threshold <n> --total-signers <n> [--chain <chainId>]";
  const flags = parseFlags(args);
  const name = requireFlag(flags, "name", usage);
  const threshold = parseInt(requireFlag(flags, "threshold", usage), 10);
  const totalSigners = parseInt(requireFlag(flags, "total-signers", usage), 10);
  const chainId = flags["chain"] ?? "bitcoin-mainnet";

  if (isNaN(threshold) || threshold < 1) {
    process.stderr.write("Error: --threshold must be a positive integer\n");
    process.exit(1);
  }
  if (isNaN(totalSigners) || totalSigners < threshold) {
    process.stderr.write(`Error: --total-signers must be >= threshold (${threshold})\n`);
    process.exit(1);
  }

  log(`creating ${threshold}-of-${totalSigners} invite: ${name}`);

  const result = await apiRequest<{ data: { inviteId: string; inviteUrl: string } & InviteRecord }>("POST", "/v1/invites", {
    name,
    chainId,
    threshold,
    totalSigners,
  });

  const data = (result as unknown as { data: { inviteId: string; inviteUrl: string } & InviteRecord }).data ?? result;
  const inviteId = (data as { inviteId?: string }).inviteId ?? (data as InviteRecord).id;
  const joinUrl = `https://quorumclaw.com/join/${inviteId}`;

  console.log(JSON.stringify({ success: true, inviteId, joinUrl, invite: data }));
}

async function cmdGetInvite(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- get-invite --code <invite-code>";
  const flags = parseFlags(args);
  const code = requireFlag(flags, "code", usage);

  log(`fetching invite: ${code}`);
  const result = await apiRequest<{ data: InviteRecord }>("GET", `/v1/invites/${code}`);
  const invite = (result as unknown as { data: InviteRecord }).data ?? result;
  const filled = (invite as InviteRecord).slots?.filter((s) => s.name).length ?? 0;
  const total = (invite as InviteRecord).slots?.length ?? 0;
  log(`${filled}/${total} slots filled`);
  console.log(JSON.stringify({ success: true, invite }));
}

async function cmdJoinInvite(args: string[]): Promise<void> {
  const usage = "Usage: arc skills run --name quorumclaw -- join-invite --code <invite-code> [--name <name>]";
  const flags = parseFlags(args);
  const code = requireFlag(flags, "code", usage);
  const name = flags["name"] ?? "Arc";

  const pubKey = await getArcInternalPubKey();
  log(`joining invite ${code} as "${name}" with pubkey ${pubKey.slice(0, 16)}...`);

  const result = await apiRequest<{ data: InviteRecord }>("POST", `/v1/invites/${code}/join`, {
    name,
    publicKey: pubKey,
  });

  const invite = (result as unknown as { data: InviteRecord }).data ?? result;
  const slot = (invite as InviteRecord).slots?.find((s) => s.isMe);
  if (slot) {
    log(`joined as slot index ${(invite as InviteRecord).slots?.indexOf(slot)}, sessionId: ${slot.sessionId}`);
  }
  console.log(JSON.stringify({ success: true, invite }));
}

function printUsage(): void {
  process.stdout.write(`quorumclaw CLI — Bitcoin Taproot multisig coordination via QuorumClaw API

USAGE
  arc skills run --name quorumclaw -- <subcommand> [flags]

SUBCOMMANDS
  register-agent
    Register Arc (arc0btc) with QuorumClaw using Arc's Taproot internal public key.
    Reads pubkey via taproot-runner. Requires wallet credentials.

  agent-status [--agent-id <id>]
    Check if an agent is registered. Defaults to arc0btc.

  create-multisig --name <name> --threshold <n> --agents <json>
    Create an M-of-N Bitcoin Taproot multisig wallet.
    --agents: JSON array of {id, publicKey, provider} objects.
    Returns multisig ID and bc1p... Taproot address.

  get-multisig --id <multisig-id>
    Retrieve multisig details including address and signer list.

  create-proposal --multisig-id <id> --to <address> --amount <sats> [--fee-rate <sats/vb>] [--note <text>]
    Propose a Bitcoin spend from a multisig. Returns proposal ID and sighash(es).
    Default fee rate: 5 sat/vb.

  get-proposal --id <proposal-id>
    Get proposal status, sighashes, and collected signatures.
    Poll this to check when threshold is met.

  sign-proposal --id <proposal-id>
    Fetch sighash(es) from proposal, sign with Arc's Taproot key, submit.
    Requires wallet credentials. VERIFY OUTPUTS before running.

  finalize-proposal --id <proposal-id>
    Assemble the Tapscript witness stack. Run once threshold signatures collected.

  broadcast-proposal --id <proposal-id>
    Broadcast the finalized transaction to the Bitcoin network.
    Returns txid on success.

  list-proposals --multisig-id <id>
    List all proposals for a multisig wallet.

  get-invite --code <invite-code>
    Inspect an open invite: slot count, filled slots, threshold.
    Invite codes appear in join URLs: quorumclaw.com/join/<code>

  join-invite --code <invite-code> [--name <name>]
    Join an existing invite as Arc. Submits Arc's internalPubKey.
    Returns session ID and slot position. Once all slots fill, a multisig
    address is created and proposals may be submitted.

WORKFLOW
  1. register-agent                  (once, stores Arc's pubkey with QuorumClaw)
  2. create-multisig                 (or receive multisig-id from coordinator)
  3. create-proposal                 (propose a spend)
  4. get-proposal                    (inspect outputs before signing!)
  5. sign-proposal                   (sign the sighash)
  6. finalize-proposal               (after threshold met)
  7. broadcast-proposal              (send to Bitcoin network)

SECURITY
  - sign-proposal is a blind-sign operation — always run get-proposal first
  - Verify co-signer signatures: arc skills run --name taproot-multisig -- verify-cosig ...
  - Register internalPubKey (NOT tweaked key) — use taproot-multisig get-pubkey

API BASE: https://agent-multisig-api-production.up.railway.app
DASHBOARD: https://quorumclaw.com/dashboard
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "register-agent":
      await cmdRegisterAgent();
      break;
    case "agent-status":
      await cmdAgentStatus(args.slice(1));
      break;
    case "create-multisig":
      await cmdCreateMultisig(args.slice(1));
      break;
    case "get-multisig":
      await cmdGetMultisig(args.slice(1));
      break;
    case "create-proposal":
      await cmdCreateProposal(args.slice(1));
      break;
    case "get-proposal":
      await cmdGetProposal(args.slice(1));
      break;
    case "sign-proposal":
      await cmdSignProposal(args.slice(1));
      break;
    case "finalize-proposal":
      await cmdFinalizeProposal(args.slice(1));
      break;
    case "broadcast-proposal":
      await cmdBroadcastProposal(args.slice(1));
      break;
    case "list-proposals":
      await cmdListProposals(args.slice(1));
      break;
    case "create-invite":
      await cmdCreateInvite(args.slice(1));
      break;
    case "get-invite":
      await cmdGetInvite(args.slice(1));
      break;
    case "join-invite":
      await cmdJoinInvite(args.slice(1));
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

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});
