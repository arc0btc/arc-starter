#!/usr/bin/env bun
// skills/bitcoin-wallet/stx-send-runner.ts
// Internal runner that unlocks the wallet and sends STX in the same process.
// The wallet manager singleton holds unlock state in memory, so unlock + send
// must share a process.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/bitcoin-wallet/stx-send-runner.ts --recipient SP... --amount-stx 2 [--memo "text"]

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import { transferStx } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";
import type { Account } from "../../github/aibtcdev/skills/src/lib/transactions/builder.js";
import { acquireNonce, releaseNonce } from "../../github/aibtcdev/skills/src/lib/services/nonce-tracker.js";
import { validateStacksAddress } from "../../github/aibtcdev/skills/node_modules/@stacks/transactions/dist/esm/utils.js";

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;

if (!walletId || !walletPassword) {
  console.log(JSON.stringify({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" }));
  process.exit(1);
}

// Parse flags
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

const flags = parseFlags(process.argv.slice(2));

if (!flags.recipient || !flags["amount-stx"]) {
  console.log(JSON.stringify({ success: false, error: "Missing required flags: --recipient and --amount-stx" }));
  process.exit(1);
}

const recipient = flags.recipient;
const amountStx = parseFloat(flags["amount-stx"]);

if (isNaN(amountStx) || amountStx <= 0) {
  console.log(JSON.stringify({ success: false, error: `Invalid amount: ${flags["amount-stx"]}. Must be a positive number.` }));
  process.exit(1);
}

// Validate recipient address via c32check — catches bad checksums and non-Stacks strings.
// Also guard against contract principals (contain '.') since makeSTXTokenTransfer expects a standard principal.
if (!validateStacksAddress(recipient) || recipient.includes(".")) {
  console.log(JSON.stringify({
    success: false,
    error: `Invalid recipient address: '${recipient}' failed Stacks address validation (c32check). Must be a standard SP/ST principal (no contract suffix).`,
  }));
  process.exit(1);
}

// Validate mainnet address format: SP + exactly 39 c32 chars (41 chars total).
// validateStacksAddress accepts testnet (ST) and mocknet (SM) addresses, but Hiro's mainnet
// broadcast API rejects them with "params/principal must match pattern" (HTTP 400).
// c32 alphabet: 0-9 A-H J K M N P-T V-Z (excludes I L O U).
const STX_MAINNET_REGEX = /^SP[0-9A-HJKMNP-TV-Z]{39}$/;
if (!STX_MAINNET_REGEX.test(recipient)) {
  console.log(JSON.stringify({
    success: false,
    error: `Invalid recipient address: '${recipient}' is not a valid Stacks mainnet address (must be SP + 39 c32 chars). Hiro mainnet API rejects non-mainnet addresses.`,
  }));
  process.exit(1);
}

// Convert STX to micro-STX (1 STX = 1,000,000 micro-STX)
const amountMicroStx = BigInt(Math.round(amountStx * 1_000_000));

const memo = flags.memo || "";

// Optional explicit nonce (for filling nonce gaps)
let explicitNonce: bigint | undefined;
if (flags.nonce !== undefined) {
  const parsed = parseInt(flags.nonce, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.log(JSON.stringify({ success: false, error: `Invalid nonce: ${flags.nonce}. Must be a non-negative integer.` }));
    process.exit(1);
  }
  explicitNonce = BigInt(parsed);
}

// Optional explicit fee in micro-STX (for RBF replacements)
let explicitFee: bigint | undefined;
if (flags.fee !== undefined) {
  const parsed = parseInt(flags.fee, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.log(JSON.stringify({ success: false, error: `Invalid fee: ${flags.fee}. Must be a positive integer (micro-STX).` }));
    process.exit(1);
  }
  explicitFee = BigInt(parsed);
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

try {
  const account = wm.getAccount() as Account;

  // Contract pre-flight: check available STX balance before nonce acquisition.
  // Fail-open: stxer unreachable or timeout → log warning and proceed.
  // Skip when caller provides an explicit nonce (gap-fill / RBF flows assume balance is sufficient).
  if (explicitNonce === undefined) {
    const SBTC_CTX = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
    const STXER_SIMS = "https://api.stxer.xyz/devtools/v2/simulations";
    const balanceExpr = "(stx-get-balance tx-sender)";
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
          body: JSON.stringify({ steps: [{ Eval: [account.stxAddress, "", SBTC_CTX, balanceExpr] }] }),
          signal: ctrl.signal,
        });
        if (!simResp.ok) throw new Error(`simulation: ${simResp.status}`);

        const simData = await simResp.json() as { steps: Array<{ Eval: { Ok?: string; Err?: string } }> };
        const step = simData.steps[0]?.Eval;

        if (step?.Ok && step.Ok.startsWith("01")) {
          // stx-get-balance returns raw uint (no ok wrapper): hex = "01" + 32-char big-endian value
          const balanceMicroStx = BigInt("0x" + step.Ok.substring(2));
          const safeToBroadcast = balanceMicroStx >= amountMicroStx;
          console.error(`[preflight] session=${sessionId} stx_balance=${balanceMicroStx} needed=${amountMicroStx} safe_to_broadcast=${safeToBroadcast}`);
          if (!safeToBroadcast) {
            console.log(JSON.stringify({
              success: false,
              error: `Pre-flight blocked: insufficient STX balance. Have ${balanceMicroStx} uSTX (${Number(balanceMicroStx) / 1_000_000} STX), need ${amountMicroStx} uSTX. No nonce consumed.`,
              preflight: { session_id: sessionId, safe_to_broadcast: false },
            }));
            wm.lock();
            process.exit(1);
          }
        } else {
          console.error(`[preflight] session=${sessionId} unexpected stx-get-balance response — proceeding`);
        }
      } finally {
        clearTimeout(preflightTimer);
      }
    } catch (prefErr) {
      // Fail-open: stxer unreachable, timeout, or parse error
      console.error(`[preflight] skipped (fail-open): ${prefErr instanceof Error ? prefErr.message : String(prefErr)}`);
    }
  }

  // Use nonce-tracker to serialise concurrent STX sends across dispatch cycles.
  // Skip when caller provides an explicit nonce (gap-fill / RBF flows).
  let nonce = explicitNonce;
  let trackedNonce: number | undefined;
  if (nonce === undefined) {
    const acquired = await acquireNonce(account.stxAddress);
    trackedNonce = acquired.nonce;
    nonce = BigInt(acquired.nonce);
  }

  try {
    const result = await transferStx(account, recipient, amountMicroStx, memo, explicitFee, nonce);

    if (trackedNonce !== undefined) {
      await releaseNonce(account.stxAddress, trackedNonce, true, undefined, result.txid);
    }

    console.log(JSON.stringify({
      success: true,
      txid: result.txid,
      recipient,
      amount_stx: amountStx,
      amount_micro_stx: amountMicroStx.toString(),
      memo: memo || undefined,
      nonce: nonce.toString(),
      explorer: `https://explorer.hiro.so/txid/${result.txid}?chain=mainnet`,
    }));
  } catch (txErr) {
    if (trackedNonce !== undefined) {
      // Treat as broadcast (conservative): do not roll back the nonce counter.
      // The nonce-tracker auto-syncs from Hiro after 90s if the conflict turns
      // out to be a false alarm; in the meantime we avoid re-using a nonce that
      // may already be in the mempool from a prior tx.
      await releaseNonce(account.stxAddress, trackedNonce, false, "broadcast");
    }
    const msg = txErr instanceof Error ? txErr.message : String(txErr);
    console.log(JSON.stringify({ success: false, error: "STX transfer failed", detail: msg }));
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ success: false, error: "STX transfer failed", detail: msg }));
} finally {
  wm.lock();
  process.exit(0);
}
