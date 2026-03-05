# Workflow Templates Reference

Detailed specifications for all built-in workflow templates.

## PR Lifecycle (`pr-lifecycle`)

Track GitHub pull requests through their full lifecycle.

**States:**
- `opened` — PR is newly created
- `review-requested` — Review has been requested
- `changes-requested` — Reviewer requested changes
- `approved` — All reviewers approved
- `merged` — PR is merged (terminal)
- `closed` — PR is closed without merging (terminal)

**Auto-detection:** The workflows sensor automatically syncs GitHub PRs to workflow instances. It:
1. Queries GitHub API for open/closed PRs (every 5 minutes)
2. Creates workflow instances for new PRs (instance_key = `owner/repo/number`)
3. Updates workflow state when PR state changes
4. Auto-completes workflows when PR reaches terminal state (merged/closed)

**Configuration:**
- Set `PR_LIFECYCLE_REPOS` env var to comma-separated list of repos (e.g., `org/repo1,org/repo2`)
- Default repos: `arc0btc/arc-starter, arc0btc/arc0me-site`
- Requires GitHub token in credentials: `arc creds get --service github --key token`

## Reputation Feedback (`reputation-feedback`)

Give on-chain feedback to agents via ERC-8004. Guides mentorship interactions through multi-step process.

**States:**
- `pending` — Initial state, awaiting workflow start
- `checking_reputation` — Retrieving current reputation summary (auto-creates task)
- `feedback_submitted` — Feedback submitted on-chain, awaiting confirmation (~10-30 min)
- `confirmed` — Feedback confirmed on-chain, reputation updated
- `completed` — Workflow finished (terminal)

**Context schema:**
```typescript
{
  agentId: number;           // Required: Agent ID to give feedback for
  agentName?: string;        // Optional: Agent name for clarity
  currentScore?: number;     // Before feedback
  rating: number;            // Required: Feedback value (e.g., 1-5 or signed integer)
  tag1?: string;             // Optional: Primary tag (e.g., "helpful", "accuracy")
  tag2?: string;             // Optional: Secondary tag (e.g., "shipped-code")
  endpoint?: string;         // Optional: Context identifier for feedback
  feedbackUri?: string;      // Optional: URI to detailed feedback data
  feedbackHash?: string;     // Optional: SHA-256 hash of feedback
  txid?: string;             // Transaction ID after submission
  updatedScore?: number;     // After confirmation
  notified?: boolean;        // Optional: Did we notify the agent?
}
```

**Pattern:** Mentorship feedback giving. Arc evaluates other agents, gives on-chain feedback, tracks confirmation.

**Requires:** `erc8004-reputation` skill (for give-feedback operations)

## Inscription (`inscription`)

Manage Bitcoin inscription lifecycle through two-phase commit/reveal process.

**States:**
- `pending` — Initial state, inscription data prepared
- `commit_preparing` — Preparing commit transaction (fee estimation, UTXO selection)
- `commit_broadcasted` — Commit transaction broadcast, awaiting confirmation
- `reveal_pending` — Commit confirmed, ready for reveal
- `reveal_preparing` — Preparing reveal transaction
- `reveal_broadcasted` — Reveal transaction broadcast, awaiting confirmation
- `confirmed` — Reveal confirmed, inscription complete
- `completed` — Workflow finished (terminal)

**Context schema:**
```typescript
{
  dataHash: string;          // Required: SHA-256 hash of inscription data
  dataSize?: number;         // Optional: Size in bytes
  walletAddress: string;     // Required: Wallet address for inscriptions
  commitTxid?: string;       // Commit transaction ID after broadcast
  commitFee?: number;        // Commit transaction fee (sats)
  commitConfirmed?: boolean; // Whether commit reached target confirmations
  revealTxid?: string;       // Reveal transaction ID after broadcast
  revealFee?: number;        // Reveal transaction fee (sats)
  revealConfirmed?: boolean; // Whether reveal reached target confirmations
  inscriptionId?: string;    // Inscription ID after reveal confirmation
  network?: string;          // "mainnet" or "testnet" (default: mainnet)
}
```

**Pattern:** Two-phase Byzantine commit for Bitcoin inscriptions. Commit phase reserves UTXO. Reveal phase uses committed UTXO to inscribe data. State machine ensures atomic semantics and fee tracking across both phases.

**Requires:** `bitcoin-wallet` skill (for transaction preparation and broadcast)

## Validation Request (`validation-request`)

Multi-step request for attestation or validation of data or identity.

**States:**
- `pending` — Request created, awaiting submission
- `request_sent` — Request submitted to validator
- `confirmed` — Validator acknowledged request
- `response_submitted` — Validator provided response
- `verified` — Response verified and accepted
- `completed` — Workflow finished (terminal)

## Signal Filing (`signal-filing`)

File a signal to aibtc.news for a beat.

**Context:** Beat name, signal content, URL references

## Beat Claiming (`beat-claiming`)

Claim or maintain a beat on aibtc.news.

**Context:** Beat slug, claimed status

## Blog Posting (`blog-posting`)

Multi-stage blog post publishing workflow.

**States:** `draft`, `review`, `scheduled`, `published`, `completed`
