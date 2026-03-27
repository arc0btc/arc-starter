---
name: nonce-manager
description: "Cross-task Stacks nonce oracle — atomic acquire/release prevents mempool collisions across skills"
metadata:
  author: "rising-leviathan"
  author-agent: "Loom"
  user-invocable: "false"
  arguments: "acquire | release | sync | status"
  entry: "skills/nonce-manager/cli.ts"
  requires: ""
  tags: "infrastructure, l2"
---

# Nonce Manager

Centralized nonce oracle for all Stacks blockchain transactions. Prevents mempool collisions when multiple skills (classifieds, inbox-notify, brief-payout) send transactions concurrently or in rapid succession.

## Problem

Each skill independently fetches nonce from Hiro API. When tasks fire back-to-back (before mempool clears), they grab the same nonce and collide with `SENDER_NONCE_STALE` or `SENDER_NONCE_DUPLICATE` errors.

## Solution

Single file-locked nonce state at `db/nonce-state.json`. Skills call `acquire` to get the next nonce (atomically incremented), and `release` after the transaction confirms or fails. If state is stale (>5 min), auto-resyncs from Hiro.

## CLI

```
arc skills run --name nonce-manager -- acquire --address SP...
arc skills run --name nonce-manager -- release --address SP... --nonce 42 [--success] [--failed]
arc skills run --name nonce-manager -- sync --address SP...
arc skills run --name nonce-manager -- status [--address SP...]
```

### acquire

Returns the next nonce for the given address. Atomically increments the stored value. Auto-syncs from Hiro if state is missing or stale (>5 min).

**Output:** `{"nonce": 42, "address": "SP...", "source": "local|hiro"}`

### release

Marks a nonce as confirmed (`--success`) or failed (`--failed`). On failure, if the released nonce equals the current stored nonce minus 1, rolls back to allow reuse.

### sync

Force re-seeds nonce state from Hiro API. Use after manual intervention or mempool clearance.

**Output:** `{"nonce": 42, "address": "SP...", "mempoolPending": 3, "lastExecuted": 41}`

### status

Shows current nonce state for one or all tracked addresses.

## Library Import

Skills running in-process can import directly for lower overhead:

```typescript
import { acquireNonce, releaseNonce, syncNonce } from "../nonce-manager/nonce-store.js";

const nonce = await acquireNonce("SP...");
// ... send transaction ...
await releaseNonce("SP...", nonce, true); // true = success
```

## Environment Variable Override

When `X402_SENDER_NONCE` is set, the x402 payment interceptor uses it instead of fetching from Hiro. This allows classifieds and other x402 consumers to pass managed nonces without modifying upstream code.

## Nonce Strategy

1. **Acquire before send** — always get nonce from manager, never from Hiro directly
2. **Release after confirm/fail** — keeps state accurate for next caller
3. **Auto-sync on stale** — if last sync >5 min ago, re-fetch from Hiro before returning
4. **File lock for atomicity** — mkdir-based lock prevents concurrent reads returning same nonce
5. **Retry on lock contention** — up to 3 retries with 500ms backoff
