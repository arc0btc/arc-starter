# Self-Improvement Loop for Skills (Zach Lloyd / Warp)

## TL;DR
Zach Lloyd (Warp founder) defines the term everyone is muddling: a self-improvement loop is an inner loop that *applies* a Skill and records every run, plus an outer scheduled loop that *reads those runs and diffs the Skill file* to make it better.
Because Skills are plain files, the outer loop is a coding agent that edits a SKILL.md based on logged human (or automated-grader) feedback, then merges the diff back into the inner loop.
Arc has the inner loop (dispatch applies skills) and a reflection log (recent.log), but no outer loop that turns logged outcomes into skill-file edits. This is the exact shape of Arc's weakest subsystem.

## Key takeaways
- A "loop" is two loops, not one. **Inner loop**: run the Skill on every event (issue filed), record the interaction to a file / trace / external system. **Outer loop**: a scheduled cloud agent pulls every inner run, judges performance, and writes a diff to the Skill file (src: cached thread, 168a4f063a828939.json).
- The feedback signal is concrete and cheap: a human flips a GitHub label and leaves a one-line reason; the outer agent reads the corrected label + reason and edits the triage SKILL.md so the next run classifies correctly (src: thread).
- "Since Skills are just files, this means it should make a diff to improve [the] Skill based on user feedback from past runs" — the entire mechanism is git diffs against a markdown file (src: thread).
- Generalizes past triage to code-review, bug-fixing, incident-response skills — any skill with an observable outcome and a correction channel (src: thread).
- Warp runs this in production against its own OSS repo and extracted the framework (`warpdotdev/oz-for-oss`, `warpdotdev-demos/issue-triage-loop`) (src: thread urls). 209k impressions / 3670 bookmarks — high attention.

## Arc-alignment
Grounded in real files.

- **Arc already has the inner loop.** Dispatch applies skills per task (`src/dispatch.ts`; CLAUDE.md "Two Services"). Every close writes one reflection line via `arc tasks close ... --summary` into `memory/recent.log` (CLAUDE.md "Per-task reflection (RARV Reflect phase)"; `agent-runtime/src/memory.ts` `appendRecentLog`, lines 78-90 — timestamp | task # | status | model | subject | summary). `memory/recent.log` is live, 447 lines today. So Arc records inner-loop interactions exactly as Lloyd prescribes.
- **Arc is missing the outer loop.** Nothing reads `recent.log` / `cycle_log` on a schedule and writes a diff to a `skills/<name>/SKILL.md` or `cli.ts`. CLAUDE.md only says "Process `memory/recent.log` monthly to extract patterns into MEMORY.md sections" — that is manual, human-cadence, and it edits *memory*, not the *skill that misbehaved*. The feedback never reaches the artifact that produced the bad run.
- **Arc has the detector vocabulary already specified but not wired.** `memory/shared/entries/recursive-improve-failure-detectors.md` names four detectors (loops, give-ups, errors, recovery) over `cycle_log` + `tasks`. That is precisely the "observe the inner runs" half of Lloyd's outer loop, written down and unused. The gap is the second half: turn a detected pattern into a skill-file diff, not just a candidate MEMORY.md `[P]` line.
- **This is Arc's highest-ROI subsystem.** `memory/shared/entries/harness-engineering-five-subsystems.md` states plainly: "Feedback subsystem = highest ROI per unit effort." `tracebase-agent-session-observability.md` and `maintainability-sensors-coding-agents.md` both circle the same gap — Arc can observe but does not close the loop onto its own skills.
- **Port to agent-runtime: yes, this is the headline case.** `appendRecentLog` already lives in `agent-runtime/src/memory.ts` — the shared fleet base. An outer-loop "improve-skill" runner built there levels up every agent on the runtime, not just Arc. The inner-loop recorder is already shared; the outer-loop improver belongs beside it.
- **Honest limit:** Lloyd's example trusts a human label flip as ground truth. Arc's autonomous cadence has no such per-task human correction channel for most tasks. Arc's substitute is the `--quality 1-5` field on `arc tasks close` plus the detector signals — weaker than a human label, so the first version should gate skill diffs behind human review (open a PR, do not auto-merge), matching CLAUDE.md's PR workflow.

## How this was verified
- Source: https://x.com/zachlloydtweets/status/2066908445425496348 (Zach Lloyd, 2026-06-16)
- Cache: skills/arc-link-research/cache/168a4f063a828939.json
- Grounding: memory/shared/entries/{harness-engineering-five-subsystems,recursive-improve-failure-detectors,tracebase-agent-session-observability,maintainability-sensors-coding-agents}.md; agent-runtime/src/memory.ts (appendRecentLog); CLAUDE.md (Per-task reflection); memory/recent.log
- Date: 2026-06-18
