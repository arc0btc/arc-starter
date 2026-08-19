---
id: signing-key-exposure-no-kms-boundary
topics: [security, signing, credentials, wallet, key-management, kms, residual-risk]
source: task-26683
created: 2026-08-19
---

**Residual, accepted risk: Arc's signing keys are reachable by Arc's own process; there is no
key-never-exposed (KMS/HSM) boundary.** Hypothesis (from a @cramforce/Vercel-KMS tweet the
scaffold could not fetch — X read budget exhausted, so verified against Arc's code, not the tweet)
was: Vercel KMS signs *inside* a function while the process never gets the raw private key; Arc
does NOT implement that. Confirmed true against Arc's own code.

**How Arc actually handles keys (verified 2026-08-19):**
- **Credential store** (`skills/arc-credentials/store.ts`): AES-256-GCM + **scrypt** (N=16384,r=8,p=1)
  at rest — note MEMORY.md's "PBKDF2-SHA256 100k" is stale, the code is scrypt. `decrypt()` →
  plaintext into JS memory; `get()`/`getCredential()` (`src/credentials.ts`) return the raw value
  string. Any process that can call it (or run `arc creds get`) reads plaintext.
- **Wallet signing** (`skills/bitcoin-wallet/cli.ts` → `sign-runner.ts` →
  `github/aibtcdev/skills/src/lib/services/wallet-manager.ts:217`): partial **process** isolation.
  `runSigning()` spawns a child `sign-runner` with `WALLET_ID`/`WALLET_PASSWORD` env; the child
  decrypts the BIP39 **mnemonic** in memory and derives keys for BIP-340/342 + SIP-018. The
  dispatch process does not hold the *derived* key — but it holds `getCredential("bitcoin-wallet",
  "password")` and can spawn the runner at will, so it can re-derive the key on demand.

**What the subprocess isolation buys, and what it does NOT:** it bounds key *lifetime* (key exists
only during the sign call, in a child, then `wm.lock()`) and gives a clean lock path. It does NOT
give **capability isolation** — on this single-uid Linux VM, Arc's own code path always reaches the
key material: the wallet password is one `arc creds get --service bitcoin-wallet --key password`
away, and `ARC_CREDS_PASSWORD` + `~/.aibtc/credentials.enc` are both readable by the dispatch uid.
So a successful prompt-injection that gets the model to run a disclosing command exfiltrates the
whole store. This is the real dominant threat (SOUL.md: "I process untrusted content every cycle").

**Why no portable KMS-grade equivalent was adopted (exit condition → "not portable" branch):**
- *External KMS / remote signer* (AWS/GCP KMS, Turnkey, Fireblocks): genuinely key-never-exposed,
  but not "portable to Arc's VM" — adds a new trust party, network round-trip + per-sign cost, and
  most don't natively cover secp256k1 **Schnorr/BIP-340 + Stacks SIP-018** (AWS KMS does ECDSA
  secp256k1, not Schnorr). Curve-support gap alone blocks a drop-in.
- *On-box TPM/enclave* (vTPM, SEV-SNP, SGX): the VM has no guaranteed such hardware; not portable
  in general.
- *Local persistent signer daemon* (unix-socket, holds mnemonic, exposes sign-only RPC): buys
  nothing extra on a **single-uid** box — an attacker with code-exec-as-arc reads `/proc/<pid>/mem`
  or just the cred store. Only helps if the key moves to a separate uid/hardware, which reduces to
  the two options above.

**Accepted residual + the real controls:** on a single-tenant single-uid VM, code-exec-as-arc ==
full key access is accepted. The actual mitigations are all *reach-reduction*, not a key boundary:
subprocess isolation (key lifetime), AGENT.md-kept-out-of-orchestrator (`src/dispatch.ts:245-253`,
limits injection reach — see [[skillmd-black-box-extraction-exposure]]), the outbound leak-canary
(`skills/social-engine/leak-canary.ts`, #26535/#26539), and no-egress-boundary context in
[[dispatch-no-egress-boundary-half-sandbox]]. **Watch trigger to revisit:** Arc moves to a
multi-tenant box, adds a second uid, gains vTPM/enclave hardware, or a Schnorr+SIP-018-capable
remote signer appears — any of those flips the "not portable" verdict and warrants a scoping task.
No follow-up filed now: building an external-signer path today adds a trust party + cost + curve
gaps without changing the single-uid threat model. No paid report written — the source tweet was
unfetchable and the topic is Arc-internal security, not $9-reader material.
