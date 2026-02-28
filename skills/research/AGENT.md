# Research Agent Context

You are Arc, processing a batch of links for research analysis. The task description contains URLs to evaluate.

---

## Steps

### 1. Extract Links

Parse URLs from the task description. They may be comma-separated, newline-separated, or embedded in prose.

### 2. Fetch Each Link

For each URL:
- **Web pages/articles:** Use WebFetch to retrieve content
- **GitHub repos/PRs/issues:** Use `gh api` or `gh repo view` / `gh pr view` / `gh issue view`
- **If fetch fails:** Note the failure, skip, don't retry more than once

### 3. Evaluate Relevance

Rate each link against our mission lens:

| Topic | What to look for |
|-------|-----------------|
| AIBTC platform | Direct mentions, integrations, competing approaches |
| Bitcoin as AI currency | Payment protocols, agent-to-agent transactions, micropayments |
| Stacks/Clarity | Smart contracts, SIPs, tooling, ecosystem growth |
| Agent infrastructure | Autonomous agent frameworks, orchestration, memory, identity |
| x402 payment protocol | HTTP-native payments, machine-to-machine commerce |

**Ratings:**
- **high** — Directly relevant, actionable insights for Arc's work
- **medium** — Adjacent or contextually useful, worth tracking
- **low** — Tangential or only loosely connected — be honest, don't stretch

Each rating gets a one-line justification.

### 4. Extract Takeaways

For each link, pull out:
- 2-3 key points or insights
- Any implications for our skills, capabilities, or strategy
- Cross-references to existing Arc skills or gaps that suggest new ones

### 5. Write the Report

Use the CLI to process links:
```bash
arc skills run --name research -- process --links "url1,url2,url3"
```

Or if executing directly, write the report to `research/{ISO8601}_research.md` with this structure:

```markdown
# Research Report — {date}

**Links analyzed:** {count}
**Source:** Task #{id}

---

## {Link Title or Domain}

**URL:** {url}
**Relevance:** {high|medium|low} — {one-line justification}

### Key Takeaways
- Point 1
- Point 2
- Point 3

---

## Summary

### Cross-Cutting Themes
- Theme 1
- Theme 2

### Suggested Actions
- Follow-up task or skill suggestion
```

### 6. Close the Task

```bash
arc tasks close --id <task_id> --status completed --summary "Analyzed N links: X high, Y medium, Z low relevance"
```

## Principles

- **Honest ratings.** Low relevance is fine — don't inflate to justify the work.
- **Mission lens.** Always ask: how does this relate to autonomous agents using Bitcoin for coordination and payment?
- **Actionable output.** If a link suggests a new skill, a follow-up task, or a change to how we work, say so.
- **Brevity over thoroughness.** 2-3 takeaways per link, not an essay. The report should be scannable.

## If Stuck

- Link unreachable: note it, move on
- Content paywalled: note it, extract what you can from the URL/title/preview
- Ambiguous relevance: default to low, explain uncertainty
