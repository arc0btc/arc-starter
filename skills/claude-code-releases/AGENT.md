# Claude Code Release — Applicability Research Briefing

You are assessing a new Claude Code release for its applicability to Arc, AIBTC, and agents in general.

## Inputs

The task description contains:
- Release tag and name
- Published date
- Release URL (full changelog)
- Release notes preview

## Workflow

### 1. Read the full release notes

Fetch the full changelog at the URL provided in the task description. Do not rely solely on the truncated preview.

```bash
gh release view {tag} --repo anthropics/claude-code --json body,tagName,name,publishedAt
```

Or read the URL directly with `arc skills run --name arc-link-research -- fetch --url {url}` if the gh CLI doesn't cover it.

### 2. Write the research report

Create `research/claude-code-releases/` directory if it doesn't exist, then write the report:

**File:** `research/claude-code-releases/{tag}.md`

**Structure:**

```markdown
# Claude Code {tag} — Applicability Assessment

*Published: {date}*
*URL: {url}*
*Assessed: {today}*

## Arc Lens

How does this release affect Arc's dispatch configuration or behavior?

- New flags, model options, or config changes Arc should adopt?
- Context controls, tool permissions, hook behavior changes?
- Cost/token tracking improvements?
- Breaking changes to dispatch subprocess invocation?
- Changes to the `--model` flag, `--max-tokens`, or other dispatch parameters?

[Write concrete findings. If nothing changes for Arc, say so explicitly.]

## AIBTC Lens

How does this matter for AIBTC ecosystem builders?

- Changes relevant to skill authors building on arc-starter?
- Agent-to-agent patterns, MCP integration, or tool-use changes?
- Anything the aibtcdev/skills team should know?

[Write concrete findings. If nothing relevant, say so.]

## Agent-General Lens

What does this release signal about Claude Code's trajectory as an agent runtime?

- Architectural direction (more/less agent autonomy, new primitives)?
- Patterns other agents should adopt or avoid based on this release?
- Anything notable about how Anthropic is evolving the tool?

[Write directional observations. This section is for signal, not just changelog summary.]

## Like / Dislike

**Like:**
- [What's genuinely good about this release]

**Dislike / Concern:**
- [What's a concern, a regression, or worth watching]

**Non-issue:**
- [What sounds significant but isn't for our use case]

## Follow-Up Tasks

[List tasks created with `arc tasks add`. If no follow-up is needed, state that explicitly.]
```

### 3. Create follow-up tasks

For each finding that requires action, create a task immediately:

```bash
arc tasks add --subject "{action}" --priority {n} --skills {relevant-skill} --source "task:{current-task-id}"
```

Priority guide:
- P3 (Opus): breaking change or major architecture decision
- P6 (Sonnet): configuration update, moderate change
- P8 (Haiku): doc update, minor flag tweak

### 4. Commit and close

```bash
git add research/claude-code-releases/{tag}.md
git commit -m "feat(claude-code-releases): applicability report for {tag}"
arc tasks close --id {task-id} --status completed --summary "Research report written: research/claude-code-releases/{tag}.md — {N} follow-up tasks created"
```

## Quality Standards

- Read the full release notes, not just the preview
- Be direct about what applies and what doesn't — "nothing changes for Arc" is a valid finding
- Do not fabricate features or speculate beyond the release notes
- The like/dislike section should reflect genuine editorial judgment, not marketing summary
- If the release has no relevance to Arc/AIBTC/agents, write a short report saying so and close normally
