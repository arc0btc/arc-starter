# Claude Code Release — Applicability Research Briefing

Two-phase research process: Phase 1 (Haiku) does relevance triage; Phase 2 (Sonnet) does deep analysis.

## Phase 1: Haiku Triage

**Model:** Haiku  
**Input:** Task description (tag, date, URL, 500-char preview of release notes)  
**Decision:** Is this release relevant to Arc, AIBTC, or agent architecture?

### Triage Questions

1. **Arc impact**: Does it mention flags, config, context controls, breaking changes, or dispatch parameters?
2. **AIBTC skill impact**: Does it affect MCP, tool-use, or agent-to-agent patterns?
3. **Release quality**: Is it a major feature release, or just bug fixes/minor updates?

### Triage Actions

**If RELEVANT** (any of: breaking change, new flags, architecture shift, tool-use changes):
```bash
arc tasks add --subject "Deep research: anthropics/claude-code {tag}" \
  --priority 5 --model sonnet --skills claude-code-releases \
  --source "task:{current-task-id}" \
  --description "Full research task. Fetch release notes and assess Arc/AIBTC/agent-general applicability. Write report to research/claude-code-releases/{tag}.md"
```
Then close this task:
```bash
arc tasks close --id {task-id} --status completed --summary "Triage: relevant release, escalated to Phase 2 sonnet research"
```

**If NOT RELEVANT** (minor bug fixes, docs, non-agent tooling):
```bash
arc tasks close --id {task-id} --status completed --summary "Triage: not relevant to Arc. Release notes: {brief 1-line summary}"
```

---

## Phase 2: Sonnet Deep Analysis

**Model:** Sonnet  
**Input:** Task description includes the tag/URL; haiku has already filtered for relevance  
**Deliverable:** Full research report

### Workflow

#### 1. Read the full release notes

Fetch the full changelog at the URL. Use one of:

```bash
gh release view {tag} --repo anthropics/claude-code --json body,tagName,name,publishedAt
```

Or the arc-link-research skill for direct URL fetch.

#### 2. Write the research report

**File:** `research/claude-code-releases/{tag}.md`

**Structure:**

```markdown
# Claude Code {tag} — Applicability Assessment

*Published: {date}*
*URL: {url}*
*Assessed: {today}*

## Arc Lens

Does this release affect Arc's dispatch configuration or behavior?

- New flags, model options, or config changes?
- Context controls, tool permissions, hook behavior?
- Cost/token tracking improvements?
- Breaking changes to dispatch subprocess invocation?
- Changes to `--model`, `--max-tokens`, or other dispatch parameters?

[Write concrete findings. If nothing changes for Arc, say so explicitly.]

## AIBTC Lens

Relevance for AIBTC ecosystem builders?

- Changes for skill authors building on arc-starter?
- Agent-to-agent patterns, MCP integration, or tool-use changes?
- Anything the aibtcdev/skills team should know?

[Write concrete findings. If nothing relevant, say so.]

## Agent-General Lens

What does this signal about Claude Code's trajectory as an agent runtime?

- Architectural direction (autonomy, new primitives)?
- Patterns other agents should adopt or avoid?
- Notable direction shifts in how Anthropic is evolving the tool?

[Directional observations, not just changelog summary.]

## Like / Dislike

**Like:**
- [What's genuinely good]

**Dislike / Concern:**
- [What's a concern, regression, or worth watching]

**Non-issue:**
- [What sounds significant but isn't for our use case]

## Follow-Up Tasks

[List created with `arc tasks add`. State if none needed.]
```

#### 3. Create follow-up tasks

For findings that require action:

```bash
arc tasks add --subject "{action}" --priority {n} --skills {relevant-skill} --source "task:{phase2-id}"
```

Priority guide:
- P3 (Opus): breaking change or major architecture decision
- P6 (Sonnet): configuration update, moderate change
- P8 (Haiku): doc update, minor tweak

#### 4. Commit and close

```bash
git add research/claude-code-releases/{tag}.md
git commit -m "feat(claude-code-releases): applicability report for {tag}"
arc tasks close --id {task-id} --status completed --summary "Research report: research/claude-code-releases/{tag}.md — {N} follow-up tasks created"
```

## Quality Standards

- Be direct about what applies and what doesn't — "nothing changes for Arc" is valid
- Do not fabricate features; stick to what the release notes say
- The like/dislike section should reflect genuine editorial judgment
- If Phase 2 finds no relevance after all, write a short report and close normally
