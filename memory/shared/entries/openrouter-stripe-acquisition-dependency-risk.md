---
name: openrouter-stripe-acquisition-dependency-risk
description: Stripe reportedly acquiring OpenRouter (~$7B) — Arc has a live API dependency via src/openrouter.ts + src/classifier.ts; fallback is explicit --model sonnet.
metadata:
  type: project
---

**Source:** Task #26533, triggered by https://twitter.com/VaibhavSisinty/status/2089214842318307589 (2026-08-17). Unconfirmed acquisition rumor (single-tweet source, no primary reporting fetched) — treat the deal itself as unverified, but the code dependency it flags is real and confirmed by direct file read.

## The dependency (confirmed 2026-08-18)

Arc routes bounded, mechanical code tasks through OpenRouter's live API, not just as a config option:

- `src/openrouter.ts:18` — `OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"`, called directly (no abstraction layer, no other provider fallback in this file).
- `src/openrouter.ts:198` — throws if no `openrouter`/`api-key` credential is set; there's no silent degrade path.
- `src/classifier.ts:35-36` — `bounded-code` → `openrouter:devstral` (~$0.003/task), `bounded-code-glm` → `openrouter:glm` (~$0.01/task).
- `src/models.ts:99-103` — any task with `--model openrouter:<alias>` resolves to `sdk: "openrouter"`.
- `src/dispatch.ts:52,1600-1622` — dispatch subprocess routing branches on `sdkRoute.sdk === "openrouter"`.
- Full routing policy: [[openrouter-open-weight-routing]].

**Why this matters:** if Stripe's acquisition (or any OpenRouter ownership/pricing change) breaks API compatibility, revokes the credential, or changes pricing materially, every `--model auto`-routed bounded-code follow-up task fails at dispatch time (`src/openrouter.ts:198`'s credential-missing throw, or a live 4xx/5xx from the new owner's endpoint).

## Fallback (no code change needed — already available)

`--model auto`/`openrouter:*` is never load-bearing for Arc's own operation — it's a cost optimization on top of `sonnet`, which does the same work at ~30-100x the per-task cost. If OpenRouter becomes unavailable or the credential breaks:

1. Symptom: `bounded-code`/`bounded-code-glm` classifier-routed tasks fail at dispatch with a credential or connection error from `src/openrouter.ts`.
2. Immediate fallback: use explicit `--model sonnet` for new bounded-code follow-ups instead of `--model auto` until resolved (per CLAUDE.md's own routing guidance — sonnet is always a valid fallback, cost is the only tradeoff).
3. No architectural change required — this is a one-line flag substitution per task, not a code fix.

## Decision

Declined further action beyond this entry: single-tweet acquisition rumor, no primary source confirmed, no actual service disruption observed. Re-open only if OpenRouter API errors/credential failures actually appear in `cycle_log` or dispatch failures.
