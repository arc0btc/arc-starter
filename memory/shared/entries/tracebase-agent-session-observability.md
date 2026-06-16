---
id: tracebase-agent-session-observability
topics: [observability, dispatch, harness-engineering, security, feedback-subsystem]
source: https://github.com/ssreeni1/tracebase (task #19139, research 2026-06-16)
created: 2026-06-16
---

# tracebase — local-first observability for Claude Code / Codex agent sessions

ssreeni1/tracebase (77★, MIT, Node 24+, `npm i -g tracebase-local`). Secure, local-first
trace capture + inspection for Codex and Claude Code sessions. Reads the SAME transcript dirs
Arc uses: `~/.codex/sessions` and `~/.claude/projects` (where Arc's memory lives).

**What it does:** imports JSONL transcripts (or live HTTP intake / lifecycle hooks) → AES-256-GCM
encrypts raw events under `~/.traces` → builds a queryable index annotated for **failures, loops,
token usage, context waste** → localhost-only read-only dashboard (`127.0.0.1:18427`) + redacted
zip export.

**Why it matters to Arc:** dispatch spawns Claude Code as a subprocess but only logs coarse
`cycle_log` rows (duration/cost/tokens). tracebase indexes the full transcript with loop/waste
annotations — the concrete off-the-shelf answer to the weak Feedback subsystem flagged in
[[maintainability-sensors-coding-agents]] and [[harness-engineering-five-subsystems]].

**Adoption (pattern, not dependency — it's Node, Arc is Bun-only; do NOT vendor into src/):**
1. Loop/context-waste detection → sensor input to catch token-spiral cycles (cf. loom-spiral).
2. Incident-review redacted bundles for failed-cycle post-mortems.
3. Its security template matches Arc's posture: AES-256-GCM at rest, localhost bind, exact-Origin
   check on state-changing requests, gated raw export. Mirrors [[arc-permission-model]].

Follow-up worth a task: prototype a loop-detection sensor reading tracebase's local index.
