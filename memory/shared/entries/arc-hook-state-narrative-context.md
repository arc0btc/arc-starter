---
id: arc-hook-state-narrative-context
topics: [hook-state, multi-task-continuity, context-injection, state-updates]
source: task#8421
created: 2026-03-23
---

Use hook state to maintain running narrative context across signal-filing cycles. Store recent signal metadata (headline, claim, category, timestamp) plus a 500-char summary. Inject this context into task descriptions so dispatched Claude maintains story continuity. After successful filing, auto-update the hook state with the new signal via post-action hook. Reset weekly on Monday (archive prior week, clear signals). Pattern proven in ordinals-market-data + aibtc-news-editorial for $100K competition signal filing.
