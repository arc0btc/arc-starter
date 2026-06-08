---
id: multi-repo-research-decomposition
topics: [research, orchestration, task-decomposition, workflow-harness]
source: task:18441 (OpenRouter tech-stack deep research kickoff, 2026-06-08)
created: 2026-06-08
---

# Multi-repo deep-research decomposition pattern

Reusable shape for "deep-research an org / multi-repo codebase" projects (e.g. OpenRouter tech-stack).

**Decompose by REPO, not by dimension.** One Phase-1 task per first-party repo → structured per-repo
report. Dimension-first re-reads every repo per dimension = the awesome-list cost trap. Phase 2 =
org-level cross-cutting tasks that read Phase-1 OUTPUTS (not raw repos). Phase 3 = opus synthesis + email.

**Clone to disk, reusable, NOT committed.** Clone first-party repos once to
`/home/dev/research-clones/<project>/` and work from local trees; use `gh` API only for PR/contributor
signal. Avoids re-fetching every cycle. (Managed repos live in `/home/dev/`; research clones get their
own dir, kept out of arc-starter git.)

**Working/context file.** Keep `research/<project>/<ISO-date>/_WORKING.md` (note: `research/` is
gitignored — persists on disk across cycles, not versioned). Holds plan, decisions, repo inventory,
per-repo brief, phase definitions, and a status tracker each task appends to. "If we don't write it
down it doesn't exist." One `.md` per repo + `_x-*.md` cross-cutting + `_synthesis.md`.

**Workflow-harness decision (important):** for repo fan-out, use the **plain arc task-queue** (one task
per repo) — NOT the Workflow tool / `CLAUDE_CODE_WORKFLOWS`, and NOT the arc-workflows state machine.
Each arc task = its own dispatch cycle with a fresh 40–50k context budget; serial lock-gating IS the
gate. The Workflow tool collapses all fan-out into ONE session = the context/token blowup the
decomposition exists to avoid (cf. loom-spiral dead-end). arc-workflows state machine is ceremony a
linear N-phase DAG doesn't need — `parent_id` + working file give traceability.

**Gating Phase 2/3:** queue Phase-1 at P5; queue one Phase-2/3 "orchestration gate" task at P6 so it
only dispatches after Phase-1 drains. The gate self-verifies all Phase-1 outputs exist before fanning
out; if incomplete, it reschedules itself ~2h out instead of fanning out early.

**Source-dedup gotcha:** `arc tasks add` skips a second pending task with the same `--source`. For a
batch, give each task a unique source (e.g. `task:<id>-<repo>`), or only the first is created.

**Confidence labels:** require every report to mark `[SOURCE]` (code/git/CI/npm/gh/docs, cited) vs
`[INFERRED]` (reasoning), kept visually separate. Whoabuddy asked for this explicitly.
