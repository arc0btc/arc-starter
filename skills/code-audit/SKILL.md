---
name: code-audit
description: On-demand static analysis, dependency review, and security scanning — Forge's dev quality layer
updated: 2026-03-18
tags:
  - security
  - audit
  - static-analysis
  - dev
---

# code-audit

On-demand code quality and security scanning for any local path. Runs three audit types:

| Type       | What It Checks |
|------------|----------------|
| `static`   | TypeScript type errors (`tsc --noEmit`), build validity (`bun build --no-bundle`) |
| `deps`     | Outdated/vulnerable packages in package.json; suspicious lockfile entries |
| `security` | Hardcoded secrets patterns, `eval`/`exec` usage, SQL injection, insecure fetch, exposed credentials |
| `all`      | All of the above (default) |

## When to Load

Load when: running a pre-PR quality gate, investigating a security report, reviewing a new dependency, or triaging a code-audit task. Do not load for tasks that don't involve code analysis.

## Priority Routing for Follow-up Tasks

| Finding                           | Priority | Model  |
|-----------------------------------|----------|--------|
| Critical security vulnerability   | P2       | opus   |
| High-severity CVE in dep          | P3       | opus   |
| Moderate issues / type errors     | P5       | sonnet |
| Low / informational               | P8       | haiku  |

## CLI Commands

```
arc skills run --name code-audit -- run --path PATH [--type static|deps|security|all]
arc skills run --name code-audit -- static --path PATH
arc skills run --name code-audit -- deps --path PATH
arc skills run --name code-audit -- security --path PATH
```

## Workflow

1. Run `code-audit run --path . --type all` at start of any code review task
2. Record findings in task result_detail
3. For critical/high findings: create a P2–P3 follow-up fix task immediately
4. For moderate: include in PR review notes
5. For low/informational: add to MEMORY.md patterns section

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] cli.ts parses named flags, exits 1 on errors
- [ ] No sensor — on-demand only
