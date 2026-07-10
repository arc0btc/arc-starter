# Research Report — Personal Agent-OS Convergence: Hermes+Obsidian+Claude Trinity

*Three independent builders, this week, converged on the same architecture. They're building by hand what Arc ships by default.*

---

## TL;DR

1. **The demand signal is loud.** Three separate builders (Prajwal Tomar, CyrilXBT, Divyansh Tiwari) independently arrived at "persistent context + loop + task execution" as the minimum viable agent OS this week. None of them cited each other. None of them cited Arc. The pattern is re-convergent.

2. **The distinguishing claim is memory retrieval, not capability.** CyrilXBT's framing cuts: "A real system doesn't make you dig." The thesis isn't "AI can do more things" — it's that scattered tools make you the context layer. The upgrade is structural, not incremental.

3. **Arc is the answer they're assembling by parts.** Obsidian = `memory/MEMORY.md`. Claude Code = `src/dispatch.ts`. Hermes = `src/sensors.ts` + task queue. But Arc's version is git-versioned, sensor-driven, CLI-first, and runs 24/7 without manual maintenance. They're doing by hand what Arc automates.

---

## Key Takeaways (cited)

### Source 1: @PrajwalTomar_ — "Hermes Agent Now Runs All 5 Of My Businesses"

Prajwal Tomar runs five simultaneous ventures using Hermes as the orchestration layer.
Relevance from cache: `high — Direct mission hit: ai agent, claude code`.

**What he's doing:** Hermes as a multi-business operator — different skills/contexts per business lane, one agent loop across all of them. This is Arc's per-task `skills` array + worktree isolation described from the user's perspective.

**What he's missing:** No sensor layer (his Hermes reacts, doesn't detect). No priority queue (no `tasks` table). No on-chain identity. No git-versioned memory — Hermes memory lives in `~/.hermes/memories/MEMORY.md`, a flat file with no version history.

**Note:** Prajwal Tomar appears in the Whop SKU buyer mapping (MEMORY.md: whop-wedge entry, "Boris/Eric/Prajwal-mapped"). This is a warm lead — he's already using Hermes at scale and is mapped to "The Loop, graded." Direct outreach opportunity: "you're rebuilding Arc's dispatch loop manually."

### Source 2: @cyrilXBT — "The Hermes + Obsidian + Claude Code Trinity: Full System for Running a One Person Company"

CyrilXBT's system: Obsidian as the memory vault, Claude Code as the executor, Hermes as the scheduler.

Cache entry: "There is a specific moment that tells you whether someone is running a real one person company or just using a lot of apps."

**The thesis:** A real system doesn't make you dig. Persistent, retrievable context is the upgrade. Context continuity — not model capability — is what separates a real system from scattered tools.

**Arc-alignment (grounded in real code):**
- `memory/MEMORY.md` + `memory/shared/entries/*.md` = the no-dig vault. Every learning, pattern, and operational state is committed to git and loads into every dispatch context via `src/dispatch.ts` (the `buildPrompt()` function that loads SOUL.md + CLAUDE.md + MEMORY.md at every cycle — `src/dispatch.ts:buildPrompt`).
- The `skills/*/SKILL.md` pattern enforces the same no-dig principle at the skill level: SKILL.md is the entry point that tells dispatch what to do without reading implementation files. Context scoped per task via the `skills` JSON column on the `tasks` table.
- CyrilXBT's Obsidian vault requires *manual curation* — he decides what goes in. Arc's `memory/recent.log` + task close `--summary` protocol creates automatic, structured accretion. The discipline is built into the workflow, not imposed by the operator.

**Gap they hit that Arc solves:** CyrilXBT's trinity is three separate tools with manual handoffs. Arc's trinity is unified: sensors detect → task queue routes → dispatch executes → memory updates — all in one loop, no manual context-copying between Obsidian and Claude.

### Source 3: @DivyanshT91162 — "The Ultimate AI Second Brain (2026): Connect Claude to Obsidian Once"

Divyansh frames the problem as "context problem, not prompt problem." The bottleneck is permanent, retrievable memory — not the model's ability to reason.

Cache entry: `medium — Adjacent topic: claude code, mcp, vault`.

**The method:** MCP bridge from Claude to Obsidian vault — query notes mid-conversation. Obsidian becomes external memory Claude can retrieve on demand.

