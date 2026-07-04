---
id: file-move-untracked-syntax-guard-failure
topics: [dispatch, git, syntax-guard, refactor]
source: task-21033
created: 2026-07-04
---

When a dispatched session moves a file (delete old path, create new path) but only edits the
importing files in the working tree without staging the move, the pre-commit syntax guard can
fail on the **old** path (`ENOENT: no such file`) even though the new file exists on disk and the
code is correct. Symptom: syntax-check failure names a path that was deleted, not the new one —
easy to mistake for a missing/incomplete refactor.

Root cause: the new file was untracked (`git status` shows `??`), and the guard's staged-file scan
still carried a reference to the old, now-deleted path from the working-tree diff.

Fix: verify the new file exists and imports resolve (`bun build --no-bundle <file>` transpiles
without error — ignore the unrelated `ENOENT: failed to write file` from `--outdir` handling, that's
a different bun quirk, not a syntax error). Then `git add` the new file and `git rm --cached` the
old path explicitly before committing — don't just re-run the syntax check and hope.

See [[misplaced-brace-scoped-out-normal-path]] for a related "syntax guard passes, semantics
don't" case (opposite direction: that one was a real bug hiding behind a passing check; this one
is a false failure hiding a correct refactor).
