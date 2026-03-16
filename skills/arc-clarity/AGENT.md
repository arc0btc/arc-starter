# arc-clarity — Subagent Briefing

You are auditing a Clarity smart contract. Produce a structured security audit report.

## Audit Process

### Phase 1: Contract Inventory

Read the entire contract. Build a function inventory:

| Function | Type | Risk Color | Notes |
|----------|------|------------|-------|
| name | public/read-only/private | GREEN/YELLOW/ORANGE/RED | brief note |

Risk colors:
- **GREEN**: Read-only, no state changes
- **YELLOW**: State changes with proper guards
- **ORANGE**: Token transfers, external calls
- **RED**: Critical — admin functions, treasury access

### Phase 2: Per-Function Security Check

For each public/private function, verify:

- [ ] Input validation with `asserts!` before state changes
- [ ] Correct principal check:
  - `tx-sender` for token operations and identity attribution
  - `contract-caller` for non-token guards and anti-phishing
  - WARNING: `contract-caller` for self-action guards is bypassable via proxy
- [ ] Error codes for all failure paths (unique per contract, u1000+ range)
- [ ] No unbounded iteration (lists must have fixed max length)
- [ ] Token operations wrapped in `try!`
- [ ] Post-conditions documented for asset protection

**tx-sender vs contract-caller call paths:**

| Call Path | contract-caller | tx-sender |
|-----------|-----------------|-----------|
| user -> target | user | user |
| user -> proxy -> target | proxy | user |
| user -> proxy (as-contract) -> target | proxy | proxy |

### Phase 3: Contract-Wide Check

- [ ] All public functions return `(response ok err)`
- [ ] Error codes are unique and documented
- [ ] Traits are whitelisted before use (`contract-of` verification)
- [ ] `as-contract` has explicit asset allowances (Clarity 4: `with-stx`, `with-ft`, `with-nft`)
- [ ] Rate limiting on sensitive operations (block-based: `burn-block-height` check)
- [ ] Admin functions have proper access control
- [ ] No swallowed errors — all `contract-call?` results handled with `try!` or `match`
- [ ] Constants use UPPER_CASE, vars/maps PascalCase, functions kebab-case, tuple keys camelCase

### Phase 4: Scoring

Score each category 0-100 with 2-3 sentence justification citing specific code:

1. **Authorization Model (15%)** — Are tx-sender/contract-caller used correctly? Any bypassable guards?
2. **Input Validation (10%)** — Are all inputs validated before state changes? Missing asserts!?
3. **Error Handling (10%)** — Unique error codes? Proper try!/match propagation? No swallowed errors?
4. **Token Safety (15%)** — Post-conditions? Transfer guards? as-contract asset restrictions?
5. **Access Control (15%)** — Admin functions protected? Whitelisting? Rate limiting?
6. **Cost Efficiency (10%)** — Execution costs reasonable? No unbounded ops? Constants over data-vars where possible?
7. **Code Quality (10%)** — Naming conventions? Structure? Readability? Under 50 functions?
8. **Composability (15%)** — Trait usage? Upgrade path (versioned contracts)? Trust boundaries defined?

### Phase 5: Hard Gate Check

Instant REJECT if any found:
- G1: Unbounded iteration
- G2: Missing auth on state-changing functions
- G3: `as-contract` without asset restrictions (Clarity 4)
- G4: Swallowed errors on contract-call?

### Phase 6: Decision

- REJECT if any gate fails, any category <60, or weighted final score <75
- APPROVE otherwise
- Confidence: 0.0-1.0 (subtract for incomplete code, missing context, ambiguity)

## Output Format

```json
{
  "contract": "contract-name",
  "version": "1.0",
  "date": "YYYY-MM-DD",
  "functions": [
    {
      "name": "function-name",
      "type": "public|read-only|private",
      "risk": "GREEN|YELLOW|ORANGE|RED",
      "issues": ["issue description"]
    }
  ],
  "categories": {
    "authorization": { "score": 85, "weight": 0.15, "reasoning": "..." },
    "input_validation": { "score": 90, "weight": 0.10, "reasoning": "..." },
    "error_handling": { "score": 80, "weight": 0.10, "reasoning": "..." },
    "token_safety": { "score": 75, "weight": 0.15, "reasoning": "..." },
    "access_control": { "score": 85, "weight": 0.15, "reasoning": "..." },
    "cost_efficiency": { "score": 90, "weight": 0.10, "reasoning": "..." },
    "code_quality": { "score": 85, "weight": 0.10, "reasoning": "..." },
    "composability": { "score": 80, "weight": 0.15, "reasoning": "..." }
  },
  "hard_gates": {
    "G1_unbounded_iteration": false,
    "G2_missing_auth": false,
    "G3_unrestricted_as_contract": false,
    "G4_swallowed_errors": false
  },
  "final_score": 83,
  "confidence": 0.90,
  "decision": "APPROVE",
  "failed": [],
  "summary": "One-paragraph summary of findings and recommendation"
}
```

## Clarity Quick Reference

### Types
int, uint, bool, principal, (buff N), (string-ascii N), (string-utf8 N), (list N T), {key: T}, (optional T), (response ok err)

### Key Security Functions
- `asserts!` — guard or early-return error
- `try!` — unwrap response/optional or propagate error
- `unwrap!` — unwrap or return default
- `match` — destructure optional/response
- `is-eq` — equality check (use for principal comparison)
- `as-contract` — execute as contract principal (changes BOTH tx-sender and contract-caller)

### Execution Cost Limits
| Category | Block Limit | Read-Only Limit |
|----------|-------------|-----------------|
| Runtime | 5,000,000,000 | 1,000,000,000 |
| Read count | 15,000 | 30 |
| Read bytes | 100MB | 100KB |
| Write count | 15,000 | 0 |
| Write bytes | 15MB | 0 |

### Clarity 4 Asset Restrictions
```clarity
(as-contract
  (with-stx u1000000)           ;; Allow specific STX amount
  (with-ft .token TOKEN u500)   ;; Allow specific FT amount
  (with-nft .nft NFT (list u1)) ;; Allow specific NFT IDs
  ;; body
)
;; DANGER: (with-all-assets-unsafe) — flag in audit
```

### Common Vulnerability Patterns
1. **Proxy bypass**: Using `contract-caller` for self-action guards — attacker routes through proxy
2. **Missing try!**: `contract-call?` without error handling silently succeeds on failure
3. **Unbounded fold**: `fold` over user-supplied list without max-length constraint
4. **Stale at-block**: Reading state at old block without considering current state changes
5. **Treasury drain**: `as-contract` with `with-all-assets-unsafe` instead of explicit allowances
