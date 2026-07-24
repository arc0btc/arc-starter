---
id: article-pipeline-p4-revert-clears-send-marker
topics: [article-pipeline, idempotency, control-plane, git-revert]
source: task #23050 (2026-07-17)
created: 2026-07-17
---

Investigated why `arc-operator-loop P4`'s auto-package batch (2026-07-16 20:39-20:41, commits
`a420cf22`/`3de6cbcc`/`642ee99e`/`fd31ead9`/`fa5ba22b`) packaged cover+email for articles 6-10,
but articles 6 and 7 were reverted (`c17f531e`, `9f568694`) seconds later while 8/9/10 were kept.

**No reason is stated anywhere in this repo.** The revert commits are bare (`git revert`
boilerplate only, no body), authored directly by the `arc` bot identity with no corresponding
`cycle_log`/task record in `db/arc.sqlite` — meaning these commits did not originate from an
Arc dispatch task at all. They come from the external control plane
(`ops/article-covers/auto-package.ts`, referenced in `scripts/send-article-package.ts`'s
header comment), which lives in the separate `manage-agents` repo, not present in this sandbox.
Root cause is therefore not determinable from `arc-starter` alone.

Content diffing found no distinguishing signal — articles 6/7's `title`/`body`/`companionPost`
are structurally identical in shape and quality to 8/9/10's. The only observable difference is
operational: 6 and 7 got reverted, 8/9/10 didn't.

**Real finding — an idempotency gap the revert exposes:** all 5 packaging commits stamped
`packageEmailSentAt` into the `article-N-x-article.json` (proof the send already fired, mirrored
in a `.bak-p4-<timestamp>` pre-image the script writes before overwriting). The revert for 6/7
restored the file to its **pre-package** state, wiping `packageEmailSentAt` entirely — it doesn't
just undo a failed attempt, it erases the record that the (apparently successful, per the
commit message and the stamp that existed until the revert) send happened. If the control-plane
auto-package script re-runs and finds no `packageEmailSentAt` on articles 6/7, it will treat them
as never-sent and re-package + re-send — a duplicate email to whoabuddy@gmail.com for content
already delivered once.

**Recommendation for the control-plane script** (needs a task filed against `manage-agents`,
not `arc-starter`): a revert path that follows a genuinely failed send should be distinguishable
from a revert that follows a successful send but a later content-quality veto. Only the former
should clear `packageEmailSentAt`. Right now both look identical to a downstream reader of this
repo's git history.

See [[disallowed-tools-not-enforced-in-dispatch]] for a related "state cleared without recording
why" pattern (frontmatter enforcement) — same class of gap: a revert/removal that isn't
self-documenting forces the next reader to reconstruct intent from timestamps alone.
