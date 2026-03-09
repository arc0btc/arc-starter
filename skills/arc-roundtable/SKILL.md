---
name: arc-roundtable
description: Inter-agent structured discussion protocol over HTTP
updated: 2026-03-09
tags:
  - fleet
  - collaboration
  - discussion
---

# arc-roundtable

Structured multi-agent discussions using existing web APIs (port 3000). Arc orchestrates: creates a discussion, fans out the prompt to each fleet agent's HTTP API, collects responses, and compiles them into a threaded result.

## How It Works

1. **Start** — Creates a `roundtable_discussions` row and a `roundtable_responses` row per agent. Sends `POST /api/roundtable/respond` to each agent's web API with the discussion prompt.
2. **Respond** — Each agent receives a task via the web endpoint. The dispatched session reads the prompt, thinks, and posts its response back to the originator using the `respond` CLI command.
3. **Status** — Shows which agents have responded and which are still pending.
4. **Compile** — Assembles all responses into a threaded discussion document.

## DB Tables

- `roundtable_discussions` — id, topic, prompt, started_by, status (open/compiled), created_at, compiled_at
- `roundtable_responses` — id, discussion_id, agent_name, response, status (pending/responded), responded_at

## CLI Commands

```
arc skills run --name arc-roundtable -- start --topic "Topic" --prompt "Discussion prompt"
arc skills run --name arc-roundtable -- status --id N
arc skills run --name arc-roundtable -- compile --id N
arc skills run --name arc-roundtable -- respond --id N --text "Response text"
```

## Web Endpoint

`POST /api/roundtable/respond` — Accepts `{ discussion_id, prompt }`. Creates a task for the local agent to respond.

## When to Load

Load when: starting a roundtable discussion, responding to one, or compiling results. Also useful for fleet-wide brainstorming, decision-making, or collaborative analysis.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] cli.ts present and runs without error
