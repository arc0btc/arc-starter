#!/usr/bin/env bun
// skills/bitcoin-wallet/balance-runner.ts
// Query Stacks API for STX balance of a given address.
// No wallet unlock required — read-only operation.
//
// Usage (called by cli.ts, not directly):
//   bun skills/bitcoin-wallet/balance-runner.ts --address SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B

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

if (!flags.address) {
  console.log(JSON.stringify({ success: false, error: "Missing required flag: --address" }));
  process.exit(1);
}

const address = flags.address;

// Validate address format (basic check for Stacks addresses)
if (!address.startsWith("SP") && !address.startsWith("ST")) {
  console.log(JSON.stringify({ success: false, error: `Invalid address: must start with SP (mainnet) or ST (testnet)` }));
  process.exit(1);
}

// Query Stacks API for account balance
try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const response = await fetch(
    `https://api.mainnet.hiro.so/extended/v1/address/${address}/balances`,
    { signal: controller.signal }
  );

  clearTimeout(timeout);

  if (!response.ok) {
    console.log(JSON.stringify({
      success: false,
      error: `API error: HTTP ${response.status} ${response.statusText}`,
      address,
    }));
    process.exit(1);
  }

  interface StxBalance {
    balance: string;
    locked: string;
    unlock_height?: number;
    lock_height?: number;
  }

  interface StacksApiResponse {
    stx: StxBalance;
    fungible_tokens?: Record<string, unknown>;
    non_fungible_tokens?: Record<string, unknown>;
  }

  const data = (await response.json()) as StacksApiResponse;
  const stxData = data.stx;

  // Convert micro-STX to STX (1 STX = 1,000,000 micro-STX)
  const balanceMicroStx = BigInt(stxData.balance);
  const lockedMicroStx = BigInt(stxData.locked || "0");
  const availableMicroStx = balanceMicroStx - lockedMicroStx;

  const balanceStx = Number(balanceMicroStx) / 1_000_000;
  const lockedStx = Number(lockedMicroStx) / 1_000_000;
  const availableStx = Number(availableMicroStx) / 1_000_000;

  console.log(JSON.stringify({
    success: true,
    address,
    balance_stx: balanceStx,
    balance_micro_stx: stxData.balance,
    locked_stx: lockedStx,
    locked_micro_stx: stxData.locked || "0",
    available_stx: availableStx,
    available_micro_stx: availableMicroStx.toString(),
    lock_height: stxData.lock_height ?? 0,
  }));
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({
    success: false,
    error: "Balance query failed",
    detail: msg,
    address,
  }));
  process.exit(1);
}
