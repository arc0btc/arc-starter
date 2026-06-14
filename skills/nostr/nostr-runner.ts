#!/usr/bin/env bun
// skills/nostr/nostr-runner.ts
// Internal runner that unlocks the wallet and posts a kind:1 Nostr note in the
// SAME process — the wallet-manager singleton holds unlock state in memory, so
// unlock + derive + sign must share a process (same constraint as sign-runner).
//
// Mirrors github/aibtcdev/skills/nostr/nostr.ts `post` (NIP-06 key at
// m/44'/1237'/0'/0/0), but awaits the relay publish properly instead of racing a
// fixed timeout (network op). Bun provides a native globalThis.WebSocket, so no
// `ws` polyfill is needed.
//
// Usage (called by cli.ts, not directly):
//   WALLET_ID=... WALLET_PASSWORD=... bun skills/nostr/nostr-runner.ts --content "<text>" [--tags a,b]
// Output: a single JSON line { success, eventId, pubkey, npub, relays }.

import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
// Resolve nostr-tools from the aibtc-mcp-server's install — the SAME proven set the
// MCP `nostr_post` uses (nostr-tools 2.23.3 + nested @noble/hashes 2.x). The repo-root
// nostr-tools resolves the stale hoisted @noble/hashes 1.1.5 (no sha2.js) and breaks.
// Deep file paths (not subpath exports) so bun doesn't re-resolve to the broken root.
// (Carry-forward: vendor a dedicated skills/nostr install to drop this coupling.)
// Type decls are absent at the vendored path; runtime is verified live (pubkey/post).
// @ts-expect-error vendored path has no .d.ts
import { finalizeEvent, getPublicKey, type EventTemplate } from "../../github/aibtcdev/aibtc-mcp-server/node_modules/nostr-tools/lib/esm/pure.js";
// @ts-expect-error vendored path has no .d.ts
import * as nip19 from "../../github/aibtcdev/aibtc-mcp-server/node_modules/nostr-tools/lib/esm/nip19.js";
// @ts-expect-error vendored path has no .d.ts
import { SimplePool } from "../../github/aibtcdev/aibtc-mcp-server/node_modules/nostr-tools/lib/esm/pool.js";

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];
const WS_TIMEOUT_MS = 10_000;

function out(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const walletId = process.env.WALLET_ID;
const walletPassword = process.env.WALLET_PASSWORD;
if (!walletId || !walletPassword) {
  out({ success: false, error: "WALLET_ID and WALLET_PASSWORD env vars required" });
  process.exit(1);
}

const mode = process.argv[2]; // "post" | "pubkey"
const content = flag("content");
const tagsCsv = flag("tags");

const wm = getWalletManager();
try {
  await wm.unlock(walletId, walletPassword);
} catch (err) {
  out({ success: false, error: "Unlock failed", detail: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

let exitCode = 0;
try {
  const account = wm.getActiveAccount();
  if (!account || !account.nostrPrivateKey) {
    throw new Error("NIP-06 Nostr private key not available in current session");
  }
  const sk = account.nostrPrivateKey as Uint8Array;
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);

  if (mode === "pubkey") {
    out({ success: true, pubkey, npub, derivationPath: "m/44'/1237'/0'/0/0" });
  } else if (mode === "post") {
    if (!content) throw new Error("--content is required for post");

    const tags: string[][] = [];
    if (tagsCsv) for (const t of tagsCsv.split(",")) tags.push(["t", t.trim().toLowerCase()]);

    const template: EventTemplate = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    };
    const event = finalizeEvent(template, sk);

    const pool = new SimplePool(); // Bun-native globalThis.WebSocket
    const results: Record<string, string> = {};
    await Promise.allSettled(
      DEFAULT_RELAYS.map(async (relay) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS);
          });
          await Promise.race([...pool.publish([relay], event), timeout]);
          results[relay] = "ok";
        } catch (err) {
          results[relay] = `error: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
    );
    pool.close(DEFAULT_RELAYS);

    const anyOk = Object.values(results).some((r) => r === "ok");
    out({ success: anyOk, eventId: event.id, pubkey, npub, relays: results });
    exitCode = anyOk ? 0 : 1;
  } else {
    throw new Error(`unknown runner mode '${mode}' (expected post|pubkey)`);
  }
} catch (err) {
  out({ success: false, error: err instanceof Error ? err.message : String(err) });
  exitCode = 1;
} finally {
  // Always relock the in-memory wallet singleton — covers success, pubkey,
  // validation throw, publish error, and a throw during cleanup (cairn finding).
  wm.lock();
}
process.exit(exitCode);
