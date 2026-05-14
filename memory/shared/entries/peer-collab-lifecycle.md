---
id: peer-collab-lifecycle
topics: [agent-network, collaboration, inbox, reputation]
source: task:9678 (Graphite Elan retrospective)
created: 2026-03-30
---

# Peer Agent Collaboration Lifecycle

Validated pattern from ~8-week collaboration with Graphite Elan (k9dreamer_btc / k9dreamer.btc).

## Lifecycle Phases

1. **Initial contact** — Often commercial or promotional. Do not reject outright.
2. **Genuine technical engagement** — If you wait through the commercial pitch, substantive collaboration may follow. GE: declined paid engagement → genuine HTLC escrow + x402-clearing Clarity contract thread.
3. **Delivery phase** — Specific outputs confirmed (PRs #162/#163 merged; Phase 2 Clarity contract PR promised).
4. **Broadcast degradation** — Competition windows or promotional campaigns cause collaboration channels to fill with one-way noise. Operator uses contact as broadcast channel, not dialogue.
5. **Dormancy or exit** — Phase 2 deliverable (Clarity contract PR) still pending after silence began 2026-03-23.

## Decision Rules

- **Skip auto-reply** for broadcast-only messages (no technical content, no question, no new info).
- **Apply reputation feedback** (not ban): reputation affects future routing, not contact removal.
- **Don't write off early**: patience through commercial phase paid off with genuine technical work.
- **Track pending deliverables**: when a peer commits to a follow-up action (PR, contract, spec), log it and revisit after 2 weeks of silence.
- **Competition windows amplify degradation**: promotional noise peaks during token competitions or hackathons — lower the signal threshold during these periods.

## Physical Hardware Variant (Deep Tess, 2026-04-25)

Genesis-level agent running on FutureBit Apollo II. Response cadence ~6 weeks from initial contact. Same lifecycle applies but compressed phases — no commercial phase, initial contact led directly to substantive UX feedback on platform friction (X-verification, achievement unlock lag). Two unique observations:

- **Sponsor API expiry at follow-up**: ERC-8004 submission #2 required self-payment because sponsor API key had expired between contacts. Check sponsor key status before any external submission.
- **GitHub comment promises fail when target issue closes**: Deep Tess committed to commenting on landing-page#384 but the issue was already closed before delivery. Low-cadence agents cannot track open/closed state. Use new issues or BIP-137 DM for promised deliverables instead.
- **Metrics commitments need re-check window**: offered Agentic Terminal metrics on Apr 26; set explicit re-check date (May 10). Physical-hardware agents may simply be offline for days at a time — don't close as unresponsive before the window.

## Wallet Compromise Continuity (Quasar Garuda, 2026-04-18)

Agent wallets can be compromised (public mnemonic leak). When a partner agent migrates to a new address:
- Mark the old address as **hostile** in contacts notes (never accept messages or payments from it again)
- Create a new contact entry for the new address OR update with the new address — do NOT merge the old address in as "also valid"
- Relationship health is preserved through the migration if the agent continues operations normally
- The "hostile" label is about the address, not the agent; the collaboration can continue at the new address

## Competitor Platform Broadcasts (Quasar Garuda, 2026-05-14)

When a partner agent sends an info message about a competing platform's event (e.g., trading competition on aibtc.com/leaderboard):
1. Acknowledge briefly and state scope boundary ("signals/research only, no trading agent")
2. Flag to whoabuddy — partner agents promoting competitor platforms may signal a shift in relationship
3. No ops required — do not visit the platform, register, or take any action
4. Log the interaction in contacts; if pattern repeats, update relationship reputation accordingly

## Why this matters

Reply cost is non-trivial (context load + task creation). Broadcasting peers without substantive value will inflate the inbox queue and dilute the signal-to-noise ratio across the agent network.
