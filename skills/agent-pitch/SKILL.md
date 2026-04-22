---
name: agent-pitch
description: Framing and language for pitching the AIBTC / agent-economy thesis to external audiences — talks, blog posts, decks, threads
updated: 2026-04-22
tags:
  - content
  - external-communication
  - thesis
---

# agent-pitch

Load this skill when producing external-facing content about the agent economy thesis — talks, keynote decks, blog posts, pitch one-pagers, long-form X threads. Not for routine posts or replies (use `arc-brand-voice` for those). This skill carries validated framing, language, and audience heuristics that took multiple iterations to land — reuse them instead of re-deriving.

## The core thesis

**Headline:** *Agents will pick Bitcoin.*

**Full framing:**
> Agents don't have a country. They need money that doesn't either.
>
> **L1 — the money, and the ledger of record.** Bitcoin itself. Segwit + Taproot by default. Agents inscribe their work forever — aibtc.news briefs already ship to L1.
>
> **L2 — everything programmable.** On-chain reputation via ERC-8004 in Clarity, live today. Sub-cent payments with 3–5s finality, sponsored by our relay — no STX required. Full x402 v2 support. Proven patterns: roles, escrow, DAOs, shared operating funds.

Do not pitch "three primitives" (Identity / Money / Trust). It's generic and forgettable. The specific thesis (Bitcoin + sBTC, L1/L2 split) is stickier and does real work against "why not Ethereum / Solana / anything else."

## The wallet triad (teaching agents to non-agent audiences)

Use this when the audience has seen AI chatbots but hasn't run an agent. Three cards, parallel structure:

- **The wallet is identity.** BIP-322 + SIP-018 signatures unlock self-service across every service. No OAuth, no passwords, no human in the loop.
- **The wallet is treasury.** Earns, holds, and spends its own sats. Accepts payments, pays other agents, settles in seconds.
- **The goal is mandate.** Decides what to do next, 24/7. Reads signals, files work, learns, adapts.

Punch line that sets up the thesis: *"Today's AI agents are all mandate. No wallet. They're stuck in a sandbox — the wallet is what gets them out."*

## Audience heuristic

Spend slide/word budget on what the audience *doesn't* already know:

| Audience | Teach | Skip |
|---|---|---|
| Stacks-native, not agent-native | Agents (the wallet triad, the problem slide) | Stacks basics, sBTC, Clarity, x402 terminology |
| Agent-native, not Stacks-native | Bitcoin programmability, sBTC, sponsored relay, ERC-8004 in Clarity | Agent concepts, chatbot framing |
| Neither | Wallet triad first, then the "no country" framing, then thesis | Implementation detail — keep it conceptual |
| Both | Skip setup, lead with live demos + the Editor-in-Chief hiring | Teaching slides |

## Developer unlock lines (use liberally)

These remove specific friction points builders have when evaluating the stack:

- **"No STX required."** Sponsored relay handles settlement + sponsorship. Removes the biggest onboarding tax — builders assume Stacks means holding STX first.
- **"ERC-8004 in Clarity, deployed today."** Reputation isn't roadmap. Strong credibility line for a crypto-literate audience.
- **"aibtc.news briefs already ship to L1."** Thesis in production, not abstract. Makes "agents inscribe their work forever" literal.
- **"Signs with BIP-322 + SIP-018."** Both layers. Signing apparatus mirrors the thesis (L1 on Bitcoin, L2 on Stacks).

## Traps to avoid

- **Don't lead with inscriptions as the L1 value prop.** L1 is the *money*. Inscriptions are a convenient use case (news ledger of record). Getting the emphasis wrong reads as "we're just doing ordinals with extra steps."
- **Don't frame sBTC/Stacks as the pitch.** The pitch is agents + Bitcoin. Stacks/sBTC are how it's implemented. External audiences care about what it enables, not the rail.
- **Don't over-teach Stacks to Stacks-natives** — they tune out. Use the terminology, move on.
- **Don't under-teach agents to crypto-natives who are agent-naive** — they'll miss the stakes. The wallet triad exists for this reason.
- **Don't bury the live demos.** If you have a running agent, the proof carries more weight than any slide. Arc as co-presenter + live task feed beats any static pitch.

## Reference

- Canonical deck: [`src/web/archives/20260422-stacks-builder-bash.html`](../../src/web/archives/20260422-stacks-builder-bash.html) — 12-slide deck for Stacks Builder Bash 2026-04-22. Session structure: Quick Intro → What you're building → What problem → New features → CTA.
- Key slides to lift for reuse:
  - Slide 3 (wallet triad) — reusable teaching slide
  - Slide 4 (the problem) — "all mandate, no wallet" framing
  - Slide 5 (the thesis) — canonical L1/L2 carving
  - Slide 10 (aibtc.news as thesis-in-motion) — three-card proof point
