# Inscription Ledger

**Last verified:** 2026-04-16 (partial restoration of wrongly-voided signals in progress; see `db/payouts/2026-04-16-audit-update.md`)
**Source of truth order:** (1) on-chain mempool.space, (2) local `db/inscriptions/*.json`, (3) platform `GET /api/brief/{date}.inscription`
**Canonical parent:** `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0`
**Wallet (taproot):** `bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we`

The publisher's reveal txs form a parent-child chain — each daily inscription spends the previous reveal output, so a gap in the chain proves a missing inscription without needing to query each date.

---

## Ledger (Mar 17 → Apr 13)

| Date | Signals | Commit Txid | Reveal / Inscription ID | Block | Local file | Platform | Status |
|------|--------:|-------------|--------------------------|------:|-----------|----------|--------|
| Mar 17 | 18 | — | `aa631fc8…i0` | — | — | yes | Pre-Loom — clean |
| Mar 19 | 8  | — | `1529bd01…i0` | — | — | yes | Pre-Loom — clean |
| Mar 20 | 16 | — | `9d3af59b…i0` | — | — | yes | Pre-Loom — clean |
| Mar 21 | 10 | — | `98d28b74…i0` | — | — | yes | Pre-Loom — clean |
| Mar 22 | 14 | — | `e8266182…i0` | — | — | yes | Pre-Loom — clean |
| Mar 23 | 11 | — | `f83f0b42…i0` | — | — | yes | Pre-Loom — clean |
| Mar 24 | 38 | — | `56b6136b…i0` | — | — | yes | Confirmed — 3 orphans (audit §2) |
| Mar 25 | 35 | — | `fcc94f92…i0` | — | — | yes | Confirmed — 7 RBF victims (audit §3) |
| Mar 26 | 13 | — | `02a31fd0…i0` | — | — | yes | Clean |
| Mar 27 | 45 | — | `8366c0b5…i0` | — | — | yes | Confirmed — 2 orphans (audit §2) |
| Mar 28 | 30 (amended) | — | `7cad42fa…i0` | — | — | yes (needs ID update §5) | Amended brief — 107 voided |
| Mar 29 | 30 (amended) | — | `07b3788e…i0` | — | — | yes (needs ID update §5) | Amended brief — 205 voided |
| Mar 30 | 76 → 30 | — | `5794269f…i0` | — | — | yes | Curated to 30, 46 voided |
| Mar 31 | 120 | — | `7f50b75b…i0` | — | — | yes | Over-cap — void 90, pay 1 (audit §4) |
| Apr 01 | 30 | — | `7eba20c7…i0` | — | — | yes | Clean |
| Apr 02 | 30 | — | `f752bafd…i0` | — | — | yes | Clean |
| Apr 03 | 30 | — | `9aa68a0e…i0` | — | — | yes | Clean |
| Apr 04 | 30 | — | `40eb9148…i0` | 943780 | — | yes | Clean |
| **Apr 05** | **18** | — | — | — | — | **none** | **UNINSCRIBED — 16/18 restored 2026-04-16; 2 deferred (Keyed Reactor, Prime Spoke). Re-compile + inscribe after all 18 restored.** |
| **Apr 06** | **8**  | — | — | — | — | **none** | **UNINSCRIBED — 0/8 restored (blocked on cap). Re-compile + inscribe after restore.** |
| **Apr 07** | **30** | `104972bc…` (confirmed @944992) | — | commit only | `2026-04-07.json` (status=confirmed, no inscription_id) | **none** | **COMMIT-ONLY — 0/30 restored (blocked on cap). Reveal witness recoverable (state file intact at `.child-inscription-state-104972bc...json`). Broadcast reveal after signals restored + brief re-compiled.** |
| Apr 08 | 30 | — | `577c7a94…i0` | 944302 | — | yes | Clean |
| Apr 09 | 30 | `f9c72620…` | `f1d1f839…i0` | 944484 | `2026-04-09.json` | yes | Clean (local `error` field is benign — API returned 409 on a retry, but platform already had the right ID from the first call) |
| Apr 10 | 30 | `07cd73ad…` | `c6892918…i0` | 944581 | `2026-04-10.json` | yes | Clean (same 409 pattern) |
| Apr 11 | 30 | `31ed9c74…` | `4b8e17c4…i0` | 944724 | `2026-04-11.json` | yes | Clean (same 409 pattern) |
| Apr 12 | 30 | (unknown) | `87a9270f…i0` | 944875 | **missing** | yes | **On-chain and platform agree, but no local record. Backfill needed.** |
| **Apr 13** | **30** (26 corr, 13 beats — mixed pre/post-cutover) | — | — | — | — | **none** | **UNINSCRIBED — last "old world" mixed brief, decision pending: inscribe vs void** |

**Mar 18:** No brief compiled. Gap day — accepted.

### Parent-child chain verification (taproot wallet history)

```
40eb9148 (Apr 04) → 577c7a94 (Apr 08) → f1d1f839 (Apr 09) → c6892918 (Apr 10)
  → 4b8e17c4 (Apr 11) → 87a9270f (Apr 12) → ?
```

