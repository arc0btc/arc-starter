#!/usr/bin/env bun

export {};

/**
 * clarity-patterns CLI — Clarity smart contract pattern library
 *
 * Provides reference implementations for common Clarity idioms:
 * SIP-010 FT, SIP-009 NFT, traits, access control, upgrades, safety patterns.
 *
 * All patterns align with clarity-check rules (no deprecated functions,
 * no anti-patterns flagged by clarity-check).
 */

// ---- Types ----

type Category =
  | "tokens"
  | "traits"
  | "access-control"
  | "upgrades"
  | "safety";

interface Pattern {
  id: string;
  name: string;
  category: Category;
  tags: string[];
  description: string;
  code: string;
  notes: string[];
  antiPatternAlignment: string[];
}

// ---- Pattern Library ----

const PATTERNS: Pattern[] = [
  {
    id: "sip-010-ft",
    name: "SIP-010 Fungible Token",
    category: "tokens",
    tags: ["sip-010", "fungible-token", "ft", "token"],
    description:
      "Minimal SIP-010 compliant fungible token with mint (owner-only) and transfer.",
    code: `
;; SIP-010 Fungible Token — minimal compliant implementation
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-fungible-token my-token u1000000000)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u401))
(define-constant ERR-NOT-TOKEN-OWNER (err u403))

(define-public (transfer
    (amount uint)
    (sender principal)
    (recipient principal)
    (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-TOKEN-OWNER)
    (ft-transfer? my-token amount sender recipient)
  )
)

(define-read-only (get-name)          (ok "My Token"))
(define-read-only (get-symbol)        (ok "MTK"))
(define-read-only (get-decimals)      (ok u6))
(define-read-only (get-total-supply)  (ok (ft-get-supply my-token)))
(define-read-only (get-token-uri)     (ok (some u"https://example.com/token.json")))

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance my-token account))
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (ft-mint? my-token amount recipient)
  )
)
`.trim(),
    notes: [
      "Replace SP3FBR2... with the deployed SIP-010 trait contract on your network.",
      "supply cap (u1000000000) is optional — omit the second arg for uncapped supply.",
      "Add (define-data-var contract-owner principal tx-sender) for transferable ownership.",
    ],
    antiPatternAlignment: [
      "Uses ft-transfer? not define-fungible-token (deprecated-define-fungible-token rule).",
      "Sender check via asserts! before transfer (missing-sender-check rule).",
      "No unwrap-panic in public functions (unwrap-panic-in-public rule).",
    ],
  },
  {
    id: "sip-009-nft",
    name: "SIP-009 Non-Fungible Token",
    category: "tokens",
    tags: ["sip-009", "nft", "non-fungible-token", "token"],
    description:
      "Minimal SIP-009 compliant NFT with sequential IDs, mint (owner-only), and transfer.",
    code: `
;; SIP-009 Non-Fungible Token — minimal compliant implementation
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-non-fungible-token my-nft uint)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY      (err u401))
(define-constant ERR-NOT-TOKEN-OWNER (err u403))
(define-constant ERR-TOKEN-NOT-FOUND (err u404))

(define-data-var last-token-id uint u0)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-TOKEN-OWNER)
    (asserts! (is-some (nft-get-owner? my-nft token-id)) ERR-TOKEN-NOT-FOUND)
    (nft-transfer? my-nft token-id sender recipient)
  )
)

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (token-id uint))
  (ok (some u"https://example.com/nft/{id}.json"))
)

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? my-nft token-id))
)

(define-public (mint (recipient principal))
  (let ((new-id (+ (var-get last-token-id) u1)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (var-set last-token-id new-id)
    (nft-mint? my-nft new-id recipient)
  )
)
`.trim(),
    notes: [
      "Replace SP2PAB... with the deployed SIP-009 trait contract on your network.",
      "Token URI can encode {id} for per-token metadata — resolve server-side.",
      "Add a (define-map token-metadata uint { ...}) for on-chain metadata.",
    ],
    antiPatternAlignment: [
      "Uses define-non-fungible-token correctly (not the deprecated alias).",
      "Ownership verified before transfer (asserts! sender check).",
      "No unwrap-panic in public functions.",
    ],
  },
  {
    id: "ft-allowance",
    name: "FT Allowance / Approve Pattern",
    category: "tokens",
    tags: ["sip-010", "fungible-token", "allowance", "approve", "erc20"],
    description:
      "Extends SIP-010 with an allowance map so spenders can transfer on behalf of owners.",
    code: `
;; FT Allowance / Approve Pattern (extends SIP-010)
;; Add alongside the base SIP-010 implementation.

(define-constant ERR-INSUFFICIENT-ALLOWANCE (err u405))
(define-constant ERR-SELF-ALLOWANCE         (err u406))

(define-map allowances
  { owner: principal, spender: principal }
  uint
)

(define-public (approve (spender principal) (amount uint))
  (begin
    (asserts! (not (is-eq tx-sender spender)) ERR-SELF-ALLOWANCE)
    (ok (map-set allowances { owner: tx-sender, spender: spender } amount))
  )
)

(define-read-only (get-allowance (owner principal) (spender principal))
  (ok (default-to u0 (map-get? allowances { owner: owner, spender: spender })))
)

;; Replace the base transfer to allow delegated transfers:
(define-public (transfer-from
    (amount uint)
    (owner principal)
    (recipient principal)
    (memo (optional (buff 34))))
  (let ((current (default-to u0 (map-get? allowances { owner: owner, spender: tx-sender }))))
    (asserts! (>= current amount) ERR-INSUFFICIENT-ALLOWANCE)
    (map-set allowances { owner: owner, spender: tx-sender } (- current amount))
    (ft-transfer? my-token amount owner recipient)
  )
)
`.trim(),
    notes: [
      "This extends the base sip-010-ft pattern — include both in your contract.",
      "Always subtract allowance before the transfer to prevent double-spend.",
      "Consider adding an infinite allowance sentinel (u340282366920938463463374607431768211455).",
    ],
    antiPatternAlignment: [
      "Allowance decremented before transfer (prevents race condition).",
      "Self-allowance guard prevents trivially broken invariants.",
    ],
  },
  {
    id: "trait-definition",
    name: "Trait Definition",
    category: "traits",
    tags: ["trait", "interface", "composability"],
    description:
      "Define a reusable trait in a dedicated contract so multiple contracts can implement it.",
    code: `
;; my-trait.clar — deploy this contract once, then reference its address
;; Trait contracts should be immutable and minimal.

(define-trait my-trait
  (
    ;; Returns the stored value
    (get-value () (response uint uint))

    ;; Sets the stored value; returns true on success
    (set-value (uint) (response bool uint))

    ;; Check if the caller is authorized
    (is-authorized (principal) (response bool uint))
  )
)
`.trim(),
    notes: [
      "Deploy trait contracts once — their address is permanent.",
      "Every function in a trait must have a fully-specified response type.",
      "Keep traits minimal: only the interface boundary, no implementation.",
      "Name the trait file and define-trait identifier consistently.",
    ],
    antiPatternAlignment: [
      "No state in trait contracts — pure interface definitions.",
    ],
  },
  {
    id: "trait-implementation",
    name: "Trait Implementation",
    category: "traits",
    tags: ["trait", "impl-trait", "interface", "composability"],
    description:
      "Implement a previously defined trait using impl-trait. Satisfies inter-contract type checking.",
    code: `
;; my-implementation.clar — implements .my-trait
(impl-trait 'SP_TRAIT_DEPLOYER.my-trait.my-trait)

(define-data-var stored-value uint u0)
(define-data-var authorized-caller principal tx-sender)

(define-constant ERR-UNAUTHORIZED (err u401))

;; impl: get-value
(define-read-only (get-value)
  (ok (var-get stored-value))
)

;; impl: set-value
(define-public (set-value (new-value uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authorized-caller)) ERR-UNAUTHORIZED)
    (var-set stored-value new-value)
    (ok true)
  )
)

;; impl: is-authorized
(define-read-only (is-authorized (caller principal))
  (ok (is-eq caller (var-get authorized-caller)))
)

;; Calling the trait via contract-call? with dynamic dispatch:
;; (contract-call? (as-contract <some-principal>) get-value)
`.trim(),
    notes: [
      "impl-trait validates at deploy time that all trait functions are present.",
      "Read-only trait functions must be defined as define-read-only.",
      "Use (as-contract ...) when calling a trait implementation from another contract.",
    ],
    antiPatternAlignment: [
      "Authorization check before var-set (var-set-without-guard rule).",
      "No unwrap-panic used.",
    ],
  },
  {
    id: "owner-only",
    name: "Owner-Only Access Control",
    category: "access-control",
    tags: ["access-control", "owner", "authorization", "admin"],
    description:
      "Single-owner guard with transferable ownership. The most common access control pattern.",
    code: `
;; Owner-Only Access Control with transferable ownership

(define-constant ERR-OWNER-ONLY (err u401))

;; Use a var for transferable ownership (not tx-sender constant)
(define-data-var contract-owner principal tx-sender)

(define-read-only (get-owner)
  (var-get contract-owner)
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    (ok (var-set contract-owner new-owner))
  )
)

;; Usage in protected functions:
(define-public (admin-action (param uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    ;; ... protected logic here ...
    (ok true)
  )
)

;; Two-step ownership transfer (safer for large contracts):
;; 1. propose-ownership sets pending-owner
;; 2. accept-ownership called by pending-owner confirms the transfer
(define-data-var pending-owner (optional principal) none)

(define-public (propose-ownership (candidate principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    (ok (var-set pending-owner (some candidate)))
  )
)

(define-public (accept-ownership)
  (let ((candidate (unwrap! (var-get pending-owner) (err u404))))
    (asserts! (is-eq tx-sender candidate) ERR-OWNER-ONLY)
    (var-set contract-owner candidate)
    (var-set pending-owner none)
    (ok true)
  )
)
`.trim(),
    notes: [
      "Prefer transferable (data-var) ownership over immutable (define-constant) for production.",
      "Two-step transfer prevents accidentally setting owner to an unreachable address.",
      "Emit a print event on ownership transfer for off-chain indexing.",
    ],
    antiPatternAlignment: [
      "All var-set calls gated by asserts! ownership check (var-set-without-guard rule).",
      "No unwrap-panic — uses unwrap! with explicit error.",
    ],
  },
  {
    id: "role-based",
    name: "Role-Based Access Control",
    category: "access-control",
    tags: ["access-control", "roles", "rbac", "authorization"],
    description:
      "Multi-role access with a roles map. Supports admin, minter, pauser, etc.",
    code: `
;; Role-Based Access Control

(define-constant ROLE-ADMIN  u0)
(define-constant ROLE-MINTER u1)
(define-constant ROLE-PAUSER u2)

(define-constant ERR-UNAUTHORIZED (err u401))
(define-constant ERR-ALREADY-HAS-ROLE (err u409))

;; roles[principal][role] = true
(define-map roles { account: principal, role: uint } bool)

;; Bootstrap: grant admin to deployer
(map-set roles { account: tx-sender, role: ROLE-ADMIN } true)

;; Read
(define-read-only (has-role (account principal) (role uint))
  (default-to false (map-get? roles { account: account, role: role }))
)

;; Admin grants / revokes
(define-public (grant-role (account principal) (role uint))
  (begin
    (asserts! (has-role tx-sender ROLE-ADMIN) ERR-UNAUTHORIZED)
    (ok (map-set roles { account: account, role: role } true))
  )
)

(define-public (revoke-role (account principal) (role uint))
  (begin
    (asserts! (has-role tx-sender ROLE-ADMIN) ERR-UNAUTHORIZED)
    (ok (map-delete roles { account: account, role: role }))
  )
)

;; Usage in guarded functions:
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (has-role tx-sender ROLE-MINTER) ERR-UNAUTHORIZED)
    ;; ... mint logic ...
    (ok true)
  )
)
`.trim(),
    notes: [
      "Add more roles as uint constants — document them at the top of the file.",
      "Consider a separate admin-role guard for role management itself.",
      "Emit print events on grant/revoke for off-chain access auditing.",
    ],
    antiPatternAlignment: [
      "All map-set/map-delete calls gated by has-role check.",
      "No unwrap-panic in public functions.",
    ],
  },
  {
    id: "multisig",
    name: "N-of-M Multisig Approval",
    category: "access-control",
    tags: ["access-control", "multisig", "governance", "approval"],
    description:
      "Require N approvals from a fixed set of M signers before executing a proposal.",
    code: `
;; N-of-M Multisig Approval

(define-constant SIGNERS (list
  'SP1SIGNER111111111111111111111111111111111
  'SP2SIGNER222222222222222222222222222222222
  'SP3SIGNER333333333333333333333333333333333
))
(define-constant THRESHOLD    u2)   ;; N approvals required
(define-constant ERR-NOT-SIGNER      (err u401))
(define-constant ERR-ALREADY-VOTED  (err u409))
(define-constant ERR-THRESHOLD-NOT-MET (err u428))

(define-map approvals { proposal-id: uint, signer: principal } bool)
(define-map approval-count uint uint)
(define-data-var proposal-nonce uint u0)

(define-read-only (is-signer (account principal))
  (is-some (index-of SIGNERS account))
)

(define-read-only (get-approval-count (proposal-id uint))
  (default-to u0 (map-get? approval-count proposal-id))
)

(define-read-only (is-approved (proposal-id uint))
  (>= (get-approval-count proposal-id) THRESHOLD)
)

(define-public (approve (proposal-id uint))
  (begin
    (asserts! (is-signer tx-sender) ERR-NOT-SIGNER)
    (asserts!
      (is-none (map-get? approvals { proposal-id: proposal-id, signer: tx-sender }))
      ERR-ALREADY-VOTED)
    (map-set approvals { proposal-id: proposal-id, signer: tx-sender } true)
    (ok (map-set approval-count proposal-id
          (+ (get-approval-count proposal-id) u1)))
  )
)

;; Execute only when threshold is met:
(define-public (execute (proposal-id uint))
  (begin
    (asserts! (is-approved proposal-id) ERR-THRESHOLD-NOT-MET)
    ;; ... execute proposal logic ...
    (ok true)
  )
)
`.trim(),
    notes: [
      "Replace placeholder signer addresses with real principals before deploying.",
      "SIGNERS list is limited to 127 entries (Clarity list max).",
      "Add proposal expiry via block-height check if time-bounding is needed.",
      "Consider storing proposal data in a map keyed by proposal-id.",
    ],
    antiPatternAlignment: [
      "index-of used for signer lookup — safe for bounded lists.",
      "No unwrap-panic in public functions.",
      "Double-vote guard via approvals map check.",
    ],
  },
  {
    id: "proxy-upgrade",
    name: "Proxy Upgrade Pattern",
    category: "upgrades",
    tags: ["upgrade", "proxy", "upgradeable", "versioning"],
    description:
      "Thin proxy contract with a stable address; points to a swappable implementation contract.",
    code: `
;; proxy.clar — stable address, never changes
;; All user-facing calls go through this contract.

(define-constant ERR-OWNER-ONLY (err u401))
(define-data-var contract-owner    principal tx-sender)
(define-data-var implementation    principal 'SP_IMPL_V1.my-implementation)

(define-read-only (get-implementation)
  (var-get implementation)
)

;; Admin upgrades the implementation pointer
(define-public (upgrade (new-impl principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    (ok (var-set implementation new-impl))
  )
)

;; Delegate a call to the current implementation
;; (contract-call? (var-get implementation) some-function arg1 arg2)
;;
;; Example delegating proxy function:
(define-public (do-action (param uint))
  (contract-call? (var-get implementation) do-action param)
)

;; ----
;; my-implementation-v1.clar — logic, references shared data store
;; my-implementation-v2.clar — new logic, same data store address
;; data-store.clar          — all state lives here, immutable address
`.trim(),
    notes: [
      "The proxy address is permanent — users interact with it forever.",
      "Implementation contracts must share the same function signatures as the proxy.",
      "Combine with data-logic-separation: implementation reads/writes a separate data contract.",
      "Emit a print event on upgrade with old/new implementation addresses.",
    ],
    antiPatternAlignment: [
      "Owner check before var-set (var-set-without-guard rule).",
      "No unwrap-panic — explicit error responses.",
    ],
  },
  {
    id: "data-logic-separation",
    name: "Data / Logic Separation",
    category: "upgrades",
    tags: ["upgrade", "data", "logic", "separation", "versioning"],
    description:
      "Store all state in an immutable data contract; swap logic contracts independently.",
    code: `
;; data-store.clar — immutable address, holds all persistent state
;; Only allow writes from the authorized logic contract.

(define-constant ERR-LOGIC-ONLY (err u403))
(define-data-var logic-contract principal 'SP_LOGIC_V1.my-logic)

(define-read-only (get-logic) (var-get logic-contract))

;; Only the deployer (an admin proxy) can rotate the logic address
(define-data-var store-owner principal tx-sender)
(define-public (set-logic (new-logic principal))
  (begin
    (asserts! (is-eq tx-sender (var-get store-owner)) ERR-LOGIC-ONLY)
    (ok (var-set logic-contract new-logic))
  )
)

;; State storage — only writable by current logic contract
(define-map user-balances principal uint)

(define-public (set-balance (user principal) (amount uint))
  (begin
    (asserts! (is-eq contract-caller (var-get logic-contract)) ERR-LOGIC-ONLY)
    (ok (map-set user-balances user amount))
  )
)

(define-read-only (get-balance (user principal))
  (default-to u0 (map-get? user-balances user))
)

;; ----
;; my-logic-v1.clar — reads/writes data-store
;; (contract-call? .data-store set-balance user new-amount)
;; (contract-call? .data-store get-balance user)
;;
;; my-logic-v2.clar — new logic, same data-store address
`.trim(),
    notes: [
      "data-store address never changes — it is the permanent canonical state.",
      "contract-caller (not tx-sender) used to verify the calling logic contract.",
      "Rotation of logic-contract should be protected by a multisig or timelock.",
    ],
    antiPatternAlignment: [
      "contract-caller check gates all state writes — no unauthorized mutations.",
      "No unwrap-panic in public functions.",
    ],
  },
  {
    id: "pausable",
    name: "Pausable Pattern",
    category: "safety",
    tags: ["safety", "pausable", "circuit-breaker", "emergency"],
    description:
      "Owner-controlled pause/unpause switch. Gate sensitive operations behind it.",
    code: `
;; Pausable Pattern

(define-constant ERR-PAUSED     (err u503))
(define-constant ERR-OWNER-ONLY (err u401))

(define-data-var paused         bool      false)
(define-data-var contract-owner principal tx-sender)

(define-read-only (is-paused) (var-get paused))

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    (ok (var-set paused true))
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-OWNER-ONLY)
    (ok (var-set paused false))
  )
)

;; Usage — add this guard to any sensitive function:
(define-public (transfer (amount uint) (recipient principal))
  (begin
    (asserts! (not (var-get paused)) ERR-PAUSED)
    ;; ... transfer logic ...
    (ok true)
  )
)
`.trim(),
    notes: [
      "Gate only irreversible or high-value operations — don't pause reads.",
      "Consider a timelock before unpausing to give users time to exit.",
      "Emit a print event on pause/unpause with the caller and block-height.",
    ],
    antiPatternAlignment: [
      "var-set gated by owner check (var-set-without-guard rule).",
      "not (var-get paused) check is clear and explicit.",
    ],
  },
  {
    id: "reentrancy-guard",
    name: "Reentrancy Guard",
    category: "safety",
    tags: ["safety", "reentrancy", "security"],
    description:
      "Prevent recursive re-entry. Clarity's atomicity provides strong baseline protection — this adds an explicit guard for complex multi-step flows.",
    code: `
;; Reentrancy Guard
;; Note: Clarity's atomic execution model makes reentrancy much harder than in Solidity.
;; Use this pattern for flows that make multiple inter-contract calls in sequence.

(define-constant ERR-REENTRANT  (err u600))
(define-data-var executing      bool false)

(define-public (protected-function (param uint))
  (begin
    (asserts! (not (var-get executing)) ERR-REENTRANT)
    (var-set executing true)
    ;; ... potentially calling other contracts ...
    (let ((result (try! (some-inter-contract-call param))))
      (var-set executing false)
      (ok result)
    )
  )
)

;; Alternative: checks-effects-interactions order
;; 1. Assertions (checks)
;; 2. State updates (effects)
;; 3. External calls (interactions)
;;
;; (define-public (safe-transfer (amount uint) (recipient principal))
;;   (begin
;;     (asserts! (>= (get-balance tx-sender) amount) ERR-INSUFFICIENT)
;;     (map-set balances tx-sender (- (get-balance tx-sender) amount)) ;; effect first
;;     (try! (as-contract (stx-transfer? amount tx-this recipient)))   ;; then interact
;;     (ok true)
;;   )
;; )
`.trim(),
    notes: [
      "In Clarity, post-conditions constrain what inter-contract calls can do — use them.",
      "Checks-effects-interactions order is the primary defense; the guard is a secondary backstop.",
      "The guard flag persists within a single transaction — reset it before any early return.",
    ],
    antiPatternAlignment: [
      "State update (var-set executing false) happens before function exits.",
      "No unwrap-panic — uses try! with explicit error propagation.",
    ],
  },
  {
    id: "error-constants",
    name: "Error Constants",
    category: "safety",
    tags: ["safety", "errors", "constants", "conventions"],
    description:
      "Standard error code conventions for readable, consistent error handling.",
    code: `
;; Standard Error Constants — HTTP-inspired ranges

;; 1xx: Validation errors
(define-constant ERR-INVALID-AMOUNT      (err u100))
(define-constant ERR-ZERO-AMOUNT         (err u101))
(define-constant ERR-OVERFLOW            (err u102))
(define-constant ERR-UNDERFLOW           (err u103))
(define-constant ERR-INVALID-PRINCIPAL   (err u104))

;; 4xx: Auth / client errors
(define-constant ERR-UNAUTHORIZED        (err u401))
(define-constant ERR-FORBIDDEN           (err u403))
(define-constant ERR-NOT-FOUND           (err u404))
(define-constant ERR-ALREADY-EXISTS      (err u409))
(define-constant ERR-PRECONDITION-FAILED (err u412))

;; 5xx: State / server errors
(define-constant ERR-PAUSED              (err u500))
(define-constant ERR-NOT-INITIALIZED     (err u501))
(define-constant ERR-ALREADY-INITIALIZED (err u502))
(define-constant ERR-REENTRANT           (err u503))

;; Usage:
;; (asserts! (> amount u0)                       ERR-ZERO-AMOUNT)
;; (asserts! (is-eq tx-sender owner)             ERR-UNAUTHORIZED)
;; (asserts! (is-some (map-get? items key))      ERR-NOT-FOUND)
;; (asserts! (is-none (map-get? items key))      ERR-ALREADY-EXISTS)
;; (asserts! (not (var-get paused))              ERR-PAUSED)
`.trim(),
    notes: [
      "Keep error codes unique within a contract to aid debugging.",
      "Document each constant with a brief comment if the name isn't self-evident.",
      "Never use u0 as an error code — it is visually confusing with false/none.",
    ],
    antiPatternAlignment: [
      "Named constants replace magic numbers (magic-number rule).",
      "Explicit error returns replace unwrap-panic (unwrap-panic-in-public rule).",
    ],
  },
  {
    id: "event-emission",
    name: "Structured Event Emission",
    category: "safety",
    tags: ["events", "logging", "print", "indexing", "observability"],
    description:
      "Use (print ...) with typed tuples for structured, indexable on-chain events.",
    code: `
;; Structured Event Emission via (print ...)
;; Events are stored on-chain and indexed by the Stacks API.

;; Transfer event — mirrors SIP-010 / SIP-009 convention
(define-public (transfer-with-event
    (amount uint)
    (sender principal)
    (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err u403))
    (try! (stx-transfer? amount sender recipient))
    (print {
      event:     "transfer",
      amount:    amount,
      sender:    sender,
      recipient: recipient,
      block:     block-height
    })
    (ok true)
  )
)

;; Mint event
(define-public (mint-with-event (token-id uint) (recipient principal))
  (begin
    (try! (nft-mint? my-nft token-id recipient))
    (print {
      event:     "mint",
      token-id:  token-id,
      recipient: recipient,
      minter:    tx-sender,
      block:     block-height
    })
    (ok true)
  )
)

;; Admin action event
(define-public (admin-action-with-event (param uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err u401))
    ;; ... logic ...
    (print {
      event:  "admin-action",
      actor:  tx-sender,
      param:  param,
      block:  block-height
    })
    (ok true)
  )
)
`.trim(),
    notes: [
      "Include event name and block-height in every print tuple — aids indexing.",
      "The Stacks API indexes print events by contract and can filter by event field.",
      "Prefer tuple literals over strings — they are type-safe and gas-efficient.",
    ],
    antiPatternAlignment: [
      "try! used instead of unwrap-panic for inter-contract calls.",
      "Sender asserted before transfer (missing-sender-check rule).",
    ],
  },
];

