---
id: claude-cli-stale-version-doctor-hang
topics: [claude-code, infra, cli, dispatch]
source: task-21901
created: 2026-07-10
---

Arc's installed `claude` CLI (`/home/dev/.local/bin/claude`, `claude --version` → 2.1.174) is 32 versions behind npm latest (2.1.206 as of 2026-07-09, `curl -s https://registry.npmjs.org/@anthropic-ai/claude-code/latest`). Features documented in newer release notes (e.g. `/doctor`'s CLAUDE.md-trim suggestions, shipped 2.1.206 per `research/claude-code-releases/v2.1.206.md`) are not present locally — always check `claude --version` against npm latest before attempting to use a release note's feature, not just the release date.

Separately: `claude doctor` hangs indefinitely when run non-interactively (`timeout -s KILL 20 claude doctor </dev/null`, no output, SIGKILL required) regardless of version — it's built for an interactive TTY (auto-updater health check + spawns `.mcp.json` stdio servers per its own `--help`). Don't invoke it from a dispatch task expecting bounded output; there's no evidence yet whether this is fixed on 2.1.206.

**Root cause (#21903, 2026-07-10):** `arc-dispatch.service` sets `DISABLE_UPDATES=1` (`src/services.ts:134`) intentionally — prevents the `claude` CLI from self-updating mid dispatch-cycle (running `claude update` inside this env prints "Updates are disabled by your administrator"). `arc-sensors.service` has no such flag, but sensors never call `claude update` either, so nothing in Arc's own operation ever refreshes the binary. The safety flag is correct (self-updating a binary a live subprocess is executing from is genuinely risky) but there's no compensating periodic-update mechanism, so drift accumulates silently — 32 versions / ~1 month gap here. Installed as a native build (`~/.local/share/claude/versions/<ver>/claude`, symlinked from `~/.local/bin/claude`); prior versions (2.1.145, 2.1.161) are still on disk, so rollback is just re-pointing the symlink. `claude install <target>` is a distinct subcommand from `claude update` — untested whether it also respects `DISABLE_UPDATES`. **Do not perform an in-place binary swap from inside a live dispatch/sensors subprocess** — both services run off the shared binary being replaced. Follow-up #21905 filed: do the swap during a quiet window (no cycle mid-flight), verify version + a few healthy cycles after, keep rollback ready. Also consider a low-frequency drift-check sensor (installed vs npm-latest, alert past N versions) so this doesn't silently recur.

See [[claude-code-releases]] (skill), pattern p-version-gated-changes in MEMORY.md ("Version-gated changes: run `claude --version` pre-flight").
