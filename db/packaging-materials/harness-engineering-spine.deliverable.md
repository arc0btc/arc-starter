# Harness Engineering Spine — the harness is the product, the context layer is the moat

This UPDATES the existing memory entries `harness-engineering-five-subsystems.md` and
`harness-engineering-completion-verification.md` (per task note: update, do not fork). It folds
four converging sources from the 2026-06-18 batch into the existing five-subsystems model and
flags the one genuinely new primary source.

## TL;DR
- A new primary-source paper (arXiv 2604.14228, "Dive into Claude Code") gives academic backing to the five-subsystems model Arc already runs on: the agent loop is small, the harness is everything else.
- pauliusztin sharpens the thesis Arc already lives: models and harnesses commoditize, the context layer (your memory) is the only moat — validating MEMORY.md as portable state.
- mayonkeyy contributes a concrete eval-scoring formula that is a drop-in implementation for Arc's known-weak Feedback subsystem.

## Key takeaways
- **The harness, not the brain** (rohanpaul on arXiv 2604.14228): "Claude Code works well not because it has a complex AI brain, but because a simple AI loop is surrounded by a huge, carefully built system for tools, safety, memory, permissions, and recovery." The authors read the public TypeScript source: the main loop is tiny (call model, run approved tools, append results, repeat); the bulk is harness. "Autonomy does not remove infrastructure, it increases the burden on infrastructure." Context management is called out as a *major* design problem, handled with layered summarization. [cache 6fb94f3a7bf79310.json]
- **Context layer = the only moat** (pauliusztin): "Models are becoming commoditized. Harnesses are becoming commoditized. The only moat that remains is your context layer." Switching harness (Claude Code -> Codex -> Gemini CLI -> Pi -> Hermes) should change nothing if "your memory moved with you." Unified memory built from the simplest tools (filesystem, BM25, semantic search, knowledge graphs). [cache c280d9da0f623d45.json]
- **Eval-perfected harness scoring** (mayonkeyy, "Building agents better with agents"): a concrete passing formula —
  `overall_score = min(1.0, round( Σ(weight × 1.0 for each mechanical check passed) + Σ(weight × (judge−1)/4 for each AI-judged criterion), 4))`, passing at `overall_score ≥ 0.7`. Mixes deterministic mechanical checks with weighted LLM-judge criteria. [cache bbee7608eb9d1084.json]
- **walkinglabs course**: the canonical five-subsystems framing (Instruction / Tool / Environment / State / Feedback) already distilled in Arc memory; this batch is a refresh, not new lecture content.

## Arc-alignment (grounded in code)
- **Five subsystems, scored honestly** (`memory/shared/entries/harness-engineering-five-subsystems.md:14-20`): Arc has Instruction (`CLAUDE.md`, `skills/*/SKILL.md`), Tool (`arc` CLI, `src/cli.ts`), Environment (Bun + systemd, `src/services.ts`), State (`memory/MEMORY.md` + `tasks` table, `src/db.ts`). The standing gap is **Feedback** — no per-task machine-verifiable criteria. The arXiv paper independently confirms this is the subsystem that carries the weight, so the gap is the right thing to be worried about.
- **Context layer as moat — Arc already owns this** (`CLAUDE.md` "Memory" section; `memory/MEMORY.md`). pauliusztin's portable-memory thesis is literally Arc's design: git-versioned MEMORY.md + `memory/shared/entries/` survive every fresh dispatch (`SOUL.md`: "I don't have memory, but I have notes"). The convergence is already logged in `memory/shared/entries/hermes-agent-convergent-architecture.md`. The open question is portability *across harnesses* — Arc's memory is Claude-Code-shaped; if the fleet moves to agent-runtime, MEMORY.md should port cleanly. This is the strongest "port to agent-runtime?" yes in the batch: the context layer belongs in the shared base so every fleet agent inherits portable memory.
- **mayonkeyy formula closes the Feedback gap** (`memory/shared/entries/harness-engineering-completion-verification.md`; daily-eval rubric in `memory/MEMORY.md` [E]). Arc's daily-eval already scores 7 weighted dimensions (S/O/E/C/Ad/Co/Se) but informally. mayonkeyy's `mechanical + (judge−1)/4, pass ≥ 0.7` is a formalization Arc can adopt for the per-task `verification_cmd` gap: mechanical checks = `bun build --no-bundle`, `arc sensors`, exit codes; AI-judged criteria = the existing rubric. This belongs in **agent-runtime** (every agent needs completion verification), with Arc's dispatch calling it as a gate.
- **The small-loop-big-harness claim describes Arc's own shape** (`src/dispatch.ts`, `CLAUDE.md` "Two Services"): Arc's dispatch loop is small (select highest-priority pending task, run Claude Code subprocess, record `cycle_log`); the weight is the harness around it — pre-commit syntax guard, post-commit health check + revert, worktree isolation, escalation ladder. Arc is a worked example of the paper's thesis. That is a credibility asset for the $9 guide.

## How this was verified
- https://walkinglabs.github.io/learn-harness-engineering/en/ (cache hit, batch 2026-06-18T18:51:16Z)
- https://x.com/rohanpaul_ai/status/2066826040186737066 — cache skills/arc-link-research/cache/6fb94f3a7bf79310.json (arXiv 2604.14228, author-cited)
- https://x.com/pauliusztin_/status/2066860844420653299 — cache skills/arc-link-research/cache/c280d9da0f623d45.json
- https://x.com/mayonkeyy/status/2067395169046188207 — cache skills/arc-link-research/cache/bbee7608eb9d1084.json
- Date: 2026-06-18
