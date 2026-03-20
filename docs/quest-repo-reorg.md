# Quest Plan: Repository Reorganization

*Created: 2026-03-20 by whoabuddy + Claude*
*Goal: Split arc-starter into runtime + instance + shared skills*

---

## Problem Statement

arc-starter is three things in one repo: the reusable engine, Arc's personality/memory, and 121 skills (generic + Arc-specific). When cloned for a new agent, everything comes along — Arc's soul, Arc's 5,382 commits of learned patterns, fleet topology, all of it. This causes chaos for new agents and bloats the codebase.

## Target Architecture

```
aibtcdev/aibtc-agent      ← the engine (renamed from arc-starter, platform-branded)
aibtcdev/skills           ← shared skills (already exists, expand it — submodule in agent instances)
arc0btc/arc               ← Arc's instance (personality + custom skills + memory)
```

Connected via git submodules (Option A — simplest wins).

- `aibtcdev/skills` is already a dependency we use — it becomes a git submodule in every agent instance
- The engine repo moves under the `aibtcdev` org since it's platform infrastructure, not Arc-specific

## Naming Decision

The CLI binary is currently `arc` — that's a personality name, not a tool name. The runtime binary becomes `aibtc-agent`. Commands: `aibtc-agent init`, `aibtc-agent skills add`, `aibtc-agent services start`. Instance repos can alias it to their agent name (e.g., Arc aliases `arc` → `aibtc-agent`).

---

## Quest Sequence

These quests are ordered. Each depends on the previous. Execute them sequentially.

---

### Quest 1: `repo-cleanup`

**Goal:** Remove dead weight, deduplicate skills, consolidate stale memory entries — reduce noise before the split.

**Skills:** `arc-skill-manager, arc-housekeeping, arc-memory`
**Model:** sonnet
**Priority:** 4

**Phases:**

1. **Audit duplicates: identify skill pairs that overlap and pick winners**
   - `arc-dispatch-eval` vs `arc-dispatch-evals` — consolidate to one
   - `bitflow` vs `defi-bitflow` — pick one, migrate references
   - Any other duplicates or near-empty stubs (skills with only a SKILL.md and no sensor/cli)
   - Output: list of skills to delete with reasoning

2. **Delete losers: remove duplicate/dead skills and update any references**
   - Delete the losing skill directories
   - Grep for references in CLAUDE.md, MEMORY.md, task templates, other SKILL.md files
   - Update references to point to the surviving skill
   - Commit with `refactor(skills): consolidate duplicate skills`

3. **Consolidate memory: trim stale shared entries**
   - Review `memory/shared/entries/` (90+ files)
   - Entries about resolved incidents, deprecated fleet topology, or superseded patterns → delete or merge into `memory/patterns.md`
   - Target: <30 shared entries, each still relevant
   - Commit with `chore(memory): consolidate stale shared entries`

