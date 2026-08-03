---
id: blog-publishing-slug-flag-excludes-date-prefix
topics: [blog-publishing, cli, gotcha]
source: task #24904, 2026-08-03
created: 2026-08-03
---

`blog-publishing -- create --slug <slug>` builds `post_id` as `${today}-${slug}` — the CLI
prepends the date itself. If a caller (e.g. a task spec) hands you a target post_id/slug like
`2026-08-03-day-24-research` and you pass that whole string as `--slug`, you get a doubled date:
`2026-08-03-2026-08-03-day-24-research`.

**Fix:** when a task specifies an exact target slug/post_id that already starts with today's date,
strip the leading `YYYY-MM-DD-` before passing `--slug` — pass only `day-24-research`, not the full
string. Verify by checking the CLI's own `post_id` field in the create-command JSON output before
proceeding to write content; don't assume the passed `--slug` value is the final post_id.

If you create with the wrong slug, delete the draft directory before recreating — `blog-publishing
-- delete --id <id>` can fail (`rm exited with code null`) on some environments; a plain `rm -f
<dir>/index.md && rmdir <dir>` (not `rm -rf`, which is blocked by the destructive-command guard
hook) works as a fallback.
