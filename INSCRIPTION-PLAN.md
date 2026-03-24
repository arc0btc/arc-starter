# Brief Inscription Plan
**Quest:** Brief Inscriptions
**Created:** 2026-03-22
**Status:** AWAITING HUMAN APPROVAL — do not execute until approved

---

## Summary

8 compiled daily briefs (March 13–17, 19–21) are ready to be inscribed as child ordinals
under the canonical aibtc.news parent inscription. March 18 is skipped (insufficient signals).
March 22's brief was not yet compiled at the time of this plan (API returned 404).

All costs are estimated at **1 sat/vB** — appropriate for archival inscriptions where slow
confirmation (hours, not minutes) is acceptable.

---

## Parent Inscription

```
9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0
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
| — | 2026-03-22 | — | — | — | — | **DEFERRED** | not yet compiled |
| | **TOTAL** | **73,797** | 1,768 | 25,401 | **41,137** | **43,905** | |

### Budget Check

| Item | Sats |
|------|------|
| Total estimated cost (8 briefs @ 1 sat/vB) | 43,905 |
| Available balance | 500,000 |
| Remaining after inscriptions | **456,095** |
| Percentage used | **8.8%** |

**Verdict: Budget is more than sufficient.** Even at 10x the fee rate (10 sat/vB), the total
would be ~439,050 sats — still within the available 500,000 sats. There is no budget risk at
any reasonable fee rate.

---

## Inscription Order

Chronological, March 13 → 21:

```
1. 2026-03-13  (4,070 bytes, 3,877 sats)
2. 2026-03-14  (1,935 bytes, 3,210 sats)
3. 2026-03-15  (6,939 bytes, 4,774 sats)
4. 2026-03-16  (8,730 bytes, 5,334 sats)
5. 2026-03-17 (15,072 bytes, 7,315 sats)
6. 2026-03-19  (9,690 bytes, 5,634 sats)
7. 2026-03-20 (17,388 bytes, 8,039 sats)
8. 2026-03-21  (9,973 bytes, 5,722 sats)
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
source ~/manage-agents/.env && sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "curl -s https://mempool.space/api/v1/fees/recommended"
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

## Exact SSH Commands

### Setup (run once before starting)

```bash
source /home/whoabuddy/manage-agents/.env

# Verify wallet is unlocked on Loom
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/bitcoin-wallet/bitcoin-wallet.ts status"

# If not unlocked:
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/bitcoin-wallet/bitcoin-wallet.ts unlock"

# Check BTC balance
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/bitcoin-wallet/bitcoin-wallet.ts balance"
```

### Per-inscription Execution Template

Replace `{DATE}` with the target date (e.g., `2026-03-13`).

**Step 1 — Fetch brief content:**

```bash
source /home/whoabuddy/manage-agents/.env

DATE="{DATE}"
curl -s https://aibtc.news/api/brief/$DATE | python3 -c \
  "import sys, json; d=json.load(sys.stdin); t=d.get('brief',{}).get('text','') or d.get('text',''); print(t, end='')" \
  > /tmp/brief-$DATE.txt

# Copy to Loom
sshpass -p "$VM_PASSWORD" scp -o StrictHostKeyChecking=no \
  /tmp/brief-$DATE.txt dev@192.168.1.14:/tmp/brief-$DATE.txt
```

**Step 2 — Run commit (inscribe):**

```bash
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/child-inscription/child-inscription.ts inscribe \
    --parent-id 9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0 \
    --content-type text/plain \
    --content-file /tmp/brief-$DATE.txt \
    --fee-rate 1"
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
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/child-inscription/child-inscription.ts reveal"
```

This outputs the child inscription ID. Note it.

**Step 5 — Record inscription on aibtc.news API:**

```bash
# First get a fresh auth token (Loom signs with its BTC key)
# The PATCH endpoint requires publisher authentication (BIP-322)
TIMESTAMP=$(date +%s)
MESSAGE="PATCH /api/brief/$DATE:$TIMESTAMP"

# Sign the message via Loom's bitcoin-wallet skill
SIGNATURE=$(sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && bun run skills/bitcoin-wallet/bitcoin-wallet.ts sign-message '$MESSAGE'" \
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
# Backup previous state (if any)
sshpass -p "$VM_PASSWORD" ssh -o StrictHostKeyChecking=no dev@192.168.1.14 \
  "cd ~/arc-starter && [ -f .child-inscription-state.json ] && \
   cp .child-inscription-state.json .child-inscription-state-backup-\$(date +%Y%m%d%H%M%S).json && \
   echo 'Backed up state file'"
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
| All 8 inscriptions sequentially | **32–96 hours** (1.5–4 days) |

**Recommendation:** Start early in the day and run one or two inscriptions per session.
Do not wait for all 8 to complete in one sitting. The state file handles interruption safely.

If speed is needed, escalate to 2 sat/vB (doubles cost to ~87,810 sats, still well within budget)
for ~30–60 min confirmation per cycle, completing all 8 in under 16 hours.

---

## Post-Inscription Verification

After each reveal:

1. Search `https://ordinals.com/inscription/{INSCRIPTION_ID}` — verify content renders as plain text
2. Verify parent relationship: inscription metadata should show parent as
   `9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0`
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

- [ ] This plan has been reviewed and approved
- [ ] Fee rate strategy is acceptable (1 sat/vB default, 2 sat/vB max)
- [ ] Sequential execution approach is acceptable (not parallel)
- [ ] Timeline is acceptable (up to 4 days at 1 sat/vB, or ~16 hours at 2 sat/vB)
- [ ] PATCH endpoint authentication method has been verified
- [ ] Wallet is unlocked on Loom before execution begins
