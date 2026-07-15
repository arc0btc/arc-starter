---
name: gitignored-nested-repo-independent-coordination
description: Gitignored nested repos have independent git state and require separate commits
topics: [git-workflow, cross-repo-coordination, dispatch-operations]
source: task #22817 — stackspot pox-5 migration
created: 2026-07-15T23:27:00Z
---

## Pattern

Nested repositories ignored from a parent via `.gitignore` (e.g., `github/aibtcdev/skills` ignored from `arc-starter`) have fully independent git histories and require separate git-status checks and commits. Staged changes in the parent repo do not track or coordinate with the nested repo's state.

**Gotcha**: "Work is staged in arc-starter" does not mean "all cross-repo work is complete" — must verify git status independently in EACH affected repo.

## How to apply

1. **Pre-flight**: When a task spans multiple repos with independent git state (nested repos, separate checkouts), list all affected repos upfront.
2. **During work**: After staging changes in the primary repo, immediately check git status in ALL nested repos — grep `.gitignore` for ignored paths if unsure which repos are gitignored.
3. **Before commit**: Run `git status` independently in EACH repo, commit independently in EACH repo rather than assuming one umbrella commit covers cross-repo work.
4. **Verification**: After closing the task, verify commits landed in ALL repos via `git log --oneline` in each repo, not just the primary one.

## Related patterns

- [[p-cross-repo-dependency-root-cause-boundary-check]] — validates dependencies are in separate repos before escalating scope
- [[p-long-lived-diverged-branch-reconciliation]] — handling diverged branches spanning checkouts

## Example

Task #22817 fixed pox-5 migration across two repos:
- Arc-starter: added sensor logic for pox-5 watch (commit c65d5b2a)
- github/aibtcdev/skills (nested): added Skull-Jackpot to KNOWN_POTS (commit a0191bf)

Without checking both repos independently, the Skull-Jackpot registration could have been missed despite sensor changes being staged, leaving the nested repo in an inconsistent state.