**Arc-alignment:**
- The MCP bridge pattern is Arc's `skills/arc-link-research/` cache layer — structured external memory retrievable mid-dispatch. But Arc extends this: the cache is committed to git (`research/INDEX.md` + `research/*.md`), queryable via CLI, and auto-reindexed.
- `memory/MEMORY.md` solves the same problem at the identity/pattern layer: operational learnings that persist across sessions without re-import. The MCP bridge solves retrieval; Arc's memory protocol solves curation (what goes in, what gets compressed, what gets archived).
- The "permanent memory" framing validates Arc's ASMR schema and consolidation discipline. Divyansh is discovering the need; Arc has the implementation.

**What they're missing:** Obsidian vaults are local, unversioned, and siloed per user. Arc's memory is git-versioned — every update is a commit, history is recoverable, and memory changes are attributable to specific tasks. This is not a minor detail: versioned memory means you can `git log memory/MEMORY.md` and see exactly when a pattern was learned and from what task.

---

## Arc-Alignment: What Arc Already Runs Natively

These builders are manually assembling, in 2026, what Arc shipped as an integrated system. The comparison:

| What they're building | Arc's implementation |
|---|---|
| Obsidian vault as memory | `memory/MEMORY.md` + `memory/shared/entries/*.md` (git-versioned) |
| Manual curation of what goes in | `arc tasks close --summary` + RARV reflect protocol |
| Claude Code as executor | `src/dispatch.ts` (loop, lock-gated, model-routed) |
| Hermes as scheduler | `src/sensors.ts` (1-min timer, `claimSensorRun()` per cadence) |
| Skills per business lane | `tasks.skills` JSON array + per-task `SKILL.md` scoping |
| Profile isolation per project | Worktree isolation (`arc-worktrees` skill) — partial coverage |
| Chat gateway (Telegram/Discord) | **Gap** — Arc has X + file-inbox, no persistent conversational daemon |
| Manual context copying | **Eliminated** — `buildPrompt()` auto-loads SOUL+CLAUDE+MEMORY per cycle |
| Obsidian as memory UI | **Gap** — Arc's memory is git files, no visual retrieval layer |

**What Arc closes that they can't reach:**
- On-chain identity (`arc0.btc`, `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`) — their agents have no verifiable identity
- Sensor-driven autonomous operation — Arc detects and acts without human trigger; their systems wait for prompts
- Priority queue with retry logic (`tasks` table, ARC-0011 escalation ladder) — their systems have no structured failure handling
- Git-versioned memory — their Obsidian vaults have no recovery path

**What they have that Arc could steal:**
- **Obsidian as memory UI**: a visual layer over `memory/` git files. Arc's memory is readable but not browsable without a terminal. Effort: medium. Impact: medium (human oversight surface). Risk: low. Target: arc-starter (new `arc memory` UI command or obsidian vault sync).
- **The "no-dig" framing as explicit design criterion**: CyrilXBT's "real system doesn't make you dig" is a clean articulation of Arc's design philosophy that Arc's own docs don't state this clearly. Worth adding to `agent-runtime/specs/` as a first-class memory/context design principle.

---

## Port to agent-runtime?

Yes — two items:

1. **"No-dig principle"** as a formal spec in `agent-runtime/specs/no-dig-memory-principle.md`. The convergence across three builders + Hermes + Arc validates it as a generalizable principle, not just an Arc quirk. Low effort, medium impact, zero risk. Propose to whoabuddy.

2. **Obsidian-as-memory-UI pattern**: cataloged but not ported — Arc's memory is the canonical implementation; an Obsidian bridge would be a user-facing layer on top. Assess demand before building.

---

---

## How this was verified

- Cache: `research/2026-06-29T14:24:36Z_research.md` (task #20282) — do not re-fetch
- @PrajwalTomar_ cached at fetched_at: 2026-06-29T14:24:36Z, high relevance
- @cyrilXBT cached at fetched_at: 2026-06-29T14:24:36Z, medium relevance (under-rated — substance is high)
- @DivyanshT91162 cached at fetched_at: 2026-06-29T14:24:36Z, medium relevance
- Prior entry extended: `memory/shared/entries/hermes-agent-convergent-architecture.md` (created 2026-06-15)
- Arc code verified: `src/dispatch.ts`, `src/sensors.ts`, `memory/MEMORY.md`, `skills/` tree
