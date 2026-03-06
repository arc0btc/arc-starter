# SatoshAI Tools Research: playstacks + abi-cli

*Researched: 2026-03-06T14:28Z | Task #1643 | Source: task:1641 (Jason S email)*

---

## Summary

Two new tools from **@satoshai** (satoshai-dev) on npm:

| Tool | Package | Version | Purpose |
|------|---------|---------|---------|
| playstacks | `@satoshai/playstacks` | 0.3.0 | E2E testing SDK for Stacks dApps — Playwright + real wallet |
| abi-cli | `@satoshai/abi-cli` | 1.0.0 | CLI: fetch deployed contract ABIs, output TypeScript `as const` |

Both are MIT licensed, actively maintained (playstacks last published 2026-02-26), and purpose-built for the Stacks ecosystem.

---

## 1. playstacks (`@satoshai/playstacks`)

**npm:** `@satoshai/playstacks` · **GitHub:** `satoshai-dev/playstacks`
**Version:** 0.3.0 (Mar 2026) · **Keywords:** stacks, playwright, e2e, blockchain, clarity, wallet, xverse

### What it does

Extends Playwright's test fixture system with a mock Xverse wallet. Tests run in a real browser; the mock intercepts wallet API calls and signs/broadcasts real transactions using a mnemonic or private key you supply. No manual wallet interaction needed during test runs.

Think: Synpress for EVM, but for Stacks — with native Clarity/Xverse semantics.

### Architecture

1. `testWithStacks()` creates a Playwright fixture that injects `window.StacksProvider` + `window.XverseProviders` via `page.addInitScript()` before navigation
2. When the dApp calls wallet methods, the mock signs using your key
3. Transaction methods (`stx_callContract`, `stx_transferStx`) → sign + broadcast
4. Signing methods (`stx_signMessage`, `stx_signStructuredMessage`) → return signature without broadcast
5. Compatible with `@stacks/connect` v8 JSON-RPC + Xverse 3-address format

### Core API

```ts
import { testWithStacks, expect } from '@satoshai/playstacks';

const test = testWithStacks({
  mnemonic: process.env.TEST_MNEMONIC!,
  network: 'mainnet', // or 'testnet', 'devnet', or custom URL
});

test('supply on DeFi protocol', async ({ page, stacks }) => {
  await page.goto('https://app.example.com');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: /xverse/i }).click();

  await page.getByRole('button', { name: 'Supply' }).click();

  const txid = stacks.wallet.lastTxId()!;
  const result = await stacks.waitForTx(txid);
  expect(result.status).toBe('success');
});
```

### Fixture API (`stacks`)

| Method | Description |
|--------|-------------|
| `stacks.wallet.address` | STX address derived from key |
| `stacks.wallet.publicKey` | Public key hex |
| `stacks.wallet.rejectNext()` | Flag next wallet request to throw user-rejection error |
| `stacks.wallet.lastTxId()` | Last broadcast txid |
| `stacks.waitForTx(txid)` | Poll until terminal status — returns `{ txid, status, blockHeight }` |
| `stacks.callReadOnly(opts)` | Call read-only Clarity function (no tx) |
| `stacks.getBalance(address?)` | STX balance in microstacks |
| `stacks.getNonce(address?)` | Account nonce |

### Config options

- `mnemonic` or `privateKey`
- `accountIndex` (default: 0)
- `network`: `'mainnet'` | `'testnet'` | `'devnet'` | custom URL
- `fee.multiplier`, `fee.maxFee`, `fee.fixed`
- `confirmation.timeout`, `confirmation.pollInterval`

### Wallet methods supported

`getAddresses`, `wallet_connect`, `stx_callContract`, `stx_transferStx`, `stx_signMessage`, `stx_signStructuredMessage`, `stx_signTransaction`

### Dependencies

- Runtime: `@stacks/network`, `@stacks/transactions`, `@stacks/wallet-sdk`
- Peer: `@playwright/test >= 1.40.0`
- Runtime requirement: Node.js >= 18

---

## 2. abi-cli (`@satoshai/abi-cli`)

**npm:** `@satoshai/abi-cli` · **GitHub:** `satoshai-dev/abi-cli`
**Version:** 1.0.0 · **Keywords:** stacks, abi, cli, typescript, clarity, codegen

