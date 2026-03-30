# Nonce Strategy Alignment Plan

Aligning Arc's on-chain transaction infrastructure with the x402-sponsor-relay's nonce management patterns. Arc signs with its own key and manages its own sender nonces. The relay manages sponsor nonces independently — if Arc clears its own account, the relay self-heals via its alarm reconciliation.

**Date:** 2026-03-29
**Repos:**
- `arc-starter` (Arc agent) — `/home/dev/arc-starter`
- `@aibtc/skills` (upstream shared library) — `/home/dev/arc-starter/github/aibtcdev/skills`
- `x402-sponsor-relay` (reference) — `/home/dev/arc-starter/github/aibtcdev/x402-sponsor-relay`

---

## Problem

Arc has 3 transaction paths with inconsistent nonce management:

| Path | Used By | Nonce Strategy | Broadcast | Issues |
|------|---------|---------------|-----------|--------|
| `x402-retry.ts` (inbox) | x402-runner | nonce-tracker (deprecated compat API) | Landing page relay | Uses `getTrackedNonce`/`recordNonceUsed` instead of `acquireNonce`/`releaseNonce` |
| `sponsor-builder.ts` (sponsored) | identity `--sponsored`, reputation `--sponsored` | None — @stacks/transactions auto-fetch | Relay `/sponsor` | No nonce-tracker, no retry logic, concurrent txs race on same nonce |
| `builder.ts` (direct) | identity, reputation, STX send | None — @stacks/transactions auto-fetch | Direct Hiro | No nonce-tracker, no retry, no self-healing |

---

## Goals

