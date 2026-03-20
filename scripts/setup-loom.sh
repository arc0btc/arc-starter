#!/usr/bin/env bash
# setup-loom.sh — Fresh wallet + AIBTC registration + ERC-8004 identity for Loom
#
# Run on Loom's VM (192.168.1.14):
#   cd ~/arc-starter && bash scripts/setup-loom.sh
#
# Prerequisites:
#   - ARC_CREDS_PASSWORD set in environment (or .env)
#   - bitcoin-wallet password already stored in creds
#   - Bun installed, NETWORK=mainnet in .env
#
# Flow:
#   1. Create fresh wallet (label: aibtc-publisher)
#   2. Store wallet ID in creds
#   3. Sign dual messages → register on aibtc.com
#   4. Store sponsor API key in creds
#   5. Register ERC-8004 identity (sponsored tx, no STX needed)
#   6. Store agent ID in creds
#   7. Submit BTC public key via challenge system

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARC_DIR="$(dirname "$SCRIPT_DIR")"
WALLET_DIR="$ARC_DIR/github/aibtcdev/skills"
WALLET_LABEL="aibtc-publisher"
AIBTC_REGISTER_URL="https://aibtc.com/api/register"
SIGN_MESSAGE="Bitcoin will be the currency of AIs"

echo "=== Loom Publisher Setup ==="
echo ""

# --- Load .env if present ---
if [[ -f "$ARC_DIR/.env" ]]; then
  set -a
  source "$ARC_DIR/.env"
  set +a
fi

# --- Check ARC_CREDS_PASSWORD ---
if [[ -z "${ARC_CREDS_PASSWORD:-}" ]]; then
  echo "ERROR: ARC_CREDS_PASSWORD not set. Check .env or export it."
  exit 1
fi

arc() { cd "$ARC_DIR" && bun run src/cli.ts "$@"; }

# =========================================================================
# Step 1: Get wallet password from existing creds
# =========================================================================
echo "[1/8] Retrieving wallet password from credential store..."
WALLET_PASSWORD=$(arc creds get --service bitcoin-wallet --key password 2>/dev/null || true)

if [[ -z "$WALLET_PASSWORD" ]]; then
  echo "ERROR: No bitcoin-wallet password found in creds store."
  echo "       Set it first: arc creds set --service bitcoin-wallet --key password --value <pw>"
  exit 1
fi
echo "       OK"

# =========================================================================
# Step 2: Create new wallet
# =========================================================================
echo ""
echo "[2/8] Creating new wallet (label: $WALLET_LABEL)..."
WALLET_OUTPUT=$(cd "$WALLET_DIR" && NETWORK=mainnet bun run wallet/wallet.ts create \
  --name "$WALLET_LABEL" \
  --password "$WALLET_PASSWORD" \
  --network mainnet 2>&1)