### What it does

Fetches a deployed Stacks contract's ABI via the Stacks API and outputs a TypeScript file with `as const satisfies ClarityAbi`. Gives you autocomplete and type safety for contract calls with zero manual work.

### CLI usage

```bash
# One contract
abi-cli fetch SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01
# → writes amm-pool-v2-01.ts

# Multiple contracts
abi-cli fetch SP...amm-pool-v2-01,SP...arkadiko-swap-v2-1

# JSON output
abi-cli fetch SP...amm-pool-v2-01 --format json

# Testnet
abi-cli fetch ST1...my-contract -n testnet

# Stdout
abi-cli fetch SP...amm-pool-v2-01 --stdout

# Config-driven sync (for multi-contract projects)
abi-cli sync

# CI staleness check (exits 1 if stale)
abi-cli sync --check
```

### Generated TypeScript output

```typescript
import type { ClarityAbi } from '@stacks/transactions';

export const abi = {
  "functions": [...],
  "variables": [...],
  ...
} as const satisfies ClarityAbi;

export type Abi = typeof abi;
```

### Config-driven sync (`abi.config.ts`)

For projects with multiple contracts:

```typescript
import type { AbiConfig } from '@satoshai/abi-cli';

export default {
  outDir: './src/abis',
  format: 'ts',
  network: 'mainnet',
  contracts: [
    { id: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01', name: 'amm-pool' },
    { id: 'SP2C2YFP12AJZB1KD5HQ4XFRYGEK02H70HVK8GQH.arkadiko-swap-v2-1', name: 'arkadiko-swap' },
  ],
} satisfies AbiConfig;
```

`name` decouples your imports from the on-chain contract ID — upgrade the contract address, imports stay the same.

Generates a barrel file with camelCase re-exports:

```typescript
export { abi as ammPoolAbi } from './amm-pool.js';
export { abi as arkadikoSwapAbi } from './arkadiko-swap.js';
```

### Programmatic API

```typescript
import { fetchContractAbi, generateTypescript, generateJson, parseContractId } from '@satoshai/abi-cli';

const abi = await fetchContractAbi('mainnet', 'SP102...', 'amm-pool-v2-01');
const tsCode = generateTypescript('SP102....amm-pool-v2-01', abi);
```

### Dependencies

- Runtime: `citty` (CLI framework), `jiti` (ts config loading)
- Peer: `@stacks/transactions`

---

## Fit Assessment

### Ecosystem context

Arc currently interacts with Stacks contracts (Zest, Alex, Arkadiko) via `@stacks/transactions` and `clarity-codegen` conventions. These tools directly address two pain points:

1. **No end-to-end test coverage** for contract interactions — today we have syntax checks and unit tests but no integration tests that exercise real transactions.
2. **Manual ABI management** — ABIs are often hardcoded or fetched ad-hoc. Drift between on-chain contract updates and local types causes bugs.

---

## Integration Recommendations

### abi-cli → High value, use now as a dev-time tool

**Use case:** Generate TypeScript ABIs for all Stacks contracts Arc interacts with.

**Immediate wins:**
- Type-safe `callReadOnly` calls with autocomplete on function names and args
- CI staleness check catches contract upgrades before they break runtime
- One-command refresh when contracts are updated: `abi-cli fetch <address.name>`

**Integration path:**
- Install as devDependency in any skill that interacts with Stacks contracts
- Create `abi.config.ts` in skills like `stacks-defi`, `aibtc-buy-sell`, etc.
- Add `abi-cli sync --check` to pre-dispatch syntax check gate (currently only runs `bun build --no-bundle`)

**Not a skill — it's a dev tool.** No sensor needed. Run manually when integrating a new contract, or in CI.

**Example for Arc's Zest integration:**
```bash
~/.bun/bin/bun x @satoshai/abi-cli fetch SP2C2YFP12AJZB1KD5HQ4XFRYGEK02H70HVK8GQH.zest-reward-dist
```

### playstacks → Medium value, requires test infrastructure investment

**Use case:** E2E integration tests for Arc-built Stacks dApps — e.g., the arc0btc-worker contract interaction flows.

**What it enables:**
- Test that a contract call succeeds end-to-end (real broadcast, real confirmation) without manual wallet
- Test failure paths (insufficient balance, rejection handling)
- Validate DeFi interactions (Zest supply, Alex swap) before deploying new skill versions

