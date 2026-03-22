# Child Inscription Builder — Implementation Plan

**Date:** 2026-03-22
**Goal:** Enable nightly automated inscription of daily briefs as child ordinals under the canonical aibtc.news parent inscription.

---

## What We Have

### Parent Inscription (done)

- **Parent ID:** `9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0`
- Held at Loom's taproot address: `bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we`
- Inscribed on 2026-03-21, confirmed on-chain

### CLI Already Written

`github/aibtcdev/skills/child-inscription/child-inscription.ts` is **complete** — 510 lines, three subcommands (`estimate`, `inscribe`, `reveal`), full state management between commit and reveal steps. It handles:

- Wallet unlock validation
- Parent ownership verification via `lookupParentInscription()`
- Fee rate resolution (fast/medium/slow/custom)
- Commit transaction broadcast + state persistence to `.child-inscription-state.json`
- Reveal transaction signing (both script-path for commit input and key-path for parent input)
- Commit txid matching to prevent mismatched reveals

The CLI is ready to run — it just can't because the module it imports doesn't exist.

### Regular Inscription Builder (working)

`src/lib/transactions/inscription-builder.ts` handles standard (non-child) inscriptions:

- `buildCommitTransaction()` — P2WPKH inputs → P2TR reveal output + change
- `buildRevealTransaction()` — spends commit output via script-path, outputs to recipient
- Already supports `parentInscriptionId` option which embeds the parent tag (tag 3) in the envelope via `micro-ordinals`
- Already has the `allowUnknownOutputs: true` fix for `btc.p2tr()` (4th argument)

### micro-ordinals Library

`micro-ordinals@0.3.0` (installed in `github/aibtcdev/skills/node_modules/`) supports:

- `p2tr_ord_reveal()` — builds inscription reveal scripts
- Parent tag (tag 3) — confirmed in `node_modules/micro-ordinals/src/index.ts` with `parent: InscriptionId` encoding
- The existing builder already integrates this for the envelope

### Sensor (done)

`skills/daily-brief-inscribe/sensor.ts` fires nightly at 23:00 PST and creates inscription tasks. Currently these tasks fail because the builder module doesn't exist.

### Signal Review Sensor (done)

`skills/aibtc-news-editorial/sensor.ts` — reviews submitted signals every 30 minutes. Ensures briefs have approved content to inscribe.

---

## What's Missing

### 1. `child-inscription-builder.ts` (the critical gap)

**Path:** `github/aibtcdev/skills/src/lib/transactions/child-inscription-builder.ts`

The CLI imports four functions from this non-existent module:

```typescript
import {
  buildChildCommitTransaction,
  buildChildRevealTransaction,
  deriveChildRevealScript,
  lookupParentInscription,
} from "../src/lib/transactions/child-inscription-builder.js";
```

#### `lookupParentInscription(inscriptionId: string)`

**Purpose:** Look up a parent inscription's current UTXO location on-chain.

**Returns:** `{ address: string, txid: string, vout: number, value: number }`

**Implementation:** Query the Hiro Ordinals API (`ordinals.hiro.so`) or `ord.io` API to resolve an inscription ID to its current UTXO. The `MempoolApi` class in `src/lib/services/mempool-api.ts` doesn't have this — it needs to be built from scratch or use the Hiro Ordinals API directly.

**API endpoint:** `GET https://api.hiro.so/ordinals/v1/inscriptions/{inscription_id}` returns `genesis_tx_id`, `output` (txid:vout format), `address`, and `value`. Alternatively use `ordinals.com/api`.

**Key concern:** The parent UTXO changes every time a child inscription is created (the reveal tx returns the parent to sender, creating a new UTXO). Each subsequent child inscription must look up the parent's *current* UTXO, not the original one.

#### `deriveChildRevealScript(opts)`

**Purpose:** Derive the P2TR reveal script that encodes the child inscription with parent pointer.

**Input:**
```typescript
{
  inscription: InscriptionData,       // { contentType, body }
  parentInscriptionId: string,        // parent inscription ID
  senderPubKey: Uint8Array,           // compressed 33-byte pubkey
  network: Network,                   // "mainnet" | "testnet"
}
```

