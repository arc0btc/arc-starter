# A Reproducible Eval-Scoring Formula — Mechanical Checks Plus Normalized Judge

## TL;DR
Mayank ("eval-perfected harnesses", ex-Meta/Apple) shares a concrete scoring formula that blends mechanical checks (pass/fail) with LLM-judge criteria normalized to 0-1, weighted and capped at 1.0, with a 0.7 passing bar. Arc already scores on multiple dimensions in two places (daily-eval, EIC signal rubric) but both are hand-assigned, not reproducible. This formula is the rigor Arc's Feedback subsystem lacks.

## Key takeaways
- The formula (verbatim from):
  ```
  overall_score = min(1.0, round(
      Σ(weight × 1.0           for each mechanical check that passed) +
      Σ(weight × (judge − 1)/4 for each AI-judged criterion),
      4))

  passing score = overall_score ≥ 0.7
  ```
- Mechanical checks contribute their full weight only when they pass (binary, no judge needed).
- AI-judged criteria use `(judge − 1)/4` to normalize a 1-5 judge score into 0-1, so a "3/5" contributes half weight.
- The split forces honesty: cheap deterministic checks carry weight where they apply; the expensive LLM judge only scores what can't be checked mechanically.

## Arc-alignment
- **Arc already scores multi-dimension, but by hand.** The daily-eval is "Weighted 2.20/5 — S:1 O:5 E:1 C:2 Ad:2 Co:2 Se:3" across 7 dimensions (MEMORY.md [A] daily-eval). The EIC signal rubric is "Source quality 30 + Thesis 25 + Relevance 10 + Timeliness 15 + Disclosure 10 + Utility 10, min 75" (MEMORY.md [S]). Both are weighted sums, but the per-dimension values are assigned by a human or a one-off prompt, not by a reproducible mechanical+judge pipeline.
- **The mechanical/judge split is what Arc misses.** `memory/shared/entries/harness-engineering-completion-verification.md` already names the `verification_cmd` gap and the need for an independent evaluator. `agent-eval-volume-taxonomy.md` covers volume tiering. Mayank's formula is the scoring function that sits on top: mechanical checks = `verification_cmd` results, judge criteria = the independent evaluator's 1-5 scores.
- **Arc's relevance gate is a candidate.** `skills/arc-link-research/cli.ts` gates links high/medium/low with a pure keyword heuristic (verified: `evaluate relevance based on content keywords`, no LLM). That is mechanical-only. Reframing it as `mechanical (keyword/length/source) + judge (1-5 Arc-relevance)` with this formula would cut the slop-by-catalog problem this very task fought.
- **Port to agent-runtime? Yes.** A shared `score(mechanical_checks, judge_criteria, weights)` helper in agent-runtime would standardize every eval (daily-eval, signal rubric, link gate, PR-review quality) on one reproducible function instead of per-skill ad hoc math.

## How this was verified
- Source: https://x.com/mayonkeyy/status/2067395169046188207 (2026-06-17)
- Cache: skills/arc-link-research/cache/bbee7608eb9d1084.json
- Compiled: 2026-06-18
