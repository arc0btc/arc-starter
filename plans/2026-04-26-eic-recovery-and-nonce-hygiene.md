---
title: EIC payout recovery + nonce-handling hygiene audit
status: executing
created: 2026-04-26
trial_window: 2026-04-24 → 2026-05-01 (EIC trial; this plan covers Day 1+2 recovery and the broader nonce/wallet self-knowledge work it surfaced)
related_plans:
  - plans/2026-04-24-eic-trial-activation.md
audit_folder: db/payouts/eic-2026-04-24/
---

# EIC payout recovery + nonce-handling hygiene audit

## 1. Situation

EIC trial Day 1 (2026-04-24) and Day 2 (2026-04-25) payouts both failed to land:

- **Day 1**: `eic-payout` sensor fired 2026-04-25T09:01Z, `sbtc-send-runner` returned generic "sBTC transfer failed" at nonce **1964** (31 ahead of chain head). Marked `status='failed'` in `eic_payouts`, no txid. **DC has 0 sats from Day 1.**
- **Day 2**: `eic-payout` sensor fired 2026-04-26T09:27Z, broadcast at nonce **1933** with txid `53a67f5ad166c72decdc71a087d16f8164470f74ccd2617716d264258a920365`. Hiro reports `tx_status: "pending"`, no block height — **stuck in mempool behind a 9-nonce gap (1924–1932 missing)**.
- **Briefs are inscribed on-chain** for both days; aibtc.news API has `inscription.inscriptionId` set but `inscribedAt` and `inscription.inscribedTxid` are null. This isn't a regression — it's been null since at least 2026-04-10. DC's "doesn't see briefs inscribed" is reading a field we've never populated.

DC continues to operate (functional approval test passed 2026-04-24T23:51Z, ledger publishing per terms) — the editorial side is fine. What's broken is our outflow.

## 2. Root cause confirmed

Two interacting failure modes:

### 2a. Nonce-manager bypass (architectural)

The publisher Stacks wallet (`SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`) is consumed by **multiple independent paths**:

| Path | Goes through nonce-manager? | Volume since 2026-04-22 |
|---|---|---:|
| `eic-payout` (and former `editor-payout`, `curated-payout`) | yes (acquireNonce/releaseNonce) | low (1-3/day) |
| `inbox-notify` send-batch | yes (line 9, releaseManagedNonce) | medium (several batches/day) |
| `agent-welcome` via `scripts/send-agent-welcome.ts` → `bitcoin-wallet x402 send-inbox-message` | **no — fetches nonce directly via Hiro inside the bitcoin-wallet skill** | **90 tasks in 48h** |
| `scripts/round-b-overnight.ts` | yes | 63 confirmed sends 2026-04-22 |
| Various manual scripts (`peel-parent-excess-to-segwit.ts`, `fund-segwit-from-taproot.ts`, etc.) | mixed | low |

The agent-welcome path is the dominant pressure source and **does not coordinate with the local nonce-manager**, so the manager's `nextNonce` becomes stale relative to chain reality. When `eic-payout` later acquires a nonce, the manager hands out a number based on its own internal counter (1964 on Day 1) far ahead of the chain head (1923 executed) — broadcast lands in a void and gets rejected or dropped by the relay.

### 2b. Stale in-flight entries (state hygiene)

`nonce-store.ts` tracks `inFlight` per address but has no garbage collector that prunes entries the chain has either confirmed or dropped from mempool. Today's local state shows 12 entries (1924–1932, 1934–1936) that Hiro doesn't see anywhere — they're ghosts. They block correct nonce acquisition because the manager skips them on `acquireNonce`.

### 2c. Release-on-rejection semantics — open bug

`nonce-store.ts:64-70` distinguishes `"broadcast"` (consumed) from `"rejected"` (reusable). The design is correct. But:

- **`inbox-notify/cli.ts:478`** has a catch path that calls `releaseManagedNonce(currentNonce, false)` with no third arg — defaults to `"broadcast"` per `releaseManagedNonce`'s logic at line 117. This is the safe default, but in cases where the relay actually rejected the tx pre-broadcast (e.g., signing error, network failure to reach mempool), we mark a reusable nonce as consumed and leak it. **Across many failures this accumulates** — exactly what we're seeing.
- The release path doesn't currently distinguish "broadcast accepted by relay but later dropped from mempool" (which DOES need on-chain gap-fill) from "broadcast attempt failed before reaching mempool" (which can be locally rolled back). The runner can know this — relay returns explicit error codes like `SENDER_NONCE_DUPLICATE`, `SENDER_NONCE_STALE` vs network/timeout — but the catch path collapses them.

**This is the bug the user flagged. Tracked in Phase L below; not lost.**

## 3. Hard constraints

- Do not pause `inbox-notify` — DC's correspondents need signal-approval notifications.
- Do not modify `MEMORY.md` until Phase G is complete (recovery confirmed end-to-end).
- All on-chain recovery actions get an audit-trail entry written before broadcast.
- No RBF on the existing Day 2 mempool tx (nonce 1933) — accept the chronological inversion (Day 2 confirms before Day 1 retry) and document it. RBF would force a replacement contract call to cancel a sBTC transfer, which is fragile per the prior `feedback_sbtc_self_transfer_rejected` lesson.

## 4. Phases

### Phase A — Pause agent-welcome sensor (no chain ops)

- [ ] `skills/agent-welcome/sensor.ts` → `sensor.ts.paused` (sensors service only discovers exact `sensor.ts` per `src/sensors.ts:218`)
- [ ] Add early `return "skip"` belt-and-suspenders in case the file is restored
- [ ] Note in `skills/agent-welcome/SKILL.md` top: paused 2026-04-26 pending nonce-handling fix (Phase L)
- [ ] Verify: `arc sensors list` no longer shows agent-welcome as discoverable
- [ ] Commit: `chore(agent-welcome): pause sensor pending nonce-manager wiring fix`

**Verification gate:** confirm no new agent-welcome tasks queue for at least one sensor cycle (60 min) after pause.

### Phase B — Create audit folder + initial records (no chain ops)

- [ ] `mkdir db/payouts/eic-2026-04-24/`
- [ ] Write `audit.md` — narrative covering trial start, Day 1 failure, Day 2 mempool stuck, recovery rationale
- [ ] Write `2026-04-24.json` — Day 1 record: status=failed, original error, planned retry
- [ ] Write `2026-04-25.json` — Day 2 record: status=pending, txid `53a67f5a…`, nonce 1933
- [ ] Write `recovery-2026-04-26.md` — empty scaffold, will be filled as Phases C-F execute
- [ ] Commit: `docs(audit): create EIC trial payout audit folder`

**Verification gate:** all four files present; checked into git.

### Phase C — Gap-fill nonces 1924-1932 (CHAIN OPS — explicit user approval each step)

Reuses `scripts/nonce-gap-fill.ts`. Recipient is the funding source already configured in the script.

- [ ] **C1.** Edit `scripts/nonce-gap-fill.ts` — set `MISSING_NONCES = [1924,1925,1926,1927,1928,1929,1930,1931,1932]`
- [ ] **C2.** Dry-run: `bun scripts/nonce-gap-fill.ts --dry-run` — paste output to audit folder, confirm nonces line up with Hiro's `detected_missing_nonces`
- [ ] **C3.** Read user approval before broadcast
- [ ] **C4.** Real broadcast: `bun scripts/nonce-gap-fill.ts` — capture txids, append to audit folder
- [ ] **C5.** Watch confirmations: each at fee 10000 uSTX should land within 1-3 Stacks blocks
- [ ] **C6.** Verify: `last_executed_tx_nonce` advances to 1932, then 1933 (Day 2 EIC) confirms naturally

**Verification gate:** Hiro reports `last_executed_tx_nonce >= 1933` AND Day 2 EIC txid moves from `pending` to `success` with non-null `block_height`.

### Phase D — Day 2 confirmation captured (no chain ops)

- [ ] Update `db/payouts/eic-2026-04-24/2026-04-25.json` — status=confirmed, block_height, confirmed_at
- [ ] Update `db/arc.sqlite` `eic_payouts` row for 2026-04-25 if any field needs reconciliation (currently status=sent, sent_at recorded — no SQL change expected)

