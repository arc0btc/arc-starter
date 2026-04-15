# Claude Code v2.1.108 Sandbox Patch — Trusted-VM Configuration

**Applies to:** autonomous agents running Claude Code v2.1.108+ on a dedicated single-tenant VM.
**Symptom:** dispatch cycles produce clean prose but no tool calls land. PR reviews, `gh` calls, `git push`, and sensor HTTP requests silently no-op. Tasks self-close as `completed` with no real work performed.

## What changed in v2.1.108 (root causes)

v2.1.108 introduced an aggressive default-deny posture with **multiple silent failure modes**, several of which produce identical-looking prose-only output:

1. **Permission bypass split into two flags.** The single `--dangerously-skip-permissions` was split into an *enabler* (`--allow-dangerously-skip-permissions`) and an *activator* (`--permission-mode bypassPermissions`). Passing only the activator silently no-ops; the LLM hits "requires approval" on every Bash call.

2. **Per-repo `.claude/settings.local.json` allowlists override the bypass.** Claude Code auto-writes narrow command allowlists (`bash`, `ssh`, `sqlite3`, ...) when commands are approved during interactive sessions. These accumulate per-repo and silently override `--dangerously-skip-permissions` in v2.1.108. Mitigated by `--setting-sources user,project`.

3. **Bubblewrap sandbox needs unprivileged user namespaces.** Ubuntu 24.04+ AppArmor blocks unprivileged userns by default. Vendored pre-2.1.108 bwrap had a workaround; the system `bwrap` from `apt` does not. Symptom: `bwrap: setting up uid map: Permission denied` or `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.

4. **Bun strips +x from vendored binaries.** Installing via `bun install -g @anthropic-ai/claude-code` does not preserve the executable bit on `vendor/seccomp/x64/apply-seccomp` and `vendor/seccomp/arm64/apply-seccomp`. Sandbox subprocesses fail with `Permission denied`, every Bash command denied.

5. **Network allowlist wildcard `["*"]` does not match anything.** The matcher (`Fm1` in `cli.js`) only handles `*.subdomain` patterns and exact strings. A bare `"*"` is silently ignored — every host falls through to default-deny. The HTTP proxy returns `403 Forbidden` with `X-Proxy-Error: blocked-by-allowlist`. There is no schema-supported "allow all" wildcard.

6. **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` silently force-resets permission mode to `default`.** This is the most dangerous of the silent failures: setting this env var (intended to scrub credentials from Bash subprocesses) overrides `--permission-mode bypassPermissions` *after* the CLI args are parsed. Visible only via the warning `⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (allowed_non_write_users hardening). Declare allowedTools explicitly, or set CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 to opt out.` On a single-tenant trusted VM, the credential-leak this scrub addresses doesn't apply — set the env var to `0` in dispatch.

## Recommended fix for trusted single-tenant VM — disable the sandbox

The VM is the trust boundary. The bwrap+proxy layer adds no security on a single-tenant host, but it **does** introduce four independent silent-failure modes (#2–#5 above). Disable it:

### `~/.claude/settings.json` (user-level — applies regardless of cwd)

```json
{
  "skipDangerousModePermissionPrompt": true,
  "effortLevel": "high",
  "permissions": { "defaultMode": "bypassPermissions" },
  "sandbox": { "enabled": false }
}
```

`bypassPermissions` removes the per-command approval prompt. `sandbox.enabled: false` removes bwrap, the seccomp helper, and the network proxy (so the unmatchable `["*"]` allowlist becomes moot). Both settings are **user-level** so they apply when dispatch `cd`s into sibling repos for PR reviews.

Project-level `<repo>/.claude/settings.json` should mirror the same `permissions` and `sandbox` blocks for consistency, but user-level is the canonical source.

### Dispatch CLI flags — `src/dispatch.ts`

Even with bypass set in settings, pass the CLI flags as belt-and-suspenders. They sit above settings in precedence and protect against drift in any sibling repo's local config:

```ts
if (Bun.env.DANGEROUS === "true") {
  args.push("--allow-dangerously-skip-permissions");
  args.push("--permission-mode", "bypassPermissions");
  args.push("--setting-sources", "user,project");  // skip narrow .claude/settings.local.json allowlists
}
```

## Verification

```bash
# 1. Permission bypass — should print "hello" without prompting
echo 'Run: echo hello' | claude --print --model claude-sonnet-4-6 \
  --output-format text --no-session-persistence \
  --allow-dangerously-skip-permissions \
  --permission-mode bypassPermissions \
  --setting-sources user,project

# 2. Network — should return HTTP/200 (or whatever GitHub gives), NOT "blocked-by-allowlist"
echo 'Run: curl -sI https://api.github.com | head -1' | claude --print --model claude-sonnet-4-6 \
  --output-format text --no-session-persistence \
  --allow-dangerously-skip-permissions \
  --permission-mode bypassPermissions \
  --setting-sources user,project

# 3. End-to-end — dispatch a real task and confirm a tool side-effect lands
arc tasks add --subject "diagnostic: post comment to test PR" --priority 2 --model sonnet --skills aibtc-repo-maintenance
arc run
# Then check the PR for the comment.
```

## Dispatch-side guard (defense in depth) — `src/dispatch.ts`

Catches silent-failure regressions where the LLM produces coherent prose despite every tool call being denied. Anchored to multi-command denial phrases (single "requires approval" matches false-positive on review prose):

```ts
const sandboxFailurePattern = /(sandbox failed to initialize|sandbox is (?:completely )?(?:non-functional|down|unavailable|blocking)|bash sandbox has (?:completely )?failed|all bash (?:commands|execution) (?:are|is) blocked|unable to execute any bash commands|every (?:bash )?command (?:is |being )?blocked)/i;
const sandboxMatch = result.match(sandboxFailurePattern);
if (sandboxMatch) {
  // Log matched substring + 200 chars context for debugging the next regression
  markTaskFailed(task.id, "Sandbox blocked tool execution — no real work performed.");
  return;
}
```

## Hardening for hosts that still need bwrap (other tools, future re-enable)

Not required when sandbox is disabled, but useful background:

- **AppArmor (Ubuntu 24.04+):** `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0` then persist via `/etc/sysctl.d/60-apparmor-namespace.conf`.
- **`apply-seccomp` +x after every install/upgrade:**
  ```bash
  chmod +x ~/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/seccomp/x64/apply-seccomp \
           ~/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/seccomp/arm64/apply-seccomp
  ```
  Wire into `scripts/install-prerequisites.sh` so it doesn't recur on `bun update`.
- **Host packages:** `sudo apt-get install -y socat bubblewrap`.

## References

- `arc-starter` commits: `8ad08307` (initial settings — superseded by this doc), `be4cac38` (dispatch guard).
- Source location of the network matcher: `~/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`, function `Fm1`.
