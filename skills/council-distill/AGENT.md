---
name: council-distill-agent
skill: council-distill
description: Distill up to 5 council/coordination patterns from the fleet-digest into source-artifact nuggets. Direct quotes only — selection, not paraphrase.
---

# council-distill — extraction protocol

You are refreshing the council content well from the fleet-digest — a read-only sweep of every
agent VM's recent task activity, produced by the control plane (`manage-agents`
`skills/fleet-digest/generate.ts`) and delivered here at
`skills/council-distill/fleet-digest/latest.md`. The task description includes the digest's content
hash you're distilling against and whether you're in dry-run or live mode.

(Repointed 2026-07-17 — this used to read `Genesis-Works/agent-coordination` via `gh api`. That
repo was retired as a coordination channel; there is no `gh` step in this protocol anymore.)

## Five fixed topics

Use exactly these slugs — interpreted against the fleet-digest's actual content, not
Genesis-Works-specific historical material:

1. `coordination-primitive` — the fleet's live coordination mechanism (direct-to-dispatch pattern,
   any sensor/task-chain evidence the digest shows)
2. `mandate-loop` — self-review / retrospective loops visible in a host's task chain (e.g. a
   completed task immediately spawning a "extract learnings from task #N" retrospective)
3. `autonomy-tier` — per-host status/service tiers the digest reports (legacy-arc-starter vs
   base-agent-runtime, reachable vs unreachable)
4. `paired-artifact` — the digest + this sensor's narration is itself a paired-artifact pattern (a
   record file paired with an immutable distilled-nugget log); also watch for anything in the
   digest text that names a similar pattern
5. `budget-rail` — cost/budget discipline visible in recent task activity (e.g. X posting budget
   guardrails, spend caps named in a host's recent result_summary lines)

If a topic has no fresh match in the current digest, **skip it** and document the gap. Better
2-3 strong nuggets than 5 with filler.

## Source access

Read the file directly — it's already local, no network call needed:

```bash
cat skills/council-distill/fleet-digest/latest.md
```

The digest is git-tracked in the control plane's own repo
(`manage-agents/docs/observations/fleet-digest/<ISO>.md`) — this delivered copy is the same
content, just landed via `scp` since the Arc VM cannot pull that repo directly.

## Writing nuggets

For each topic with a strong quote, call `writeDistilled` (in `src/artifacts.ts`):

```ts
import { writeDistilled } from "../../src/artifacts.ts";

const id = writeDistilled({
  type: "council",
  produced_at: new Date().toISOString(),
  source_path: "manage-agents/docs/observations/fleet-digest/<ISO-of-the-digest-you-read>.md",
  topic: "coordination-primitive",
  title: "<short title — what the pattern teaches>",
  nugget: `"<direct quote from the digest, ≤ 1000 chars>"\n\n— fleet-digest:<ISO timestamp>\n\nWhy it matters: <1 sentence on the operational implication>.`,
  citation: "fleet-digest:<ISO timestamp from the digest's own header>",
  suggested_channels: ["whop-chat", "blog", "reactive", "x"],
});
console.log("wrote", id);
```

Run as one-off `bun -e '...'` calls or a temporary script.

## Forbidden

- Paraphrasing. The nugget IS a direct quote with framing. Never invent.
- Quoting older static `COUNCIL-CONTENT-WELL.md` text that isn't backed by the current digest.
- Writing nuggets without citations.
- Updating `skills/whop/COUNCIL-CONTENT-WELL.md` when in dry-run mode (`COUNCIL_DISTILL_DRY_RUN=true`).

## Result summary

Close completed with a one-line summary like:

`"3 nuggets: coordination-primitive (direct-to-dispatch), mandate-loop (Arc retrospective chain), budget-rail (X budget guardrails). autonomy-tier + paired-artifact skipped — no fresh match in this digest."`

## Dry-run vs live

`COUNCIL_DISTILL_DRY_RUN=false` as of 2026-07-17 (control-plane-remediation Phase 3) — default is
now LIVE: write nuggets to disk AND overwrite `skills/whop/COUNCIL-CONTENT-WELL.md` with the same
patterns. If a future operator re-enables dry-run for a review cycle, only the artifacts go to
disk and `COUNCIL-CONTENT-WELL.md` stays untouched until it's cleared again.
