---
id: claude-code-skill-patterns
topics: [claude-code, skills, dispatch, permissions, cost, context]
source: research/claude-code-releases/ (v2.1.108–v2.1.121)
created: 2026-04-28
---

# Claude Code Best Practices for Arc Skill Authors

Patterns distilled from release assessments v2.1.108–v2.1.121. Three categories: permissions, context, cost.

---

## 1. Tool Permission Configurations

**`alwaysLoad: true` for trusted MCP servers** (v2.1.121)
In `.claude/settings.json` or MCP server config, set `alwaysLoad: true` on servers whose tools are unconditionally needed. This skips ToolSearch deferral entirely — tools are always in the active set without a search step. Use for `aibtc-mcp-server` and `arc-mcp` where every dispatch session needs those tools.

```json
{
  "mcpServers": {
    "aibtc-mcp": { "command": "...", "alwaysLoad": true }
  }
}
```

**`disallowedTools` in agent frontmatter is reliable in headless mode** (v2.1.119)
Previously `--print` mode did not enforce `disallowedTools`. Now it does. Skill authors can declare tool restrictions in agent frontmatter once and trust them in both interactive and dispatch contexts. No workaround needed.

**Extend defaults with `"$defaults"` in autoMode** (v2.1.118)
Custom `autoMode.allow` rules previously replaced the built-in list. Now `"$defaults"` expands to the built-in list. Always include `"$defaults"` when adding custom rules, or you silently narrow permissions:

```json
{
  "autoMode": {
    "allow": ["$defaults", "Bash(my-custom-command:*)"]
  }
}
```

**`type: "mcp_tool"` hooks for event-driven MCP calls** (v2.1.118)
Hooks can now call MCP tools directly instead of spawning a subprocess. For skills that hook into `Stop` or `PostToolUse` to call beat editor or arc-mcp tools, replace shell wrappers with `type: "mcp_tool"` entries. Reduces latency and removes subprocess dependency.

**`--dangerously-skip-permissions` fully suppresses skill/agent/command write prompts** (v2.1.121)
Writes to `.claude/skills/`, `.claude/agents/`, `.claude/commands/` no longer prompt even in `--dangerously-skip-permissions` mode. Dispatch cannot hang on these operations. No skill code change needed.

---

## 2. Context Management for Large Skill Trees

**Stack both prompt-caching levers** (v2.1.108 + v2.1.98, confirmed live)
- `ENABLE_PROMPT_CACHING_1H=1` — 1-hour cache TTL; cached tokens cost ~85% less than input tokens. Eliminates cache misses between dispatch cycles fired within an hour. 20–40% cost reduction.
- `--exclude-dynamic-system-prompt-sections` — removes dynamic sections (timestamps, session IDs) that bust the cache. 20–30% additional reduction.
Combined effect: 40–50% total input cost reduction. Both are live in Arc's dispatch config as of 2026-04-25.

**Keep SKILL.md files lean; put execution detail in AGENT.md**
SKILL.md is loaded into the orchestrator's context for every task that lists the skill. AGENT.md is passed only to subagents. Orchestrator context is capped at 40–50k tokens across all loaded skills. Skill authors should put architecture, CLI syntax, and composability notes in SKILL.md; put step-by-step execution instructions in AGENT.md.

**MCP startup doesn't block context loading** (v2.1.116)
`resources/templates/list` is deferred until first `@`-mention. Multiple MCP servers now connect in parallel (v2.1.119). Skills with MCP dependencies do not add proportional cold-start latency as MCP server count grows.

**Bash tool timeout is hard-capped at 120,000ms** (v2.1.110)
Values above 2 minutes are silently clamped. Skills with long-running shell operations (blockchain RPC, file processing, build scripts) must decompose into shorter steps or use script dispatch instead of extending the timeout.

---

## 3. Cost-Efficient Dispatch Configurations

**Script dispatch for subprocess-heavy skills** (validated 2026-04-23, commit 90df07f6)
Skills that run build tools (npm, wrangler) or deploy pipelines should use `model: "script"` dispatch, not LLM models. Eliminates LLM overhead entirely and prevents OOM (opus + subprocesses = multi-GB RSS). Pattern: any skill where the task is "run a command and check the exit code" is a script dispatch candidate.

**Model selection is independent of priority**
- `haiku` — simple reads, classification, single-file edits with no staged `.ts` files
- `sonnet` — composition, signal filing, any task with >2 staged `.ts` files, multi-step CLI workflows
- `opus` — deep analysis, architecture decisions, complex multi-file refactors
- **Signal-filing tasks must be sonnet**: haiku times out before `aibtc-news-editorial` can compose. Any task with subject matching "File *-signal:*" or "File *-beat signal:*" → sonnet.

**`DISABLE_UPDATES=1` in systemd unit** (v2.1.118)
Prevents the claude-code binary from auto-updating between dispatch cycles. Binary drift mid-service can silently change dispatch behavior. Add to the dispatch unit's `Environment=` section. Stricter than `DISABLE_AUTOUPDATER` (which could be bypassed by `claude update`).

**Check `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`** (v2.1.110)
If this env var is set without intending to, the pre-fix auto-title bug was firing an extra haiku request per dispatch cycle. Fixed in v2.1.110, but verify the env state. This plus prompt-caching misconfiguration are the two most common silent cost drains.

---

## 4. Operational Reliability Patterns

**PostToolUse hooks now cover all tools** (v2.1.121)
`updatedToolOutput` previously worked only for MCP tools. Now works for Bash, Read, Write, Edit, Glob, Grep. Skill authors can write output-transforming hooks for any tool — useful for sanitizing credentials from Bash output or logging file operation sizes.

**`duration_ms` in PostToolUse hook inputs** (v2.1.119)
Hook inputs now include `duration_ms` for the tool call that triggered the hook. Enables detecting slow tool calls (e.g., alert if a Bash RPC call takes >30s). Building block for dispatch-level performance monitoring.

**`${ENV_VAR}` in MCP server headers now works** (v2.1.119)
MCP server configs that use env var placeholders in HTTP headers for auth were silently failing before. Now resolved. Verify any MCP server with `Authorization: Bearer ${API_KEY}` style headers is actually authenticating.

**stdio MCP servers with stdout logging are stable** (v2.1.110)
A regression in v2.1.105 disconnected stdio MCP servers on first non-JSON stdout line. Fixed in v2.1.110. Skills implementing MCP servers with any logging to stdout can rely on stable behavior.

**Worktree isolation is semantically correct** (v2.1.119)
Stale worktree reuse across sessions is fixed. Skills using `isolation: "worktree"` (via the Agent tool) get clean isolation across task boundaries. The arc-worktrees skill is on a sound foundation.

**Memory leak fixes relevant to long dispatch cycles** (v2.1.121)
Three multi-GB memory leak classes fixed: image tool calls, large transcript history scans, and long-running tools with slow progress events. Dispatch cycles running >15 minutes benefit most. Upgrade from any pre-v2.1.121 version.
