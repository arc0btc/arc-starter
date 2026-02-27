#!/usr/bin/env bun
// skills/wallet/cli.ts
// Unified CLI for wallet management and signing.
// Usage: arc skills run --name wallet -- <subcommand> [flags]
//
// The upstream wallet manager holds unlock state in memory (singleton).
// Signing requires unlock + sign in the same process. For operations that
// need an unlocked wallet, we import the wallet manager directly instead
// of spawning separate subprocesses.

import { getCredential } from "../../src/credentials.ts";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const WALLET_SCRIPT = resolve(ROOT, "wallet/wallet.ts");
const SIGNING_SCRIPT = resolve(ROOT, "signing/signing.ts");
const SIGN_RUNNER = resolve(import.meta.dir, "sign-runner.ts");

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [wallet/cli] ${msg}`);
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

/**
 * Run an upstream script as a subprocess. Used only for read-only commands
 * that don't need wallet unlock state (info, status, btc-verify, lock).
 */
async function runScript(script: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Run an upstream script that may hang (e.g. wallet unlock keeps a timer alive).
 * Reads stdout until a complete JSON object is received, then kills the process.
 */
async function runScriptWithTimeout(script: string, args: string[], timeoutMs: number = 15000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  let stdout = "";
  let stderr = "";

  const stderrPromise = new Response(proc.stderr).text().then((t) => { stderr = t; });

  // Read stdout incrementally, kill process once we have a complete JSON response
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  const readWithTimeout = new Promise<string>(async (resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for response"));
    }, timeoutMs);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });

        // Check if we have a complete JSON object
        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            JSON.parse(trimmed);
            clearTimeout(timer);
            proc.kill();
            resolve(trimmed);
            return;
          } catch {
            // Incomplete JSON, keep reading
          }
        }
      }
      clearTimeout(timer);
      resolve(stdout.trim());
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });

  const result = await readWithTimeout;
  await stderrPromise.catch(() => {});
  return { stdout: result, stderr: stderr.trim(), exitCode: 0 };
}

async function getWalletPassword(): Promise<string> {
  const password = await getCredential("wallet", "password");
  if (!password) {
    console.log(JSON.stringify({ success: false, error: "Wallet password not found in credential store (wallet/password)" }));
    process.exit(1);
  }
  return password;
}

async function getWalletId(): Promise<string> {
  const id = await getCredential("wallet", "id");
  if (!id) {
    console.log(JSON.stringify({ success: false, error: "Wallet ID not found in credential store (wallet/id)" }));
    process.exit(1);
  }
  return id;
}

/**
 * Run a signing command via the sign-runner, which handles unlock + sign + lock
 * in a single process (required because wallet manager session is in-memory).
 */
async function runSigning(signingArgs: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const password = await getWalletPassword();
  const walletId = await getWalletId();

  const proc = Bun.spawn(["bun", "run", SIGN_RUNNER, ...signingArgs], {
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
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ---- Subcommands ----

async function cmdUnlock(): Promise<void> {
  const password = await getWalletPassword();
  log("unlocking wallet (verification)");

  // Unlock hangs due to auto-lock timer — use timeout approach
  try {
    const result = await runScriptWithTimeout(WALLET_SCRIPT, ["unlock", "--password", password]);
    console.log(result.stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`unlock failed: ${msg}`);
    console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
    process.exit(1);
  }
}

async function cmdLock(): Promise<void> {
  log("locking wallet");
  const result = await runScript(WALLET_SCRIPT, ["lock"]);

  if (result.exitCode !== 0) {
    log(`lock failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "Lock failed", detail: result.stderr }));
    process.exit(1);
  }

  console.log(result.stdout);
}

async function cmdInfo(): Promise<void> {
  const result = await runScript(WALLET_SCRIPT, ["info"]);

  if (result.exitCode !== 0) {
    log(`info failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "Info failed", detail: result.stderr }));
    process.exit(1);
  }

  console.log(result.stdout);
}

async function cmdStatus(): Promise<void> {
  const result = await runScript(WALLET_SCRIPT, ["status"]);

  if (result.exitCode !== 0) {
    log(`status failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "Status failed", detail: result.stderr }));
    process.exit(1);
  }

  console.log(result.stdout);
}

async function cmdBtcSign(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.message) {
    process.stderr.write("Usage: arc skills run --name wallet -- btc-sign --message \"text\" [--auto-lock]\n");
    process.exit(1);
  }

  log("signing BTC message (auto unlock/lock)");
  const result = await runSigning(["btc-sign", "--message", flags.message]);

  if (result.exitCode !== 0) {
    log(`btc-sign failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "BTC sign failed", detail: result.stderr || result.stdout }));
    process.exit(1);
  }

  console.log(result.stdout);
}

async function cmdStacksSign(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.message) {
    process.stderr.write("Usage: arc skills run --name wallet -- stacks-sign --message \"text\" [--auto-lock]\n");
    process.exit(1);
  }

  log("signing Stacks message (auto unlock/lock)");
  const result = await runSigning(["stacks-sign", "--message", flags.message]);

  if (result.exitCode !== 0) {
    log(`stacks-sign failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "Stacks sign failed", detail: result.stderr || result.stdout }));
    process.exit(1);
  }

  console.log(result.stdout);
}

async function cmdBtcVerify(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.message || !flags.signature) {
    process.stderr.write("Usage: arc skills run --name wallet -- btc-verify --message \"text\" --signature \"sig\" [--expected-signer \"addr\"]\n");
    process.exit(1);
  }

  const scriptArgs = ["btc-verify", "--message", flags.message, "--signature", flags.signature];
  if (flags["expected-signer"]) {
    scriptArgs.push("--expected-signer", flags["expected-signer"]);
  }

  const result = await runScript(SIGNING_SCRIPT, scriptArgs);

  if (result.exitCode !== 0) {
    log(`btc-verify failed: ${result.stderr}`);
    console.log(JSON.stringify({ success: false, error: "BTC verify failed", detail: result.stderr }));
    process.exit(1);
  }

  console.log(result.stdout);
}

function printUsage(): void {
  process.stdout.write(`wallet CLI

USAGE
  arc skills run --name wallet -- <subcommand> [flags]

SUBCOMMANDS
  unlock
    Unlock the wallet using password from Arc credential store.

  lock
    Lock the wallet, clearing key material from memory.

  info
    Show wallet addresses and network (no unlock needed).

  status
    Show wallet readiness state (no unlock needed).

  btc-sign --message "text" [--auto-lock]
    Sign a Bitcoin message (BIP-137/BIP-322). Auto-unlocks and locks.

  stacks-sign --message "text" [--auto-lock]
    Sign a Stacks message. Auto-unlocks and locks.

  btc-verify --message "text" --signature "sig" [--expected-signer "addr"]
    Verify a Bitcoin signature (no unlock needed).

EXAMPLES
  arc skills run --name wallet -- info
  arc skills run --name wallet -- unlock
  arc skills run --name wallet -- btc-sign --message "Hello"
  arc skills run --name wallet -- btc-verify --message "Hello" --signature "abc..." --expected-signer "bc1q..."
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "unlock":
      await cmdUnlock();
      break;
    case "lock":
      await cmdLock();
      break;
    case "info":
      await cmdInfo();
      break;
    case "status":
      await cmdStatus();
      break;
    case "btc-sign":
      await cmdBtcSign(args.slice(1));
      break;
    case "stacks-sign":
      await cmdStacksSign(args.slice(1));
      break;
    case "btc-verify":
      await cmdBtcVerify(args.slice(1));
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
