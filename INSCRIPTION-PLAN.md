# Brief Inscription Plan
**Quest:** Brief Inscriptions
**Created:** 2026-03-22
**Status:** APPROVED — execution in progress

---

## Summary

10 compiled daily briefs (March 13–17, 19–23) are ready to be inscribed as child ordinals
under the canonical aibtc.news parent inscription. March 18 is skipped (insufficient signals).

All costs are estimated at **1 sat/vB** — appropriate for archival inscriptions where slow
confirmation (hours, not minutes) is acceptable.

---

## Parent Inscription

```
fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0
```

Held by Loom's Taproot address: `bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we`

---

## Cost Table

| # | Date | Size (bytes) | Commit Fee (sats) | Reveal Fee (sats) | Reveal Amount (sats) | Total Cost (sats) | Status |
|---|------|-------------|-------------------|-------------------|---------------------|-------------------|--------|
| 1 | 2026-03-13 | 4,070 | 221 | 1,564 | 3,656 | **3,877** | pending |
| 2 | 2026-03-14 | 1,935 | 221 | 897 | 2,989 | **3,210** | pending |
| 3 | 2026-03-15 | 6,939 | 221 | 2,461 | 4,553 | **4,774** | pending |
| 4 | 2026-03-16 | 8,730 | 221 | 3,021 | 5,113 | **5,334** | pending |
| 5 | 2026-03-17 | 15,072 | 221 | 5,002 | 7,094 | **7,315** | pending |
| — | 2026-03-18 | — | — | — | — | **SKIPPED** | insufficient signals |
| 6 | 2026-03-19 | 9,690 | 221 | 3,321 | 5,413 | **5,634** | pending |
| 7 | 2026-03-20 | 17,388 | 221 | 5,726 | 7,818 | **8,039** | pending |
| 8 | 2026-03-21 | 9,973 | 221 | 3,409 | 5,501 | **5,722** | pending |
| 9 | 2026-03-22 | 14,693 | 221 | 4,884 | 6,976 | **7,197** | pending |
| 10 | 2026-03-23 | 10,577 | 221 | 3,598 | 5,690 | **5,911** | pending |
| | **TOTAL** | **99,067** | 2,210 | 33,883 | **53,803** | **57,013** | |

### Budget Check

| Item | Sats |
|------|------|
| Total estimated cost (10 briefs @ 1 sat/vB) | 57,013 |
| Available balance | 500,000 |
| Remaining after inscriptions | **442,987** |
| Percentage used | **11.4%** |

**Verdict: Budget is more than sufficient.** Even at 5x the fee rate (5 sat/vB), the total
would be ~285,065 sats — still well within the available 500,000 sats.

---

## Inscription Order

Chronological, March 13 → 23:

```
1.  2026-03-13  (4,070 bytes,  3,877 sats)
2.  2026-03-14  (1,935 bytes,  3,210 sats)
3.  2026-03-15  (6,939 bytes,  4,774 sats)
4.  2026-03-16  (8,730 bytes,  5,334 sats)
5.  2026-03-17 (15,072 bytes,  7,315 sats)
6.  2026-03-19  (9,690 bytes,  5,634 sats)
7.  2026-03-20 (17,388 bytes,  8,039 sats)
8.  2026-03-21  (9,973 bytes,  5,722 sats)
9.  2026-03-22 (14,693 bytes,  7,197 sats)
10. 2026-03-23 (10,577 bytes,  5,911 sats)
```

---

## Fee Rate Strategy

**Target: 1 sat/vB**

- Archival inscriptions — no urgency, slow confirmation is fine
- Typical confirmation time at 1 sat/vB: 2–6 hours (sometimes up to 24h if mempool spikes)
- If mempool is congested and 1 sat/vB is getting ignored, escalate to 2 sat/vB
- Never use `slow`, `medium`, or `fast` labels — pass `--fee-rate 1` explicitly for
  reproducible estimates and predictable costs

To check current mempool before executing:

```bash
curl -s https://mempool.space/api/v1/fees/recommended
```

If `minimumFee` is above 2, defer until mempool clears. These are archival inscriptions —
patience is the right strategy.

---

## Execution Approach

**Sequential commit+reveal cycles.** Each inscription is a two-step process:

```
Step 1: inscribe  →  broadcasts commit tx (locks sats in P2TR output)
Step 2: reveal    →  spends commit output, creates child inscription
```

The commit tx must confirm before the reveal tx is valid. Each cycle:
1. Run `inscribe` → get commit txid
2. Wait for 1 confirmation (~10 min at 1 sat/vB minimum, likely 2–6 hours)
3. Run `reveal` → child inscription is created
4. Confirm inscription ID in mempool.space
5. PATCH the aibtc.news API with the inscription ID
6. Proceed to next brief

Do **not** parallelize. The parent UTXO is spent in each reveal transaction and must be
returned before the next inscription can proceed.

---

## Exact Commands

### Setup (run once before starting)

```bash
cd ~/arc-starter

# Verify wallet is unlocked
bun run skills/bitcoin-wallet/bitcoin-wallet.ts status

# If not unlocked:
bun run skills/bitcoin-wallet/bitcoin-wallet.ts unlock

# Check BTC balance
bun run skills/bitcoin-wallet/bitcoin-wallet.ts balance
```

### Per-inscription Execution Template

Replace `{DATE}` with the target date (e.g., `2026-03-13`).

**Step 1 — Fetch brief content:**

```bash
DATE="{DATE}"
curl -s https://aibtc.news/api/brief/$DATE | python3 -c \
  "import sys, json; d=json.load(sys.stdin); t=d.get('brief',{}).get('text','') or d.get('text',''); print(t, end='')" \
  > /tmp/brief-$DATE.txt
```

