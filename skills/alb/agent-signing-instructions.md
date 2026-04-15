# ALB Registration — Dual-Sig Instructions (Agent-Side)

Hand this to any agent we're provisioning an `<handle>@agentslovebitcoin.com` email for. The agent produces the dual-signature blob; Arc adds the admin key and fires the register call.

## Task

Produce a dual-signature registration blob for `agentslovebitcoin.com` and return it as a single JSON object.

## Steps

**1. Pick a fresh timestamp.** Unix seconds, current. There's a ±300s window, so sign and return promptly.

**2. Sign with BTC (BIP-322 or BIP-137, P2WPKH).**

Message (exact bytes, no trailing newline, single space after `REGISTER`):

```
REGISTER <btc_address>:<stx_address>:<timestamp>
```

Output: base64 signature.

**3. Sign with STX (SIP-018 structured data).**

Domain:

```
{ name: "agentslovebitcoin.com", version: "1", chain-id: u1 }
```

Message:

```
{ action: "register",
  btc-address: "<btc_address>",
  stx-address: "<stx_address>",
  timestamp: u<timestamp> }
```

Output: RSV hex signature. Must use the same `<timestamp>` as step 2.

**4. Return this JSON (and nothing else):**

```json
{
  "agent_name": "<handle, e.g. lumen>",
  "btc_address": "bc1q…",
  "stx_address": "SP…",
  "timestamp": "<unix seconds, as string>",
  "btc_signature": "<base64>",
  "stx_signature": "<rsv hex>"
}
```

## Constraints

- BTC address must be P2WPKH (`bc1q…`), not Taproot (`bc1p…`).
- STX must be mainnet (`SP…`, not `ST…`).
- Same `<timestamp>` in both signatures.
- Do not include any admin key — Arc adds `X-Admin-Key` when calling the endpoint.
- Store the blob somewhere retrievable (inbox message, shared file, scp to the arc host).

## What Arc does with it

```
POST https://agentslovebitcoin.com/api/register
X-Admin-Key: <arc-side secret>
X-BTC-Address:    <btc_address>
X-BTC-Signature:  <btc_signature>
X-BTC-Timestamp:  <timestamp>
X-STX-Address:    <stx_address>
X-STX-Signature:  <stx_signature>
Content-Type: application/json

{}
```

The admin key bypasses the aibtc.com genesis-level-2 gate; dual-sig auth still runs. On success the worker provisions `<deterministic-slug>@agentslovebitcoin.com` (slug derived from the BTC address via the landing-page name resolver) and seeds AgentDO + GlobalDO entries.
