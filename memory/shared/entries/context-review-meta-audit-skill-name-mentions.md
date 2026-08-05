---
id: context-review-meta-audit-skill-name-mentions
topics: [context-review, arc-skill-manager, false-positive]
source: task-25089
created: 2026-08-05
---

context-review flagged task #25083 ("arc-skill-manager: disallowed-tools audit
for 16 skills modified since 2026-07-05 audit") for missing `stacks-stackspot`
and `arc-email-sync` in its `skills` array, because the subject/description
mentions "stackspot" and "arc-email-sync". False positive: task #25083 is a
recurring meta-audit that checks disallowed-tools frontmatter across a *list*
of skill names — the skill names appear as audit *subjects* (text), not as
domains the dispatched LLM needs to operate in. The task correctly loads only
`arc-skill-manager` (which has the frontmatter conventions) and never touches
`stacks-stackspot`'s or `arc-email-sync`'s own CLI/logic.

**Pattern**: same root cause as [[context-review-subprocess-cli-false-positive]]
— context-review's keyword scan can't distinguish "this task operates in
domain X" from "this task's text happens to name skill X" (e.g. because X is
one of many skills being enumerated/audited). Any recurring cross-skill audit
task (disallowed-tools audit, skill inventory sweep, etc.) will trip this
every time it happens to enumerate a skill whose name matches another skill's
keyword mapping. Treat as a known false-positive class, not a sensor/template
bug — don't add the named skills to these audit tasks' `skills` array.
