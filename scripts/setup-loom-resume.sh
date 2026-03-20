#!/usr/bin/env bash
# setup-loom-resume.sh — Resume from step 5 (AIBTC registration)
#
# Wallet already created and stored in creds. This script:
#   5. Signs + registers on aibtc.com
#   6. Stores sponsor API key
#   7. Registers ERC-8004 identity (sponsored)
#
# Run on Loom's VM:
#   cd ~/arc-starter && bash scripts/setup-loom-resume.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARC_DIR="$(dirname "$SCRIPT_DIR")"
AIBTC_REGISTER_URL="https://aibtc.com/api/register"
SIGN_MESSAGE="Bitcoin will be the currency of AIs"

echo "=== Loom Publisher Setup (resuming from AIBTC registration) ==="
echo ""

# --- Load .env if present ---
if [[ -f "$ARC_DIR/.env" ]]; then
  set -a
  source "$ARC_DIR/.env"
  set +a
fi

# Force mainnet
export NETWORK=mainnet

# --- Check ARC_CREDS_PASSWORD ---
if [[ -z "${ARC_CREDS_PASSWORD:-}" ]]; then
  echo "ERROR: ARC_CREDS_PASSWORD not set. Check .env or export it."
  exit 1
fi

arc() { cd "$ARC_DIR" && NETWORK=mainnet bun run src/cli.ts "$@"; }

# =========================================================================
# Verify current wallet
# =========================================================================
echo "[pre] Checking current wallet in creds..."
WALLET_ID=$(arc creds get --service bitcoin-wallet --key id 2>/dev/null || true)
echo "       Wallet ID: $WALLET_ID"
echo ""

# Get the BTC address from the wallet for registration
WALLET_INFO=$(arc skills run --name bitcoin-wallet -- info 2>&1)
echo "$WALLET_INFO"
echo ""

# Try to extract BTC segwit address from wallet info
BTC_SEGWIT=$(echo "$WALLET_INFO" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
// Handle both locked (list of wallets) and unlocked (single wallet) formats
if (d.wallets) {
  // Locked — find the wallet matching our ID
  const w = d.wallets.find(w => w.id === '$WALLET_ID');
  if (w) process.stdout.write((w['Bitcoin (L1)']?.['Native SegWit'] || '').split(' ')[0]);
} else {
  process.stdout.write(d.btcAddress || d['Bitcoin (L1)']?.['Native SegWit']?.split(' ')[0] || '');
}
" 2>/dev/null || true)

STX_ADDRESS=$(echo "$WALLET_INFO" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if (d.wallets) {
  const w = d.wallets.find(w => w.id === '$WALLET_ID');
  if (w) process.stdout.write(w['Stacks (L2)'] || '');
} else {
  process.stdout.write(d.address || d['Stacks (L2)']?.['Address'] || d['Stacks (L2)'] || '');
}
" 2>/dev/null || true)

echo "  Using BTC: $BTC_SEGWIT"
echo "  Using STX: $STX_ADDRESS"

if [[ -z "$BTC_SEGWIT" || -z "$STX_ADDRESS" ]]; then
  echo "ERROR: Could not determine wallet addresses. Check wallet info output above."
  exit 1
fi
echo ""

# =========================================================================
# Step 5: AIBTC platform registration (dual-sign + POST /api/register)
# =========================================================================
echo "[5/8] Registering on aibtc.com..."
echo "       Signing: \"$SIGN_MESSAGE\""

# Helper: extract JSON from output that may have log lines before it
parse_json() {
  bun -e "
const raw = require('fs').readFileSync('/dev/stdin','utf8');
const start = raw.indexOf('{');
if (start === -1) { process.exit(1); }
const d = JSON.parse(raw.slice(start));
process.stdout.write(JSON.stringify(d));
"
}

# BIP-137 Bitcoin signature
BTC_SIG_OUTPUT=$(arc skills run --name bitcoin-wallet -- btc-sign --message "$SIGN_MESSAGE" 2>&1)
BTC_JSON=$(echo "$BTC_SIG_OUTPUT" | parse_json || true)
BTC_SIGNATURE=$(echo "$BTC_JSON" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.signatureBase64 || d.signature || '');
" 2>/dev/null || true)

if [[ -z "$BTC_SIGNATURE" ]]; then
  echo "ERROR: BTC signing failed."
  echo "$BTC_SIG_OUTPUT"
  exit 1
fi
echo "       BTC signature: OK"

# Stacks signature
STX_SIG_OUTPUT=$(arc skills run --name bitcoin-wallet -- stacks-sign --message "$SIGN_MESSAGE" 2>&1)
STX_JSON=$(echo "$STX_SIG_OUTPUT" | parse_json || true)
STX_SIGNATURE=$(echo "$STX_JSON" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.signatureBase64 || d.signature || '');
" 2>/dev/null || true)

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

# Store AIBTC registration details in creds
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
  echo "[6/8] WARNING: No sponsor API key in response."
  echo "       ERC-8004 registration will need STX for fees."
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
  echo "       You can submit your pubkey manually later:"
  echo "       1. GET https://aibtc.com/api/challenge?address=$BTC_SEGWIT&action=update-pubkey"
  echo "       2. Sign the challenge message with btc-sign"
  echo "       3. POST the signed response back"
else
  echo "       Challenge: $CHALLENGE"
  echo "       Signing challenge..."

  CHALLENGE_SIG_OUTPUT=$(arc skills run --name bitcoin-wallet -- btc-sign --message "$CHALLENGE" 2>&1)
  CHALLENGE_JSON=$(echo "$CHALLENGE_SIG_OUTPUT" | parse_json || true)
  CHALLENGE_SIGNATURE=$(echo "$CHALLENGE_JSON" | bun -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.signatureBase64 || d.signature || '');
" 2>/dev/null || true)

  if [[ -z "$CHALLENGE_SIGNATURE" ]]; then
    echo "       WARNING: Challenge signing failed."
    echo "       $CHALLENGE_SIG_OUTPUT"
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
echo "  STX Address: $STX_ADDRESS"
echo "  Claim Code:  $CLAIM_CODE"
echo ""
