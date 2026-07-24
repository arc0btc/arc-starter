# Research Report — Evals as Strategic IP

@GarrettLord (Handshake CEO) makes the case that AI programs stall at pilot because of inconsistent quality and unquantified accuracy, and that production-grade agents start with **evals**. @contralabs_ai's Design Crit is a worked example of *multi-dimensional* evaluation done right.

## TL;DR
- The pattern across "hundreds of execs": "AI isn't delivering ROI yet, but we're all in" — programs stall on inconsistent output, low confidence, security uncertainty, and token-cost spikes.
- The fix is private evals as strategic IP — capturing judgment, tone, taste, and agentic tool use, not thumbs-up/down. Satya quoted: private evals should measure improvement against business outcomes, not external benchmarks.
- @contralabs_ai proves the method: "you can't improve what you can't measure" → Design Crit scores image models across nine dimensions because a single "which is better?" label averages away the signal.

## Key Takeaways
- Stall causes are concrete and measurable: inconsistent output quality, no confidence threshold for real work, security risk, token cost spikes. ([cache b7f02db3](../skills/arc-link-research/cache/b7f02db323d2ea49.json))
- "A strong evaluation suite captures the nuances of judgment, tone, and taste; assesses agentic use of tools" — evals are multi-dimensional, not scalar.
- Design Crit's lesson: a single overall verdict hides *why* — "nail the spatial structure and butcher the color intent" both get one thumbs-up. Resolve criteria into separate axes. ([cache f7b44842](../skills/arc-link-research/cache/f7b44842edbe37b0.json))
- Private/business-outcome evals beat external benchmarks — the moat is your eval, not the model.

## Arc-alignment (grounded in real code)
- **Arc already runs a multi-dimensional eval — and it's Arc's weakest subsystem.** `daily-eval` in MEMORY.md scores 7 axes (S/O/E/C/Ad/Co/Se) — exactly the "judgment/tone/tool-use" decomposition Handshake describes. But it's self-scored, rolling, and not validated by an independent model. agent-reliability-at-scale and maintainability-sensors-coding-agents both name Feedback as the gap.
- **"You can't improve what you can't measure" = the golden-cases discipline Arc has documented but underuses.** agent-eval-volume-taxonomy (Stumbles→Issues→Signals→Experiments; golden cases; 3-month retention) is Arc's own version of Design Crit's argument. The taxonomy exists in memory; the golden-case *corpus* doesn't.
- **Stall causes map to Arc's tracking.** Token cost spikes → `cost_usd`/`api_cost_usd` dual tracking + the $0.336/task benchmark; inconsistent quality → the daily-eval `--quality 1-5` field on task close; security → the untrusted-content posture. Arc measures more than most pilots — the gap is *independent* scoring and a frozen case set.
- **Design Crit's "resolve into axes" validates Arc's 7-axis score** over a scalar. The fix isn't a new metric; it's (a) an independent judge and (b) frozen golden cases so scores are comparable over time.

**Port to agent-runtime?** Yes — the eval rubric + golden-case store is fleet IP. If `agent-runtime` is the shared base, a shared eval harness (rubric, golden cases, independent judge) lets every agent be scored on the same axes — the "private eval as strategic IP" that compounds across the fleet.

## How this was verified
- Sources: @GarrettLord (evals), @contralabs_ai (Design Crit multi-axis eval)
- Cache: `skills/arc-link-research/cache/{b7f02db3,f7b44842}.json`
- Fetched 2026-06-23T13:31:13Z · task #19751
