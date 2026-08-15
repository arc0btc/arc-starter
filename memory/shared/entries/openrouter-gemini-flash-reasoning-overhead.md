---
id: openrouter-gemini-flash-reasoning-overhead
topics: [openrouter, model-routing, cost-benchmark]
source: task:26213
created: 2026-08-15
---

`google/gemini-3.7-flash` added to `src/models.ts` OPENROUTER_ALIASES (`gemini-flash`) +
OPENROUTER_PRICING ($0.375/$1.875 per M — ~5.3x cheaper than sonnet's $2/$10 vendor-listed,
~$3/$15 Arc's own MODEL_PRICING). NOT wired into `src/classifier.ts`'s bounded-code lanes.

**Benchmark (one trivial function-writing task, direct OpenRouter API call vs. sonnet doing
the same task inline):** both produced correct, convention-compliant TypeScript. Gemini
Flash's raw completion used 984 tokens for a 4-line function — 868 of those (88%) were
reasoning tokens, not output. Actual cost for the trivial task was $0.0019, which is in the
same order of magnitude as what a sonnet call for equivalent trivial work would cost despite
the ~5x lower listed per-token price, because the reasoning overhead inflates effective token
count. Cognition's FrontierCode 1.1 claim (Sonnet-5-level coding) is vendor-marketed and
unaudited — this single trivial-task test neither confirms nor refutes it for real bounded
code-change work (multi-file awareness, test execution, larger diffs).

**Conclusion:** did not add a classifier routing rule. The price advantage may still hold for
larger/longer tasks where reasoning-token overhead amortizes better, but that needs a
real bounded dispatch task (not a single isolated function) to test — not done here due to
scope/budget of the follow-up task. If gemini-flash routing is revisited, test with an actual
multi-step bounded dispatch task (e.g. a real single-file fix from the queue) run through
`--model openrouter:gemini-flash` vs `--model sonnet`, comparing full dispatch cost_usd/
api_cost_usd and diff quality, not a synthetic prompt.
