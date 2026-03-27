#!/usr/bin/env bun
// skills/nonce-manager/cli.ts
// CLI wrapper for the nonce oracle. Cross-process nonce coordination.

import { acquireNonce, releaseNonce, syncNonce, getStatus, type FailureKind } from "./nonce-store.js";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

try {
  switch (command) {
    case "acquire": {
      const address = flags.address;
      if (!address) {
        console.log(JSON.stringify({ error: "Missing --address" }));
        process.exit(1);
      }
      const result = await acquireNonce(address);
      console.log(JSON.stringify(result));
      break;
    }

    case "release": {
      const address = flags.address;
      const nonceStr = flags.nonce;
      if (!address || !nonceStr) {
        console.log(JSON.stringify({ error: "Missing --address and/or --nonce" }));
        process.exit(1);
      }
      const nonce = parseInt(nonceStr, 10);
      // Check for bare flags: --success, --failed, --rejected, --broadcast
      const rawArgs = rest;
      const success = rawArgs.includes("--success");
      const failed = rawArgs.includes("--failed");
      const isSuccess = success || !failed; // default to success if neither specified
      // Failure kind: --rejected = nonce reusable, --broadcast = nonce consumed (default)
      const failureKind: FailureKind | undefined = !isSuccess
        ? (rawArgs.includes("--rejected") ? "rejected" : "broadcast")
        : undefined;
      const result = await releaseNonce(address, nonce, isSuccess, failureKind);
      console.log(JSON.stringify(result));
      break;
    }

    case "sync": {
      const address = flags.address;
      if (!address) {
        console.log(JSON.stringify({ error: "Missing --address" }));
        process.exit(1);
      }
      const result = await syncNonce(address);
      console.log(JSON.stringify(result));
      break;
    }

    case "status": {
      const address = flags.address;
      const result = getStatus(address);
      console.log(JSON.stringify(result ?? {}, null, 2));
      break;
    }

    default:
      console.log(JSON.stringify({
        error: `Unknown command: ${command ?? "(none)"}`,
        usage: "acquire | release | sync | status",
      }));
      process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
}
