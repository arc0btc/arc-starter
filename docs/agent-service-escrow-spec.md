# Agent Service Escrow — Contract Specification

**Version:** 0.1.0-draft
**Author:** Arc (arc0.btc)
**Date:** 2026-04-06
**Status:** DRAFT — awaiting whoabuddy review before implementation
**Source:** Task #11028 (contracts exploration), Task #11035

---

## 1. Purpose

A bilateral escrow contract enabling agents to exchange services for payment on Stacks. The first use case is PR reviews — Arc already performs 20+ reviews/week, establishing proven demand.

**Design principles:**
- Pausable, not upgradeable — no admin key, no proxy. Once deployed, the contract is immutable.
- Two-party only (client + provider). No marketplace logic, no fee splitting.
- STX-denominated initially. sBTC support deferred to Phase 2.
- All state transitions emit structured events for off-chain indexing.

---

## 2. Actors

| Actor | Role | Identity |
|-------|------|----------|
| **Client** | Creates escrow, deposits STX, releases payment on proof | Any principal (agent or human) |
| **Provider** | Accepts escrow, submits proof of work, receives payment | Any principal (agent or human) |
| **Deployer** | Can pause/unpause the contract. Cannot touch escrow funds. | Arc (SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B) |

The deployer has **no access to escrowed funds**. Pause only prevents new escrow creation — existing escrows can always be released or refunded.

---

## 3. Data Structures

### 3.1 Escrow Map

```clarity
(define-map escrows
  { escrow-id: uint }
  {
    client:      principal,
    provider:    principal,
    amount:      uint,          ;; STX in microstacks
    service-id:  (string-utf8 64),  ;; e.g. "pr-review", "code-audit"
    proof-hash:  (optional (buff 32)),  ;; SHA-256 of proof artifact
    status:      (string-ascii 10),     ;; "open" | "proved" | "released" | "refunded" | "disputed"
    created-at:  uint,          ;; block-height at creation
    deadline:    uint,          ;; block-height deadline for proof submission
    released-at: (optional uint)
  }
)
```

### 3.2 State Variables

```clarity
(define-data-var escrow-counter uint u0)
(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
```

### 3.3 Error Constants

Following the `error-constants` pattern (HTTP-inspired ranges):

```clarity
;; 1xx: Validation
(define-constant ERR-ZERO-AMOUNT         (err u100))
(define-constant ERR-INVALID-DEADLINE    (err u101))
(define-constant ERR-SELF-ESCROW         (err u102))

;; 4xx: Auth / state
(define-constant ERR-UNAUTHORIZED        (err u401))
(define-constant ERR-NOT-FOUND           (err u404))
(define-constant ERR-WRONG-STATUS        (err u409))
(define-constant ERR-DEADLINE-PASSED     (err u410))
(define-constant ERR-DEADLINE-NOT-PASSED (err u411))

;; 5xx: System
(define-constant ERR-PAUSED              (err u500))
(define-constant ERR-TRANSFER-FAILED     (err u501))
```

---

## 4. Functions

### 4.1 `create-escrow`

**Signature:** `(define-public (create-escrow (provider principal) (amount uint) (service-id (string-utf8 64)) (deadline uint)) (response uint uint))`

**Behavior:**
1. Assert not paused
2. Assert `amount > u0`
3. Assert `deadline > block-height` (future deadline)
4. Assert `provider != tx-sender` (no self-escrow)
5. Transfer `amount` STX from `tx-sender` to contract
6. Increment `escrow-counter`
7. Insert escrow map entry with `status: "open"`
8. Emit `escrow-created` event
9. Return escrow ID

**Who can call:** Anyone (when not paused)

**STX flow:** Client → Contract (held in escrow)

### 4.2 `submit-proof`

**Signature:** `(define-public (submit-proof (escrow-id uint) (proof-hash (buff 32))) (response bool uint))`

**Behavior:**
1. Load escrow, assert exists
2. Assert `tx-sender == provider`
3. Assert `status == "open"`
4. Assert `block-height <= deadline`
5. Update escrow: `status = "proved"`, `proof-hash = (some proof-hash)`
6. Emit `proof-submitted` event
7. Return `true`

**Who can call:** Provider only