**Limitations for Arc's current setup:**
1. Requires Node.js >= 18 (Arc runs on Bun — Bun compatibility unknown, likely works but untested)
2. Tests broadcast real transactions → require a funded testnet wallet (`TEST_MNEMONIC` env var)
3. No Clarinet devnet integration mentioned — `network: 'devnet'` points to localhost:3999, but spin-up is separate
4. Peer dependency on `@playwright/test >= 1.40.0` — adds ~100MB to devDeps
5. Per CLAUDE.md test policy: tests must run via CI, never inline during dispatch

**Integration path (when ready):**
- Create a `tests/` directory in `arc0btc-worker` or any Stacks skill repo
- Use `network: 'testnet'` with a dedicated test wallet
- Add GitHub Actions workflow: `npx playwright install && playwright test`
- Store `TEST_MNEMONIC` as GitHub Actions secret

**Not a skill or sensor — it's CI infrastructure.** Would need a dedicated task to scaffold.

### @satoshai/kit → Worth noting

The third package, `@satoshai/kit`, is a "typesafe Stacks wallet & contract interaction library for React." Not immediately relevant to Arc (no frontend), but relevant if Arc ever builds a React interface over the web dashboard.

---

## Gaps & Limitations

### playstacks
- **Bun compatibility unknown** — depends on `@stacks/wallet-sdk` which may use Node.js crypto APIs; needs testing
- **Only Xverse-compatible** — if Arc needed Leather/Hiro wallet support, not covered yet (though Stacks Provider is standard)
- **No Clarinet devnet wrapper** — you manage your own devnet instance; no fixture for spinning up a local Stacks node
- **Real transactions only** — unlike Clarinet unit tests which use mock principals, these hit real networks (testnet/mainnet). Cost and latency implications.
- **Low adoption** — 383 monthly downloads as of March 2026; early-stage, API may still change
- **No Stacks nakamoto/sBTC transaction types** mentioned — unclear if it supports newer transaction types

### abi-cli
- **Fetch-only, not watch** — no `--watch` mode to auto-regenerate when a contract is redeployed
- **No diff output** — `--check` exits 1 but doesn't show what changed; adds friction in debugging
- **No multi-address support for batch ownership** — config handles multiple contracts but all must be explicitly listed; no "fetch all contracts from address X" capability
- **v1.0.0 freshness** — likely stable, but still v1; verify `satisfies ClarityAbi` behavior on edge-case ABI shapes (maps with complex key types, traits)

---

## Recommended Actions

1. **Short-term (this sprint):** Add `abi-cli` as devDep to `arc-starter` and generate ABIs for the 3-5 Stacks contracts Arc most frequently calls (Zest, Alex AMM, Arkadiko swap, any Arc-owned contracts). Creates type safety immediately.

2. **Medium-term:** Create an `abi.config.ts` for each Stacks-heavy skill, add `abi-cli sync --check` to CI. Closes ABI drift gap permanently.

3. **Long-term (when E2E testing becomes a priority):** Scaffold `playstacks` integration in arc0btc-worker with a testnet test wallet. Create a follow-up task once Bitflow/Zest V2 integrations land, since those are the first complex contract flows worth integration-testing.

4. **Follow-up task suggestion:** "Add abi-cli ABI generation for top 5 Stacks contracts — create abi.config.ts + CI check" → P5 (Sonnet, moderate operational work)

---

## Related Tools (Ecosystem Context)

| Tool | Approach | vs. abi-cli |
|------|----------|-------------|
| `clarity-codegen` | Code generation via `clarity-codegen` CLI | Similar goal; abi-cli is simpler (no templates), pure TS output |
| `clarigen` | Full TypeScript client generation | More opinionated, generates typed function wrappers; abi-cli just does ABIs |
| `clarity-abitype` | TypeScript inference from ABI at compile time | Complementary — use abi-cli to fetch, clarity-abitype for zero-codegen type safety |
| Synpress | E2E testing for EVM dApps (MetaMask) | playstacks is the Stacks equivalent |
| Clarinet JS SDK | Unit testing Clarity contracts | Different layer — playstacks is integration/E2E, Clarinet is unit |
