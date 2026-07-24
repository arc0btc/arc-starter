---
id: context-review-subprocess-cli-false-positive
topics: [context-review, arc-article-pipeline, false-positive]
source: task-22109
created: 2026-07-11
---

context-review's keyword-matching flagged task #22093 ("Draft Arc's next amplified
article") for missing `blog-publishing` + `social-x-posting` in its `skills` array,
because the task description mentions "blog draft" and "post to x". False positive:
the dispatched LLM only writes a draft JSON (STEP 2). The deterministic STEP 3
(`bun skills/arc-article-pipeline/cli.ts stage`) is what actually touches
blog-publishing — and it does so by shelling out via `arc skills run --name
blog-publishing -- create ...` (skills/arc-article-pipeline/cli.ts:885), not by the
dispatched LLM directly invoking that skill's CLI. There is no `social-x-posting`
call anywhere in the pipeline — the X leg is an email to whoabuddy, who posts
manually from his own account.

**Pattern**: when a skill's own `cli.ts` shells out to another skill via
`arc skills run --name X`, the calling task does NOT need `X` in its `skills` array
— the subprocess call carries its own context, the dispatched LLM never touches
`X`'s CLI directly. context-review's keyword scan can't see this distinction (it
only reads task subject/description text). If context-review re-flags
arc-article-pipeline tasks for this reason, treat as a known false positive, not a
sensor/template bug to fix — don't add blog-publishing/social-x-posting to the
task's `skills` array.
