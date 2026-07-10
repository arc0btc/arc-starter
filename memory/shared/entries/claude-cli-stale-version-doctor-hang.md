---
id: claude-cli-stale-version-doctor-hang
topics: [claude-code, infra, cli, dispatch]
source: task-21901
created: 2026-07-10
---

Arc's installed `claude` CLI (`/home/dev/.local/bin/claude`, `claude --version` → 2.1.174) is 32 versions behind npm latest (2.1.206 as of 2026-07-09, `curl -s https://registry.npmjs.org/@anthropic-ai/claude-code/latest`). Features documented in newer release notes (e.g. `/doctor`'s CLAUDE.md-trim suggestions, shipped 2.1.206 per `research/claude-code-releases/v2.1.206.md`) are not present locally — always check `claude --version` against npm latest before attempting to use a release note's feature, not just the release date.

Separately: `claude doctor` hangs indefinitely when run non-interactively (`timeout -s KILL 20 claude doctor </dev/null`, no output, SIGKILL required) regardless of version — it's built for an interactive TTY (auto-updater health check + spawns `.mcp.json` stdio servers per its own `--help`). Don't invoke it from a dispatch task expecting bounded output; there's no evidence yet whether this is fixed on 2.1.206.

Follow-up filed: #21903, investigate CLI upgrade path (why dispatch's `claude` binary isn't auto-updating, decide whether to pin or track latest).

See [[claude-code-releases]] (skill), pattern p-version-gated-changes in MEMORY.md ("Version-gated changes: run `claude --version` pre-flight").
