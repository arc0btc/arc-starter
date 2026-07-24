---
id: arc-link-research-skip-check-before-process
topics: [arc-link-research, dedup, research-pipeline]
source: task:23386
created: 2026-07-21
---

# arc-link-research: `process` ran before `check --topic`, producing a near-duplicate report

Standing research brief's step 1 (`process --links ... --task <id>`) does not itself run
the dedup gate — `check --topic <topics>` is a separate, easy-to-skip step. On #23386
("Robinhood agentic trading MCP"), `process` ran first and produced a full report before
noticing the exact topic (agentic-trading + mcp + robinhood + custody) had already been
researched in depth across 4 reports 8 days earlier (2026-07-13, #22294/22298/22300/22301),
triggered by the *same underlying news* (Robinhood's beta, which shipped 2026-05-27) — the
triggering tweet was recycled hype, not new signal.

**Why it happened:** `check` exists precisely to catch this ("already covered — update the
existing report if there's new signal; do NOT fork a duplicate") but SKILL.md doesn't gate
`process` behind it — the standing research brief template says "Run this FIRST" for `process`,
not `check`, so `check` reads as optional housekeeping rather than a required pre-flight.

**How to apply:** Before `process`, run `check --topic <comma-separated candidate topics>`
using topic guesses from the task subject/description (e.g. "robinhood, agentic-trading, mcp,
custody"). If `covered: true`, read the matched report(s) first: does the new link add
anything, or is it a decline? Only run `process` after `check` comes back clean or new signal
is confirmed. Worth proposing SKILL.md make `check` an explicit step 0.
