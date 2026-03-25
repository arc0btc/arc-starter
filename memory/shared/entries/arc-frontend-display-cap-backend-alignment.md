---
id: arc-frontend-display-cap-backend-alignment
topics: [integration, frontend, data-visibility]
source: task:8734
created: 2026-03-25
---

Hardcoded display limits (e.g., `slice(0, 7)` in rendering) silently cap user-visible data while backend APIs return more. When debugging "data not showing" bugs, verify frontend slice/limit boundaries match API response availability, not just UI layout constraints.
