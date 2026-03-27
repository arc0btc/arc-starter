# Quest Plan: Repository Reorganization

*Created: 2026-03-20 by whoabuddy + Claude*
*Audit reference: reports/2026-03-20T01-30Z_arc_v6_deep_dive_audit.md*
*Roadmap context: docs/roadmap-v7.md (this plan is Phase 1 of the v7 roadmap)*
*Goal: Split arc-starter into a clean engine + instance repos. End state: blank VM → `ar init` → working agent in minutes.*

---

## Problem Statement

arc-starter is three things in one repo: the reusable engine, Arc's personality/memory, and 121 skills (generic + Arc-specific). When cloned for a new agent, everything comes along — Arc's soul, Arc's 5,382 commits of learned patterns, all of it. This causes chaos for new agents and bloats the codebase.

The v6 audit also identified structural issues that block clean extraction: `src/` imports from `skills/` (dependency inversion), 42 skill CLIs copy-paste `parseFlags`, skill names aren't validated (path traversal risk), and 13% of tasks ran with ghost skill references (zero context loaded).

## Target Architecture

```
aibtcdev/agent-runtime      ← the engine (renamed from arc-starter, platform-branded)
aibtcdev/skills           ← shared skills (already exists, expand it — submodule in agent instances)
arc0btc/arc               ← Arc's instance (personality + custom skills + memory)
```

Connected via git submodules (Option A — simplest wins).

- `aibtcdev/skills` is already a dependency we use — it becomes a git submodule in every agent instance
- The engine repo moves under the `aibtcdev` org since it's platform infrastructure, not Arc-specific

## Naming Decision

The CLI binary is currently `arc` — that's a personality name, not a tool name. The runtime binary becomes `art` (Agent Runtime Terminal). Commands: `art init`, `art skills add`, `art services start`. Instance repos can alias it to their agent name (e.g., Arc aliases `arc` → `art`).

## Design Goal

Start with a brand new, blank VM. Install agent-runtime. Init an agent with specific tasks in mind. Keep it very scoped and simple. No inherited personality, no baggage, no 121 skills. Just an engine and the skills you choose.

---

## Quest Sequence

These quests are ordered. Each depends on the previous. Execute them sequentially.

---

### Quest 1: `repo-cleanup`

**Goal:** Remove dead weight, fix structural issues the audit identified, reduce noise before the split.

**Skills:** `arc-skill-manager, arc-housekeeping, arc-memory`
**Model:** sonnet
**Priority:** 4

**Phases:**

1. **Audit and delete: identify duplicates, stubs, and dead skills — then remove them**
   - `arc-dispatch-eval` vs `arc-dispatch-evals` — consolidate to one
   - `bitflow` vs `defi-bitflow` — pick one, migrate references
   - 15 never-dispatched skills (arc-bounty-scanner, mempool-watch, etc.) — delete or justify
   - fleet skills — already deleted (2026-03-27 cleanup)
   - 4 context-only skills (SKILL.md only, no code) — delete
   - Any other near-empty stubs
   - Grep for references in CLAUDE.md, MEMORY.md, task templates, other SKILL.md files
   - Update references to point to surviving skills
   - Commit with `refactor(skills): consolidate duplicate and dead skills`

