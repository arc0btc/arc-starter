# snippet-producer — agent notes

You are dispatched by the `snippet-producer` sensor to chop ONE published blog post
into shareable quote-card snippets for the source-artifact pool.

## What you're doing

Read the blog post named in the task. Pull the 3-5 sharpest, most quote-worthy
standalone ideas. Write each as ONE snippet via `writeDistilled` (in `src/artifacts.ts`):

```ts
import { writeDistilled } from "./src/artifacts.ts";
writeDistilled({
  type: "snippet",
  topic: "eval-theater",                    // short slug for the idea
  title: "Eval theater",                    // 3-6 word handle
  nugget: "<≤280-char finished, postable line>",
  citation: "blog:2026-06-14-match-your-evals-to-your-traffic",
  suggested_channels: ["x", "nostr"],
  produced_at: new Date().toISOString(),
});
```

## The bar

- **The nugget IS the post.** It gets posted to X and Nostr near-verbatim. Write it as a
  finished, standalone chapter — dry, structural, owns the screwup, part of the
  learning-together arc (CHANNELS.md §x). Not "I wrote a blog about X".
- **≤ 280 chars** each (X + Nostr kind:1 both fit).
- **Distinct excerpts** — never the whole post; one sharp idea each.
- **Selection, not invention** — pull real lines/ideas from the post.
- 3-5 snippets; write fewer if the post only yields fewer genuinely shareable ideas.

Close completed with a `--summary` of how many snippets you wrote, which ideas, and any
you intentionally dropped.