**Step 2 — Run commit (inscribe):**

```bash
cd ~/arc-starter
bun run skills/child-inscription/child-inscription.ts inscribe \
  --parent-id fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0 \
  --content-type text/plain \
  --content-file /tmp/brief-$DATE.txt \
  --fee-rate 1
```

This outputs a `commitTxid`. Note it. **Wait for 1 confirmation before proceeding.**

**Step 3 — Monitor commit tx:**

```bash
# Check confirmation status (replace TXID)
curl -s https://mempool.space/api/tx/{COMMIT_TXID}/status | python3 -c \
  "import sys, json; d=json.load(sys.stdin); print('confirmed:', d.get('confirmed'), 'height:', d.get('block_height'))"
```

**Step 4 — Run reveal:**

The state file is saved automatically by the `inscribe` step. The `reveal` command reads it.

```bash
cd ~/arc-starter
bun run skills/child-inscription/child-inscription.ts reveal
```

This outputs the child inscription ID. Note it.

**Step 5 — Record inscription on aibtc.news API:**

```bash
cd ~/arc-starter

# Sign the PATCH request with BIP-137
TIMESTAMP=$(date +%s)
MESSAGE="PATCH /api/brief/$DATE:$TIMESTAMP"

SIGNATURE=$(bun run skills/bitcoin-wallet/bitcoin-wallet.ts sign-message "$MESSAGE" \
  | python3 -c "import sys, json; print(json.load(sys.stdin).get('signature',''))")

BTC_ADDRESS="bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku"
INSCRIPTION_ID="{INSCRIPTION_ID}"

curl -s -X PATCH https://aibtc.news/api/brief/$DATE \
  -H "Content-Type: application/json" \
  -d "{
    \"inscription\": \"$INSCRIPTION_ID\",
    \"btc_address\": \"$BTC_ADDRESS\",
    \"timestamp\": $TIMESTAMP,
    \"signature\": \"$SIGNATURE\"
  }"
```

---

## State File Management

The `child-inscription` skill saves a state file at `~/arc-starter/.child-inscription-state.json`
after each `inscribe` command. The `reveal` command reads this file.

**Before each inscription:**

```bash
cd ~/arc-starter

# Backup previous state (if any)
[ -f .child-inscription-state.json ] && \
  cp .child-inscription-state.json .child-inscription-state-backup-$(date +%Y%m%d%H%M%S).json && \
  echo 'Backed up state file'
```

**If something goes wrong:**

The state file contains the `commitTxid` and `revealAmount` needed to construct the reveal.
If the reveal fails, restore from backup and retry. Do not delete the state file until the
inscription is confirmed and the API has been updated.

---

## Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Commit tx stuck (low fee) | Low at 1 sat/vB unless mempool spike | Check mempool before starting; defer if min fee > 2 sat/vB |
| Reveal tx fails after commit confirms | Low | State file preserved; retry `reveal` command |
| Parent UTXO locked between cycles | Expected | Each reveal returns parent UTXO; wait for confirm before next inscribe |
| Wallet locked mid-sequence | Low | Check wallet status before each inscription |
| API PATCH fails | Low | Inscription still exists on-chain; retry PATCH independently |
| Content too large | Not applicable | Largest brief is 17,388 bytes — well within ordinals limits (~400KB) |

---

## Timeline Estimate

At 1 sat/vB with current mempool conditions:

| Phase | Time estimate |
|-------|--------------|
| Commit tx confirmation | 2–6 hours (can be up to 24h) |
| Reveal tx confirmation | 2–6 hours |
| Per inscription cycle | ~4–12 hours |
| All 10 inscriptions sequentially | **40–120 hours** (2–5 days) |

**Recommendation:** Start early in the day and run one or two inscriptions per session.
Do not wait for all 8 to complete in one sitting. The state file handles interruption safely.

If speed is needed, escalate to 2 sat/vB (doubles cost to ~87,810 sats, still well within budget)
for ~30–60 min confirmation per cycle, completing all 8 in under 16 hours.

---

## Post-Inscription Verification

After each reveal:

1. Search `https://ordinals.com/inscription/{INSCRIPTION_ID}` — verify content renders as plain text
2. Verify parent relationship: inscription metadata should show parent as
   `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0`
3. Check `https://aibtc.news/api/brief/{DATE}` — verify `inscription` field is now set
4. Update this document's cost table row status from `pending` → `inscribed: {INSCRIPTION_ID}`

---

## Notes for Phase 4

The `daily-brief-inscribe` sensor (installed on Loom) has a prerequisite guard that checks
for the CLI at `~/arc-starter/github/aibtcdev/skills/child-inscription/child-inscription.ts`.

Phase 1 installed the skill at `~/arc-starter/skills/child-inscription/child-inscription.ts`
(a different path). Phase 4 must either:
- Update the sensor's `CHILD_INSCRIPTION_CLI` path constant to point to the installed location, OR
- Clone `aibtcdev/skills` into `~/arc-starter/github/aibtcdev/skills/` as the sensor expects

The sensor also references `content-type text/html` in its task description, but the briefs
are plain text (`text/plain`). Phase 4 should correct this inconsistency.

---

## Approval Checklist

Before Phase 4 (execution) begins, confirm:

- [x] This plan has been reviewed and approved
- [x] Fee rate strategy is acceptable (1 sat/vB default, 2 sat/vB max)
- [x] Sequential execution approach is acceptable (not parallel)
- [x] Timeline is acceptable (up to 4 days at 1 sat/vB, or ~16 hours at 2 sat/vB)
- [x] PATCH endpoint authentication method has been verified
- [ ] Wallet is unlocked on Loom before execution begins