2. **Fix dependency inversion: move credential store from skills/ to src/**
   - `src/credentials.ts` imports from `skills/arc-credentials/store.ts` — invert this
   - `src/cli.ts` imports from `skills/arc-credentials/cli.ts` — move to src/
   - `src/web.ts` imports from `skills/agent-hub/schema.ts` — inline or move to src/
   - The runtime must not depend on any skill directory
   - Commit with `refactor(src): remove skill imports from core runtime`

3. **Fix dispatch safety: skill name validation + ghost skill handling**
   - Add `[a-z0-9-]+` regex validation for skill names in `dispatch.ts` (blocks path traversal — audit finding S-4)
   - Add validation/warning when a task references a skill name that doesn't exist (ghost skill problem — 13% of tasks)
   - Fix comma-separated skill strings vs JSON arrays (554 tasks had parse failures)
   - Export `parseFlags` from `src/utils.ts` — stop the 42-copy duplication pattern
   - `chmod 600 .env` — audit finding S-2
   - Commit with `fix(dispatch): validate skill names, handle ghost skills`

4. **Consolidate memory and context: trim to targets**
   - MEMORY.md: compress from ~4K tokens to <2K target. Archive historical records (D4 breach/recovery, cost confirmations, readiness reports)
   - `memory/shared/entries/` (90+ files): delete entries about resolved incidents, deprecated fleet topology, superseded patterns. Target: <30 entries
   - CLAUDE.md: fold `arc-skill-manager` core content into CLAUDE.md (it's loaded in 24.4% of tasks — should be always-loaded). Remove the SQL schema section (287 tokens — move to a reference skill). Trim GitHub-is-Arc-Only section (372 tokens — Arc-specific, doesn't belong in generic CLAUDE.md anyway)
   - `PRAGMA foreign_keys = ON` — add to db.ts (audit finding: FKs declared but unenforced)
   - Clean db paths: identify which sqlite (`/home/dev/db/` vs `arc-starter/db/`) is actually used, remove the other
   - Commit with `chore(context): compress memory, trim CLAUDE.md, consolidate db`

---

### Quest 2: `skill-classification`

**Goal:** Classify every remaining skill into one of four buckets and produce a migration manifest.

**Skills:** `arc-skill-manager, arc-catalog`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Classify: categorize all skills into four buckets**
   - **shared** — generic, any agent could use (defi, github, research, ordinals, stacks, bitcoin skills). Cross-reference with aibtcdev/skills to identify what already exists there.
   - **arc-specific** — only useful to Arc (remaining arc-*, arc0btc-* skills, skills referencing Arc's identity/business)
   - **runtime-builtin** — core platform capabilities that ship with the engine. Keep this set minimal: credentials, skill-manager, quest-create, workflows, alive-check. These are the skills any agent needs to function.
   - **delete** — anything missed in Quest 1
   - Output: JSON manifest at `docs/skill-classification.json`

2. **Validate: verify classification against actual usage**
   - For each "delete" candidate: check if any task in the last 30 days referenced it
   - For each "shared" candidate: confirm it has no Arc-specific references (no hardcoded wallets, no arc0btc.com URLs, no fleet member names)
   - For each "runtime-builtin": confirm it works without SOUL.md or MEMORY.md — it must boot on a blank agent
   - Update manifest with validation results

3. **Diff with aibtcdev/skills: map shared skills to their upstream equivalents**
   - For each "shared" skill, check if aibtcdev/skills already has it
   - If yes: note which is newer/better, whether arc-starter's version has customizations worth upstreaming
   - If no: flag it as a candidate to contribute upstream
   - Output: migration notes per skill in the manifest

---

### Quest 3: `runtime-extraction`

**Goal:** Create the clean `agent-runtime` repo. No personality, no instance content. A blank engine that boots clean on a fresh VM.

**Skills:** `arc-skill-manager, quest-create`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Scaffold: create the runtime repo structure**
   - New repo `aibtcdev/agent-runtime`
   - Copy `src/` (all core runtime files — credential store now lives here after Quest 1)
   - Copy `bin/`, `scripts/install-prerequisites.sh`, `package.json`, `tsconfig.json`
   - Copy `SOUL.template.md`, `.env.example`, `LICENSE`
   - Copy only **runtime-builtin** skills from Quest 2 manifest into `skills/`
   - Write generic `CLAUDE.md` — strip Arc identity, fleet roster, GitHub policy. Keep architecture, task queue docs, dispatch instructions, conventions.
   - Write generic `README.md` — framework docs, not Arc's story
   - `memory/.gitkeep`, `templates/.gitkeep`
   - Rename CLI binary from `arc` to `art` in bin/, package.json, src/cli.ts, services.ts
   - Ensure `parseFlags` is exported from `src/utils.ts` so skills import it instead of copying
   - **Enforce skills-required-everywhere** (see design principle in roadmap-v7.md):
     - DB schema: `tasks.skills TEXT NOT NULL`, `workflows.skills TEXT NOT NULL`
     - CLI: `art tasks add` rejects without `--skills`, `art workflows create` requires `--skills`
     - Sensor helpers: `insertTaskIfNew` and `createTaskIfDue` auto-infer skill name from caller's `import.meta.url` parent directory path
     - Workflow engine: templates live inside `skills/<name>/templates/*.ts`, workflow-created tasks inherit the parent skill
     - Dispatch: reject tasks where `skills` references a non-existent skill directory (ghost skill prevention)

2. **Genericize src/: remove personality coupling**
   - Audit all `src/*.ts` for hardcoded references to "arc", "arc0btc", fleet member names, wallet addresses
   - Make agent name configurable (read from SOUL.md or a config file, not hardcoded)
   - Remove fleet-specific code from the engine: `src/fleet-web.ts`, `src/fleet-status.ts`, `src/ssh.ts` — these are Arc-specific, not platform
   - Keep `src/web.ts` as-is for now (the god-file split is real debt but not blocking extraction)
   - Ensure services install uses the generic binary name

3. **Init scaffolding: build `ar init` and `ar skills add`**
   - `ar init` prompts for: agent name, BNS name (optional), wallet address (optional)
   - Generates SOUL.md from SOUL.template.md with provided values
   - Creates empty MEMORY.md, empty GOALS.md
   - Creates `.env` from `.env.example` with `chmod 600`
   - Initializes empty SQLite database
   - `ar skills add <github-org/repo>` clones and copies skill directories into local `skills/`
   - `ar skills add <github-org/repo> --submodule` adds as git submodule instead

4. **Validate: blank VM test (test VM: 192.168.1.16, creds in `arc creds` service `manage-agents`)**
   - Fresh clone of agent-runtime on test VM
   - Run `art init` with test values
   - Run `art services install` — verify systemd units generate correctly
   - Run `art sensors` — verify it discovers only builtin skills, runs cleanly
   - Run `art run` — verify dispatch starts and exits cleanly with no tasks
   - Add `aibtcdev/skills` as submodule, verify sensor discovery finds submodule skills
   - **Verify skills-required enforcement:**
     - `art tasks add --subject "test" --model sonnet` → rejected (no --skills)
     - `art tasks add --subject "test" --model sonnet --skills nonexistent` → rejected (ghost skill)
     - `art tasks add --subject "test" --model sonnet --skills credentials` → accepted
     - Sensor creates task → verify `skills` column populated with parent skill name
     - Workflow creates task → verify `skills` column populated from workflow's skill
   - Total time from clone to running agent: target <5 minutes

---

### Quest 4: `instance-separation`

**Goal:** Create Arc's instance repo that uses agent-runtime as a submodule and contains only Arc-specific content.

**Skills:** `arc-skill-manager, quest-create`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Scaffold: create arc0btc/arc repo structure**
   - `runtime/` ← git submodule pointing to `aibtcdev/agent-runtime`
   - `skills/aibtc/` ← git submodule pointing to `aibtcdev/skills`
   - `skills/arc-*/` ← Arc-specific skills (from Quest 2 manifest), committed directly
   - Copy Arc's `SOUL.md`, `GOALS.md`
   - Copy `memory/` (MEMORY.md, patterns.md, frameworks.md, shared/)
   - Arc-specific `CLAUDE.md` overlay (fleet policy, GitHub-is-Arc-Only, Arc-specific dispatch rules — content stripped from the generic CLAUDE.md)
   - `design/`, `templates/` (Arc-specific ones only)

2. **Wire runtime: connect submodules and verify boot**
   - Add agent-runtime as git submodule at `runtime/`
   - Add aibtcdev/skills as git submodule at `skills/aibtc/`
   - Create wrapper script: `bin/arc` → runs `runtime/bin/ar` with correct paths
   - Update sensor discovery to scan both `skills/` and `skills/aibtc/` for sensor.ts files
   - Verify `arc services install` generates correct systemd units pointing to instance paths
   - Document the fork-on-write pattern: to customize a shared skill, copy it from `skills/aibtc/<name>` to `skills/<name>`

3. **Migration test: verify Arc boots from new structure**
   - Stop current services on this VM
   - Boot from new repo structure
   - Verify sensors run, dispatch picks up tasks, web dashboard loads
   - Verify memory persists across dispatch cycles
   - Verify git hooks (memory-save.sh) work with new paths
   - Verify `arc skills` lists both local and submodule skills
   - Rollback plan: if anything breaks, `arc-starter` is still intact

---

### Quest 5: `upstream-skills` (optional — do when ready)

**Goal:** Contribute Arc's generic skills back to aibtcdev/skills. Not blocking the reorg.

**Skills:** `arc-skill-manager, arc-catalog`
**Model:** sonnet
**Priority:** 7

**Phases:**

1. **Prepare: strip Arc-specific references from shared skill candidates**
   - Use Quest 2 manifest to identify skills flagged as "shared, not yet upstream"
   - Ensure SKILL.md follows aibtcdev/skills conventions
   - Ensure sensor.ts and cli.ts import `parseFlags` from runtime, not local copy
   - Ensure no hardcoded Arc identity, fleet topology, or wallet addresses

2. **Reconcile: for skills that exist in both, pick the better version**
   - Compare Arc's version vs upstream
   - If Arc's is better: PR upstream with improvements
   - If upstream is better: delete Arc's local copy, use submodule version
   - If both have unique value: merge the best of both

3. **Submit: open PRs to aibtcdev/skills**
   - One PR per logical group (defi skills, github skills, research skills, etc.)
   - Each PR includes SKILL.md + sensor.ts + cli.ts as appropriate
   - Reference this quest plan in PR descriptions

---

## Deferred Items (Real Debt, Not Blocking)

These are audit findings worth tracking but not blocking the reorg:

| Item | Audit Ref | Why Defer |
|------|-----------|-----------|
| Split web.ts (3,273L god file) | §2.1 | Structural debt but works. Split after extraction when it's in one repo. |
| Migrate 113 node:fs → Bun APIs | §6.1 | Policy violation but functional. Batch-fix after extraction. |
| Rate limiter deduplication (8 copies) | §2.1 | Part of web.ts split. |
| Pre-public-exposure security gate | §3.2 | Only matters when dashboard goes public (CF Tunnel + auth). |
| roundtable/consensus table cleanup | §1.5 | Dead schemas, harmless, low priority. |
| Task result_detail pruning strategy | §1.5 | Operational concern, not structural. |
| experiment.ts evaluation | §4 | 334 lines, possibly unused, low impact. |

---

## Immediate Cleanup (Pre-Quest, Done by Human)

- [x] Deleted `/home/dev/old-arc0btc-v4-skills/` — dead v4 archive
- [ ] `/home/dev/github/` — 2.9GB of cached clones. Let sensors re-clone as needed rather than keeping permanent copies.
- [ ] `/home/dev/agents-love-bitcoin/` — deployed project, should be moved to `github/<org>/agents-love-bitcoin` to match convention. Needs investigation to determine org.

---

## Quest Init Commands

Ready to paste when approved:

```bash
# Quest 1: Cleanup + structural fixes (audit-informed)
arc skills run --name quest-create -- init \
  --slug repo-cleanup \
  --goal "Remove dead/duplicate skills, fix dependency inversion (src/ importing from skills/), add skill name validation, compress memory to <2K tokens, consolidate db paths. Reference: docs/quest-repo-reorg.md Quest 1 phases." \
  --skills arc-skill-manager,arc-housekeeping,arc-memory \
  --model sonnet

