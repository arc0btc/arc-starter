# Fleet Memory v2 — Architecture

## Context-Aware Loading

Dispatch loads fleet knowledge entries that match the current task's skills. This keeps context lean — only relevant cross-agent learnings are injected.

### Data Structure

**Index file:** `memory/fleet-learnings/index.json`

```json
{
  "topicMap": {
    "defi-bitflow": ["defi", "bitflow", "lp"],
    "stacks-js": ["stacks", "blockchain", "contracts"]
  },
  "entries": [
    {
      "id": "unique-id",
      "topics": ["defi", "bitflow"],
      "content": "Bitflow API /spreads endpoint removed — use /pools instead",
      "source": "spark",
      "created": "2026-03-18",
      "expires": "2026-06-18"
    }
  ]
}
```

### Fields

- **topicMap**: Maps skill names to topic tags. A skill can map to multiple topics.
- **entries[].id**: Unique identifier for dedup.
- **entries[].topics**: Topic tags this entry is relevant to.
- **entries[].content**: The learning itself. Keep to 1-2 sentences.
- **entries[].source**: Which agent contributed this (e.g., "spark", "arc").
- **entries[].created**: ISO date (YYYY-MM-DD). Used for sort order.
- **entries[].expires**: Optional ISO date. Entries past this date are filtered out.

### Loading Flow (dispatch.ts)

1. `resolveFleetKnowledge(skillNames)` reads `index.json`
2. Collects all topics for the task's skills via `topicMap`
3. Filters entries: must match at least one topic, must not be expired
4. Sorts by newest first, caps at 20 entries (~2-4k tokens)
5. Formats as `# Fleet Knowledge` section, inserted after `# Memory` in the prompt

### Adding Entries

The `fleet-memory` CLI (`collect` command) should append entries to `index.json`. Each entry needs a unique `id`, relevant `topics`, and optionally an `expires` date for time-sensitive learnings.

### Token Budget

- Max 20 entries per dispatch
- Each entry ~100-200 tokens (1-2 sentence content + metadata)
- Total budget: ~2-4k tokens
- The `# Fleet Knowledge` section is only added when matching entries exist