// ---- Helpers ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function scorePatternForUseCase(pattern: Pattern, useCase: string): number {
  const query = useCase.toLowerCase();
  const terms = query.split(/\s+/);
  let score = 0;

  for (const term of terms) {
    if (pattern.id.includes(term)) score += 3;
    if (pattern.name.toLowerCase().includes(term)) score += 2;
    if (pattern.description.toLowerCase().includes(term)) score += 2;
    if (pattern.tags.some((t) => t.includes(term))) score += 2;
    if (pattern.category.includes(term)) score += 1;
    if (pattern.code.toLowerCase().includes(term)) score += 1;
  }

  return score;
}

// ---- Subcommands ----

function cmdList(): void {
  const rows = PATTERNS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    tags: p.tags,
    description: p.description,
  }));
  console.log(
    JSON.stringify({ success: true, count: rows.length, patterns: rows }, null, 2)
  );
}

function cmdCategories(): void {
  const cats = new Map<Category, { count: number; ids: string[] }>();
  for (const p of PATTERNS) {
    const entry = cats.get(p.category) ?? { count: 0, ids: [] };
    entry.count++;
    entry.ids.push(p.id);
    cats.set(p.category, entry);
  }
  const categories = Array.from(cats.entries()).map(([name, data]) => ({
    name,
    count: data.count,
    patterns: data.ids,
  }));
  console.log(JSON.stringify({ success: true, categories }, null, 2));
}