**Note:** The `proof-hash` is a SHA-256 digest of the proof artifact (e.g., PR URL, commit hash, review text). The actual proof lives off-chain; the hash provides verifiable attestation.

### 4.3 `release-escrow`

**Signature:** `(define-public (release-escrow (escrow-id uint)) (response bool uint))`

**Behavior:**
1. Load escrow, assert exists
2. Assert `tx-sender == client`
3. Assert `status == "open" OR status == "proved"` (client can release even before proof)
4. Transfer `amount` STX from contract to provider
5. Update escrow: `status = "released"`, `released-at = (some block-height)`
6. Emit `escrow-released` event
7. Return `true`

**Who can call:** Client only

**STX flow:** Contract → Provider

**Design note:** Client can release at any time regardless of proof status. This is intentional — the client is the one who deposited funds, so they can choose to release early.

### 4.4 `refund-escrow`

**Signature:** `(define-public (refund-escrow (escrow-id uint)) (response bool uint))`

**Behavior:**
1. Load escrow, assert exists
2. Assert `tx-sender == client`
3. Assert `status == "open"` (cannot refund after proof submitted)
4. Assert `block-height > deadline` (deadline must have passed)
5. Transfer `amount` STX from contract to client
6. Update escrow: `status = "refunded"`, `released-at = (some block-height)`
7. Emit `escrow-refunded` event
8. Return `true`

**Who can call:** Client only, after deadline, only if no proof submitted

**STX flow:** Contract → Client

**Rationale:** Refund requires the deadline to have passed AND no proof to have been submitted. If the provider submitted proof, the client must release or the escrow stays in `proved` state (dispute resolution is out of scope for v1).

### 4.5 `pause` / `unpause`

**Signature:** `(define-public (pause) (response bool uint))` / `(define-public (unpause) (response bool uint))`

**Behavior:** Following the `pausable` pattern. Deployer-only. Pause prevents `create-escrow` only. All other functions (submit-proof, release, refund) remain available regardless of pause state — funds must never be locked by a pause.

### 4.6 Read-Only Functions

```clarity
(define-read-only (get-escrow (escrow-id uint))
  (map-get? escrows { escrow-id: escrow-id }))

(define-read-only (get-escrow-count)
  (var-get escrow-counter))

(define-read-only (is-paused)
  (var-get paused))
```

---

## 5. Events

All events follow the `event-emission` pattern — structured tuples with `event` name and `block` height.

| Event | Fields | When |
|-------|--------|------|
| `escrow-created` | `escrow-id`, `client`, `provider`, `amount`, `service-id`, `deadline`, `block` | `create-escrow` succeeds |
| `proof-submitted` | `escrow-id`, `provider`, `proof-hash`, `block` | `submit-proof` succeeds |
| `escrow-released` | `escrow-id`, `client`, `provider`, `amount`, `block` | `release-escrow` succeeds |
| `escrow-refunded` | `escrow-id`, `client`, `amount`, `block` | `refund-escrow` succeeds |
| `paused` | `actor`, `block` | `pause` succeeds |
| `unpaused` | `actor`, `block` | `unpause` succeeds |

---

## 6. State Machine

```
                create-escrow
                     │
                     ▼
                  ┌──────┐
           ┌─────│ open  │─────┐
           │     └──────┘     │
           │         │         │
    release-escrow   │   submit-proof
    (client, any     │   (provider,
     time)           │    before deadline)
           │         │         │
           ▼         │         ▼
      ┌──────────┐   │    ┌────────┐
      │ released  │   │    │ proved │
      └──────────┘   │    └────────┘
                     │         │
               refund-escrow   │  release-escrow
               (client, after  │  (client)
                deadline,      │
                no proof)      │
                     │         │
                     ▼         ▼
                ┌──────────┐  ┌──────────┐
                │ refunded │  │ released │
                └──────────┘  └──────────┘
```

Terminal states: `released`, `refunded`. No transitions out of terminal states.

---

## 7. Security Considerations

### 7.1 No Admin Key on Funds
The deployer can pause/unpause but **cannot** transfer, release, or refund escrow funds. Only the client can release or refund. Only the provider receives payment on release. This is enforced structurally — no admin function touches `stx-transfer?`.

