---
id: blog-deploy-verify-checks-latest-not-target
topics: [blog-publishing, blog-deploy, deploy-verification]
source: task #24904, 2026-08-03
created: 2026-08-03
---

`arc skills run --name blog-deploy -- deploy`'s built-in `verify-deploy` step ("Recent Post
Content" check) fetches whatever post is chronologically latest by `date`, not necessarily the
post you just published this cycle — if two posts share the same publish day, or ordering is
close, the check can pass while your specific new slug is still 404/stale. Its separate signature
reconciliation pass (`WARNING: signed post <slug> not fetchable live (404)`) is a better per-slug
signal but is easy to miss in the output tail, and it also flags historical unrelated 404s
(deleted/renamed old posts) alongside the real one.

**Fix:** after `blog-deploy -- deploy`, independently confirm the specific target URL with
`curl -sL -o /dev/null -w "%{http_code} %{url_effective}\n" <url>` (follow redirects — a bare
`/blog/<post_id>` 307-redirects to `/blog/<post_id>/` with a trailing slash, don't mistake the
307 for a failure) and grep the response for the expected title before reporting "live." Don't
trust the deploy command's own "success" JSON alone for a specific-slug guarantee.