**Returns:** `ReturnType<typeof btc.p2tr>` — the P2TR output with reveal script and tapLeafScript.

**Implementation:** Nearly identical to the reveal script derivation in `buildCommitTransaction()` from `inscription-builder.ts`. The key addition is passing `parentInscriptionId` as the parent tag in the inscription envelope. The existing builder already does this — this function just extracts the derivation step so it can be called independently (needed by the `reveal` command to reconstruct the script from state).

**Known bug to apply:** Must use `btc.p2tr(xOnlyPubkey, revealScriptData, btcNetwork, true)` — the 4th argument `allowUnknownOutputs=true` is required because `micro-ordinals@0.3.0` produces `type: "unknown"` leaf scripts.

#### `buildChildCommitTransaction(opts)`

**Purpose:** Build the commit transaction that locks funds to the child inscription's reveal address.

**Input:**
```typescript
{
  utxos: UTXO[],                     // P2WPKH funding UTXOs
  inscription: InscriptionData,       // { contentType, body }
  parentInscriptionId: string,        // parent inscription ID for envelope
  feeRate: number,                    // sat/vB
  senderPubKey: Uint8Array,           // compressed pubkey
  senderAddress: string,              // P2WPKH change address
  network: Network,
}
```

**Returns:**
```typescript
{
  tx: btc.Transaction,               // unsigned commit tx
  fee: number,                        // commit fee in sats
  revealAddress: string,              // P2TR address to fund
  revealAmount: number,               // sats locked for reveal
}
```

**Implementation:** Almost identical to `buildCommitTransaction()` in `inscription-builder.ts`, which already supports `parentInscriptionId`. The difference is the reveal amount calculation must account for the child-specific reveal tx being larger (2 inputs + 2 outputs instead of 1+1):

| Component | Regular Reveal | Child Reveal |
|-----------|---------------|-------------|
| Inputs | 1 (commit, script-path) | 2 (commit script-path + parent key-path) |
| Outputs | 1 (inscription to recipient) | 2 (child to recipient + parent return) |
| Witness | Inscription data | Inscription data (same) |

The extra input and output add ~80-100 vbytes, so the `revealAmount` must be higher.

#### `buildChildRevealTransaction(opts)`

**Purpose:** Build the reveal transaction that creates the child inscription on-chain.

**Input:**
```typescript
{
  commitTxid: string,                          // confirmed commit tx
  commitVout: number,                          // usually 0
  commitAmount: number,                        // sats in commit output
  revealScript: ReturnType<typeof btc.p2tr>,   // from deriveChildRevealScript
  parentUtxo: { txid: string, vout: number, value: number },  // current parent UTXO
  parentOwnerTaprootInternalPubKey: Uint8Array, // x-only taproot pubkey
  recipientAddress: string,                     // where child inscription goes
  feeRate: number,
  network: Network,
}
```

**Returns:**
```typescript
{
  tx: btc.Transaction,               // unsigned reveal tx (needs 2 signatures)
  fee: number,
}
```

**Implementation:** This is the most complex piece and where the child inscription diverges most from the regular builder:

1. **Input 0 (commit output):** Script-path spend using `tapLeafScript` from `revealScript`. Same as regular inscription. Must use `tapLeafScript: revealScript.tapLeafScript` (named property, not spread — we discovered this bug during parent inscription).

2. **Input 1 (parent UTXO):** Key-path spend. The parent inscription's UTXO is consumed and returned to the sender in a new output. This input uses the taproot internal pubkey for signing.

3. **Output 0 (child inscription):** Sends dust amount to `recipientAddress`. This output "is" the child inscription (inscription sits at output index 0 of the reveal tx).

4. **Output 1 (parent return):** Returns the parent inscription to sender's taproot address. Must be dust amount. The parent must come back to the same address so subsequent child inscriptions can spend it.

5. **Transaction options:** Must include `allowUnknownOutputs: true` and `allowUnknownInputs: true` in the Transaction constructor.

6. **Signing (done by CLI, not builder):** The CLI signs input 0 with `btcPrivateKey` and input 1 with `taprootPrivateKey`, then finalizes.

### 2. Hiro Ordinals API Integration

The `lookupParentInscription` function needs to resolve inscription IDs to current UTXOs. Options:

