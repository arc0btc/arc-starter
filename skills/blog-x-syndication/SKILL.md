---
name: blog-x-syndication
description: Automatically syndicate arc0.me blog posts to @arc0btc on X after publish
updated: 2026-03-16
tags:
  - publishing
  - social
  - x
  - blogging
---

# Blog X Syndication

After a blog post is published on arc0.me, automatically post a highlight to @arc0btc on X. The post explains *why* the content matters — not just title + link. Professional tone, genuine insight, no spam patterns.

## Components

| File | Purpose |
|------|---------|
| `sensor.ts` | 30-min cadence — detects newly published posts not yet syndicated, queues P5 tasks |
| `cli.ts` | Manual syndication, status check, mark-syndicated |

## CLI

```
arc skills run --name blog-x-syndication -- syndicate --post-id <post-id>
arc skills run --name blog-x-syndication -- mark-syndicated --post-id <post-id> --tweet-id <tweet-id>
arc skills run --name blog-x-syndication -- status
```

## Sensor Behavior

- **Cadence:** 30 minutes
- **Detection:** Scans `github/arc0btc/arc0me-site/src/content/docs/blog/` for `.mdx` files with `draft: false`
- **Dedup:** Tracks syndicated post IDs in hook state (`db/hook-state/blog-x-syndication.json`)
- **First run bootstrap:** If no prior state, marks all existing posts as already-syndicated (prevents flooding historical content)
- **One task per post:** Creates a P5 task (Sonnet) per unsyndicated published post
- **Rate limiting:** At most one unsyndicated post queued per sensor run

## Task Execution Flow

The dispatched Sonnet agent:
1. Reads the blog post via `arc skills run --name blog-publishing -- show --id <post-id>`
2. Crafts a compelling X post (X Premium — up to 25000 chars, but keep it focused):
   - Leads with the core insight or surprising angle
   - Explains WHY it matters — not just WHAT it is
   - Ends with the post URL (https://arc0.me/blog/<slug-fragment>)
   - Arc's voice: direct, precise, genuine — no emoji unless it earns its place
3. Posts via `arc skills run --name social-x-posting -- post --text "..."`
4. Marks syndicated: `arc skills run --name blog-x-syndication -- mark-syndicated --post-id <post-id> --tweet-id <tweet-id>`

## Post URL Pattern

Blog posts live at: `https://arc0.me/blog/<YYYY-MM-DD-slug>/`

Example: post ID `2026-03-10-on-trust` → URL `https://arc0.me/blog/2026-03-10-on-trust/`

## Tweet Craft Guidelines

**Do:**
- Lead with the sharpest sentence from the post
- Name the insight explicitly: "The key finding: ..."
- Make it standalone — someone shouldn't need to click to understand the point
- Include the full URL at the end

**Don't:**
- "Check out my new post..." (generic)
- Just the title + link
- Excessive hashtags (0-1 max, only if genuinely relevant)
- "Excited to share..." (filler opener)

## When to Load

Load when: executing blog-x-syndication tasks, manually triggering syndication, or debugging why a post wasn't syndicated.
