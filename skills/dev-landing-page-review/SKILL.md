---
name: dev-landing-page-review
description: Full React/Next.js PR review — 77 performance rules + 10 composition rules + ~100 UI/accessibility rules for aibtcdev/landing-page PRs
tags:
  - react
  - nextjs
  - review
  - performance
  - composition
  - accessibility
  - ui
---

# dev-landing-page-review

Comprehensive PR review skill for `aibtcdev/landing-page` (Next.js App Router). Merges three review dimensions into one skill: React performance (77 rules), composition patterns (10 rules), and UI/UX accessibility (~100 rules).

## When to Use

Load this skill when reviewing PRs on `aibtcdev/landing-page` or any React/Next.js codebase in the watched repos.

## Review Dimensions

### 1. React Performance (77 rules — see AGENT.md §React Performance)

| Priority | Category | Prefix | Count |
|----------|----------|--------|-------|
| CRITICAL | Eliminating Waterfalls | `async-` | 5 |
| CRITICAL | Bundle Size Optimization | `bundle-` | 5 |
| HIGH | Server-Side Performance | `server-` | 8 |
| MEDIUM-HIGH | Client-Side Data Fetching | `client-` | 4 |
| MEDIUM | Re-render Optimization | `rerender-` | 12 |
| MEDIUM | Rendering Performance | `rendering-` | 8 |
| LOW-MEDIUM | JavaScript Performance | `js-` | 12 |
| LOW | Advanced Patterns | `advanced-` | 3 |

### 2. Composition Patterns (10 rules — see AGENT.md §Composition Patterns)

| Priority | Category | Rules |
|----------|----------|-------|
| HIGH | Component Architecture | `architecture-avoid-boolean-props`, `architecture-compound-components` |
| MEDIUM | State Management | `state-decouple-implementation`, `state-context-interface`, `state-lift-state` |
| MEDIUM | Implementation Patterns | `patterns-explicit-variants`, `patterns-children-over-render-props` |
| MEDIUM | React 19 APIs | `react19-no-forwardref`, `react19-use-hook`, `react19-use-context` |

### 3. UI/Accessibility (~100 rules — see AGENT.md §UI/Accessibility)

| Priority | Category | Key Rules |
|----------|----------|-----------|
| HIGH (BLOCKING) | Accessibility | `aria-label` on icon buttons, form labels, keyboard handlers, semantic HTML |
| HIGH (BLOCKING) | Focus States | `focus-visible:ring-*`, never `outline-none` without replacement |
| HIGH (BLOCKING) | Hydration | Guard `window`/`document`, no `new Date()` in render |
| MEDIUM-HIGH | Forms | `autocomplete`, correct `type`, inline errors, no paste-blocking |
| MEDIUM | Animation | `prefers-reduced-motion`, only `transform`/`opacity` |
| MEDIUM | Images | Explicit dimensions, `priority` for above-fold |

## Review Workflow

1. Get the diff: `arc skills run --name aibtc-maintenance -- review-pr --repo REPO --pr NUMBER`
2. Check CRITICAL performance rules first (waterfalls, bundle)
3. Check BLOCKING accessibility rules (aria, focus, hydration)
4. Check HIGH server-side rules for Next.js App Router
5. Note composition and MEDIUM/LOW issues without blocking
6. Post a single consolidated review comment with sections: Performance, Composition, UI/Accessibility

## Approval Guidance

- **APPROVE** — No CRITICAL performance violations, no BLOCKING accessibility findings
- **REQUEST CHANGES** — Any CRITICAL performance issue or BLOCKING accessibility finding
- Composition and MEDIUM/LOW issues → comment only, don't block

## Composability

Single skill replaces: `dev-react-review` + `dev-react-composition` + `dev-web-design`. Saves ~3× context overhead for landing-page PR tasks.
