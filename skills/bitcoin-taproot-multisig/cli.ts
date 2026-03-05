#!/usr/bin/env bun
// skills/bitcoin-taproot-multisig/cli.ts
// Unified CLI for Taproot multisig coordination.
// Usage: arc skills run --name taproot-multisig -- <subcommand> [flags]
//
// get-pubkey: routes through taproot-runner.ts (needs wallet unlock in-process)
// verify-cosig: BIP-340 Schnorr verification (no wallet needed, runs in-process)
// guide: pure JSON output (no wallet needed)

import { getCredential } from "../../src/credentials.ts";
import { schnorr } from "../../github/aibtcdev/skills/node_modules/@noble/curves/secp256k1.js";
import { hex } from "../../github/aibtcdev/skills/node_modules/@scure/base/index.js";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const TAPROOT_RUNNER = resolve(import.meta.dir, "taproot-runner.ts");

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [taproot-multisig/cli] ${msg}`);
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

async function getWalletPassword(): Promise<string> {
  const password = await getCredential("bitcoin-wallet", "password");
  if (!password) {
    console.log(JSON.stringify({ success: false, error: "Wallet password not found in credential store (wallet/password)" }));
    process.exit(1);
  }
  return password;
}

async function getWalletId(): Promise<string> {
  const id = await getCredential("bitcoin-wallet", "id");
  if (!id) {
    console.log(JSON.stringify({ success: false, error: "Wallet ID not found in credential store (wallet/id)" }));
    process.exit(1);
  }
  return id;
}

// ---- Subcommands ----

async function cmdGetPubkey(): Promise<void> {
  log("getting taproot internal pubkey (auto unlock/lock)");

  const password = await getWalletPassword();
  const walletId = await getWalletId();

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
    log(`get-pubkey failed: ${stderr.trim()}`);
    console.log(JSON.stringify({ success: false, error: "get-pubkey failed", detail: stderr.trim() || stdout.trim() }));
    process.exit(1);
  }

  console.log(stdout.trim());
}

async function cmdVerifyCosig(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.digest || !flags.signature || !flags["public-key"]) {
    process.stderr.write("Usage: arc skills run --name taproot-multisig -- verify-cosig --digest <hex> --signature <hex> --public-key <hex>\n");
    process.exit(1);
  }

  log("verifying co-signer signature");

  try {
    const digestBytes = hex.decode(flags.digest);
    const sigBytes = hex.decode(flags.signature);
    const pubKeyBytes = hex.decode(flags["public-key"]);

    if (digestBytes.length !== 32) {
      throw new Error("--digest must be exactly 32 bytes (64 hex chars)");
    }
    if (sigBytes.length !== 64) {
      throw new Error("--signature must be exactly 64 bytes (128 hex chars)");
    }
    if (pubKeyBytes.length !== 32) {
      throw new Error("--public-key must be exactly 32 bytes (64 hex chars)");
    }

    const isValid = schnorr.verify(sigBytes, digestBytes, pubKeyBytes);

    console.log(JSON.stringify({
      success: true,
      isValid,
      digest: flags.digest,
      signature: flags.signature,
      publicKey: flags["public-key"],
      message: isValid
        ? "Signature is valid — this co-signer's key signed this digest."
        : "Signature is INVALID — do not proceed. Key mismatch or digest was tampered.",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`verify-cosig failed: ${msg}`);
    console.log(JSON.stringify({ success: false, error: "verify-cosig failed", detail: msg }));
    process.exit(1);
  }
}

function cmdGuide(): void {
  console.log(JSON.stringify({
    title: "Bitcoin Taproot Multisig: Agent-to-Agent Coordination Guide",
    description:
      "How to execute M-of-N Taproot multisig transactions between autonomous agents " +
      "using BIP-340 Schnorr signatures and OP_CHECKSIGADD.",
    provenOnMainnet: [
      {
        type: "2-of-2",
        txid: "d05806c87ceae62e8f47daafb9fe4842c837fa3f333864cd5a5ec9d2a38cf96b",
        block: 937849,
        signers: ["Arc (arc0btc)", "Aetos (SetZeus)"],
        date: "2026-02-22",
      },
      {
        type: "3-of-3",
        txid: "47dbaf5185b582902b43241e757c6bc6a1c60b4418453d93b2ffbb0315f87e92",
        block: 938206,
        multisigAddress: "bc1pysmgn5dnmht8rzp542kcf7gyftkuczwwwfvld4lfr64udxfe4yssktp35t",
        signers: ["Arc (arc0btc)", "Aetos (SetZeus)", "Bitclaw"],
        date: "2026-02-25",
      },
    ],
    bipsUsed: {
      "BIP-340": "Schnorr signatures — 64-byte, x-only pubkeys",
      "BIP-341": "Taproot output structure — key-path and script-path spending",
      "BIP-342": "Tapscript — OP_CHECKSIGADD for M-of-N threshold multisig",
      "BIP-86": "HD key derivation for Taproot — m/86'/[coinType]'/0'/0/0",
    },
    workflow: [
      {
        step: 1,
        title: "Get Your Public Key",
        command: "arc skills run --name taproot-multisig -- get-pubkey",
        note: "Share 'internalPubKey' (32 bytes hex), NOT the tweaked key or address.",
      },
      {
        step: 2,
        title: "Join the Multisig Wallet",
        description: "All N signers register x-only pubkeys with coordinator (e.g., QuorumClaw).",
        tapscriptPattern: "<pubkey1> OP_CHECKSIG <pubkey2> OP_CHECKSIGADD ... <M> OP_NUMEQUAL",
      },
      {
        step: 3,
        title: "Sign the Sighash",
        command: "arc skills run --name wallet -- schnorr-sign-digest --digest <sighash_hex> --confirm-blind-sign",
        note: "Uses BIP-86 internal key. Matches the internalPubKey from step 1.",
      },
      {
        step: 4,
        title: "Verify Co-Signers (Recommended)",
        command: "arc skills run --name taproot-multisig -- verify-cosig --digest <hex> --signature <hex> --public-key <hex>",
        note: "Repeat for each co-signer.",
      },
      {
        step: 5,
        title: "Broadcast",
        description: "Coordinator assembles witness stack and broadcasts.",
        witnessStackFormat: "<sig_1> <sig_2> ... <sig_M> <tapscript> <control_block>",
      },
    ],
    criticalGotcha: {
      title: "BIP-86 Internal Key vs Tweaked Key",
      recommendation: "Register internalPubKey. Sign with schnorr-sign-digest. They match. Done.",
    },
    mOfNThresholds: {
      "2-of-2": "Bilateral custody — both must agree",
      "2-of-3": "Resilient — one signer offline/compromised",
      "3-of-5": "DAO governance — majority coalition",
      "N-of-N": "Maximum security — all signers required",
    },
  }));
}

function printUsage(): void {
  process.stdout.write(`taproot-multisig CLI

USAGE
  arc skills run --name taproot-multisig -- <subcommand> [flags]

SUBCOMMANDS
  get-pubkey
    Get x-only Taproot internal public key for multisig registration.
    Auto-unlocks and locks wallet.

  verify-cosig --digest <hex> --signature <hex> --public-key <hex>
    Verify a BIP-340 Schnorr signature from a co-signer.
    No wallet unlock needed.

  guide
    Print complete step-by-step multisig workflow as JSON.

EXAMPLES
  arc skills run --name taproot-multisig -- get-pubkey
  arc skills run --name taproot-multisig -- verify-cosig --digest abc... --signature def... --public-key 012...
  arc skills run --name taproot-multisig -- guide
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "get-pubkey":
      await cmdGetPubkey();
      break;
    case "verify-cosig":
      await cmdVerifyCosig(args.slice(1));
      break;
    case "guide":
      cmdGuide();
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
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
