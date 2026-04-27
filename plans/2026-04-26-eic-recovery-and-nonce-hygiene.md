---
title: EIC payout recovery + nonce-handling hygiene audit
status: executing
created: 2026-04-26
last_updated: 2026-04-27
trial_window: 2026-04-24 → 2026-05-01 (EIC trial; this plan covers Day 1+2+3 recovery and the broader nonce/wallet self-knowledge work it surfaced)
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

### 1a. Update — 2026-04-27 (Phase C in flight)

- **Phase C broadcast 2026-04-27T09:02Z** — 9 gap-fill txs at nonces 1924-1932, all confirmed. Day 2 EIC (1933) confirmed in same window. Hiro `last_executed_tx_nonce: 1923 → 1933`. ✅
- **Day 3 (2026-04-26 brief) ran end-to-end during the gap window.** Compile 05:02Z, inscribed 07:02–08:56Z (`inscriptionId: 6595d16d…`), EIC payout broadcast 09:02Z at nonce **1940** (txid `0x8ff46eaf…`). `eic_payouts` row id=3, status=sent, 400k sats, 30 signals across 3 beats. **Stuck pending behind a NEW 6-nonce gap (1934-1939).**
- **Origin of new gap:** local `db/nonce-state.json` had `inFlight: [1924-1932, 1934-1936]` (12 phantoms) coming into the recovery. When Day 3 fired, the manager skipped phantoms and handed out 1940 — but its internal counter also advanced through 1937, 1938, 1939 without those landing on chain (they're not in `inFlight` either, so they were "lost" — released or never tracked). Three new phantoms emerged from the act of acquiring one good nonce. **This is a second nonce-store bug to fix in Phase L** (nonces handed out by `acquireNonce` must always be tracked until explicitly released).
- **Plan response:** add **Phase C-bis** — gap-fill 1934-1939 to release Day 3. Phase F now scopes to Day 1 only (Day 3 self-recovers via C-bis confirmation).

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

### Phase C — Gap-fill nonces 1924-1932 (CHAIN OPS — explicit user approval each step) ✅ DONE 2026-04-27

Reuses `scripts/nonce-gap-fill.ts`. Recipient is the funding source already configured in the script.

- [x] **C1.** Edit `scripts/nonce-gap-fill.ts` — set `MISSING_NONCES = [1924,1925,1926,1927,1928,1929,1930,1931,1932]`
- [x] **C2.** Dry-run confirmed exact match to Hiro `detected_missing_nonces`
- [x] **C3.** User approval ("yes do both" — 2026-04-27 ~05:30Z)
- [x] **C4.** Real broadcast 2026-04-27 09:02Z — 9/9 succeeded; txids logged in `recovery-2026-04-26.md`
- [x] **C5.** Confirmations observed within ~minutes
- [x] **C6.** Hiro `last_executed_tx_nonce: 1933` — Day 2 EIC + all 9 gap-fills confirmed

**Verification gate satisfied.** Day 2 EIC (nonce 1933) confirmed.

### Phase C-bis — Gap-fill nonces 1934-1939 (CHAIN OPS — pending approval)

New gap that emerged during Phase C window (see §1a). Day 3 EIC (1940) is stuck behind it.

- [x] Edit `scripts/nonce-gap-fill.ts` — set `MISSING_NONCES = [1934,1935,1936,1937,1938,1939]`
- [x] Dry-run confirmed (6 txs, ~0.06 STX, sender + recipient correct)
- [ ] **C-bis.3.** User approval before broadcast
- [ ] **C-bis.4.** Real broadcast — capture txids in audit folder
- [ ] **C-bis.5.** Confirmations observed; Day 3 (1940) clears
- [ ] **C-bis.6.** Verify `last_executed_tx_nonce >= 1940`

**Verification gate:** Hiro reports `last_executed_tx_nonce >= 1940` AND Day 3 EIC tx `0x8ff46eaf…` confirms with non-null `block_height`.

### Phase D — Day 2 + Day 3 confirmation captured (no chain ops)

- [ ] Update `db/payouts/eic-2026-04-24/2026-04-25.json` — Day 2: status=confirmed, block_height, confirmed_at
- [ ] Add `db/payouts/eic-2026-04-24/2026-04-26.json` — Day 3 record (status=sent then confirmed post C-bis, txid `0x8ff46eaf…`, signals 30, beats [aibtc-network, bitcoin-macro, quantum])
- [ ] Update `eic_payouts` rows for 2026-04-25 + 2026-04-26 if any reconciliation needed

**Verification gate:** audit JSONs and DB rows agree on status + block_height for both days.

### Phase E — Clean local in-flight state (no chain ops)

- [ ] Inspect `db/nonce-state.json` — capture current state to audit folder as `nonce-state-pre-cleanup.json`
- [ ] Force-release stale entries: 1924-1932 (now confirmed on chain via gap-fill, will release naturally on next sync) and 1934-1936 (never broadcast — release as `"rejected"` so they're reusable)
- [ ] Cleanup approach: prefer adding a `nonce-manager prune` subcommand if missing, otherwise targeted manual edits with rationale logged
- [ ] Re-run `arc skills run --name nonce-manager -- sync --address SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`
- [ ] Save post-cleanup state to audit folder as `nonce-state-post-cleanup.json`

**Verification gate:** local `nextNonce` matches Hiro's `possible_next_nonce`; `inFlight` length == count of txs Hiro reports in mempool from this wallet.

### Phase F — Re-run Day 1 EIC payout (CHAIN OPS — explicit user approval)

Day 2 + Day 3 already broadcast and (post C-bis) confirmed; only **Day 1** needs a manual re-run.

- [ ] Optional patch: clear `error` column on `markSent` in `skills/eic-payout/cli.ts` (cosmetic, decide with user)
- [ ] **F1.** Read user approval before broadcast
- [ ] **F2.** Run: `arc skills run --name eic-payout -- execute --date 2026-04-24`
   - Idempotency: `upsertPayout` uses `ON CONFLICT(date) DO UPDATE`; short-circuit at line 267-269 fires only on `status='sent'`. Current row is `status='failed'` → falls through cleanly.
- [ ] **F3.** Capture new txid → append to audit `2026-04-24.json` and `recovery-2026-04-26.md`
- [ ] **F4.** Verify balance-check follow-on task auto-queues
- [ ] **F5.** Watch confirmation — should land at next available nonce (1941 or higher, behind Day 3 at 1940)

**Verification gate:** Hiro reports the new Day 1 txid as `success`, `eic_payouts` row shows `status=sent` with non-null txid and sent_at, audit folder records all three days' final state.

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

**Architectural decisions confirmed 2026-04-27:**
- **Authoritative status comes from the x402 sponsor relay receipt, not Hiro mempool reads.** Per `aibtcdev/x402-sponsor-relay` README: `POST /relay` returns `receiptId` + `txid` on broadcast; `GET /verify/:receiptId` returns `status: "confirmed" | "valid" | "error"` with settlement details. This is the polling endpoint we should drive L4 from. Mempool reads from a single Hiro node are unreliable when the node hasn't synced yet — confirmation typically lands in 5-15s but can take a few minutes.
- **Broadcast = in mempool.** Once the relay returns a `txid`, the tx is in the network's mempool. Treat that nonce as consumed regardless of subsequent confirmation outcome. The remaining question is success vs revert, not consumed vs available.
- **The relay handles nonce-gap "held" state explicitly.** `POST /relay` returns HTTP 202 with `status: "held"` + `queue.missingNonces` when there's a gap. We can drive automatic gap-fill from this response — the relay literally tells us which nonces to fill.
- **`bitcoin-wallet x402 send-inbox-message` (upstream `aibtcdev/skills/x402/x402.ts:472-476`) does not accept a `--nonce` flag** — it fetches Hiro's nonce internally inside the skill. This is the bypass behind Mode 1 root cause. Fix requires upstream PR.
- **Nonce-manager itself is local-only.** Upstream `aibtcdev/skills` does not have a nonce-coordinator skill. Our local `skills/nonce-manager` is the only cross-skill coordinator for this deployment. Long-term, propose it for upstream.

#### Sub-tasks

- [ ] **L1.** PR to `aibtcdev/skills`: add `--nonce` flag to `x402 send-inbox-message` (and any other broadcast subcommand that signs a publisher-wallet Stacks tx). **Handed off to a separate session** — out of scope for this sprint per user direction ("focus on getting the publisher (ourselves) completely fixed up as the shining example").
- [x] **L2.** `scripts/send-agent-welcome.ts` rewired to write a one-message batch JSON and shell out to `inbox-notify send-batch` instead of `bitcoin-wallet x402 send-inbox-message`. The bitcoin-wallet path silently dropped `--nonce`; routing through `inbox-notify` puts every send under the local nonce-manager. (Stop-gap variant from the original plan; supersedes the L1-blocked path.)
- [x] **L3.** `inbox-notify/cli.ts` failure-classification fixed by replacing the bitcoin-wallet shell-out with a local `skills/inbox-notify/x402-send.ts` module that owns the relay handshake end-to-end. Returns a structured `failureKind` (`"rejected" | "broadcast"`) classified by relay error code (`BROADCAST_FAILED`, `NOT_SPONSORED`, `SPENDING_CAP_EXCEEDED`, `SENDER_NONCE_*`, etc.) and HTTP status (202 held, 4xx pre-broadcast, 5xx ambiguous). Lines 229 + 478 + 470 + 557 in `cli.ts` now consume that hint instead of the legacy substring matching. Receipts (`payment_id`, `txid`) propagate to `releaseNonce` via the new `broadcastInfo` parameter.
- [x] **L4.** Receipt-driven reconciliation replaces the originally-planned mempool-read GC. New `skills/nonce-manager/schema.ts` defines a `nonce_broadcasts` SQLite table tracking `{address, nonce, source, payment_id, txid, broadcast_at, status, ...}` per release-as-broadcast. New `skills/nonce-manager/reconcile.ts` polls `aibtc.com/api/payment-status/{paymentId}` for `source: "x402-relay"` and Hiro `/extended/v1/tx/{txid}` for `source: "direct"`. Confirmed/rejected/expired transitions are explicit; 404s on Hiro are held pending (could be index lag, never auto-rejected on first miss). TTL defaults to 30 minutes. Phantoms are surfaced via the sensor as a single alert task — never auto-gap-filled.
- [x] **L4b.** Test `skills/nonce-manager/nonce-store.test.ts > acquireNonce > "never advances nextNonce without pushing to inFlight (atomic)"` proves concurrent acquires all land in `inFlight` before return. Code path is correct; the Day 3 phantoms came from `inbox-notify`'s release-classification bug, not from acquireNonce itself.
- [x] **L5.** 37 tests across `skills/nonce-manager/{nonce-store,reconcile}.test.ts` and `skills/inbox-notify/x402-send.test.ts` covering: acquire atomicity, release classification (success/broadcast/rejected with rollback), broadcast persistence, sync `inFlight` preservation, x402-relay + direct-broadcast reconciliation, TTL expiry, poll backoff, defensive error isolation, all 11 documented relay error codes.
- [ ] **L6.** Re-enable `agent-welcome` sensor (rename `sensor.ts.paused` → `sensor.ts` + remove the early `return "skip"`) after a soak window verifies (a) `nonce-reconcile` sensor is producing zero phantoms on organic traffic and (b) the new `contact-registry` backfill sensor is keeping the eligible-agent pool fresh.

Bonus, identified during sprint kickoff:

- [x] **L6-prep.** `skills/contact-registry/sensor.ts` queues a deterministic `backfill-agents` task every 6 hours. Without this, the agent-welcome eligibility pool never grows once seeded — confirmed gap (917 local vs 921 upstream agents at sprint start).

**Verification gate:** with agent-welcome re-enabled, run a 24h soak. Hiro reports zero new `detected_missing_nonces` originating from our wallet. Local `inFlight` stays bounded (entries cleared within ~30s of relay-confirmed status, never linger past TTL). Receipt poll cycle completes within 5 min for any sponsored tx.

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
- 2026-04-27 — Phase C executed (9 gap-fills broadcast, all confirmed; Day 2 EIC 1933 confirmed). Discovered new 6-nonce gap (1934-1939) created by Day 3 cycle running during the recovery window — Day 3 EIC payout (nonce 1940, txid `0x8ff46eaf…`) is stuck behind it. Added Phase C-bis (gap-fill 1934-1939). Added L4b sub-task to fix `acquireNonce`'s phantom-nonce-emission bug. Rescoped Phase F to Day 1 only (Day 2 + Day 3 already broadcast).
- 2026-04-27 (later) — Phases C-bis, D, E, F all executed. All three EIC trial days confirmed on chain (Day 1 bh=7765320 nonce 1941, Day 2 bh=7765150 nonce 1933, Day 3 bh=7765275 nonce 1940). Phase G comment posted (#634 comment 4328491106). Phase H issue filed (`aibtcdev/agent-news#659`). Phase L re-architected around the actual `aibtcdev/x402-sponsor-relay` receipt model (`POST /relay` → `receiptId`; `GET /verify/:receiptId` → status). L4 switched from mempool-poll-based GC to receipt-poll-based reconciliation per user guidance ("careful with bad mempool data from nodes that haven't synced yet, broadcast = in mempool, relay handles this with a receipt we can poll"). Confirmed upstream `aibtcdev/skills/x402/x402.ts:472-476` is the bypass — `getAccountInfo(account.address).nonce` fetched inline; no `--nonce` flag exists yet. L1 scoped as upstream PR. L2 has a stop-gap option (route `send-agent-welcome` through `inbox-notify send-batch`) that can land before L1 merges.
- 2026-04-27 (sprint) — Phases L2, L3, L4, L4b, L5, L6-prep all delivered on branch `fix/nonce-recovery-shining-example`. New files: `skills/nonce-manager/{schema,reconcile,nonce-store.test,reconcile.test}.ts`, `skills/inbox-notify/{x402-send,x402-send.test}.ts`, `skills/contact-registry/sensor.ts`. Major edits: `skills/inbox-notify/cli.ts` (replaced bitcoin-wallet shell-out with local x402-send), `skills/nonce-manager/{nonce-store,cli,sensor}.ts` (BroadcastInfo plumbing + reconcile subcommand + reconcile sensor). 37 tests passing. L1 handed off (out of scope per user). L6 (un-pause agent-welcome) deferred until soak metrics confirm zero phantoms on organic traffic.
