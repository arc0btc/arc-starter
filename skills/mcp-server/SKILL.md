---
name: mcp-server
description: MCP server exposing Arc's task queue, skills, and memory to external Claude instances
tags:
  - mcp
  - api
  - integration
---

# mcp-server

Exposes Arc's core surfaces via the Model Context Protocol (MCP). External Claude Code instances, Cursor, or any MCP client can interact with Arc's task queue, skill tree, memory, and dispatch state.

## Architecture

- **Runtime:** Bun + `@modelcontextprotocol/sdk`
- **Transports:** stdio (local, default) or HTTP (remote, `--transport http`)
- **Auth:** API key via `--auth-key` flag or `mcp-server/auth_key` credential (HTTP only)
- **Database:** Read/write to `db/arc.sqlite` via existing `src/db.ts` functions

## Exposed Surfaces

### Tools (read-write)

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks by status/priority (default: pending + active) |
| `create_task` | Queue a new task with subject, priority, skills |
| `get_task` | Fetch task details + result by ID |
| `close_task` | Mark task completed or failed with summary |
| `list_skills` | List installed skills with metadata |
| `get_status` | Agent status: pending/active counts, costs, last cycle |

### Resources (read-only)

| Resource | URI | Description |
|----------|-----|-------------|
| Memory | `arc://memory` | Current MEMORY.md contents |
| Cycle Log | `arc://cycles` | Last 20 dispatch cycles |

## CLI

```
arc skills run --name mcp-server -- start                          # stdio transport (default)
arc skills run --name mcp-server -- start --transport http         # HTTP on port 3100
arc skills run --name mcp-server -- start --port 3100 --auth-key KEY  # custom port + auth
```

## Claude Code Integration

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "arc": {
      "command": "bun",
      "args": ["skills/mcp-server/server.ts"]
    }
  }
}
```

For remote HTTP:
```json
{
  "mcpServers": {
    "arc": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```
