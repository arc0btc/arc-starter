---
name: blog-publishing
description: Create, manage, and publish blog posts with ISO8601 content pattern
tags:
  - publishing
  - blogging
  - content
---

# Blog Publishing

Manages Arc's blog (arc0.me) — creating drafts, publishing posts, scheduling content, and organizing articles with ISO8601 timestamps.

## Content Pattern

Blog posts follow this ISO8601 structure:

```
content/YYYY/YYYY-MM-DD/[post-slug]/
  ├── index.md          (post content, frontmatter with ISO8601 timestamps)
  └── [assets]/         (images, code samples, etc.)
```

Frontmatter includes ISO8601 dates:
```yaml
---
title: "Post Title"
date: 2026-02-28T15:13:31Z
updated: 2026-02-28T15:13:31Z
draft: false
tags:
  - tag1
  - tag2
---
```

## Components

| File | Purpose |
|------|---------|
| `cli.ts` | Create, publish, list, schedule posts |
| `sensor.ts` | Detect unpublished drafts, queue review tasks |
| `AGENT.md` | Subagent briefing for post creation |

## CLI

```
arc skills run --name blog-publishing -- create --title "Title" [--slug slug] [--tags tag1,tag2]
arc skills run --name blog-publishing -- draft --id <post-id>
arc skills run --name blog-publishing -- publish --id <post-id>
arc skills run --name blog-publishing -- schedule --id <post-id> --for <iso8601>
arc skills run --name blog-publishing -- list [--status draft|published|scheduled]
arc skills run --name blog-publishing -- show --id <post-id>
arc skills run --name blog-publishing -- delete --id <post-id>
```

## Workflow

1. **Create**: `create --title "Post Title"` generates a draft post with ISO8601 timestamp
2. **Edit**: Open post in `content/YYYY/YYYY-MM-DD/[slug]/index.md`
3. **Review**: `show --id <post-id>` to preview
4. **Publish**: `publish --id <post-id>` sets `draft: false` and commits
5. **Schedule**: `schedule --id <post-id> --for 2026-03-01T09:00:00Z` for future publication

## Storage

Posts are stored in the local git repository (`github/arc0btc/arc0me-site/content/`). Each post is tracked by:
- `post_id`: Unique identifier (YYYY-MM-DD-slug)
- `path`: Relative path to index.md
- `status`: draft, published, or scheduled
- `published_at`: ISO8601 timestamp (null if draft)

## Sensor Behavior

- Cadence: 60 minutes
- Scans for unpublished drafts
- Queues review task for oldest draft (priority 6, skills: `["blog-publishing"]`)
- Checks scheduled posts for publish-ready status (ISO8601 now >= scheduled_for)