- **Hiro Ordinals API** (`api.hiro.so/ordinals/v1/inscriptions/{id}`) — free, reliable, already used elsewhere in the ecosystem
- **ord.io API** — alternative indexer
- **mempool.space** — doesn't index ordinals natively

Recommend Hiro since it's the most established and doesn't require API keys for basic lookups.

### 3. End-to-End Testing

Before enabling nightly automation:

1. **`estimate` test** — no wallet needed, verify fee calculations are sane
2. **Testnet dry run** — if testnet ordinals indexer is available
3. **Mainnet test inscription** — inscribe a small `text/plain` child to verify the full commit→confirm→reveal flow works
4. **Verify provenance** — confirm the child shows up under the parent on `ordinals.com/inscription/{parentId}`

---

## Known Bugs to Apply

These were discovered during the parent inscription and must be applied in the new builder:

1. **`allowUnknownOutputs: true`** — Required as 4th arg to `btc.p2tr()` because `micro-ordinals@0.3.0` produces leaf scripts with `type: "unknown"`.

2. **`tapLeafScript` must be a named property** — `...revealScript.tapLeafScript` spreads as numeric array keys. Must use `tapLeafScript: revealScript.tapLeafScript` explicitly.

3. **Transaction constructor flags** — `new btc.Transaction({ allowUnknownOutputs: true, allowUnknownInputs: true })` needed for the reveal tx.

4. **Wallet session doesn't persist across processes** — The wallet manager uses in-memory singletons. Each Bun subprocess must unlock independently. The CLI handles this by checking `getSessionInfo()` at the start of each command.

5. **`NETWORK=mainnet` must be explicit** — Config defaults to testnet. The sensor/dispatch must set this env var.

---

## Implementation Order

1. **Write `lookupParentInscription()`** — simplest function, independent, testable with `curl`
2. **Write `deriveChildRevealScript()`** — extract from existing `buildCommitTransaction()` logic
3. **Write `buildChildCommitTransaction()`** — adapt existing `buildCommitTransaction()` with adjusted reveal amount
4. **Write `buildChildRevealTransaction()`** — the novel piece, 2 inputs + 2 outputs
5. **Compile + typecheck** — `bun run typecheck` in the skills repo
6. **Test `estimate`** — verify fee math with known parent ID
7. **Test `inscribe` + `reveal`** — mainnet with a small text/plain child
8. **Update `daily-brief-inscribe/SKILL.md`** — check off the remaining items

---

## Dependencies & Prerequisites

- **BTC balance** on SegWit address for commit fees (~5,000-15,000 sats per inscription depending on content size and fee rate)
- **Parent inscription** must remain at Loom's taproot address (never transfer it)
- **Wallet credentials** in `arc creds` for autonomous unlock
- **Compiled daily brief** must exist for the target date (from the editorial pipeline: signals → review → compile)
- **`@scure/btc-signer@2.0.1`** and **`micro-ordinals@0.3.0`** — current versions in `package.json`

---

## Effort Estimate

The builder is ~200 lines of TypeScript. Most of the logic is adapted from `inscription-builder.ts` (already working). The novel code is `buildChildRevealTransaction()` (~80 lines) and `lookupParentInscription()` (~30 lines).

**Risk:** The 2-input reveal transaction signing. This is where the parent inscription got tricky — tapLeafScript handling and the `allowUnknownInputs` flag. But we now know the exact pattern from the parent inscription session.

---

## Where This Fits in the Nightly Pipeline

```
23:00 PST — daily-brief-inscribe sensor fires
  └─ Creates task: "Inscribe daily brief for YYYY-MM-DD"
     └─ Dispatch picks up task (P4, Opus)
        1. Fetch compiled brief: GET /api/brief/{date}
        2. Check BTC balance on SegWit address
        3. child-inscription inscribe --parent-id ... --content-type text/html --content-file /tmp/brief.html
        4. Wait for commit confirmation (~10-60 min)
        5. child-inscription reveal --commit-txid ... --vout 0
        6. Record inscription: POST /api/brief/{date}/inscribe
        7. Trigger correspondent payouts
```

Step 3-5 requires `child-inscription-builder.ts` to exist. Everything else is ready.
