# AGENT.md — arc-payments

You are executing a task created by the arc-payments sensor. A payment arrived at Arc's Stacks address with an `arc:` memo code that matched a known service. Your job is to deliver that service.

---

## Task Context

The task description always contains these fields (populated by the sensor):

```
Service: arc:<code>
Currency: STX | sBTC
Amount: <human-readable> (<raw> microSTX or sats)
Sender: SP...
Txid: 0x...
Block: <block_height>
Memo: arc:<code>
```

Use these fields to understand what was ordered and by whom. The txid is your receipt — reference it in all responses.

---

## Service Codes → What to Do

| Memo code | Subject pattern | Skills | Model | Action |
|-----------|----------------|--------|-------|--------|
| `arc:arxiv-latest` | `Deliver arXiv digest to <sender>` | `arxiv-research` | sonnet | Run the arxiv-research skill to produce a digest of recent papers. Deliver via inbox message to sender. |
| `arc:ask-quick` | `Ask Arc (Quick) from <sender>` | — | haiku | Retrieve the question from X DMs (sender quoted txid) or @arc0btc DMs. Answer concisely. |
| `arc:ask-informed` | `Ask Arc (Informed) from <sender>` | — | sonnet | Same as ask-quick but with deeper research. Use web search if needed. |
| `arc:pr-standard` | `PR Review ordered by <sender>` | `aibtc-repo-maintenance` | sonnet | Get the PR URL from X DMs. Run a thorough review. Post findings as a GitHub comment. |
| `arc:monitor-basic` | `Monitoring service (Basic) ordered by <sender>` | `arc-monitoring-service` | haiku | Get the endpoint URL from X DMs. Set up basic uptime monitoring. |
| `arc:monitor-pro` | `Monitoring service (Pro) ordered by <sender>` | `arc-monitoring-service` | haiku | Same as monitor-basic but with response-time tracking and alerting. |
| `arc:feed-premium` | `Premium intelligence digest for <sender>` | `arc-memory` | sonnet | Synthesize a tailored intelligence digest from Arc's memory and recent signals. Deliver via inbox. |

---

## Retrieving the Buyer's Request

For services that require additional input (ask-quick, ask-informed, pr-standard, monitor-basic, monitor-pro):

1. Check X DMs from the sender's Stacks address (they may have linked a Twitter/X handle).
2. Check @arc0btc DMs where the sender quoted the txid.
3. If no DM found within reasonable lookup, send a reply to the sender's inbox:
   ```
   arc skills run --name arc-inbox -- send --to <sender> --subject "Payment received — awaiting your request" \
     --body "I received your payment (txid: <txid>). Please DM @arc0btc with your question/URL, quoting this txid."
   ```
4. Close the task as `completed` with summary "awaiting input from sender — inbox message sent".

---

## STX vs sBTC Detection

The sensor already resolved currency before creating the task. The `Currency:` field in the description tells you which path was taken:

**STX path:** `tx_type = token_transfer`. Memo is a 34-byte hex buffer decoded to UTF-8 with trailing null bytes stripped.

**sBTC path:** `tx_type = contract_call` to `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`, function `transfer`. Memo comes from the optional `(buff 34)` argument, decoded from Clarity repr (`(some 0x...)` → hex → UTF-8).

You do not need to re-parse the transaction — the sensor already validated currency, minimum amount, and memo. Trust the task description.

---

## Minimum Amounts (reference only — already validated by sensor)

| Code | STX min | sBTC min (sats) |
|------|---------|-----------------|
| `arc:arxiv-latest` | 5 STX | 5,000 sats |
| `arc:ask-quick` | 1 STX | 1,000 sats |
| `arc:ask-informed` | 5 STX | 5,000 sats |
| `arc:pr-standard` | 40 STX | 40,000 sats |
| `arc:monitor-basic` | 2 STX | 500 sats |
| `arc:monitor-pro` | 10 STX | 2,500 sats |
| `arc:feed-premium` | 1 STX | 1,000 sats |

The sensor already rejected underpayments. If you somehow receive a task with an amount below minimum, close it as `failed` with "underpayment — sensor validation gap" and flag for investigation.

---

## WoT Check (Sybil Guard)

Before delivering any service, optionally verify sender reputation:

```
arc skills run --name nostr-wot -- sybil-check --pubkey <hex>
```

Stacks addresses do not map directly to Nostr pubkeys. You need the pubkey from X DM context or contact lookup. If `likely_sybil = true`, withhold delivery and close as `failed` with "sybil check failed — service withheld".

If the pubkey is unknown, skip the check and proceed with delivery. Sybil guard is best-effort.

---

## Dedup Guarantee

The sensor uses `pendingTaskExistsForSource(source)` where `source = sensor:arc-payments:<txid>`. Each txid produces at most one task, ever. You will never receive duplicate tasks for the same payment.

---

## State Tracking

The sensor stores `last_block_height` in hook state (via `writeHookState("arc-payments", ...)`). On each 3-minute run it fetches the last 25 transactions and filters to blocks after `last_block_height`. This means:

- Payments older than the last processed block are never re-processed.
- If the sensor misses a run window, it catches up on the next run (up to 25 txs back).
- If Arc's address receives >25 txs between sensor runs, older payments in that batch may be missed. This is a known gap — file a follow-up task if you see evidence of it.

You do not need to interact with hook state. It is sensor-internal.

---

## Unrecognized Memo

If a payment arrives with an `arc:` prefix that does not match any key in SERVICE_MAP, the sensor logs `skip: no arc: service prefix in memo` and does NOT create a task. No dispatch action is taken — correct behavior.

If you receive a task with an unrecognized service code (should not happen under normal operation):
1. Do NOT attempt to guess the service.
2. Close as `failed` with "unrecognized arc: service code — no task created".
3. Create a follow-up task: `arc tasks add --subject "arc-payments: unknown service code in task description" --priority 5 --model sonnet`.

Never create malformed or speculative tasks from payment data.

---

## Delivery Checklist

- [ ] Read `Service:`, `Sender:`, `Txid:`, `Amount:` from task description
- [ ] For input-dependent services: retrieve question/URL from X DMs before proceeding
- [ ] Run sybil check if Nostr pubkey is available
- [ ] Execute the service (arxiv digest, answer, PR review, monitoring setup, feed)
- [ ] Reference the txid in all responses and inbox messages
- [ ] Close task: `arc tasks close --id <id> --status completed --summary "<one-line summary>"`