### 7.2 Deadline Enforcement
- Provider must submit proof before deadline (block-height)
- Client can only refund after deadline AND only if no proof submitted
- Client can release at any time (their own funds)
- No one can alter the deadline after creation

### 7.3 No Dispute Resolution (v1)
If proof is submitted but client disagrees with quality, the escrow stays in `proved` state indefinitely. Dispute resolution (arbitration, voting, timeout-release) is explicitly deferred to a future version. This is the correct tradeoff for v1 — disputes require governance, and governance requires a DAO (Phase 3).

**Mitigation for v1:** Agents can agree on service terms off-chain before creating escrow. The proof-hash provides verifiable evidence. Small escrow amounts limit dispute risk.

### 7.4 Clarity-Specific Safety
- All `stx-transfer?` calls wrapped in `try!` (no `unwrap-panic` in public functions)
- `asserts!` used for all preconditions with explicit error constants
- No unbounded iteration — escrows accessed by ID, not iterated
- No reentrancy risk — Clarity executes atomically, but status is set before transfer as belt-and-suspenders

---

## 8. What This Contract Does NOT Do

- **No marketplace.** No listing, discovery, or matching. Agents coordinate off-chain.
- **No fees.** No platform cut, no deployer commission. Pure bilateral escrow.
- **No multi-token.** STX only. sBTC/SIP-010 support requires trait integration (Phase 2).
- **No dispute resolution.** `proved` state is a dead-end if client won't release.
- **No upgradability.** Immutable on deploy. New versions require new contracts.
- **No rate limiting.** Any principal can create unlimited escrows.

---

## 9. Use Case: PR Review Escrow

```
1. Client agent creates escrow:
   - provider: Arc (SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B)
   - amount: 500000 (0.5 STX)
   - service-id: "pr-review"
   - deadline: (+ block-height u144)  ;; ~24 hours

2. Arc reviews the PR and submits proof:
   - proof-hash: SHA-256 of the review comment URL

3. Client releases escrow after verifying review quality

4. If Arc doesn't review within 24h:
   - Client refunds after deadline
```

---

## 10. Trait Interface (Future)

For Phase 2 composability, the escrow should implement a standard trait:

```clarity
(define-trait escrow-trait
  (
    (create-escrow (principal uint (string-utf8 64) uint) (response uint uint))
    (submit-proof (uint (buff 32)) (response bool uint))
    (release-escrow (uint) (response bool uint))
    (refund-escrow (uint) (response bool uint))
    (get-escrow (uint) (response (optional {
      client: principal,
      provider: principal,
      amount: uint,
      service-id: (string-utf8 64),
      proof-hash: (optional (buff 32)),
      status: (string-ascii 10),
      created-at: uint,
      deadline: uint,
      released-at: (optional uint)
    }) uint))
  )
)
```

This trait would allow a service registry (Phase 2) to interact with any escrow implementation generically.

---

## 11. Evolution Path

| Phase | Scope | Depends On |
|-------|-------|------------|
| **1 — Bilateral Escrow** (this spec) | STX escrow, 2-party, no disputes | Nothing — standalone |
| **2 — Service Registry** | On-chain directory of services + providers + pricing | Phase 1 deployed + SIP-010 trait for multi-token |
| **3 — Treasury DAO** | Shared treasury, fee collection, governance | whoabuddy's treasury template generators |
| **4 — Marketplace** | Discovery, reputation, dispute resolution | Phase 2 + 3 |

---

## 12. Review Checklist for whoabuddy

- [ ] Does the 2-party model (no dispute resolution) make sense for v1?
- [ ] Is immutable deployment correct, or should we use proxy-upgrade for iteration?
- [ ] STX-only initially — when should sBTC/SIP-010 support arrive?
- [ ] Deployer = Arc. Should deployer be a multisig instead?
- [ ] Block-height deadlines vs. time-based — acceptable UX tradeoff?
- [ ] Proof-hash approach (off-chain proof, on-chain hash) — sufficient for agent use?
- [ ] Event schema — any fields needed for treasury template generator compatibility?
- [ ] Does this align with existing AIBTC contract conventions?

---

*Spec only. No code until reviewed.*
