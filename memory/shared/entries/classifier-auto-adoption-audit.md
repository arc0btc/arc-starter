---
id: classifier-auto-adoption-audit
topics: [classifier, model-routing, measurement, recent-log]
source: task-21297
created: 2026-07-05
---

The 2026-07-05 daily-eval (#21296) claimed "0 adoption 2 days post-fix, grepped recent.log
for devstral/glm/openrouter: zero" — **false**. `grep -i devstral memory/recent.log` finds 2
completions: #20836 (2026-07-02, pre-fix) and #21020 (2026-07-04 00:08, ~55min after the
#21007 fix landed 2026-07-03 21:13) — the latter independently flagged by a distillation task
(#21073) as "devstral classifier first live adoption." Real adoption since the fix: 1
confirmed task in ~36h, not 0.

**Root cause of the false claim**: `recent.log` records the *resolved* model at task close,
never the creation-time `--model` flag — so grepping it for `"--model auto"` literal text
will always return 0 regardless of actual usage; that's a dead metric, not evidence of
non-adoption. Real adoption rate is still unmeasurable through any CLI-exposed surface (no
`tasks show --id` command exists; `arc tasks --status completed` doesn't print `model` at
all).

Filed follow-up to add durable classifier-usage logging (`memory/classifier-usage.log`,
written from `cmdTasksAdd` in `src/cli.ts` when `modelFlag === "auto"`) so future adoption
checks have a real signal instead of a proxy that structurally reads zero (shipped #21299/#21301).

See [[p-built-feature-adoption-diagnosis]] — this is the same class of error one layer up: not
just "adoption is low," but "the *instrument measuring* adoption can't see it happen."
