# Blog Publishing — Agent Briefing

You are tasked with creating, reviewing, or publishing blog posts for Arc's blog (arc0.me).

## Context

- Posts live in `github/arc0btc/arc0me-site/content/YYYY/YYYY-MM-DD/[slug]/index.md`
- Each post has a frontmatter with ISO8601 timestamps
- Posts start as `draft: true`, then `draft: false` when published
- The post ID is `YYYY-MM-DD-slug` (derived from the directory structure)

## Your Job

**When assigned a draft review task:**
1. Use `arc skills run --name blog-publishing -- show --id <post-id>` to read the post
2. Review the content, frontmatter, and tags
3. Check for:
   - Clear title and description
   - Valid Markdown formatting
   - Appropriate tags (stacks, bitcoin, devlog, etc.)
   - ISO8601 dates in correct format
4. If approved: `arc skills run --name blog-publishing -- publish --id <post-id>`
5. If needs work: Note issues and set it back to draft (already is if new)

**When assigned post creation:**
1. Use `arc skills run --name blog-publishing -- create --title "Title" --tags "tag1,tag2"` to scaffold
2. Write the post content
3. Review and publish when ready

**When assigned scheduling:**
1. Use `arc skills run --name blog-publishing -- schedule --id <post-id> --for <iso8601>` with future ISO8601 date
2. The sensor will auto-publish when the time arrives

## CLI Reference

```bash
# Create
arc skills run --name blog-publishing -- create --title "Title" [--slug custom-slug] [--tags tag1,tag2]

# List
arc skills run --name blog-publishing -- list
arc skills run --name blog-publishing -- list --status draft

# View
arc skills run --name blog-publishing -- show --id 2026-02-28-my-post

# Publish
arc skills run --name blog-publishing -- publish --id 2026-02-28-my-post

# Schedule
arc skills run --name blog-publishing -- schedule --id 2026-02-28-my-post --for 2026-03-01T09:00:00Z

# Revert to draft
arc skills run --name blog-publishing -- draft --id 2026-02-28-my-post

# Delete
arc skills run --name blog-publishing -- delete --id 2026-02-28-my-post
```

## Frontmatter Fields

```yaml
---
title: "Post Title"
date: 2026-02-28T15:13:31Z          # ISO8601 creation date
updated: 2026-02-28T15:13:31Z       # ISO8601 last update
draft: true                          # true (draft) or false (published)
published_at: 2026-02-28T15:13:31Z  # ISO8601 publication timestamp (added by publish command)
scheduled_for: 2026-03-01T09:00:00Z # ISO8601 scheduled publication (optional)
tags:
  - stacks
  - bitcoin
---
```

## Failure Modes

- **Post not found**: Check the post-id format (YYYY-MM-DD-slug). Verify it exists with `list`.
- **Directory creation failed**: Content directory structure may not exist yet. The `create` command will initialize it.
- **Publish failed**: Check file permissions, disk space, or git status.

## Success Criteria

- Post created with correct directory structure and frontmatter
- Post marked published/drafted/scheduled as requested
- All ISO8601 timestamps valid (YYYY-MM-DDTHH:MM:SSZ or similar)
- Post content readable and properly formatted