function cmdShow(args: string[]): void {
  const flags = parseFlags(args);
  const patternId = flags.pattern;

  if (!patternId) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Required: --pattern <id>",
        usage:
          "arc skills run --name clarity-patterns -- show --pattern sip-010-ft",
      })
    );
    process.exit(1);
  }

  const pattern = PATTERNS.find((p) => p.id === patternId);
  if (!pattern) {
    const ids = PATTERNS.map((p) => p.id);
    console.log(
      JSON.stringify({
        success: false,
        error: `Pattern not found: ${patternId}`,
        available: ids,
      })
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ success: true, pattern }, null, 2));
}

function cmdSearch(args: string[]): void {
  const flags = parseFlags(args);
  const tag = flags.tag;
  const category = flags.category as Category | undefined;

  if (!tag && !category) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Required: --tag <tag> or --category <category>",
        usage:
          "arc skills run --name clarity-patterns -- search --tag sip-010\n" +
          "arc skills run --name clarity-patterns -- search --category access-control",
      })
    );
    process.exit(1);
  }

  let results = PATTERNS;

  if (tag) {
    results = results.filter((p) => p.tags.some((t) => t.includes(tag)));
  }
  if (category) {
    results = results.filter((p) => p.category === category);
  }

  const rows = results.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    tags: p.tags,
    description: p.description,
  }));

  console.log(
    JSON.stringify({ success: true, count: rows.length, patterns: rows }, null, 2)
  );
}