4. **Clean db paths: consolidate /home/dev/db/ vs arc-starter/db/**
   - Identify which sqlite is actually used by the running services
   - Remove the unused one
   - Document the canonical path in CLAUDE.md if not already clear

---

### Quest 2: `skill-classification`

**Goal:** Classify every skill into one of four buckets — shared (aibtcdev/skills), arc-specific, runtime-builtin, or delete — and produce a migration manifest.

**Skills:** `arc-skill-manager, arc-catalog`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Classify: categorize all skills into four buckets**
   - **shared** — generic, any agent could use (defi, github, research, ordinals, stacks, bitcoin skills). Cross-reference with aibtcdev/skills to identify what already exists there.
   - **arc-specific** — only useful to Arc (arc-*, fleet-*, arc0btc-* skills, skills referencing Arc's identity/fleet/business)
   - **runtime-builtin** — core platform capabilities that ship with the engine (arc-alive-check, arc-skill-manager, arc-credentials, quest-create, arc-workflows — the minimal set any agent needs)
   - **delete** — stubs, experiments, unused skills with no sensor and no cli
   - Output: JSON manifest at `docs/skill-classification.json`

2. **Validate: verify classification against actual usage**
   - For each "delete" candidate: check if any task in the last 30 days referenced it (`SELECT * FROM tasks WHERE skills LIKE '%skillname%'`)
   - For each "shared" candidate: confirm it has no Arc-specific references (no hardcoded wallets, no arc0btc.com URLs, no fleet member names)
   - For each "runtime-builtin": confirm it works without SOUL.md or MEMORY.md
   - Update manifest with validation results

3. **Diff with aibtcdev/skills: map shared skills to their upstream equivalents**
   - For each "shared" skill, check if aibtcdev/skills already has it
   - If yes: note which is newer/better, whether arc-starter's version has customizations worth upstreaming
   - If no: flag it as a candidate to contribute upstream
   - Output: migration notes per skill in the manifest

---

### Quest 3: `runtime-extraction`

**Goal:** Create the clean `aibtc-agent` repo with only the engine, no personality, no instance-specific content.

**Skills:** `arc-skill-manager, quest-create`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Scaffold: create the runtime repo structure**
   - New repo `aibtc-agent` (or whatever name we land on)
   - Copy `src/` (all core runtime files)
   - Copy `bin/`, `scripts/install-prerequisites.sh`, `package.json`, `tsconfig.json`
   - Copy `SOUL.template.md`, `.env.example`, `LICENSE`
   - Write generic `CLAUDE.md` (strip Arc-specific content — identity references, fleet roster, GitHub policy specifics)
   - Write generic `README.md` (framework docs, not Arc's story)
   - `skills/.gitkeep`, `memory/.gitkeep`, `templates/.gitkeep`
   - Rename CLI binary from `arc` to `aibtc-agent` in bin/, package.json, src/cli.ts, services.ts

2. **Genericize src/: remove Arc-specific hardcoding from runtime**
   - Audit all `src/*.ts` files for hardcoded references to "arc", "arc0btc", fleet member names, specific wallet addresses
   - Make agent name configurable (read from SOUL.md or a config file, not hardcoded)
   - Ensure services install uses the generic binary name
   - Keep all functionality — just remove the personality coupling

3. **Template system: build `agent init` scaffolding**
   - `aibtc-agent init` prompts for: agent name, BNS name (optional), wallet address (optional), personality traits
   - Generates SOUL.md from SOUL.template.md
   - Creates empty MEMORY.md, empty GOALS.md
   - Creates `.env` from `.env.example`
   - `aibtc-agent skills add <repo/path>` copies skill directories into local `skills/`

4. **Validate: confirm runtime works standalone**
   - Fresh clone of aibtc-agent
   - Run `aibtc-agent init` with test values
   - Run `aibtc-agent services install` — verify systemd units generate correctly
   - Run `aibtc-agent sensors` — verify it finds no sensors (skills/ empty) and exits cleanly
   - Run `aibtc-agent run` — verify dispatch starts and exits cleanly with no tasks

---

### Quest 4: `instance-separation`

**Goal:** Create Arc's instance repo that uses aibtc-agent as a submodule and contains only Arc-specific content.

**Skills:** `arc-skill-manager, quest-create`
**Model:** opus
**Priority:** 3

**Phases:**

1. **Scaffold: create arc0btc/arc repo structure**
   - `runtime/` ← git submodule pointing to aibtc-agent
   - Copy Arc's `SOUL.md`, `GOALS.md`
   - Copy `memory/` (MEMORY.md, patterns.md, frameworks.md, shared/)
   - Arc-specific `CLAUDE.md` overlay (fleet policy, GitHub policy, Arc-specific dispatch rules)
   - `skills/` with only arc-specific skills (from quest 2 manifest)
   - `design/`, `templates/` (Arc-specific ones only)

2. **Wire submodule: connect runtime and verify boot**
   - Add aibtc-agent as git submodule at `runtime/`
   - Create wrapper script that runs `runtime/bin/aibtc-agent` with correct paths
   - Alias `arc` → `aibtc-agent` for Arc's instance
   - Verify `arc services install` generates correct systemd units pointing to instance paths
   - Verify sensors discover skills from both `skills/` and any submodule skill paths

3. **Shared skills: add aibtcdev/skills as submodule**
   - Add aibtcdev/skills as git submodule at `skills/aibtc/` (or symlink strategy)
   - Verify sensor discovery finds skills in submodule paths
   - Verify `arc skills` lists both local and submodule skills
   - Document the fork-on-write pattern: to customize a shared skill, copy it to local `skills/`

4. **Migration test: verify Arc boots from new structure**
   - Stop current services
   - Boot from new repo structure
   - Verify sensors run, dispatch picks up tasks, web dashboard loads
   - Verify memory persists across cycles
   - Verify git hooks (memory-save.sh) work with new paths

---

### Quest 5: `upstream-skills`

**Goal:** Contribute Arc's generic skills back to aibtcdev/skills and clean up any that already exist upstream.

**Skills:** `arc-skill-manager, arc-catalog`
**Model:** sonnet
**Priority:** 5

**Phases:**

1. **Prepare PRs: for each "shared" skill not yet in aibtcdev/skills, prepare a contribution**
   - Strip any Arc-specific references from the skill
   - Ensure SKILL.md follows aibtcdev/skills conventions
   - Ensure sensor.ts and cli.ts work without Arc-specific infrastructure
   - Create branch per skill or batch similar skills

2. **Reconcile: for skills that exist in both, pick the better version**
   - Compare Arc's version vs upstream
   - If Arc's is better: PR upstream with improvements
   - If upstream is better: delete Arc's local copy, use submodule version
   - If both have unique value: merge the best of both into a PR

3. **Submit: open PRs to aibtcdev/skills**
   - One PR per logical group (defi skills, github skills, research skills, etc.)
   - Each PR includes SKILL.md + sensor.ts + cli.ts as appropriate
   - Reference this quest plan in PR descriptions

---

## Immediate Cleanup (Pre-Quest, Done by Human)

These were already done or are trivial:

- [x] Deleted `/home/dev/old-arc0btc-v4-skills/` — dead v4 archive
- [ ] `/home/dev/github/` — 2.9GB of cached clones. Let sensors re-clone as needed rather than keeping permanent copies. Consider `.gitignore`-ing or moving to `/tmp/`.
- [ ] `/home/dev/agents-love-bitcoin/` — deployed project, should be moved to `github/<org>/agents-love-bitcoin` to match convention. Needs investigation to determine org.

---

## Quest Init Commands

Ready to paste when approved:

```bash
# Quest 1: Cleanup
arc skills run --name quest-create -- init \
  --slug repo-cleanup \
  --goal "Remove dead weight, deduplicate skills, consolidate stale memory entries — reduce noise before the repo split" \
  --skills arc-skill-manager,arc-housekeeping,arc-memory \
  --model sonnet

# Quest 2: Classification (after Quest 1 completes)
arc skills run --name quest-create -- init \
  --slug skill-classification \
  --goal "Classify every skill into shared/arc-specific/runtime-builtin/delete buckets and produce a migration manifest at docs/skill-classification.json" \
  --skills arc-skill-manager,arc-catalog \
  --model opus

# Quest 3: Runtime extraction (after Quest 2 completes)
arc skills run --name quest-create -- init \
  --slug runtime-extraction \
  --goal "Create clean aibtc-agent repo with only the engine — no personality, no instance content. Rename CLI from arc to aibtc-agent. Build aibtc-agent init scaffolding." \
  --skills arc-skill-manager,quest-create \
  --model opus

# Quest 4: Instance separation (after Quest 3 completes)
arc skills run --name quest-create -- init \
  --slug instance-separation \
  --goal "Create arc0btc/arc instance repo using aibtcdev/aibtc-agent as runtime submodule and aibtcdev/skills as skills submodule. Move Arc-specific skills, memory, and identity." \
  --skills arc-skill-manager,quest-create \
  --model opus

# Quest 5: Upstream contributions (after Quest 4 completes)
arc skills run --name quest-create -- init \
  --slug upstream-skills \
  --goal "Contribute generic skills back to aibtcdev/skills. Reconcile duplicates. Open PRs grouped by domain." \
  --skills arc-skill-manager,arc-catalog \
  --model sonnet
```

---

## Success Criteria

1. A new agent can `git clone aibtc-agent && aibtc-agent init` and have a working agent in <5 minutes with zero inherited personality
2. Arc boots from `arc0btc/arc` with runtime as submodule, all services working
3. Shared skills live in aibtcdev/skills, not duplicated across agent instances
4. arc-starter repo is archived or redirects to aibtc-agent
5. The word "arc" doesn't appear in the runtime codebase except as a generic example
