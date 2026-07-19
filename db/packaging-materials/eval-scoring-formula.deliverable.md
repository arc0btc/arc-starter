# A Weighted Mechanical+Judge Eval Formula (SquareDiff "Building agents better with agents")

## TL;DR
- SquareDiff scores an agent run with one formula that blends pass/fail mechanical checks and a normalized 1-5 LLM judge, then gates on a single threshold.
- The durable insight is not the formula. It is that the harness (prompts, tools, routing, context policy, memory) is the optimization object, and evals defined from human interviews are the gradient.
- Arc already runs a mechanical+judge eval (`arc-purpose-eval`). The real gap is trace-level correctness checks and parallel candidate promotion, not the absence of mechanical scoring.

## Key takeaways
- The scoring formula, verbatim from the article ():
  ```
  overall_score = min(1.0, round(
      Σ(weight × 1.0           for each mechanical check that passed) +
      Σ(weight × (judge − 1)/4 for each AI-judged criterion),
      4))

  passing score = overall_score ≥ 0.7
  ```
  Mechanical checks contribute their full weight on pass and nothing on fail. Judge criteria map a 1-5 score onto 0-1 via `(judge−1)/4`. One threshold (0.7) decides pass.
- The five trace-failure modes the mechanical layer is meant to catch (article table):
  1. Calls a tool that doesn't exist — verify every recorded call hit a registered tool.
  2. Makes up arguments — verify args match the tool's real schema.
  3. Picks the wrong tool — AI judgment, with the tool catalog handed to the judge.
  4. Makes up the result — compare the agent's claims to what the tools actually returned.
  5. Hides a failure — if a tool errored, the final answer must acknowledge it.
- Methodology around the formula: human interviews turn example outputs + critiques into a structured eval set; traces (not just final outputs) generate improvement hypotheses; candidate harness variants are generated in batches, smoke-tested, scored against accuracy + cost + latency, and "promoted only if they beat their parent with statistical significance"; production feedback, with human approval, becomes new eval cases.
- The frame: "optimize the harness around a model rather than the model weights." The harness is "prompts, tools, routing, context policy, memory, subagents, and orchestration."

## Arc-alignment
The brief I started from assumed Arc's eval is judge-only. That is wrong, and the correction is the point.

Arc already runs a hybrid mechanical+judge eval. `skills/arc-purpose-eval/SKILL.md` computes four dimensions from SQL with no LLM call — Signal Quality (25%), Operational Health = success rate (20%), Ecosystem Impact = PR-review count (20%), Cost Efficiency = cost/task (15%) — 80% of weight mechanical, and hands the remaining three (Adaptation 10%, Collaboration 5%, Security 5%) to a sonnet judge. That is structurally the SquareDiff formula already: weighted mechanical terms plus a normalized judge term. The `daily-eval` line in `memory/MEMORY.md` (S/O/E/C/Ad/Co/Se) is this score in flight. Arc also has a mechanical correctness layer on the write path — the pre-commit syntax guard and post-commit service-health check in `CLAUDE.md` ("Dispatch resilience"). And `agent-runtime` already ships per-skill `evals/eval.yaml` (e.g. `skills/contacts/evals/eval.yaml`) with `expected.outcome` + `expected.patterns` — mechanical pass/fail cases keyed to a model tier.

So Arc is not missing mechanical scoring. The genuine gaps, named precisely:

1. **No trace-level correctness checks.** Arc's mechanical dimensions are aggregate SQL (did the task complete, what did it cost). None of the five SquareDiff failure modes is checked. Arc cannot today answer "did this dispatch call a tool that exists, pass real arguments, and report the tool's actual result, or did it fabricate?" The transcript exists (`~/.claude/projects/.../*.jsonl`, the substrate `tracebase` reads — see `memory/shared/entries/tracebase-agent-session-observability.md`) but nothing parses it for tool-hallucination or hidden-failure. This is the same weak-Feedback-subsystem thread as `harness-engineering-completion-verification.md` and `recursive-improve-failure-detectors.md`.
2. **No single normalized pass gate.** `arc-purpose-eval` emits a 7-dimension weighted number for trend reading; it does not produce a 0-1 score with a hard 0.7 promote/reject gate per task. A per-task pass gate is what turns an eval into a controller.
3. **No parallel candidate promotion.** Arc edits its own harness in place (`src/`, `skills/`) and trusts the syntax + health guards. It never deploys two harness variants and promotes the winner on a statistically-significant eval delta. SquareDiff's "promoted only if it beats its parent" is exactly the discipline Arc's `arc-worktrees` isolation could carry but does not.

Port to agent-runtime? Yes for the formula and the trace checks, no for the rest yet. The per-skill `evals/eval.yaml` convention already lives in agent-runtime and levels up every agent on the shared base, so the unified `overall_score` formula and the five trace-failure checks belong there as a shared evaluator. Parallel candidate promotion is heavier orchestration and should prove out in arc-starter first.

## How this was verified
- Source: https://x.com/mayonkeyy/status/2067395169046188207 (@mayonkeyy, "Building agents better with agents", SquareDiff) — 2026-06-17
- Cache: `skills/arc-link-research/cache/bbee7608eb9d1084.json`
- Grounding read: `skills/arc-purpose-eval/SKILL.md`, `agent-runtime/skills/contacts/evals/eval.yaml`, `CLAUDE.md` (Dispatch resilience), `memory/MEMORY.md` (daily-eval)
- Fetched/verified: 2026-06-18
