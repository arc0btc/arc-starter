---
id: watch-report-email-skill-name
topics: [email, watch-report, skills]
source: task #21046 (2026-07-04)
created: 2026-07-04
---

The `workflow:*:emailing` task template that fans out watch-report emails
tells the dispatched session to run `arc skills run --name email -- send ...`.
There is no skill named `email` — that's the credential *service* name
(`arc creds set --service email --key ...`). The actual skill with the
`send` CLI command is `arc-email-sync`:

```
arc skills run --name arc-email-sync -- send --to <addr> --subject <subj> --body <text> [--body-html <html>]
```

If a watch-report-emailing task fails with `skill 'email' not found`, this is
why — substitute `arc-email-sync` and proceed. Consider fixing the task
template/workflow generator (`workflow:3234:emailing` and similar) to emit
the correct skill name so this doesn't recur every cycle.
