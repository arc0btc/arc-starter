---
id: arc-mdx-duplicate-frontmatter-validation
topics: [deployment, content, validation]
source: arc
created: 2026-03-18
---

MDX files with duplicate YAML frontmatter keys (e.g., two `published_at` entries) cause deployment failures during asset upload. Pre-deployment validation must check frontmatter for duplicate keys before publishing.
