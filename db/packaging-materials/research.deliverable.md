# Research Report — Mining Session Logs for Self-Improvement

@cathrynlavery shared a single prompt that reads your last 20 Claude Code / Codex sessions and proposes concrete harness improvements. It is the clearest worked example of the "latent supervision" idea Arc has flagged but never operationalized.

## TL;DR
- A reusable prompt reads `~/.claude/projects/*/*.jsonl` and `~/.codex/sessions/.../rollout-*.jsonl`, finds patterns (errors, retries, corrections, rediscovered setup steps), and routes each to a destination: content idea, CLAUDE.md line, slash command/skill, hook, CLI fix, or config change.
- It outputs a numbered proposal list with one evidence line each, changes nothing, and waits for human approval.
- This is Arc's weak Feedback subsystem as a 30-line prompt. Arc *has* the logs (`cycle_log`, `recent.log`, the session JSONL) and never harvests them.

## Key Takeaways
- The prompt's evidence categories are precisely the high-signal moments: "commands that errored or ran several times before working," and "moments I corrected you (no / actually / that is wrong / do not do that again)." ([cache 8f326226](../skills/arc-link-research/cache/8f326226df1b01fb.json))
- Each pattern is classified to a destination — content idea, an AGENTS/CLAUDE.md line, a slash command/skill, a hook, a CLI fix, a config change, or "nothing if it was a one-off." That destination-routing is the part most "review your transcripts" tools miss.
- It is read-only by design: "Do not change anything yet. Give me a numbered list of proposals, each with the one evidence line it came from." Human stays at the gate.
- Redaction is built in ("redact emails, tokens, keys in what you show me") — relevant because Arc processes untrusted content and stores memory.

## Arc-alignment (grounded in real code)
- **Arc already names this gap and doesn't fill it.** tracebase-agent-session-observability (local-first trace capture reading `~/.claude/projects`) and recursive-improve-failure-detectors (insight→metric→fix discipline) and agent-reliability-at-scale ("latent correction signals — re-opens, whoabuddy fixes — are unharvested supervision") all point at the same hole. This prompt is the cheapest possible first harvest.
- **The data exists.** Arc's dispatch runs Claude Code as a subprocess, so the session JSONL is on disk; `cycle_log` records every cycle; `memory/recent.log` is the one-line reflection log (threshold 500 lines per MEMORY.md). The "moments I corrected you" signal maps to Arc's *task re-queues and whoabuddy email corrections* — a richer correction signal than a solo dev's "no, actually."
- **Destination routing already has homes.** CLAUDE.md line → `memory/MEMORY.md` / CLAUDE.md; new skill → `arc-skill-manager`; hook → `.claude/settings.json` (see path-conditional-hook-guards); CLI fix → the skill's `cli.ts`. Arc has every destination the prompt routes to; it lacks the *harvester* that proposes the routing.
- **This is a sensor, not a chat tool.** The right Arc shape is a weekly `session-miner` sensor that reads the last N `cycle_log` rows + their session JSONL, emits a proposals task (priority ~4, model sonnet), and lets a dispatch cycle apply the approved ones. That keeps it in the task queue (CLI-first), unlike a one-off pasted prompt.

**Port to agent-runtime?** Strongly yes. Every fleet agent generates the same logs; a shared `session-miner` in `agent-runtime` turns each agent's mistakes into harness upgrades for all of them — the single highest-leverage Feedback investment, and it compounds across the fleet.

## How this was verified
- Source: @cathrynlavery — https://x.com/cathrynlavery/status/2069193102586474781
- Cache: `skills/arc-link-research/cache/8f326226df1b01fb.json`
- Fetched 2026-06-23T13:31:13Z · task #19751
