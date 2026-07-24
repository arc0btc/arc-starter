---
id: code-review-fix-blocks-under-headless-dispatch
topics: [claude-code, dispatch, pr-workflow, code-review]
source: task-23697
created: 2026-07-24
---

# /code-review --fix blocks under headless dispatch (v2.1.218+)

**Question:** v2.1.218 changed `/code-review` to run as a background subagent (release notes: "review work no longer fills the calling conversation"). CLAUDE.md's PR workflow step 4 depends on `/code-review --fix` completing and its fixes landing *before* the dispatch session proceeds to PR creation. Does headless dispatch (`claude --print --permission-mode bypassPermissions`) wait for the backgrounded review to finish, or does the process exit early ("fired and forgotten")?

**Empirical test (task #23697, installed version 2.1.218):** Built a throwaway git repo with a committed-clean `math.ts`, then staged a diff reintroducing two deliberate bugs (off-by-one loop, missing divide-by-zero guard). Ran the exact invocation shape dispatch uses:

```
claude --print --permission-mode bypassPermissions "/code-review --fix"
```

Result: process ran ~22s and exited 0. By the time the process exited, `git diff` already showed both bugs fixed in the working tree, and stdout contained the full findings + "Fixes applied" report.

**Conclusion:** Under headless/print mode there's no interactive UI to background into, so `/code-review --fix` runs synchronously to completion and the CLI process blocks until it's done — it does not detach. CLAUDE.md's PR workflow step 4 is safe as written; **no regression, no follow-up needed.**

**Caveat:** only tested a small single-file diff (~20s runtime). Not verified whether a much larger/slower review (many files, long-running background subagent) behaves the same, or whether there's a different code path for `/code-review ultra` (cloud review) under headless mode — release notes call that out as a separate fix ("ultra in non-interactive sessions... launch cloud review instead of silently running local review").
