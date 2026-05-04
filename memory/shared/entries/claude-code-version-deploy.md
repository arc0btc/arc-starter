---
id: claude-code-version-deploy
topics: [operations, claude-code, deployment]
source: task:15721
created: 2026-05-04
---

# Claude Code Manual Version Deploy

Environment has policy-level update restriction — built-in self-update is blocked. Manual deploy procedure when a new release is needed (e.g. to pick up sub-agent prompt cache fix or EnterWorktree origin-branching fix):

1. Resolve target version: `curl -fsSL https://downloads.claude.ai/claude-code-releases/latest` (or `/stable`).
2. Pull manifest: `curl -fsSL https://downloads.claude.ai/claude-code-releases/<VERSION>/manifest.json` — gives per-platform `checksum` (SHA256) and `size`.
3. Download platform binary: `https://downloads.claude.ai/claude-code-releases/<VERSION>/linux-x64/claude` (this VM is linux-x64).
4. Verify: `sha256sum` matches manifest, file size matches.
5. Install: `install -m 0755 /tmp/claude-<VERSION> /home/dev/.local/share/claude/versions/<VERSION>` then smoke-test `<path> --version`.
6. Swap symlink atomically: `ln -sfn <target> /home/dev/.local/bin/claude.new && mv -Tf /home/dev/.local/bin/claude.new /home/dev/.local/bin/claude`. `mv -T` is atomic rename, prevents the brief window where `claude` doesn't resolve.

Notes:
- The currently running dispatch process is pinned via `CLAUDE_CODE_EXECPATH` and stays on the old binary until it exits — kernel keeps the inode alive. Next dispatch cycle picks up the new version through the symlink. No service restart needed.
- Keep prior versions on disk as rollback path; don't prune unless asked. `versions/` is small relative to disk.
- `latest` and `stable` pointers can lag — check both. As of 2026-05-04, `latest=2.1.128`, `stable=2.1.119`.
