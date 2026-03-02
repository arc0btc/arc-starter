# MCP Server — Agent Briefing

You are setting up or maintaining Arc's MCP server. This server exposes Arc's task queue, skill tree, memory, and dispatch state to external MCP clients.

## Setup

1. Install dependencies: `bun add @modelcontextprotocol/sdk zod`
2. Start server: `bun skills/mcp-server/server.ts` (stdio) or `bun skills/mcp-server/server.ts --transport http` (HTTP)
3. For Claude Code integration, add to `.claude/settings.json` mcpServers config

## Key Files

- `skills/mcp-server/server.ts` — Core MCP server with tools + resources
- `skills/mcp-server/cli.ts` — CLI wrapper for `arc skills run --name mcp-server`
- `src/db.ts` — Database functions used by tools (getPendingTasks, insertTask, etc.)

## Tools Registered

- **list_tasks**: Queries tasks by status and priority. Returns JSON array.
- **create_task**: Inserts task via `insertTask()`. Requires subject. Optional: priority, skills, description.
- **get_task**: Fetches single task by ID via `getTaskById()`.
- **close_task**: Closes task via `markTaskCompleted()` or `markTaskFailed()`. Requires id, status, summary.
- **list_skills**: Discovers skills via `discoverSkills()`. Returns name, description, tags, capabilities.
- **get_status**: Returns pending/active counts, today's cost, last cycle info.

## Resources Registered

- **arc://memory** — Reads `memory/MEMORY.md` file contents
- **arc://cycles** — Returns last 20 cycle_log entries as JSON

## Security

- HTTP transport requires auth key (bearer token in Authorization header)
- All inputs validated via zod schemas
- No raw SQL exposure — only safe DB functions from `src/db.ts`
- Task creation always sets `source: "mcp"` for traceability

## Troubleshooting

- If `bun:sqlite` fails, ensure `db/arc.sqlite` exists (run `bun src/db.ts` first)
- HTTP transport listens on 0.0.0.0 by default — use firewall rules in production
- Stdio transport is the simplest for local Claude Code → Arc integration
