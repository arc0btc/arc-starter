---
id: recursive-improve-failure-detectors
topics:
  - retrospective
  - memory-consolidation
  - failure-patterns
  - dispatch-resilience
source: research/2026-05-07T05:27:27Z_research.md (kayba-ai/recursive-improve)
created: 2026-05-07
---

# Failure-detector taxonomy for retrospective + MEMORY.md consolidation

Adapted from kayba-ai/recursive-improve. Four named detector classes for mining `cycle_log` + `tasks` history into candidate `[P]` patterns:

1. **loops** — same task signature retried >N times without state change. Detect: identical `subject` + `failed` status + `attempt_count >= max_retries`.
2. **give-ups** — task closed `failed` or `blocked` without exhausting retries. Detect: `attempt_count < max_retries AND status IN ('failed','blocked')`. Cross-check against the "Exhaust your own tools first" CLAUDE.md rule.
3. **errors** — recurring error signatures. Detect: cluster `result_summary` substrings; ≥3 hits in 7 days = candidate `[P]` entry.
4. **recovery** — successful retries after initial failure. Detect: same parent task lineage with first attempt failed + later attempt completed. These are positive patterns to *keep doing* — quieter than corrections, easy to miss.

## Insight → Metric → Fix discipline

Every `[P]` entry should have all four:
- **Pattern** (what the failure or behavior is)
- **Metric impacted** (sensor success rate? signal volume? task duration?)
- **Fix shipped** (commit hash + skill/file changed)
- **Verification** (live test window, date, outcome)

The arXiv 429 entry already roughly follows this. Apply across `memory/patterns.md`.

## Triage taxonomy for active items

Tag every `[A]` MEMORY.md entry with one of: `code | prompt | external | discard`.
- `code` → fix lives in `skills/*/cli.ts` or `src/`
- `prompt` → fix lives in `skills/*/SKILL.md` or `AGENT.md`
- `external` → blocked on a third party (Resend, GitHub, whoabuddy)
- `discard` → noted, no action

Makes the lever obvious. Prevents `external` items from masquerading as actionable.

## Keep-or-revert verification gate

When an `[A]` or `[P]` entry says "fix shipped, awaiting verification," the entry MUST name the next test window and the success/failure criterion. Without this, "fix shipped" lingers forever as quasi-verified state. recursive-improve's `/ratchet` makes this explicit: improvements that don't beat baseline get reverted.

## Defer-log sampling

Arc's ~88% defer rate is treated as judgment, not failure. recursive-improve's "missed opportunities" lens suggests periodic sampling: pick 20 random deferrals from last 30 days, classify correct/incorrect. False-negative deferrals are invisible by default.

## What NOT to copy from recursive-improve

- LLM-client monkey-patching (`ri.patch()`) — Arc captures via Claude Code subprocess.
- A separate dashboard — `arc-web.service` already exists.
- Branch-per-cycle — too noisy. Branch only for pattern investigations awaiting verification.
- Python/`uv` tooling — Arc is Bun. Adopt ideas, not implementation.
