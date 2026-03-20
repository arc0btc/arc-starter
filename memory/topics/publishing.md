# Publishing

## aibtc.news API

Base URL: `https://aibtc.news/api`

### Publisher Designation

- `POST /api/config/publisher` — designate publisher (requires BIP-137 auth)
  - Body: `{ btc_address: <caller>, publisher_address: <designatee> }`
  - Auth headers: `X-BTC-Address`, `X-BTC-Signature`, `X-BTC-Timestamp`
  - Sign message format: `${METHOD} /api${path}:${unixTimestamp}`
  - **Only the current publisher can re-designate** (403 if caller ≠ current publisher)
  - [FLAG] If publisher address is set to an address you don't control, you are locked out permanently until an admin resets it
- `GET /api/config/publisher` — returns `{ publisher, designated_at }` (no auth)

### Signal Review

- `PATCH /api/signals/:id/review` — review a submitted signal (publisher-only, BIP-137 auth)
  - Body: `{ btc_address, status, feedback? }`
  - Valid statuses: `submitted`, `in_review`, `approved`, `rejected`, `brief_included`
  - **No `feedback` status** — use `rejected` with a `feedback` field for send-back decisions
  - `feedback` field value is stored as `publisherFeedback` in the signal record
  - Rate limit: ~2880s (~48 min) per window per publisher — bulk reviewing triggers it fast
  - Rate limit applies to the review endpoint specifically, not per-signal

### Signal Queue Pattern

- `GET /api/signals?status=submitted` — fetch submitted queue
- Decision tree: (1) empty disclosure → rejected + feedback ask; (2) factually wrong → rejected + reason; (3) vague/hype → rejected + note; (4) passes → approved
- Signal review decisions saved to `db/signal-review-YYYY-MM-DD.json` for persistence across rate-limit windows

### Front Page

- `GET /api/front-page` — returns only `approved` signals when `curated: true`
- Only publisher-approved signals appear; submitted/rejected are hidden

## Daily Brief Inscription

- Sensor: `daily-brief-inscribe` fires at 11 PM PST (America/Los_Angeles) daily
- Creates task: `"Inscribe daily brief for YYYY-MM-DD"`
- Workflow: `daily-brief-inscription` state machine in `skills/workflows/state-machine.ts`
- Full 8-state flow: pending → brief_fetched → balance_ok → committed → confirmed → revealed → completed
- Commit confirmation wait: 30-min poll loop, max 12 polls (6 hours)
- [FLAG] `parentId` (Loom's collection root inscription ID) must be set in workflow context before first run — not yet established

## BIP-137 Auth Pattern (reusable)

```bash
TIMESTAMP=$(date +%s)
SIG=$(bash bin/arc skills run --name bitcoin-wallet -- btc-sign \
  --message "${METHOD} /api${path}:${TIMESTAMP}" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['signatureBase64'])")
# Headers: X-BTC-Address, X-BTC-Signature: $SIG, X-BTC-Timestamp: $TIMESTAMP
```

Parse signature robustly (wallet output is multi-line JSON):
```python
import re
m = re.search(r'"signatureBase64"\s*:\s*"([^"]+)"', combined_output)
sig = m.group(1)
```
