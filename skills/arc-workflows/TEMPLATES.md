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

## New Release (`new-release`)

Track assessment and integration of upstream releases.

**States:**
- `detected` — Release detected, awaiting assessment
- `assessing` — Assessment task created, review in progress
- `integration_pending` — Assessment complete, action required
- `integrating` — Integration changes in progress
- `no_action` — No integration needed
- `completed` — Workflow finished (terminal)

**Context schema:**
```typescript
{
  repo?: string;              // Required: Repository name
  version?: string;           // Required: Release version
  releaseUrl?: string;        // Optional: URL to release notes
  skills?: string[];          // Optional: Skills for assessment/integration
  assessmentSummary?: string; // Assessment findings
  actionRequired?: boolean;   // Whether integration is needed
  integrationDescription?: string; // Custom integration instructions
}
```

**Pattern:** Detect new upstream releases, assess impact, integrate relevant changes.

**Requires:** `arc-skill-manager` skill (for assessment and integration)

## Architecture Review (`architecture-review`)

Track architecture review cycles with followup cleanup tasks.

**States:**
- `triggered` — Review triggered by event
- `reviewing` — Review in progress
- `cleanup_pending` — Review complete, cleanup items identified
- `cleaning` — Cleanup tasks in progress
- `completed` — Workflow finished (terminal)

**Context schema:**
```typescript
{
  trigger?: string;        // "codebase-changed" | "active-reports" | "scheduled"
  diagramPath?: string;    // Path to architecture diagram
  reviewSummary?: string;  // Findings from review task
  cleanupItems?: string;   // Identified cleanup tasks
}
```

**Pattern:** Architecture review automatically spawns cleanup subtasks to prevent stale followups.

**Requires:** `arc-architecture-review`, `arc-skill-manager` skills

## Email Thread (`email-thread`)

Triage, respond to, and extract learnings from incoming email threads.

**States:**
- `received` — Email thread received; creates triage task
- `triaged` — Thread reviewed, action items identified; auto-transitions to `reply_pending` or `retrospective_pending`
- `reply_pending` — Reply needed; creates reply task; advances to `retrospective_pending`
- `retrospective_pending` — All actions done; creates retrospective task (skipped if no action items)
- `completed` — Workflow finished (terminal)

**Context schema:**
```typescript
{
  sender?: string;       // Sender name/email
  subject?: string;      // Email subject
  messageCount?: number; // Messages in thread
  source?: string;       // Detecting skill (arc-email-sync, etc.)
  needsReply?: boolean;  // Whether a reply is needed
  actionItems?: string;  // Comma-separated summary of action items spawned
  replyDraft?: string;   // Draft reply text (set before transitioning to reply_pending)
  taskRef?: string;      // "task:{id}" of root dispatch task (for retrospective reference)
}
```

**Pattern:** Automatically triage emails, spawn followup tasks, send replies, then capture learnings. The retrospective step is skipped for purely informational threads (no actionItems).

**Requires:** `arc-email-sync`, `arc-skill-manager` skills

**instance_key:** `email-thread-{sender-slug}-{message-id-or-date}` (one per thread)

## Quest (`quest`)

Decompose complex tasks into sequential phases.

**States:**
- `planning` — Quest phases being planned
- `executing` — Phases executing sequentially
- `completed` — All phases complete (terminal)

**Context schema:**
```typescript
{
  slug: string;              // Short identifier
  goal: string;              // High-level goal
  sourceTaskId: number | null; // Task that spawned quest
  parentTaskId: number | null; // Parent for phase tasks
  skills: string[];          // Skills for phase tasks
  model: string;             // Model tier (opus/sonnet/haiku)
  phases: QuestPhase[];      // Array of phase definitions
  currentPhase: number;      // 1-indexed current phase
}
```

**Phase structure:**
```typescript
{
  n: number;                           // Phase number
  name: string;                        // Phase name
  goal: string;                        // Phase goal
  status: "pending"|"active"|"completed"|"failed"; // Phase status
  taskId: number | null;               // Spawned task ID
}
```

**Pattern:** Break large goals into small (<2min) phases. Execute one phase per task. Checkpoint in workflow context so failures restart from last state, not from scratch.

## Blog Posting (`blog-posting`)

Multi-stage blog post publishing workflow.

**States:** `draft`, `review`, `scheduled`, `published`, `completed`
