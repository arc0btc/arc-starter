#!/usr/bin/env bun
// skills/defi-zest/tx-runner.ts
// Internal runner that unlocks the wallet and runs a Zest command in the
// same process. The wallet manager singleton holds unlock state in memory,
// so unlock + tx must share a process.
//
// Nonce serialization: acquires a nonce from the shared nonce-tracker before
// running the defi command, then injects it via --nonce so all Zest write ops
// coordinate with STX sends (stx-send-runner) through the same file-locked
// nonce state at ~/.aibtc/nonce-state.json.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/defi-zest/tx-runner.ts zest-supply --asset sBTC --amount 8200

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { acquireNonce, syncNonce } from "../../github/aibtcdev/skills/src/lib/services/nonce-tracker.js";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

// Unlock wallet manager singleton
const wm = getWalletManager();

try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Unlock failed", detail: msg }));
  process.exit(1);
}

// Determine if this is a write command that broadcasts an STX transaction.
// Read-only commands (zest-get-position, zest-list-assets, etc.) skip nonce acquisition.
const WRITE_COMMANDS = new Set([
  "zest-supply", "zest-withdraw", "zest-borrow", "zest-repay", "zest-claim-rewards",
  "alex-run-swap",
]);
const command = process.argv[2];
const isWriteCommand = command !== undefined && WRITE_COMMANDS.has(command);