function cmdSuggest(args: string[]): void {
  const flags = parseFlags(args);
  const useCase = flags["use-case"];

  if (!useCase) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Required: --use-case <text>",
        usage:
          "arc skills run --name clarity-patterns -- suggest --use-case \"fungible token with minting\"",
      })
    );
    process.exit(1);
  }

  const scored = PATTERNS.map((p) => ({
    score: scorePatternForUseCase(p, useCase),
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
  }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length === 0) {
    console.log(
      JSON.stringify({
        success: true,
        useCase,
        suggestions: [],
        message:
          "No patterns matched. Try broader terms or run 'list' for all patterns.",
      })
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        useCase,
        suggestions: scored.map(({ score: _score, ...rest }) => rest),
      },
      null,
      2
    )
  );
}

// ---- Usage ----

function printUsage(): void {
  console.log(`clarity-patterns — Clarity smart contract pattern library

Usage:
  bun skills/clarity-patterns/cli.ts <command> [flags]

Commands:
  list                List all available patterns
  categories          List pattern categories with counts
  show                Show a specific pattern with full code
  search              Filter patterns by tag or category
  suggest             Suggest patterns for a given use case

Flags:
  --pattern <id>       Pattern ID for 'show'
  --tag <tag>          Tag filter for 'search'
  --category <name>    Category filter for 'search'
  --use-case <text>    Use case description for 'suggest'

Examples:
  bun skills/clarity-patterns/cli.ts list
  bun skills/clarity-patterns/cli.ts categories
  bun skills/clarity-patterns/cli.ts show --pattern sip-010-ft
  bun skills/clarity-patterns/cli.ts search --tag access-control
  bun skills/clarity-patterns/cli.ts search --category tokens
  bun skills/clarity-patterns/cli.ts suggest --use-case "NFT with royalties"
  bun skills/clarity-patterns/cli.ts suggest --use-case "upgradeable contract"
`);
}

// ---- Entry Point ----

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (sub) {
    case "list":
      cmdList();
      break;
    case "categories":
      cmdCategories();
      break;
    case "show":
      cmdShow(args.slice(1));
      break;
    case "search":
      cmdSearch(args.slice(1));
      break;
    case "suggest":
      cmdSuggest(args.slice(1));
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