# Parse and display wallet info
WALLET_ID=$(echo "$WALLET_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.walletId);
")
BTC_SEGWIT=$(echo "$WALLET_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write((d['Bitcoin (L1)']?.['Native SegWit'] || '').split(' ')[0]);
")
BTC_TAPROOT=$(echo "$WALLET_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write((d['Bitcoin (L1)']?.['Taproot'] || '').split(' ')[0]);
")
STX_ADDRESS=$(echo "$WALLET_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d['Stacks (L2)']?.['Address'] || '');
")
MNEMONIC=$(echo "$WALLET_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.mnemonic || '');
")

echo ""
echo "  Wallet ID:   $WALLET_ID"
echo "  BTC SegWit:  $BTC_SEGWIT"
echo "  BTC Taproot: $BTC_TAPROOT"
echo "  STX Address: $STX_ADDRESS"
echo ""
echo "  =============================================="
echo "  MNEMONIC (save securely, shown only once):"
echo "  $MNEMONIC"
echo "  =============================================="
echo ""

# =========================================================================
# Step 3: Store wallet ID in creds
# =========================================================================
echo "[3/8] Storing wallet ID in credential store..."
arc creds set --service bitcoin-wallet --key id --value "$WALLET_ID"
echo "       OK"

# =========================================================================
# Step 4: Verify wallet works
# =========================================================================
echo ""
echo "[4/8] Verifying wallet..."
arc skills run --name bitcoin-wallet -- info
echo ""

# =========================================================================
# Step 5: AIBTC platform registration (dual-sign + POST /api/register)
# =========================================================================
echo "[5/8] Registering on aibtc.com..."
echo "       Signing: \"$SIGN_MESSAGE\""

# BIP-137 Bitcoin signature
BTC_SIG_OUTPUT=$(arc skills run --name bitcoin-wallet -- btc-sign --message "$SIGN_MESSAGE" 2>&1)
BTC_SIGNATURE=$(echo "$BTC_SIG_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.signature || d.result?.signature || '');
")

if [[ -z "$BTC_SIGNATURE" ]]; then
  echo "ERROR: BTC signing failed."
  echo "$BTC_SIG_OUTPUT"
  exit 1
fi
echo "       BTC signature: OK"

# Stacks signature
STX_SIG_OUTPUT=$(arc skills run --name bitcoin-wallet -- stacks-sign --message "$SIGN_MESSAGE" 2>&1)
STX_SIGNATURE=$(echo "$STX_SIG_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.signature || d.result?.signature || '');
")

if [[ -z "$STX_SIGNATURE" ]]; then
  echo "ERROR: STX signing failed."
  echo "$STX_SIG_OUTPUT"
  exit 1
fi
echo "       STX signature: OK"

# POST registration
echo "       Posting to $AIBTC_REGISTER_URL..."
REGISTER_OUTPUT=$(curl -s -X POST "$AIBTC_REGISTER_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"bitcoinSignature\": \"$BTC_SIGNATURE\",
    \"stacksSignature\": \"$STX_SIGNATURE\",
    \"btcAddress\": \"$BTC_SEGWIT\",
    \"description\": \"Loom — AIBTC publisher agent. Content, reports, ecosystem briefs.\"
  }")

echo ""
echo "       Registration response:"
echo "$REGISTER_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log(JSON.stringify(d, null, 2));
"
echo ""

# Extract sponsor API key and display name
SPONSOR_KEY=$(echo "$REGISTER_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.sponsorApiKey || '');
")
DISPLAY_NAME=$(echo "$REGISTER_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.agent?.displayName || d.displayName || '');
")
CLAIM_CODE=$(echo "$REGISTER_OUTPUT" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.claimCode || '');
")

echo "  AIBTC Name:    $DISPLAY_NAME"
echo "  Claim Code:    $CLAIM_CODE"

# Store AIBTC registration details in creds (matches existing pattern on Loom)
if [[ -n "$DISPLAY_NAME" ]]; then
  arc creds set --service aibtc --key display-name --value "$DISPLAY_NAME"
fi
if [[ -n "$CLAIM_CODE" ]]; then
  arc creds set --service aibtc --key claim-code --value "$CLAIM_CODE"
fi

# =========================================================================
# Step 6: Store sponsor API key
# =========================================================================
echo ""
if [[ -n "$SPONSOR_KEY" ]]; then
  echo "[6/8] Storing sponsor API key in credential store..."
  arc creds set --service x402-relay --key sponsor_api_key --value "$SPONSOR_KEY"
  arc creds set --service aibtc --key sponsor-api-key --value "$SPONSOR_KEY"
  echo "       OK"
else
  echo "[6/8] WARNING: No sponsor API key in response. ERC-8004 registration will need STX for fees."
  echo "       You can register later with: arc skills run --name erc8004-identity -- register --sponsored"
fi

# =========================================================================
# Step 7: Register ERC-8004 identity (sponsored)
# =========================================================================
echo ""
if [[ -n "$SPONSOR_KEY" ]]; then
  echo "[7/8] Registering ERC-8004 on-chain identity (sponsored tx)..."
  IDENTITY_URI="https://aibtc.com/api/agents/$STX_ADDRESS"
  arc skills run --name erc8004-identity -- register --uri "$IDENTITY_URI" --sponsored

  echo ""
  echo "       ERC-8004 tx submitted. Wait ~10-30 min for confirmation, then:"
  echo "       arc skills run --name erc8004-identity -- get-last-id"
  echo ""
  echo "       Once confirmed, store the agent ID:"
  echo "       arc creds set --service erc8004 --key agent_id --value <NEW_ID>"
  echo "       arc skills run --name erc8004-identity -- set-wallet --agent-id <NEW_ID> --sponsored"
else
  echo "[7/8] SKIPPED: No sponsor key — fund wallet with STX then run manually:"
  echo "       arc skills run --name erc8004-identity -- register --uri \"https://aibtc.com/api/agents/$STX_ADDRESS\" --fee low"
fi

# =========================================================================
# Step 8: Submit BTC public key via challenge system
# =========================================================================
echo ""
echo "[8/8] Submitting BTC public key to AIBTC platform..."
echo "       Requesting challenge for address: $BTC_SEGWIT"

CHALLENGE_RESPONSE=$(curl -s "https://aibtc.com/api/challenge?address=$BTC_SEGWIT&action=update-pubkey")
CHALLENGE=$(echo "$CHALLENGE_RESPONSE" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.challenge || d.message || '');
")

if [[ -z "$CHALLENGE" ]]; then
  echo "       WARNING: Could not get challenge from AIBTC API."
  echo "       Response: $CHALLENGE_RESPONSE"
  echo "       Submit pubkey manually later (see next steps)."
else
  echo "       Challenge: $CHALLENGE"
  echo "       Signing challenge..."

  BTC_SIG_OUTPUT2=$(arc skills run --name bitcoin-wallet -- btc-sign --message "$CHALLENGE" 2>&1)
  CHALLENGE_SIGNATURE=$(echo "$BTC_SIG_OUTPUT2" | bun -e "
const raw = require('fs').readFileSync('/dev/stdin','utf8');
const start = raw.indexOf('{');
if (start === -1) process.exit(1);
const d = JSON.parse(raw.slice(start));
process.stdout.write(d.signatureBase64 || d.signature || '');
" 2>/dev/null || true)

  if [[ -z "$CHALLENGE_SIGNATURE" ]]; then
    echo "       WARNING: Challenge signing failed."
    echo "       $BTC_SIG_OUTPUT2"
  else
    echo "       Signature: OK"

    # Extract compressed public key from BIP-322 witness (2nd item is 33-byte pubkey)
    PUBKEY_HEX=$(echo "$CHALLENGE_SIGNATURE" | bun -e "
const b64 = require('fs').readFileSync('/dev/stdin','utf8').trim();
const buf = Buffer.from(b64, 'base64');
let offset = 0;
const numItems = buf[offset++];
for (let i = 0; i < numItems; i++) {
  const len = buf[offset++];
  const item = buf.slice(offset, offset + len);
  offset += len;
  if (len === 33) { process.stdout.write(item.toString('hex')); break; }
}
" 2>/dev/null || true)
    echo "       Public key: $PUBKEY_HEX"

    echo "       Submitting pubkey to AIBTC..."
    PUBKEY_RESPONSE=$(curl -s -X POST "https://aibtc.com/api/challenge" \
      -H "Content-Type: application/json" \
      -d "{
        \"address\": \"$BTC_SEGWIT\",
        \"action\": \"update-pubkey\",
        \"challenge\": \"$CHALLENGE\",
        \"signature\": \"$CHALLENGE_SIGNATURE\",
        \"publicKey\": \"$PUBKEY_HEX\"
      }")

    echo "       Response:"
    echo "$PUBKEY_RESPONSE" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log(JSON.stringify(d, null, 2));
" 2>/dev/null || echo "       $PUBKEY_RESPONSE"
  fi
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Agent Name:  $DISPLAY_NAME"
echo "  BTC SegWit:  $BTC_SEGWIT"
echo "  BTC Taproot: $BTC_TAPROOT"
echo "  STX Address: $STX_ADDRESS"
echo "  Claim Code:  $CLAIM_CODE"
echo ""
echo "Next steps:"
echo "  1. SAVE THE MNEMONIC — it won't be shown again"
echo "  2. Wait for ERC-8004 tx to confirm, then store agent ID"
echo "  3. Copy SOUL-loom.md to Loom's arc-starter root as SOUL.md"
echo "  4. Update src/identity.ts with new addresses (old → legacy_wallets)"
echo "  5. Optional: viral claim tweet to reach Genesis level"
echo ""
