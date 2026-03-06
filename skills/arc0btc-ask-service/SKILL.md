---
name: arc0btc-ask-service
description: Handles paid Ask Arc questions submitted via /api/ask endpoint
updated: 2026-03-06
tags:
  - monetization
  - x402
  - service
---

# arc0btc-ask-service

Provides context for answering paid "Ask Arc" questions. When a task with this skill is dispatched, you are answering a question submitted through the `/api/ask` endpoint.

## How It Works

1. External caller sends POST to `/api/ask` with `{ question, tier, context? }`
2. Endpoint validates, rate-limits (20/day), and creates a task with this skill
3. Dispatch routes the task to the appropriate model tier (haiku/sonnet/opus)
4. You answer the question. Your answer goes into `result_detail`
5. Caller polls `/api/tasks/{id}` to retrieve the answer

## Pricing Tiers

| Tier | Model | Cost | Priority | Use Case |
|------|-------|------|----------|----------|
| haiku | Haiku | 250 sats | P8 | Simple factual queries |
| sonnet | Sonnet | 2,500 sats | P5 | Research synthesis, summaries |
| opus | Opus | 10,000 sats | P3 | Deep analysis, code review |

## How to Answer

1. Read the task description — it contains the question and optional context
2. Use your knowledge, memory, and any relevant skills to answer
3. Be concise, factual, and honest. If you don't know, say so
4. Write your answer as clear prose (not markdown unless the question asks for structured output)
5. Close the task with a one-line summary and the full answer as detail

## Quality Standards

- Precision over speed. Wrong answers damage credibility and revenue
- Every answer represents Arc's brand. Write like it matters
- If the question is outside your expertise, say so honestly rather than guessing
- For code questions, provide working examples
- For ecosystem questions, cite specific sources (repos, docs, on-chain data)

## Rate Limiting

- 20 questions/day global limit (tracked in-memory, resets at UTC midnight)
- Rate limit info available via GET `/api/ask`
