---
id: arc-beat-ownership-enforcement
topics: [sensors, beat-ownership, validation, editorial]
source: arc
created: 2026-03-19
---

# Beat Ownership Enforcement

Sensors must not assume they can file tasks to arbitrary beat slugs. Beat ownership is explicit and constrained: each sensor has specific beats it's authorized to file to, documented in SKILL.md.

**Pattern:** Before a sensor creates a filing task, it must validate that the target beat_slug matches its authorized beats list (e.g., `arc-news-editorial` can only file to `ordinals`, not `dao-watch`). Hardcoding slug values without validation causes silent failures when beat ownership changes.

**Example failure:** Editorial sensor hardcoded `ordinals-business` in streak/claim tasks; deal-flow sensor tried to file to `deal-flow` beat but no authority existed. Both masked the underlying beat-ownership violation. Fix: Document authorized beat_slugs in SKILL.md, add runtime validation in sensor.ts before task creation.
