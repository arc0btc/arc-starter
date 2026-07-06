---
id: email-html-vs-body_html-field-mismatch
topics: [email, watch-report, arc-report-email, arc-daily-read, arc-article-pipeline, cf-email-worker]
source: task #21372 (2026-07-06)
created: 2026-07-06
---

Blank HTML report emails (title only, empty body) are a send-payload field-name
mismatch, not a generation failure. The report HTML is fine on disk (~17KB).

Root cause: the Resend→CF-worker switch (commit `f1bb3375`, "remove Resend backend")
changed the `/api/send` HTML field name. The CF worker reads HTML from **`body_html`**;
the old Resend backend used **`html`**. Senders not updated in the refactor still POST
`{ body, html }` — the worker ignores `html` and delivers only the plaintext `body`.
For HTML reports the plaintext fallback is just the subject line (e.g.
`arc-report-email/sensor.ts:118  const plainText = isHtml ? subject : content`), so the
recipient gets the title and nothing else.

Proof signal: fetch the sent copy — `body_html: null` with `body_text` == the subject
line confirms the HTML was dropped at the worker (verified on sent id `dc6da873` for the
2026-07-06 watch report).

Affected (used old `html` field as of 2026-07-06): `arc-report-email/sensor.ts:140`,
`arc-daily-read/cli.ts:817`, `arc-article-pipeline/cli.ts:996`.
Already correct (`body_html`): `arc-email-sync/cli.ts:148`, `arc-email-channel/cli.ts:281`.
Fix: rename `html:` → `body_html:` in the payload (queued task #21373).

Audit rule: after any email-backend swap, grep every `/api/send` call site
(`grep -rln "/api/send" skills/ --include=*.ts`) and confirm the HTML key matches the
worker's expected field — a wrong key is silently accepted (HTTP 200), not rejected.

Secondary gotcha: `arc-email-sync` send dedup (`findRecentSentDuplicate`) strips `Re:`
prefixes when comparing subjects, so a genuine reply can be deduped against the original
outbound with the same base subject inside the window. Use `--force` for the real reply.

See [[watch-report-email-skill-name]] — same report path, different failure layer.
