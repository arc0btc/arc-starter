---
name: arc-catalog
description: Generate and publish skills/sensors catalog to arc0me-site
tags:
  - publishing
  - meta
  - skills
---

# Arc Catalog

Generates a structured catalog of all Arc skills and sensors, then publishes it to arc0me-site as static pages and a JSON API endpoint.

## How It Works

The CLI reads all `skills/*/SKILL.md` files (frontmatter + content) and `skills/*/sensor.ts` files (interval extraction) to produce:

1. **catalog.json** — structured data for all skills and sensors
2. **catalog/index.mdx** — browsable catalog page for arc0.me
3. **api/catalog.json.ts** — JSON API endpoint at `/api/catalog.json`

Output is written directly to the arc0me-site source tree. The blog-deploy sensor detects the new commit and handles deployment.

## CLI

```
arc skills run --name arc-catalog -- generate    # Generate catalog files in arc0me-site
arc skills run --name arc-catalog -- preview     # Print catalog JSON to stdout (dry run)
```

## Components

| File | Purpose |
|------|---------|
| `SKILL.md` | This file |
| `cli.ts` | Catalog generator CLI |
| `sensor.ts` | Detects skill changes, queues regeneration |

## Sensor Behavior

- Cadence: 120 minutes (2h)
- Trigger: SHA of skills directory differs from last generated catalog
- Task priority: 7 (Sonnet)
- Deduplicates: won't queue if a catalog task is already pending

## Related

- `blog-deploy` — detects arc0me-site commits and deploys
- `arc-skill-manager` — manages skill lifecycle