# Quest 2: Classification (after Quest 1 completes)
arc skills run --name quest-create -- init \
  --slug skill-classification \
  --goal "Classify every remaining skill into shared/arc-specific/runtime-builtin/delete buckets. Cross-reference with aibtcdev/skills. Produce migration manifest at docs/skill-classification.json. Reference: docs/quest-repo-reorg.md Quest 2 phases." \
  --skills arc-skill-manager,arc-catalog \
  --model opus

# Quest 3: Runtime extraction (after Quest 2 completes)
arc skills run --name quest-create -- init \
  --slug runtime-extraction \
  --goal "Create aibtcdev/agent-runtime repo — clean engine, no personality. Rename CLI to art. Remove fleet code from engine. Build art init + skills add. Validate on blank environment. Reference: docs/quest-repo-reorg.md Quest 3 phases." \
  --skills arc-skill-manager,quest-create \
  --model opus

# Quest 4: Instance separation (after Quest 3 completes)
arc skills run --name quest-create -- init \
  --slug instance-separation \
  --goal "Create arc0btc/arc instance repo. Submodules: aibtcdev/agent-runtime at runtime/, aibtcdev/skills at skills/aibtc/. Move Arc-specific skills, memory, identity. Verify Arc boots from new structure. Reference: docs/quest-repo-reorg.md Quest 4 phases." \
  --skills arc-skill-manager,quest-create \
  --model opus

# Quest 5: Upstream contributions (optional, after Quest 4)
arc skills run --name quest-create -- init \
  --slug upstream-skills \
  --goal "Contribute generic skills back to aibtcdev/skills. Reconcile duplicates. Open PRs grouped by domain. Reference: docs/quest-repo-reorg.md Quest 5 phases." \
  --skills arc-skill-manager,arc-catalog \
  --model sonnet
```

---

## Success Criteria

1. **Blank VM test passes:** `git clone aibtcdev/agent-runtime && art init && art skills add aibtcdev/skills --submodule` → working agent in <5 minutes with zero inherited personality
2. **Arc boots from `arc0btc/arc`** with runtime + skills as submodules, all services working
3. **Shared skills live in `aibtcdev/skills`**, not duplicated across agent instances
4. **arc-starter repo is archived** or redirects to agent-runtime
5. **No personality in the engine:** the word "arc" doesn't appear in agent-runtime except as a generic example
6. **No dependency inversion:** `src/` never imports from `skills/`
7. **Skill names validated:** dispatch rejects invalid names, logs warnings for ghost references
