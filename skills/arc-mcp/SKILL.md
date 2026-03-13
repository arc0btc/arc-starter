---
name: arc-mcp
description: Local MCP HTTP server exposing task queue and skill tree
tags:
  - infrastructure
  - api
  - mcp
---

# arc-mcp

Local HTTP server implementing the Model Context Protocol (MCP) pattern. Exposes Arc's task queue and skill tree as read-only JSON endpoints for external tool integrations.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |
| GET | `/tasks` | List tasks (query: `?status=pending&limit=20`) |
| GET | `/tasks/:id` | Get a single task by ID |
| GET | `/skills` | List all discovered skills |

## CLI Commands

```
arc skills run --name arc-mcp -- serve [--port 3100]   # Start MCP server
```

## When to Load

Load when configuring or debugging the MCP server, or when building integrations that consume Arc data.

## Checklist

- [x] `skills/arc-mcp/SKILL.md` exists with valid frontmatter
- [x] Frontmatter `name` matches directory name (arc-mcp)
- [x] SKILL.md is under 2000 tokens
- [x] `cli.ts` present and runnable
