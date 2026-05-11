---
name: ordinals-marketplace
description: "BTC ordinals marketplace operations via Magic Eden — browse active listings, list inscriptions for sale via PSBT flow, submit signed listings, buy inscriptions, and cancel active listings. BTC ordinals only (not Solana). Mainnet-only."
tags:
  - l1
  - write
  - mainnet-only
  - requires-funds
metadata:
  author: "whoabuddy"
  author-agent: "Trustless Indra"
  user-invocable: "false"
  arguments: "get-listings | list-for-sale | list-for-sale-submit | buy | cancel-listing"
  mcp-tools: "ordinals_get_listings, ordinals_list_for_sale, ordinals_list_for_sale_submit, ordinals_buy, ordinals_cancel_listing"
  requires: "wallet"
---

# Ordinals Marketplace Skill

Browse and trade Bitcoin ordinals/inscriptions on the Magic Eden marketplace via the Magic Eden BTC ordinals API (`api-mainnet.magiceden.dev/v2/ord/btc`).

**Important:** This skill covers BTC ordinals only. Magic Eden operates separate marketplaces for different chains; this skill exclusively uses the Bitcoin ordinals API. All operations are mainnet-only — the API does not support testnet.

This is an MCP-tool skill. Agents invoke the underlying MCP tools directly rather than a standalone CLI script. Write operations use the Magic Eden PSBT-based listing flow: Magic Eden generates a PSBT which the seller or buyer signs and then broadcasts.

## Prerequisites

- Wallet must be unlocked for all write operations (`list-for-sale`, `buy`, `cancel-listing`)
- `get-listings` is public and requires no wallet
- Active wallet must have Taproot keys (P2TR address) — managed wallets satisfy this
- BTC balance required for purchasing and cancellations (miner fee for cancel; purchase price + fee for buy)
- Set `MAGIC_EDEN_API_KEY` environment variable for a dedicated authenticated rate limit (optional but recommended for high-volume use; without it, the unauthenticated shared limit applies: 30 QPM)

## Subcommands

### get-listings

Browse active BTC ordinals listings on Magic Eden. No wallet required.

MCP tool: `ordinals_get_listings`

Options:
- `collection` (optional) — Magic Eden collection symbol to filter by (e.g. `nodemonkes`, `bitcoin-puppets`)
- `minPriceSats` (optional) — Minimum listing price in satoshis
- `maxPriceSats` (optional) — Maximum listing price in satoshis
- `limit` (optional) — Number of results (default 20, max 100)
- `offset` (optional) — Pagination offset (default 0)
- `sortBy` (optional) — `priceAsc`, `priceDesc`, or `recentlyListed` (default)

### list-for-sale

List a wallet inscription for sale on Magic Eden using the PSBT listing flow. Step 1 of 2.

MCP tool: `ordinals_list_for_sale`

Options:
- `inscriptionId` (required) — Inscription ID in txid+index format, e.g. `abc123...i0`
- `priceSats` (required) — Listing price in satoshis
- `receiverAddress` (optional) — BTC address to receive payment (defaults to wallet's Taproot address)

Returns a `psbtBase64` for signing. Pass the signed result to `list-for-sale-submit`.

### list-for-sale-submit

Submit a signed listing PSBT to finalize the Magic Eden listing. Step 2 of 2.

MCP tool: `ordinals_list_for_sale_submit`

Options:
- `inscriptionId` (required) — Inscription ID from step 1
- `signedPsbt` (required) — Signed PSBT base64 string from `psbt_sign`

### buy

Buy a listed inscription. Returns a buyer PSBT to sign and broadcast.

MCP tool: `ordinals_buy`

Options:
- `inscriptionId` (required) — Inscription ID to purchase

Returns `psbtBase64` and `priceSats`. Sign with `psbt_sign`, broadcast with `psbt_broadcast`.

### cancel-listing

Cancel an active ordinals listing. Returns a cancellation PSBT to sign and broadcast.

MCP tool: `ordinals_cancel_listing`

Options:
- `inscriptionId` (required) — Inscription ID of the active listing

Returns `psbtBase64`. Sign with `psbt_sign`, broadcast with `psbt_broadcast`.
