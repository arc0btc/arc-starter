---
name: arc-inbox
description: On-chain message inbox for Arc — Clarity contract on Stacks for public message submission and Arc-only replies.
---

# arc-inbox

On-chain message and reply storage via a Clarity smart contract on Stacks (L2).

## Contract: `arc-inbox`

Deployed by Arc (`SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`).

### Data Model

- **messages** map: `message-id → {sender, recipient, content (string-utf8 1024), timestamp (block-height), replied, reply}`
- **sender-messages** map: `sender → last-message-id` (tracks each sender's most recent message)
- **message-count** var: total messages posted

### Public Functions

| Function | Who | Description |
|----------|-----|-------------|
| `(post-message (content (string-utf8 1024)))` | Any principal | Submit a message to Arc. Fails if sender has an unreplied pending message (ERR_PENDING_MESSAGE u102). |
| `(post-reply (message-id uint) (content (string-utf8 1024)))` | Arc only | Reply to a message. Sets `replied=true` and stores reply content. |

### Read-Only Functions

| Function | Returns |
|----------|---------|
| `(get-message (message-id uint))` | Full message tuple or `none` |
| `(get-sender-last-message (sender principal))` | `{last-message-id}` or `none` |
| `(get-message-count)` | Total message count (uint) |

### Error Codes

| Code | Constant | Meaning |
|------|----------|---------|
| u100 | ERR_NOT_ARC | Caller is not Arc's address |
| u101 | ERR_MESSAGE_NOT_FOUND | Message ID does not exist |
| u102 | ERR_PENDING_MESSAGE | Sender has an unreplied message — wait for reply |
| u103 | ERR_ALREADY_REPLIED | Message already has a reply |
| u104 | ERR_EMPTY_CONTENT | Content string is empty |

### Deployment

Contract source: `skills/arc-inbox/contract/arc-inbox.clar`
Contract ID: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B.arc-inbox`

**Status:** Not yet deployed. Testnet attempt failed (2026-03-18) — wallet has 0 testnet STX and contract hardcodes mainnet ARC_ADDRESS (`SP2...`), making testnet non-functional for `post-reply`. Deploy directly to mainnet.

Deploy to mainnet:
```bash
cd /home/dev/arc-starter/github/aibtcdev/skills
bun run wallet/wallet.ts unlock --password <password>
NETWORK=mainnet bun run stx/stx.ts deploy-contract \
  --contract-name arc-inbox \
  --code-body "$(cat /home/dev/arc-starter/skills/arc-inbox/contract/arc-inbox.clar)" \
  --fee medium
```

After deployment, monitor tx status:
```bash
bun run stx/stx.ts get-transaction-status --txid <txid>
```

Verify:
```bash
bun run query/query.ts get-contract-info --contract-id SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B.arc-inbox
```

### Integration

Once deployed, other skills/sensors can interact via read-only calls:
```bash
bun run query/query.ts call-read-only \
  --contract-id SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B.arc-inbox \
  --function-name get-message-count
```

Future: arc-inbox sensor to monitor new messages and create reply tasks.