// Contract pre-flight: simulate sBTC balance before nonce acquisition for supply ops.
// Fail-open: stxer unreachable or timeout → log warning and proceed (do not block the tx).
// Only runs for zest-supply with sBTC — the highest-value check for Zest write ops.
if (isWriteCommand && command === "zest-supply") {
  const rawArgs = process.argv.slice(3);
  const assetIdx = rawArgs.indexOf("--asset");
  const amountIdx = rawArgs.indexOf("--amount");
  const asset = assetIdx >= 0 ? rawArgs[assetIdx + 1] : undefined;
  const supplyAmount = amountIdx >= 0 ? parseInt(rawArgs[amountIdx + 1] ?? "", 10) : NaN;

  if (asset?.toLowerCase() === "sbtc" && !isNaN(supplyAmount)) {
    const ARC_SENDER = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
    const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
    const STXER_SIMS = "https://api.stxer.xyz/devtools/v2/simulations";
    const expression = "(contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance tx-sender)";

    try {
      const ctrl = new AbortController();
      const preflightTimer = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const sessionResp = await fetch(STXER_SIMS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skip_tracing: true }),
          signal: ctrl.signal,
        });
        if (!sessionResp.ok) throw new Error(`session create: ${sessionResp.status}`);
        const { id: sessionId } = await sessionResp.json() as { id: string };

        const simResp = await fetch(`${STXER_SIMS}/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ steps: [{ Eval: [ARC_SENDER, "", SBTC_CONTRACT, expression] }] }),
          signal: ctrl.signal,
        });
        if (!simResp.ok) throw new Error(`simulation: ${simResp.status}`);

        const simData = await simResp.json() as { steps: Array<{ Eval: { Ok?: string; Err?: string } }> };
        const step = simData.steps[0]?.Eval;

        if (step?.Ok && step.Ok.startsWith("0701")) {
          // (ok uint N): hex = "07"(ok) + "01"(uint) + 32-char big-endian uint value
          const balance = BigInt("0x" + step.Ok.substring(4));
          const decoded = `(ok uint ${balance})`;
          const safeToBroadcast = balance >= BigInt(supplyAmount);
          console.error(`[preflight] session=${sessionId} decoded=${decoded} safe_to_broadcast=${safeToBroadcast}`);
          if (!safeToBroadcast) {
            console.log(JSON.stringify({
              success: false,
              error: `Pre-flight blocked: insufficient sBTC balance. Have ${balance} sats, need ${supplyAmount} sats. No nonce consumed.`,
              preflight: { session_id: sessionId, decoded, safe_to_broadcast: false },
            }));
            wm.lock();
            process.exit(1);
          }
        } else if (step?.Ok?.startsWith("08")) {
          // (err ...) — contract call failed
          const decoded = `(err ${step.Ok.substring(4)})`;
          console.error(`[preflight] session=${sessionId} decoded=${decoded} safe_to_broadcast=false`);
          console.log(JSON.stringify({
            success: false,
            error: `Pre-flight blocked: sBTC balance check returned error. ${decoded}`,
            preflight: { session_id: sessionId, decoded, safe_to_broadcast: false },
          }));
          wm.lock();
          process.exit(1);
        } else if (step?.Err) {
          console.error(`[preflight] session=${sessionId} runtime_error=${step.Err} safe_to_broadcast=false`);
          console.log(JSON.stringify({
            success: false,
            error: `Pre-flight blocked: simulation runtime error. ${step.Err}`,
            preflight: { session_id: sessionId, decoded: step.Err, safe_to_broadcast: false },
          }));
          wm.lock();
          process.exit(1);
        } else {
          console.error(`[preflight] session=${sessionId} unexpected response format — proceeding`);
        }
      } finally {
        clearTimeout(preflightTimer);
      }
    } catch (prefErr) {
      // Fail-open: stxer unreachable, timeout, or parse error
      console.error(`[preflight] skipped (fail-open): ${prefErr instanceof Error ? prefErr.message : String(prefErr)}`);
    }
  }
}

// Mempool depth guard: refuse to submit if too many pending txs are already
// in the mempool for this sender. Prevents TooMuchChaining (Stacks limit ~25).
const MEMPOOL_DEPTH_LIMIT = 20;
const HIRO_API = "https://api.mainnet.hiro.so";

if (isWriteCommand) {
  try {
    const account = wm.getAccount() as Account;
    const mempoolResp = await fetch(
      `${HIRO_API}/extended/v1/tx/mempool?sender_address=${account.address}&limit=1`,
    );
    if (mempoolResp.ok) {
      const mempoolData = await mempoolResp.json() as { total: number };
      if (mempoolData.total >= MEMPOOL_DEPTH_LIMIT) {
        console.log(JSON.stringify({
          success: false,
          error: `Mempool depth ${mempoolData.total} >= limit ${MEMPOOL_DEPTH_LIMIT}. Skipping Zest tx to avoid TooMuchChaining. Retry after mempool clears.`,
        }));
        wm.lock();
        process.exit(1);
      }
    }
  } catch {
    // Best-effort check — proceed if Hiro API is unreachable
  }
}

// Acquire nonce before running the defi command so all STX-sending paths
// coordinate through the shared nonce-tracker file lock.
let acquiredNonce: number | undefined;
if (isWriteCommand) {
  try {
    const account = wm.getAccount() as Account;
    const acquired = await acquireNonce(account.address);
    acquiredNonce = acquired.nonce;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ success: false, error: "Nonce acquisition failed", detail: msg }));
    wm.lock();
    process.exit(1);
  }
}

// Override process.argv so Commander in defi.ts sees our args.
// Append --nonce so the Zest command passes it through to callContract.
const txArgs = process.argv.slice(2);
if (acquiredNonce !== undefined) {
  txArgs.push("--nonce", acquiredNonce.toString());
}
process.argv = ["bun", "defi.ts", ...txArgs];

// Monkey-patch Commander's parse() to use parseAsync()
const { Command } = await import("../../github/aibtcdev/skills/node_modules/commander/index.js");
let parseResult: Promise<unknown> | null = null;
const origParse = Command.prototype.parse;
Command.prototype.parse = function (this: InstanceType<typeof Command>, ...args: unknown[]) {
  parseResult = this.parseAsync(...(args as [string[]?, object?]));
  return this;
};

try {
  await import("../../github/aibtcdev/skills/defi/defi.ts");
  if (parseResult) {
    await parseResult;
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "Zest command failed", detail: msg }));
  // Sync nonce-tracker from Hiro on failure: we don't know if the tx was
  // broadcast before the error, so a fresh sync is safer than guessing.
  if (acquiredNonce !== undefined) {
    try {
      const account = wm.getAccount() as Account;
      await syncNonce(account.address);
    } catch {
      // Best effort — nonce-tracker auto-recovers after STALE_NONCE_MS (90s)
    }
  }
  wm.lock();
  process.exit(1);
} finally {
  Command.prototype.parse = origParse;
}

wm.lock();
process.exit(0);