**Verification gate:** audit JSON and DB row agree on status=confirmed/sent and block_height.

### Phase E — Clean local in-flight state (no chain ops)

- [ ] Inspect `db/nonce-state.json` — capture current state to audit folder as `nonce-state-pre-cleanup.json`
- [ ] Force-release stale entries: 1924-1932 (now confirmed on chain via gap-fill, will release naturally on next sync) and 1934-1936 (never broadcast — release as `"rejected"` so they're reusable)
- [ ] Cleanup approach: prefer adding a `nonce-manager prune` subcommand if missing, otherwise targeted manual edits with rationale logged
- [ ] Re-run `arc skills run --name nonce-manager -- sync --address SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`
- [ ] Save post-cleanup state to audit folder as `nonce-state-post-cleanup.json`

**Verification gate:** local `nextNonce` matches Hiro's `possible_next_nonce`; `inFlight` length == count of txs Hiro reports in mempool from this wallet.

### Phase F — Re-run Day 1 EIC payout (CHAIN OPS — explicit user approval)

- [ ] Optional patch: clear `error` column on `markSent` in `skills/eic-payout/cli.ts` (cosmetic, decide with user)
- [ ] **F1.** Read user approval before broadcast
- [ ] **F2.** Run: `arc skills run --name eic-payout -- execute --date 2026-04-24`
   - Idempotency: `upsertPayout` uses `ON CONFLICT(date) DO UPDATE`; short-circuit at line 267-269 fires only on `status='sent'`. Current row is `status='failed'` → falls through cleanly.
- [ ] **F3.** Capture new txid → append to audit `2026-04-24.json` and `recovery-2026-04-26.md`
- [ ] **F4.** Verify balance-check follow-on task auto-queues (sensor wiring per existing trial plan)
- [ ] **F5.** Watch confirmation — should land within 1-2 blocks behind Day 2 (which has now confirmed at 1933)

**Verification gate:** Hiro reports the new Day 1 txid as `success`, `eic_payouts` row shows `status=sent` with non-null txid and sent_at, audit folder records both Day 1 and Day 2 final state.

### Phase G — Communicate to DC on #634 (no chain ops)

- [ ] Comment on aibtcdev/agent-news#634 with:
  - Day 1 final txid + chronological note explaining inversion
  - Day 2 final txid (now confirmed)
  - Both inscriptionIds (since the platform isn't surfacing them via inscribedAt yet — temporary)
  - Apology + cause sketch (nonce-manager bypass) + commitment that Phase L fixes the recurring root cause
- [ ] Mark `plans/2026-04-24-eic-trial-activation.md` Phase Final checkboxes as complete
- [ ] Update memory per the activation plan's memory-update step (collapse roster, FLAG line for EIC era)

**Verification gate:** comment posted; activation plan checkboxes ticked; MEMORY.md reflects post-recovery state.

### Phase H — File platform issue for inscribedAt + backfill migration (no chain ops)

We have local `db/inscriptions/<date>.json` for at least the recent windows; the API has `inscription.inscriptionId` set across all checked dates back to 2026-04-10. The `inscriptionId` itself encodes the reveal txid as `<reveal-txid>i0`.

- [ ] Open issue on `aibtcdev/agent-news` proposing:
  - Platform populates `inscribedAt = now()` and `inscription.inscribedTxid = <derived from inscriptionId>` at the time the existing `inscribe-brief` POST writes `inscription_id` (zero protocol changes — single DB-write update on existing endpoint)
  - Backfill SQL migration for historical briefs: `UPDATE briefs SET inscribed_at = updated_at, inscribed_txid = SUBSTR(inscription_id, 1, 64) WHERE inscription_id IS NOT NULL AND inscribed_at IS NULL`
- [ ] Optional follow-up issue: extend POST contract to accept explicit `commit_txid` and `reveal_txid` so future sends are precise rather than derived (lower priority — derivation is correct for ordinal-style inscriptions)
- [ ] Cross-link issue from #634 + this plan

**Verification gate:** issue filed with both proposal sections + backfill SQL inline; we can offer a PR for the platform-side change if useful.

### Phase I — Audit nonce handling across active skills (code review)

Survey every code path that touches the publisher Stacks wallet and confirm it goes through the local nonce-manager.

- [ ] List active skills: `arc sensors list` + `ls skills/`
- [ ] For each skill that has a sensor or CLI that broadcasts a Stacks tx from the publisher wallet, verify:
  1. `import { acquireNonce, releaseNonce } from "../nonce-manager/nonce-store.js"` is present
  2. The acquired nonce is passed explicitly to the broadcast call (e.g., `--nonce` flag)
  3. The release path covers all failure modes: success, broadcast (consumed), rejected (reusable)
  4. No path falls back to "Hiro lookup inside bitcoin-wallet skill" without first acquiring through the manager
- [ ] Build a table in audit folder: `nonce-manager-coverage.md` with one row per call site (skill, file:line, status: ✓ wired / ✗ bypasses / partial)
- [ ] **Known bypasses to add to fix list:**
  - `scripts/send-agent-welcome.ts` → `bitcoin-wallet x402 send-inbox-message` (no nonce passed → bitcoin-wallet skill internally fetches Hiro nonce → BYPASS)
  - Any other call to `bitcoin-wallet x402 send-inbox-message` without `--nonce`
- [ ] Verification gate: every active call site is in the table with explicit status; bypasses are scheduled for Phase L fix.

### Phase J — Audit past tasks for stale in-flight nonces (data archaeology)

Goal: confirm no other latent gaps are sitting in our state, and learn how often this happens.

- [ ] SQL query: tasks since 2026-04-01 that touched the publisher wallet and ended in `status='failed'` with nonce-related errors → group by date
- [ ] Cross-reference against Hiro's `detected_missing_nonces` history (sample at known checkpoints)
- [ ] Document findings in audit folder: `nonce-incident-history.md`
- [ ] If any latent gaps exist on chain right now (besides the ones we're fixing in Phase C), surface them and decide whether to gap-fill in this recovery or backlog

**Verification gate:** historical incidents catalogued; current chain state confirmed gap-free post-Phase F.

### Phase K — Local wallet self-knowledge tooling (DX)

> "We should know our own local wallet and easily fill in our own TXs not stumble and get stuck like we did this time."

Build the muscles so we never stumble through this manually again.

- [ ] **K1.** `arc wallet status [--address X]` — single command that shows for the publisher wallet (default) or any address:
  - sBTC balance, STX balance
  - Hiro: last_executed_tx_nonce, last_mempool_tx_nonce, possible_next_nonce, detected_missing_nonces
  - Local: nonce-manager nextNonce, mempoolPending, inFlight count + list
  - Drift indicator: ✓ aligned / ⚠ N missing nonces / ⚠ local ahead by N / ⚠ stale in-flight
- [ ] **K2.** `arc wallet history [--limit N] [--since DATE]` — recent on-chain txs from our wallet, with nonce + status + block_height + function name
- [ ] **K3.** `arc wallet gap-fill --nonces X,Y,Z [--dry-run]` — wraps `scripts/nonce-gap-fill.ts` as a first-class CLI, with safety prompts and audit-folder logging on success
- [ ] **K4.** `arc wallet rbf --nonce X --new-fee-uSTX N` — RBF a stuck mempool tx with a higher-fee replacement (for cases where gap-fill isn't right)
- [ ] **K5.** Pre-dispatch health check (sensor-ish) — flags wallet drift to dispatch and refuses to fire payment skills until acknowledged
- [ ] **K6.** Documentation: `docs/wallet-operations.md` — runbook for the failure modes we've now seen (nonce gap, mempool stuck, manager bypass, rejection-vs-broadcast)

**Verification gate:** K1+K2 ship and prove themselves on the publisher wallet. K3 reproduces today's recovery as a single command. K4 / K5 / K6 may be follow-up PRs.

### Phase L — Fix the actual nonce-manager bugs

This is the bug the user explicitly flagged as "don't lose this." Phase L is the code fix that makes Phase A's pause unnecessary.

- [ ] **L1.** Wire `bitcoin-wallet x402 send-inbox-message` (and any other bitcoin-wallet subcommand that broadcasts a publisher-wallet Stacks tx) through the nonce-manager. If the skill doesn't already accept `--nonce` correctly, fix the wiring.
- [ ] **L2.** Update `scripts/send-agent-welcome.ts` to acquire/release nonces around its send call.
- [ ] **L3.** Refine `inbox-notify/cli.ts:478` and any peer catch paths — distinguish:
  - relay rejected pre-broadcast (`SENDER_NONCE_DUPLICATE`, `SENDER_NONCE_STALE`, signing error, network unreachable) → release as `"rejected"`
  - relay accepted, tx in mempool but later observed dropped → release as `"broadcast"` AND queue an automatic gap-fill
  - true unknown → keep current safe default (`"broadcast"`) but log a warning so we can audit
- [ ] **L4.** Add an in-flight garbage collector to `nonce-store.ts`: on `sync`, prune `inFlight` entries that are either ≤ `last_executed_tx_nonce` (confirmed) or absent from mempool past a TTL (dropped → schedule gap-fill).
- [ ] **L5.** Add unit tests covering: rejected vs broadcast release, GC pruning of confirmed/dropped entries, concurrent acquire from two skill paths.
- [ ] **L6.** Re-enable `agent-welcome` sensor (Phase A reversal) once L1-L4 land and a smoke run confirms it advances chain nonces cleanly.

**Verification gate:** with agent-welcome re-enabled, run a 24h soak. Hiro reports zero new `detected_missing_nonces`. Local `inFlight` stays bounded (entries cleared within one block of confirmation).

### Phase M — Ship + close-out

- [ ] PR for Phase L code changes (separate from this recovery commit so the bug fix has its own history)
- [ ] Memory updates: incident entry covering this episode (`memory/topics/incidents.md`), feedback memory if any new lessons emerge, MEMORY.md operational note pointer to `docs/wallet-operations.md`
- [ ] Mark this plan `status: complete` and archive into `plans/archive/` with a `superseded_by:` pointer if any follow-up plan succeeds it

**Verification gate:** all lettered phases checked; PR merged; soak window passes clean.

## 5. Risks

- **Gap-fill at higher-fee replaces lower-fee mempool entries.** Verify there isn't a stray low-priority publisher tx between 1924-1932 we'd accidentally RBF. Hiro reports those nonces as truly missing (not in mempool), so the risk is low — but `--dry-run` first.
- **inbox-notify keeps firing during recovery.** Notifications are signal-approval triggers and we're not pausing them. If inbox-notify hits a nonce in our gap-fill range, the gap-fill collides. Mitigation: gap-fill window is short (1-3 blocks), and inbox-notify acquires through the same nonce-manager so it'll pick up correctly post-Phase E. Watch for it.
- **DC reads the `aibtc.news/api/brief/<date>` shape change.** We're not changing the platform contract in this plan — only filing the issue (Phase H). DC sees the inscription IDs in the meantime via direct mention.
- **Phase L churn.** Fixing the bypass (L1) is non-trivial because it means upstream changes in the bitcoin-wallet skill. Out of repo for some of these — track upstream PR if needed.

## 6. Decision log

- **2026-04-26**: Chose gap-fill + accept-inversion over RBF Day 2 → Day 1 fresh re-send. Reason: RBF on sBTC contract calls is fragile (prior incident); records explain the inversion cleanly; lower risk for marginal cosmetic benefit.
- **2026-04-26**: Chose to pause agent-welcome rather than push through Phase L immediately. Reason: stops the bleed today, gives Phase L room to be done right rather than rushed under recovery pressure.
- **2026-04-26**: Chose to NOT pause inbox-notify. Reason: signal notifications are correspondent-facing and pausing them would degrade DC's pipeline visibility during the trial.

## Revisions

- 2026-04-26 — initial plan written. Phase A-G are immediate recovery; H is platform-side; I-J are audits; K-M are durable fixes and DX so this stops being a recurring class of incident.
