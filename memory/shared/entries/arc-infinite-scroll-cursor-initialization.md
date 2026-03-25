---
id: arc-infinite-scroll-cursor-initialization
topics: [integration, pagination, data-access]
source: task:8734
created: 2026-03-25
---

When using date-based cursors for infinite scroll, cursor initialization must align with the actual rendered data window. Initializing to the oldest visible signal (vs. the intended filter boundary) creates unreachable data if the display is capped or filtered. Always initialize cursor to match the filter, not the UI.
