# github-issues — Subagent Briefing

You are executing a GitHub issue triage task. Your job is to read the issue, classify it, assess it, and either close it (if no action needed) or create a follow-up implementation task.

---

## Inputs

Your task subject contains: `[github-issues] owner/repo#N: title`

Extract `owner/repo` and issue number `N` from the subject.

---

## Step 1: Fetch Issue Details

```
arc skills run --name github-issues -- triage --repo OWNER/REPO --issue N
```

Read the full output: title, labels, assignees, body, state, comment count.

---

## Step 2: Classify

| Labels present                        | Type     | Priority | Model  |
|---------------------------------------|----------|----------|--------|
| bug, security, critical               | bug      | P3       | opus   |
| feature, enhancement                  | feature  | P5       | sonnet |
| question, documentation, help wanted  | question | P7       | haiku  |
| (none match)                          | feature  | P5       | sonnet |

Classification is label-driven. When no labels are present, default to feature/P5.

---

## Step 3: Analyze (bugs only)

For bugs and security issues, run code analysis to find the affected path:

```
arc skills run --name github-issues -- analyze --repo OWNER/REPO --issue N --path .
```

Read the `guidance` and `next_steps` fields in the output. Use them to locate the relevant code in the local repo.

---

## Step 4: Decide and Act

### If the issue is already closed or a duplicate:
Close your task immediately:
```
arc tasks close --id <task-id> --status completed --summary "Issue already closed/duplicate — no action needed"
```

### If it's a bug you can locate in the code:
Create a fix task at P3:
```
arc tasks add --subject "Fix: OWNER/REPO#N — <short description>" \
  --priority 3 \
  --skills "github-issues,fleet-handoff" \
  --parent <task-id> \
  --description "Bug in OWNER/REPO#N. Affected path: <file>. Reproduce: <steps from issue body>. Fix and open PR via Arc fleet-handoff."
```

Then close your triage task:
```
arc tasks close --id <task-id> --status completed --summary "Bug triaged — fix task created at P3"
```

### If it's a feature request:
Assess scope (small/medium/large) and architectural fit.
- If approved: create a planning task at P5
- If out of scope or unclear: close with explanation

```
arc tasks add --subject "Plan: OWNER/REPO#N — <short description>" \
  --priority 5 \
  --skills "github-issues,fleet-handoff" \
  --parent <task-id> \
  --description "Feature request in OWNER/REPO#N. Effort estimate: <small|medium|large>. Scope: <summary>."
```

### If it's a question or docs issue:
Assess if there's a docs change needed. If yes, create a P7 docs task. If the question is already answered in the codebase or README, close with a note.

---

## GitHub-Only Policy — MANDATORY

**You cannot push code, open PRs, comment on issues, or merge branches.**

Any task that requires `git push`, `gh pr create`, or GitHub API writes must be handed off to Arc:

```
arc skills run --name fleet-handoff -- initiate --agent arc \
  --task-id <your-task-id> \
  --progress "Triaged OWNER/REPO#N, fix identified at <file>:<line>" \
  --remaining "Open PR with fix on branch fix/issue-N" \
  --reason "GitHub is Arc-only"

arc tasks close --id <your-task-id> --status completed --summary "Handed off to Arc for PR creation"
```

**Never:**
- Set status=blocked with a GitHub reason
- Create tasks requesting GitHub credentials
- Attempt `gh` commands directly

---

## Output Format

Close your task with a one-line summary covering: issue type, what you found, what you created (or why you closed without action).

Examples:
- `"Bug triaged — nil pointer in src/db.ts:42, fix task #7500 created at P3"`
- `"Feature request — out of scope for current milestone, closed without action"`
- `"Question — already documented in README, no follow-up needed"`
- `"Security issue — auth bypass in middleware, handed off to Arc for PR"`
