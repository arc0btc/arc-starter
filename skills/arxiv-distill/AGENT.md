---
name: arxiv-distill-agent
skill: arxiv-distill
description: Distill an arxiv digest into 3-5 source-artifact nuggets. Selection, not paraphrase.
---

# arxiv-distill — extraction protocol

You are distilling one `research/arxiv/*_arxiv_digest.md` into 3-5 nuggets that
will feed Arc's blog drafts, paid-room synthesis, and X cadence beats. The task
description includes the source digest path.

## What a nugget is

One short claim worth surfacing across Arc's channels. Shape:

```ts
{
  type: "arxiv",
  produced_at: "<ISO8601 now>",
  source_path: "<digest path from task description>",
  topic: "quantum-pqc" | "aibtc-infra" | "agent-architecture",
  title: "<paper title, ≤ 100 chars>",
  nugget: "<≤ 1200 chars: direct quote + 1 line of framing>",
  citation: "arxiv:<id>",   // e.g. "arxiv:2606.13639"
  suggested_channels: <see SKILL.md>
}
```

## Step-by-step

1. **Read the digest** at the path in the task description.

2. **Pick 3-5 papers** from the Highlights section. Bias toward:
   - direct Bitcoin / Stacks / MCP / agent-payment relevance
   - quantum-PQC if the paper has a concrete threat model or timeline
   - multi-agent orchestration with a real technique (not just "we used GPT-4")
   - Drop generic-LLM-scaling, vision-only, healthcare-LLM, unless they have a
     Bitcoin tie buried in the body

3. **Classify each pick**. Use the keyword classifier:

   ```ts
   import { classifyTopic } from "../arxiv-research/lib/keywords.ts";
   const topic = classifyTopic(title, abstract);
   ```

   If classifier returns null, you can override only if you can justify the
   bucket in the result_summary. When in doubt, drop the paper.

4. **Write each nugget**. Use a one-off Bun script:

   ```ts
   import { writeDistilled } from "../../src/artifacts.ts";

   const id = writeDistilled({
     type: "arxiv",
     produced_at: new Date().toISOString(),
     source_path: "<path>",
     topic: "<one of three>",
     title: "<paper title>",
     nugget: `"<exact quote from abstract>"\n\nWhy it matters: <1 sentence on the agent / Bitcoin angle>.`,
     citation: "arxiv:<id>",
     suggested_channels: [...],  // per SKILL.md
   });
   console.log("wrote", id);
   ```

   Run via `bun -e '...'` or by writing a tiny temporary script. The function
   throws on validation failure (nugget > 1200 chars, invalid channel, etc.) —
   fix the input, don't catch and retry silently.

5. **Verify on disk**. After all writes:

   ```bash
   ls -la artifacts/distilled/arxiv/ | tail -10
   ```

   Spot-check one JSON file matches what you wrote.

6. **Close completed** with a result_summary like:
   `"5 nuggets: 2 quantum-pqc (Shor timeline + lattice BIP), 2 aibtc-infra (MCP server orchestration + x402 payment patterns), 1 agent-architecture (multi-agent reward modeling). Dropped 3 generic-LLM-scaling and 1 vision paper."`

## Forbidden

- Paraphrasing instead of quoting. The nugget is a *selection* of the paper's
  own words. Frame in 1 sentence; quote the rest.
- Writing nuggets without arxiv IDs in `citation`.
- Producing > 5 nuggets per task. Quality bar > quota.
- Using suggested_channels that aren't in the SKILL.md table.

## If the digest is thin

Write 0-2 nuggets and close completed with summary explaining which papers
didn't pass the bar. The pool stays healthier with fewer-but-real entries
than with filler.
