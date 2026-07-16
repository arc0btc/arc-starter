# ARC-0016: Namespace Shared Nonce State by Network (`network:address`)

| Field | Value |
|-------|-------|
| ARC | 0016 |
| Title | Namespace shared nonce-state.json by network |
| Author | Arc |
| Status | Proposed — awaiting whoabuddy sign-off (cross-repo format change) |
| Created | 2026-07-16 |
| Requires | `~/.aibtc/nonce-state.json` v2 (schema owned jointly by `aibtcdev/skills` and `aibtcdev/aibtc-mcp-server`) |

---

## Context

`~/.aibtc/nonce-state.json` is a single file shared across every process that sends Stacks
transactions — Arc dispatch (`aibtcdev/skills`) and `aibtc-mcp-server`, potentially running
under different `NETWORK` values (mainnet/testnet) in the same host environment. The current
v2 schema (`src/lib/services/nonce-tracker.ts`) keys `state.addresses` by **address string
only**:

```ts
export interface NonceStateFile {
  version: number;
  addresses: Record<string, AddressNonceState>;
}
```

A mainnet-context process and a testnet-context process acting on the same address string
(e.g. during local dev, or a misconfigured subprocess env) write into the **same slot**.
Whichever process syncs or acquires last wins, silently clobbering the other's `nextNonce`
and `pending` log. This produced the 2026-07-16 nonce clobber on
`SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B` (see `memory/MEMORY.md` →
`zest-yield-manager-nonce-gap-remediation`, task #22939/#22936).

**Interim mitigations already shipped** (both narrow the blast radius, neither closes the root
cause):

1. Dispatch subprocess env now defaults `NETWORK=mainnet` explicitly (commit `92019508`) —
   removes the most common cause of an accidentally-testnet-context process touching a
   mainnet address.
2. `nonce-tracker.ts` rejects empty-account / wrong-network response bodies from Hiro before
   writing state (`arc0btc/skills#1`) — stops a bad sync response from corrupting an entry,
   but does not stop two *correctly-functioning* same-address, different-network processes
   from sharing a slot.

Neither mitigation changes the on-disk key. The structural gap remains: **the schema has no
field for network**, so two legitimate concurrent contexts for the same address are
indistinguishable to the tracker.

## Proposal

Bump `NonceStateFile.version` to `3`. Change the `addresses` map key from `address` to
`` `${network}:${address}` `` (e.g. `mainnet:SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`).

```ts
export interface NonceStateFile {
  version: 3;
  addresses: Record<string, AddressNonceState>; // key: `${network}:${address}`
}
```

`network` is the existing `NETWORK` value already imported into `nonce-tracker.ts`
(`../config/networks.js`) — no new config surface, just threading it into the key everywhere
`state.addresses[address]` is currently read/written (`acquireNonce`, `releaseNonce`,
`syncNonce`, `getStatus`, and the two compat wrappers `getTrackedNonce` /
`recordNonceUsed`/`reconcileWithChain`).

### Migration: no auto-migrate

`migrateV1toV2` set a precedent for silent migration (`lastUsedNonce` → `nextNonce`), but that
was a same-network field rename — safe to infer. v2 → v3 is **not** safe to infer: a v2 key of
just `SP2GHQ...F3B` does not record which network produced it, so guessing wrong re-introduces
exactly the clobber this RFC exists to fix. `readStateFileSync()` should instead:

- Detect `version === 2` (or unversioned) → **discard**, same as the existing unversioned-file
  branch (`createDefaultState()`), not migrate.
- Each address re-syncs fresh from Hiro on first `acquireNonce`/`syncNonce` call under its
  correct network context — this is already the existing self-healing path for a missing
  entry (`entry` undefined → sync from Hiro), so the cost of "no migration" is one extra Hiro
  round-trip per active address, not a functional gap.

### Audit scope

Before landing, audit every direct `acquireNonce`/`releaseNonce`/`syncNonce` call site across
both repos (not just `nonce-tracker.ts` itself) to confirm each runs under an explicit,
correct `NETWORK` value at call time — the interim mitigation (dispatch defaults
`NETWORK=mainnet`) covers the Arc dispatch subprocess path only, not every caller.

## Why an RFC, not a direct PR

`nonce-state.json`'s format is declared shared in the `nonce-tracker.ts` module header
(`@see https://github.com/aibtcdev/aibtc-mcp-server/issues/413`,
`@see https://github.com/aibtcdev/skills/issues/240`) — both repos read/write the same file on
the same host. A unilateral format bump from one repo's copy of `nonce-tracker.ts` would break
the other repo's copy the next time it reads the file (version mismatch → falls into the
"discard" branch → the other process silently loses its tracked state, same failure class as
the migration risk above, just moved earlier). This needs the same-day coordinated deploy of
both `aibtcdev/skills` and `aibtc-mcp-server` copies of `nonce-tracker.ts`, which is
whoabuddy's call to schedule.

## Risk if not fixed

Low immediate likelihood (requires two processes for the same address string running under
different `NETWORK` values concurrently), but high blast radius when it recurs — the 2026-07-16
incident cost a multi-hour gap-fill (#22939) and blocked a downstream sBTC supply operation
(#22936) before diagnosis. The interim mitigations reduce the odds; this RFC is the structural
close.

## Open questions for whoabuddy

1. Coordinated deploy window for both repos, or is a compat shim (read v3, write both v2+v3
   keys for one release) preferred to decouple the rollout?
2. Any other consumers of `nonce-state.json` outside `aibtcdev/skills` /
   `aibtc-mcp-server` that need to be in the coordination loop?

---

*Filed by Arc, task #22940, follow-up to #22935/#22939/#22936.*
