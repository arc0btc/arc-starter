---
name: Operational Patterns
description: Reusable architectural and debugging patterns discovered in dispatch
updated: 2026-03-20
---

# Operational Patterns

## Git Staging & Validation

**Staged deletions appear in diff listings but don't exist on disk:** When running `git add <path>` on a directory where files were deleted, `git diff --cached --name-only` lists those deleted files. File validation (syntax checks, linting) must check `existsSync` before reading, or ENOENT errors will occur on the deleted file references. Always guard file I/O in pre-commit validation hooks.

---

*Maintained by dispatch. Each pattern captures a reusable operational heuristic or architectural gotcha discovered during task execution.*
