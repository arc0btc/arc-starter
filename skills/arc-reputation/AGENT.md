# AGENT.md — arc-reputation

You are executing a reputation task. This document is your execution brief.

---

## What This Skill Does

arc-reputation is a signed peer review system. Reviews are canonical JSON documents signed with BIP-322 (native SegWit) via Arc's Bitcoin wallet, stored in a local SQLite `reviews` table, and exportable as portable signed documents for independent verification.

Every review is **immutable** once stored. There is no update or delete.

---

## Signed Review Format

The payload that gets BIP-322-signed:

```json
{
  "version": 1,
  "subject": "API reliability",
  "reviewer_address": "bc1q...",
  "reviewee_address": "bc1q...",
  "rating": 4,
  "comment": "Consistent uptime over 30 days",
  "tags": ["reliability", "api"],
  "created_at": "2026-03-06T23:00:00.000Z"
}
```

**Fields:**
- `version` — Always `1`. Fixed.
- `subject` — Short description of what is being reviewed (e.g., "API reliability", "task execution quality").
- `reviewer_address` — Bitcoin address of the signer. Discovered automatically during signing; you do NOT need to supply it.
- `reviewee_address` — Bitcoin address of the entity being reviewed. You must supply this.
- `rating` — Integer 1–5. No decimals.
- `comment` — Optional detailed text. Can be empty string.
- `tags` — Optional array of short lowercase strings. Use `--tags "tag1,tag2"` (comma-separated, not JSON).
- `created_at` — ISO 8601 timestamp. Set automatically at signing time.

**Signing mechanics:** The CLI builds the canonical JSON string (`JSON.stringify` with fixed key order), calls `bitcoin-wallet/sign-runner.ts btc-sign`, discovers the signer address from the signing result, then re-signs the final payload with `reviewer_address` populated. Both sign calls happen internally — you do not manage this manually.

---

## CLI Commands

All commands use: `arc skills run --name arc-reputation -- <subcommand> [flags]`

### give-feedback (write + sign a review)

```
arc skills run --name arc-reputation -- give-feedback \
  --reviewee <btc-address> \
  --subject "<text>" \
  --rating <1-5> \
  [--comment "<text>"] \
  [--tags "<tag1,tag2>"]
```

**Requirements:**
- `--reviewee` — Bitcoin address (bc1q... format). Get from `arc skills run --name contacts -- ...` if needed.
- `--subject` — What is being reviewed. Keep it concise (under 60 chars).
- `--rating` — Integer 1–5. 1=poor, 3=adequate, 5=excellent.
- Wallet password and wallet ID must be in the credential store. If missing, the command exits with `"Wallet password not found"` or `"Wallet ID not found"`.

**Success output:**
```json
{
  "success": true,
  "review_id": 42,
  "reviewer": "bc1q...",
  "reviewee": "bc1q...",
  "rating": 4,
  "subject": "API reliability",
  "signature": "base64...",
  "message_hash": "hex..."
}
```

**Record the `review_id`** — you'll need it for verify/show/export.

### verify (check a stored review's signature)

```
arc skills run --name arc-reputation -- verify --id <review-id>
```

**Success output:**
```json
{
  "success": true,
  "review_id": 42,
  "signature_valid": true,
  "reviewer": "bc1q..."
}
```

If `signature_valid` is `false`, include `verification_error` in the result.

### show (retrieve a single review)

```
arc skills run --name arc-reputation -- show --id <review-id>
```

Returns the full review record with `tags` parsed as an array (not the raw JSON string stored in SQLite).

### list (query reviews)

```
arc skills run --name arc-reputation -- list [--reviewee <addr>] [--reviewer <addr>] [--limit <n>]
```

- No filters → returns most recent 50 reviews
- `--reviewee` or `--reviewer` → filters by that address; no `--limit` applies when filtered
- Returns `{ success: true, count: N, reviews: [...] }`

### summary (reputation aggregate for an address)

```
arc skills run --name arc-reputation -- summary --address <btc-address>
```

**Success output:**
```json
{
  "success": true,
  "address": "bc1q...",
  "total_reviews": 12,
  "average_rating": 4.17,
  "min_rating": 3,
  "max_rating": 5
}
```

If no reviews exist: `{ "success": true, "address": "...", "total_reviews": 0, "message": "No reviews found for this address" }`.

### export (portable signed document)

```
arc skills run --name arc-reputation -- export --id <review-id>
```

Outputs the full payload + signature + message_hash as a self-contained document for sharing or independent verification. The signature can be verified against the payload by any BIP-322 verifier.

---

## Common Task Patterns

### "Review agent X for task quality"

1. Look up agent's Bitcoin address via contacts skill if not known.
2. Run `give-feedback` with subject like `"Task #N: <task title>"`, rating 1–5, comment with specifics.
3. Record the `review_id` in your task result_summary.

### "Summarize reputation for agent X"

1. Get Bitcoin address from contacts or task context.
2. Run `summary --address <addr>` to get aggregate stats.
3. Run `list --reviewee <addr>` to get individual reviews if detail is needed.
4. Report `average_rating`, `total_reviews`, and any notable comments.

### "Verify review integrity"

1. Run `verify --id <n>` — checks that the stored signature matches the stored payload.
2. `signature_valid: true` = the review was not tampered with after signing.
3. If `signature_valid: false`, note the `verification_error` and flag the review as potentially corrupt.

---

## Error Modes

| Error | Cause | Fix |
|-------|-------|-----|
| `Wallet password not found in credential store` | `bitcoin-wallet` / `password` credential missing | Escalate: wallet setup required |
| `Wallet ID not found in credential store` | `bitcoin-wallet` / `id` credential missing | Escalate: wallet setup required |
| `Signing failed` | sign-runner subprocess failed | Check stderr detail; may be wallet locked or signing script missing |
| `Final signing failed` | Second sign call (with reviewer_address populated) failed | Same as above; transient error — retry once |
| `Review #N not found` | Review ID doesn't exist | Verify the ID from a prior `list` call |
| `Rating must be an integer from 1 to 5` | Non-integer or out-of-range rating | Fix the `--rating` value |
| Exit code 1 with no JSON | CLI parse error or missing required flag | Check required flags: `--reviewee`, `--subject`, `--rating` |

**Do not retry signing failures more than once.** Signing failure is not transient; it usually indicates a missing credential or broken wallet path.

---

## Storage Details

- Table: `reviews` in `db/arc.sqlite`
- `tags` column is stored as a JSON string (`'["tag1","tag2"]'`); the CLI automatically parses it to an array in all outputs.
- `created_at` defaults to `datetime('now')` (UTC) if not set explicitly.
- Reviews are indexed by `reviewer_address`, `reviewee_address`, and `rating`.

---

## Constraints

- Read operations (`show`, `list`, `summary`, `verify`, `export`) do NOT require the wallet to be unlocked.
- `give-feedback` DOES require the wallet (handled via sign-runner automatically).
- There is no way to delete or update a review. If you file an incorrect review, note the error in your task result and create a corrective review if needed.
- Only one reviewer per review record. You cannot co-sign.
