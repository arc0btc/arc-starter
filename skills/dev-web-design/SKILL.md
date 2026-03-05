---
name: dev-web-design
description: UI/UX accessibility audit against Vercel web-interface-guidelines — file:line reporting
tags:
  - ui
  - accessibility
  - review
  - design
---

# web-design

Systematic UI/UX and accessibility review for aibtcdev/landing-page PRs. Based on Vercel Labs' web-interface-guidelines (~100 rules across 16 categories). Reports findings in `file:line` format.

## When to Use

Load this skill when reviewing PRs on:
- `aibtcdev/landing-page` (Next.js App Router — any PR touching CSS, TSX, or component files)
- Any Next.js/React UI codebase in the watched repos

## Guidelines Source

Rules are fetched dynamically from:
```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```
Fetching dynamically ensures reviews always use the latest rules. If fetch fails, fall back to embedded rules in AGENT.md.

## Rule Categories (16)

| Priority | Category | Key Rules |
|----------|----------|-----------|
| HIGH | Accessibility | `aria-label` on icon buttons, form labels, keyboard handlers, semantic HTML |
| HIGH | Focus States | `focus-visible:ring-*`, never `outline-none` without replacement |
| HIGH | Hydration | Guard `window`/`document`, no `new Date()` in render |
| MEDIUM-HIGH | Forms | `autocomplete`, correct `type`, inline errors, no paste-blocking |
| MEDIUM | Animation | `prefers-reduced-motion`, only `transform`/`opacity`, no `transition: all` |
| MEDIUM | Images | Explicit dimensions, lazy-loading, `priority` for above-fold |
| MEDIUM | Dark Mode | `color-scheme: dark`, explicit colors for `<select>` |
| MEDIUM | Navigation | URL reflects state, confirmation for destructive actions |
| MEDIUM | Content | Truncation, empty states, variable-length handling |
| LOW-MEDIUM | Typography | `…` not `...`, curly quotes, `tabular-nums` for numbers |
| LOW | Touch | `touch-action: manipulation`, `overscroll-behavior: contain` |
| LOW | Localization | `Intl.*` APIs, language detection |

## Output Format

Group findings by file, one issue per line:
```
components/Button.tsx:42 — icon-only button missing aria-label
styles/globals.css:18 — outline-none without focus-visible replacement
app/page.tsx:88 — <div onClick> needs onKeyDown + tabIndex
```

Report only genuine violations. Max 15 findings per review to avoid noise.

## Review Workflow

1. Fetch guidelines: `curl -s https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
2. Get diff: `arc skills run --name aibtc-maintenance -- review-pr --repo REPO --pr NUMBER`
3. Filter to UI-relevant files (`.tsx`, `.css`, `.scss`, `components/`, `styles/`, `app/`)
4. Apply rules, report in `file:line` format
5. Include under `## UI/Accessibility` section in the PR review comment
6. See AGENT.md for detailed rule descriptions and examples

## Composability

Pair with `react-reviewer` and `composition-patterns` for full landing-page PR review. All three skills load together for React repo PRs.

## Checklist

- [ ] `skills/dev-web-design/SKILL.md` exists with valid frontmatter
- [ ] `skills/dev-web-design/AGENT.md` exists with embedded rule reference
- [ ] aibtc-maintenance sensor loads this skill for React repo PRs
- [ ] Output uses `file:line — description` format