1. All write txs use `nonce-tracker.ts` acquire/release for sender nonces
2. All write txs prefer relay `/sponsor` (sponsored) by default, direct Hiro as fallback
3. `sponsor-builder.ts` gets retry logic mirroring `x402-retry.ts` patterns
4. Self-transfer RBF for stuck sender nonces (clear Arc's own account so relay sponsor self-heals)

---

## Phase 1 — Core Infrastructure (upstream `skills/src/lib/`)

All additive, no breaking changes to existing function signatures.

### 1a. New `transactions/retry-strategy.ts`

Shared error classification engine for all transaction paths.

- `classifyRelayError(status, body: SponsorRelayResponse, retryAfterHeader?)` — handles `/sponsor` error codes:
  - `NONCE_CONFLICT` (409, retryAfter: 30s) — relay sponsor nonce collision, resubmit same tx
  - `BROADCAST_FAILED` (502, retryAfter: 5s) — relay sponsored but Hiro rejected broadcast
  - `NONCE_DO_UNAVAILABLE` (503, retryAfter: 3s) — transient relay infra issue
  - `SPONSOR_FAILED` (500) — relay couldn't sign sponsorship
  - Rate limits (429)
- `classifyBroadcastError(errorMessage)` — handles direct Hiro broadcast errors:
  - `ConflictingNonceInMempool` — release nonce as rejected, re-acquire
  - `BadNonce` — same
  - Transient HTTP failures
- `sleep(ms)` utility
- `RetryInfo` type: `{ retryable: boolean, delayMs: number, relaySideConflict: boolean }`

**Dependencies:** None

### 1b. Modify `transactions/sponsor-builder.ts`

Add nonce-tracker integration and retry logic to sponsored transaction submission.

**Changes:**
1. Import `acquireNonce`/`releaseNonce` from `../services/nonce-tracker.js`
2. Import `classifyRelayError`, `sleep` from `./retry-strategy.js`
3. Add optional `nonce?: bigint` to `SponsoredTransferOptions`
4. Make `submitToSponsorRelay` public (for resubmission of same serialized tx)
5. New function `sponsoredContractCallWithRetry(account, options, network, maxAttempts=3)`:
   - Acquire nonce → build sponsored tx with explicit nonce → submit to relay
   - Relay-side conflict (NONCE_CONFLICT): sleep(retryAfter), resubmit same tx hex (relay deduplicates)
   - Sender-side conflict: release nonce as rejected, re-acquire, rebuild, resubmit
   - Success: release nonce as confirmed with txid
   - Broadcast but failed: release nonce as "broadcast" (consumed — can't know if it hit mempool)
6. New function `transferStxSponsoredWithRetry` — same pattern
7. Existing `sponsoredContractCall`/`transferStxSponsored` unchanged for backward compat

**Dependencies:** 1a

### 1c. Modify `transactions/builder.ts`

Add nonce-tracker-aware wrappers for direct Hiro broadcast.

**Changes:**
1. Import `acquireNonce`/`releaseNonce` from `../services/nonce-tracker.js`
2. Import `classifyBroadcastError`, `sleep` from `./retry-strategy.js`
3. New `callContractWithRetry(account, options, maxAttempts=3)`:
   - Acquire nonce, build tx with explicit nonce, broadcast to Hiro
   - `ConflictingNonceInMempool`/`BadNonce`: release as rejected, re-acquire, retry
   - Success: release as confirmed
4. New `transferStxWithRetry(account, recipient, amount, memo?, fee?, maxAttempts=3)` — same pattern
5. Existing `callContract`/`transferStx` unchanged

**Dependencies:** 1a

### 1d. New `transactions/send-with-fallback.ts`

Unified write-tx entry point: prefer relay, fallback to direct.

```typescript
export interface SendOptions {
  account: Account;
  network: Network;
  preferSponsored?: boolean;  // default true
  maxAttempts?: number;       // default 3
}

export async function sendContractCall(
  options: ContractCallOptions,
  sendOptions: SendOptions
): Promise<TransferResult>

export async function sendStxTransfer(
  recipient: string,
  amount: bigint,
  memo: string | undefined,
  sendOptions: SendOptions
): Promise<TransferResult>
```

**Logic:**
1. If `preferSponsored !== false` and sponsor API key available:
   - Try `sponsoredContractCallWithRetry`
   - If all retries exhausted: fall back to `callContractWithRetry`
2. If no sponsor config or `preferSponsored: false`:
   - Use `callContractWithRetry` directly

Fallback starts with a fresh nonce acquire — the `*WithRetry` functions manage their own nonce lifecycle.

**Dependencies:** 1b, 1c

### 1e. Modify `utils/x402-retry.ts`

Migrate from deprecated compat API to proper nonce lifecycle.

**Changes:**
1. Replace `getTrackedNonce` + `recordNonceUsed` + `reconcileWithChain` with `acquireNonce` + `releaseNonce`
2. Remove `getNextNonce` helper (manual Hiro fetch + reconcile) — nonce-tracker auto-syncs when stale (>90s)
3. Replace `advanceNonceCache` with `releaseNonce(address, nonce, true, undefined, txid)`
4. On retry sender-side: `releaseNonce(address, nonce, false, "rejected")` then re-acquire
5. Keep inbox-specific codes (`SENDER_NONCE_DUPLICATE`, `SENDER_NONCE_STALE`, `SENDER_NONCE_GAP`) local — distinct from `/sponsor` codes

Exported function signatures unchanged.

**Dependencies:** 1a (optional), independent of 1b-1d

### 1f. Update exports in `transactions/index.ts`

```typescript
export * from "./retry-strategy.js";
export * from "./send-with-fallback.js";
```

**Dependencies:** 1a, 1d

---

## Phase 2 — Self-Transfer RBF Gap Filler (upstream `skills/src/lib/`)

### 2a. New `transactions/nonce-gap-filler.ts`

```typescript
export interface GapFillResult {
  filledNonces: number[];
  txids: string[];
  errors: Array<{ nonce: number; error: string }>;
}

export async function fillNonceGaps(
  account: Account,
  network: Network,
  options?: {
    fee?: bigint;        // Default: 10000n (0.01 STX)
    maxGaps?: number;    // Default: 5
    sponsored?: boolean; // Default: false (direct — don't burn sponsor fees on admin txs)
  }
): Promise<GapFillResult>
```

**Logic:**
1. `syncNonce(account.stxAddress)` → get `detectedMissing` from Hiro
2. For each missing nonce (up to `maxGaps`):
   - Self-transfer: `transferStx(account, account.stxAddress, 0n, "nonce-gap-fill", fee, BigInt(missingNonce))`
   - Record success or error, continue to next
3. Re-sync after all fills

Direct broadcast, not relay — gap fills are administrative overhead.

**Dependencies:** 1c

### 2b. Export from `transactions/index.ts`

**Dependencies:** 2a

---

## Phase 3 — Arc-Specific Changes (`arc-starter/skills/`)

### 3a. Modify `bitcoin-wallet/stx-send-runner.ts`

- Without `--nonce`: use `sendStxTransfer` (nonce-tracker + retry + sponsored-first)
- With `--nonce`: keep raw `transferStx` (manual gap-fill/RBF use case)
- Add `--sponsored` flag (default true)

**Dependencies:** 1d

### 3b-3c. `erc8004-reputation/tx-runner.ts` and `erc8004-identity/cli.ts`

No changes needed — Phase 4 handles via upstream service layer.

### 3d. New `nonce-manager/gap-fill-runner.ts`

Runner script: unlock wallet → `fillNonceGaps(account, network, opts)` → JSON output.

```
WALLET_ID=... WALLET_PASSWORD=... bun skills/nonce-manager/gap-fill-runner.ts [--max-gaps 5] [--fee 10000]
```

**Dependencies:** 2a

### 3e. Modify `nonce-manager/cli.ts`

Add `gap-fill` subcommand:

```
arc skills run --name nonce-manager -- gap-fill [--max-gaps 5] [--fee 10000]
```

Spawns `gap-fill-runner.ts` with wallet credentials from credential store.

**Dependencies:** 3d

---

## Phase 4 — Service Layer Migration (upstream `skills/src/lib/services/`)

Replace the `if (sponsored) / else` pattern in all service write methods:

```typescript
// Before (15+ methods across erc8004.service, sbtc.service, etc.)
if (sponsored) {
  return sponsoredContractCall(account, options, this.network);
}
return callContract(account, options);

// After
return sendContractCall(options, {
  account, network: this.network, preferSponsored: sponsored
});
```

Every service write method gets nonce-tracker + retry + sponsored-with-fallback. Method signatures (`sponsored?: boolean`) unchanged.

**Services affected:**
- `erc8004.service.ts` (15+ write methods: registerIdentity, giveFeedback, revokeFeedback, etc.)
- `sbtc.service.ts` (transfer)
- Any others with the sponsored pattern

**Dependencies:** 1d

---

## Phase 5 — Cleanup

- Add deprecation warnings to compat API in `nonce-tracker.ts` (`getTrackedNonce`, `recordNonceUsed`, `reconcileWithChain`)
- Consider extracting shared 502/503 handling from `x402-retry.ts` into `retry-strategy.ts`

**Dependencies:** All above

---

## Dependency Graph

```
1a ─┬─→ 1b ─┬─→ 1d ─┬─→ 1f
    │        │        ├─→ 3a
    ├─→ 1c ──┘        └─→ 4a-4b → 5
    │    │
    │    └─→ 2a → 2b
    │         └─→ 3d → 3e
    └─→ 1e
```

**Minimum viable slice:** 1a + 1b — gives `sponsor-builder.ts` nonce-tracker integration and retry logic (biggest gap today).

---

## Key Design Decisions

1. **New `*WithRetry` functions rather than modifying existing ones** — backward compatible, no risk to aibtc-mcp-server or other consumers
2. **`sendContractCall` as unified entry point** — single place for relay-first-then-direct logic, keeps service layer clean
3. **Gap fills direct to Hiro, not relay** — administrative self-transfers shouldn't consume sponsor budget
4. **Keep x402-retry.ts inbox-specific codes separate from sponsor-builder relay codes** — `/relay` and `/sponsor` return different error shapes and codes
5. **`--nonce` flag keeps raw path** — manual gap-fill/RBF operations need direct control without nonce-tracker interference

---

## Key Files Reference

| File | Role |
|------|------|
| `skills/src/lib/services/nonce-tracker.ts` | Cross-process nonce oracle (acquire/release/sync) |
| `skills/src/lib/transactions/builder.ts` | Direct Hiro broadcast (transferStx, callContract) |
| `skills/src/lib/transactions/sponsor-builder.ts` | Relay `/sponsor` broadcast (sponsoredContractCall) |
| `skills/src/lib/utils/x402-retry.ts` | Inbox retry logic (reference implementation) |
| `skills/src/lib/services/erc8004.service.ts` | Largest consumer (15+ write methods) |
| `skills/src/lib/config/sponsor.ts` | Relay URL + API key config |
| `arc-starter/skills/bitcoin-wallet/stx-send-runner.ts` | Arc STX send |
| `arc-starter/skills/nonce-manager/cli.ts` | Arc nonce management CLI |
| `x402-sponsor-relay/src/endpoints/sponsor.ts` | Relay /sponsor response format reference |
