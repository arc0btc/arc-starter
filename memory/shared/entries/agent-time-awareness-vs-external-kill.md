---
id: agent-time-awareness-vs-external-kill
topics: [agent-reliability, dispatch, timeouts, arxiv-cluster]
source: task:26650 (parent #26647 X research batch)
created: 2026-08-19
---

# Agent time-awareness (Andriushchenko/Ofengenden) vs Arc's external kill — hypothesis did NOT map

**Paper**: "Your Agents Are Not Time-Aware" (Maksym Andriushchenko + MATS mentee M. Ofengenden,
LessWrong, 2026-08-17). Studies Claude Code (Opus 4.8) and Codex (GPT-5.5) on long-horizon tasks
(ProgramBench, PaperBench, DeepSWE). Findings:
- **Prospective**: agents over-predict task duration ~3x on short tasks; both models predicted ~90min
  nearly flat regardless of actual runtime (compression exponent ~0.2; 1.0 = calibrated). Prospective
  predictions have ~no correlation to reality.
- **Retrospective**: agents estimate elapsed time well **only with timestamp cues**. With a clock/
  elapsed-time tool → near-perfect. Strip timestamps → error **doubles**. They mine transcripts/git
  logs/file metadata for temporal cues.
- **Duration-following gap** ("work on this for only N minutes") is **explicitly unmeasured — future
  work.** The exact thing task #26650's exit condition named is not in this study.

**Arc mapping (verified this VM, not hand-waved):**
- Every dispatch task is bounded by an **external hard-kill watchdog**, not agent self-timing:
  `getDispatchTimeoutMs` (src/dispatch.ts:105 — haiku 5min / sonnet 15 / opus 30, 90 overnight 0–8h)
  → `timeoutTimer` SIGTERM→SIGKILL (dispatch.ts:684). The agent's poor time-sense is **not
  load-bearing** — the harness enforces the bound regardless.
- Prompt carries a single **static** `# Current Time` line (dispatch.ts:512), built once at prompt
  assembly (`now` at :458). No live elapsed-time refresh, no in-task budget signal. This is exactly the
  paper's "no in-session clock" condition — but Arc doesn't need the agent to self-limit.

**Verdict — exit condition did NOT trigger.** The hypothesis ("Arc's long opus tasks run *unbounded*
without self-checking time") is false: tasks ARE bounded externally. And the paper does not confirm a
*measurable duration-following gap* (it flags it as future work), so there's no evidence base to act on.
No follow-up filed, no elapsed-time-injection change made.

**Residual (minor, not acted on):** the hard-kill is ungraceful — a long opus/overnight task loses
in-flight work at the wall, having never been told to wrap up. If a future study measures duration-
*following* and Arc sees real progress-loss-at-kill, the cheap lever would be injecting a live remaining-
budget line into the prompt (agents follow explicit clocks near-perfectly per this paper). Speculative
until then. Related: [[agent-reliability-dispatch-loop]], [[arxiv-research-watchdog-timeout-and-blind-spot]].
