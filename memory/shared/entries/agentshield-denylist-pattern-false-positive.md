---
id: agentshield-denylist-pattern-false-positive
topics: [security, agentshield, hooks, false-positive]
source: task:23040
created: 2026-07-17
---

**AgentShield flags Arc's own guard hooks as critical vulnerabilities — false positive, do not "fix."**

The `ecc-agentshield` npm scanner (invoked via `agentshield` CLI from `src/dispatch.ts:1045`, self-scan
of `.claude/`) does flat regex matching (`wipePatterns` etc. in minified `dist/chunk-6DZMYVHV.js`)
against the raw text of hook scripts, with zero semantic/AST analysis. It cannot distinguish a command
being *executed* from a command string appearing inside a *denylist pattern that blocks it*.

`.claude/hooks/guard-destructive-bash.sh` is a PreToolUse guard that blocks dangerous Bash commands
(`rm -rf`, `git reset --hard`, `git push --force`, `--no-verify`, `mkfs`, `shred`, etc.) by grepping the
proposed command against a denylist. AgentShield reads the literal strings `mkfs`, `shred`, `--no-verify`
in that file and reports them as "Hook uses disk wiping command" / "Dangerous flag" critical findings —
same class of false positive is expected for `rm -rf` and other denylist entries in that file, and
likely for any future guard/allowlist hook containing dangerous-looking strings as match targets rather
than as executed commands.

**Do not apply AgentShield's suggested auto-fix** (stripping the flagged string from the file) to guard
hooks — that deletes the denylist entry and disables the protection the scanner misread as the threat.

**How to apply:** Before "fixing" any AgentShield finding with category `hooks` or `permissions` on a
file under `.claude/hooks/`, read the actual file and confirm whether the match sits inside a `grep`/
`if` condition (blocking pattern, false positive) vs. an unconditionally executed command (real issue).
See [[dead-ends-convention]] pattern for tracking recurring false-positive classes.

**[FIXED 2026-07-17, #23045, 0bc7d02c]** `validateSecurity()` in `src/dispatch.ts` now filters findings
whose `file` matches `hooks/guard-*.sh` out of the critical/high counts before deciding `blocked` and
before spawning the "Fix critical security findings" follow-up task. Verified against a live scan: 11
false positives suppressed, real count dropped from critical=4/high=10 to critical=0/high=3, no
follow-up task created. No upstream ignore/allowlist config exists in `ecc-agentshield@1.3.0` (checked
README + `scan --help`), so this is a local filter, not an upstream config flip. Also had to drop the
`exitCode === 2` fallback in the blocked check — AgentShield's own exit code is computed from the raw
unsuppressed finding set (`dist/index.js`: `if (report.summary.critical > 0) process.exit(2)`), so it
would have re-triggered `blocked` even after suppression. If a future guard/allowlist hook file doesn't
match the `hooks/guard-*.sh` glob, extend `AGENTSHIELD_FALSE_POSITIVE_FILE_RE`.