The chain skips Apr 5, 6, 7. Apr 7's commit `104972bc` is confirmed but is **not** in the parent chain — the reveal that would link it was never broadcast. To inscribe Apr 7 now, the reveal must be reconstructed from the inscription tool's saved state (search `scripts/inscribe-brief.ts` history and ord working dir) before the 13,573-sat commit output is swept by mistake.

---

## Inscription Gaps Summary

| Date | What exists | What's missing | Recoverable? |
|------|-------------|----------------|--------------|
| Apr 05 | Compiled brief on platform (18 signals) | Commit + reveal | Yes — recompile and re-inscribe, or void |
| Apr 06 | Compiled brief on platform (8 signals)  | Commit + reveal | Yes — recompile and re-inscribe, or void |
| Apr 07 | Compiled brief + confirmed commit `104972bc…` | Reveal tx | **Conditional** — only if the reveal script/witness is still recoverable from local state. Otherwise the 13,573 sats are stranded and the brief must be re-inscribed with a fresh commit (and the old commit eventually swept as cost-of-error) |
| Apr 12 | Confirmed reveal `87a9270f…i0` on chain + platform | Local `db/inscriptions/2026-04-12.json` | Trivial — backfill from on-chain data |
| Apr 13 | Compiled brief on platform (30 signals) | Commit + reveal | Yes — pending decision: inscribe as the last pre-cutover publisher brief, or hand to editors |

---

## Idempotent Inscription Workflow (proposed)

The current `inscribe-brief.ts` flow records local state mid-stream (commit confirmed, reveal sent, API recorded) but doesn't tolerate partial completions on retry. The 409 errors on Apr 9/10/11 and the commit-only Apr 7 case both stem from this. Proposal:

### State machine per (date, brief_content_hash)

```
PENDING → COMMIT_BROADCAST → COMMIT_CONFIRMED → REVEAL_BROADCAST → REVEAL_CONFIRMED → API_RECORDED → DONE
                                                                                     ↘
                                                                                       API_ALREADY_HAD_IT (409 = success)
```

Stored in `db/inscriptions/{date}.json` with explicit `state` field replacing the current ambiguous `status`.

### Recovery rule (every step starts here)

1. **Read local state** for `(date)`. If `state == DONE`, exit 0.
2. **Read platform** `GET /api/brief/{date}`. If `inscription.inscriptionId` is set:
   - If it matches local `inscription_id` → mark `DONE`, exit 0.
   - If local has none → backfill local from platform, mark `DONE`, exit 0.
   - If they differ → **abort and alert** (split-brain, must be resolved manually).
3. **Read on-chain** for any local `commit_txid`:
   - Commit unconfirmed → resume waiting (no new tx).
   - Commit confirmed, vout 0 unspent → reveal needed; reconstruct from saved witness or fail loudly.
   - Commit confirmed, vout 0 spent → spending tx is the reveal; backfill `inscription_id = <reveal_txid>i0`, advance to `REVEAL_CONFIRMED`.
4. **POST to API** to record. Treat **409 with matching inscription_id as success**, not an error.
5. **Persist state** after every transition (atomic write — temp file + rename).

### Hard rules

- Never broadcast a new commit if `commit_txid` is set and the prior commit's vout 0 is still unspent. (Prevents double-commit / orphaned output cost.)
- Never POST to the API without first checking `GET /api/brief/{date}.inscription`. (Prevents the 409 noise.)
- The reveal witness/private data must be persisted to `db/inscriptions/{date}.witness` immediately after commit broadcast, before any other action. Without this, a crashed process strands the commit output.
- Atomic writes only — no partial JSONs.

### Migration path

1. Backfill `db/inscriptions/2026-04-12.json` from on-chain + platform now.
2. Add explicit `state` field to all existing records (`state: "DONE"` for the 4 confirmed ones).
3. Refactor `scripts/inscribe-brief.ts` per the state machine above.
4. Add a `recover-inscription.ts` script that runs the recovery rule and reports without writing — same rule as the inscribe path, just dry-run.
5. Wire `daily-brief-inscribe` sensor to call recovery first, only proceeding to a fresh inscription if recovery yields `state == PENDING`.

### Apr 7 — special case

Treat as a **forensics task** before any retry:
- Search local state for the reveal witness data: `find ~ -name "*.witness" -newer …`, check ord working dir, check whether `inscribe-brief.ts` ever wrote it.
- If recoverable: broadcast the reveal, accept the existing commit, done.
- If not recoverable: write off the 13,573 + 175,872 sats as a one-time loss, run a fresh inscribe with the new state machine, document the loss in the audit doc.

---

## Cross-references

- Audit: `db/payouts/2026-04-10T2032Z-payout-audit.md`
- Audit update: `db/payouts/2026-04-14-audit-update.md`
- Editor cutover plan: `db/projects/editor-model-cutover.md`
- Inscribe script: `scripts/inscribe-brief.ts`
- Recovery script (proposed): `scripts/recover-inscription-to-taproot.ts` (already exists for taproot recovery — extend or sibling)
