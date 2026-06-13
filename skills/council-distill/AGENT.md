---
name: council-distill-agent
skill: council-distill
description: Distill 5 council patterns from Genesis-Works/agent-coordination into source-artifact nuggets. Direct quotes only — selection, not paraphrase.
---

# council-distill — extraction protocol

You are refreshing the council content well from `Genesis-Works/agent-coordination`
(private repo, `gh api`-accessible to Arc). The task description includes the HEAD
SHA you're distilling against and whether you're in dry-run or live mode.

## Five fixed topics

Use exactly these slugs:

1. `coordination-primitive` — substrate, shared-DB, `FOR UPDATE SKIP LOCKED`
2. `mandate-loop` — structural disagreement, mandate cycle
3. `autonomy-tier` — earned-autonomy tier model, charter
4. `paired-artifact` — paired artifact + immutable log, Notch ledger
5. `budget-rail` — hard budget rails, trustless delegation, RFC 0012

If a topic has no fresh quote in the repo, **skip it** and document the gap. Better
3 strong nuggets than 5 with filler.

## Source access

```bash
gh api 'repos/Genesis-Works/agent-coordination/contents/<path>' --jq '.content' | base64 -d
```

Recent commit window (2026-05-22 to 2026-05-30) covers substrate-activation phase 1,
the 9-phase shared-substrate quest, CRM + commission ledger Postgres migration,
management profile + GREEN health.

Suggested first reads (branch out as needed):

- `README.md`
- `fleet/2026-05-29T184700Z-shared-substrate-FINAL.md`
- `fleet/2026-05-29T184600Z-shared-substrate-phase-9.md`
- Charter / tier / RFC docs in the root

The existing static brief at `skills/whop/COUNCIL-CONTENT-WELL.md` is a useful
starting point — quotes from there are valid if still in the current HEAD, but
verify before re-using (the council moves).

## Writing nuggets

For each topic with a strong quote, call `writeDistilled` (in `src/artifacts.ts`):

```ts
import { writeDistilled } from "../../src/artifacts.ts";

const id = writeDistilled({
  type: "council",
  produced_at: new Date().toISOString(),
  source_path: "genesis-works/agent-coordination/fleet/...",
  topic: "coordination-primitive",
  title: "<short title — what the pattern teaches>",
  nugget: `"<direct quote from the source file, ≤ 1000 chars>"\n\n— council:<short-citation>\n\nWhy it matters: <1 sentence on the operational implication>.`,
  citation: "council:<short ref like 'substrate-phase-9'>",
  suggested_channels: ["whop-chat", "blog", "reactive"],
});
console.log("wrote", id);
```

Run as one-off `bun -e '...'` calls or a temporary script.

## Forbidden

- Paraphrasing. The nugget IS a direct quote with framing. Never invent.
- Quoting older static `COUNCIL-CONTENT-WELL.md` text that's no longer in the
  current repo HEAD.
- Writing nuggets without citations.
- Updating `skills/whop/COUNCIL-CONTENT-WELL.md` when in dry-run mode (default).

## Result summary

Close completed with a one-line summary like:

`"4 nuggets: coordination-primitive (substrate-phase-9), autonomy-tier (charter §3), paired-artifact (Notch §1), budget-rail (RFC-0012 phase-2). mandate-loop skipped — no fresh quote in this HEAD."`

## Dry-run vs live

In dry-run mode (default), only the artifacts go to disk; `COUNCIL-CONTENT-WELL.md`
stays untouched. Human voice review reads the nuggets, signs off, then
`COUNCIL_DISTILL_DRY_RUN=false` flips. In live mode, also overwrite the static
brief with the same 5 patterns.
