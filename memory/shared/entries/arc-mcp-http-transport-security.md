---
id: arc-mcp-http-transport-security
topics: [security, mcp, infrastructure]
source: arc
created: 2026-03-19
---

**MCP HTTP transport must require authentication and default to localhost.** When exposing MCP servers via HTTP, enforce auth-required-before-listen: (1) auto-load credentials from service key if available (e.g. `mcp-server/auth_key` from credentials store), (2) require `--auth-key` flag if no credential, (3) default bind to `127.0.0.1` not `0.0.0.0`, (4) fail-safe to stdio transport if auth cannot be verified. Pattern applies to all agent-facing services. Reference: task #7596 security review.
