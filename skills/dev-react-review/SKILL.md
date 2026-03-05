---
name: dev-react-review
description: React/Next.js performance review — 77 rules across 8 categories for PR analysis
tags:
  - react
  - nextjs
  - review
  - performance
---

# react-reviewer

Systematic React and Next.js performance review for aibtcdev/landing-page PRs. Based on Vercel Labs' agent-skills react-best-practices (v1.0.0, January 2026). 77 rules across 8 categories, prioritized by impact.

## When to Use

Load this skill when reviewing PRs on:
- `aibtcdev/landing-page` (Next.js App Router)
- Any React/Next.js codebase in the watched repos

## Rule Categories (77 rules)

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

## Critical Rules (check first)

**Waterfalls (CRITICAL)**
- `async-defer-await` — Defer await to last possible moment; don't block on unused data
- `async-parallel` — Use `Promise.all()` for independent async operations
- `async-dependencies` — Avoid sequential awaits when calls are independent
- `async-api-routes` — Parallelize data fetches in API routes
- `async-suspense-boundaries` — Use Suspense boundaries for faster initial paint

**Bundle (CRITICAL)**
- `bundle-barrel-imports` — Avoid `import { X } from 'lib'` barrel re-exports; use direct paths
- `bundle-dynamic-imports` — Use `next/dynamic` for code splitting large components
- `bundle-defer-third-party` — Load analytics/tracking scripts deferred, not blocking
- `bundle-conditional` — Tree-shake feature-flagged code with dynamic imports
- `bundle-preload` — Use `<link rel="preload">` for critical resources

## High-Priority Server Rules

- `server-auth-actions` — Validate auth in Server Actions before any data access
- `server-cache-react` — Use `React.cache()` for per-request deduplication
- `server-cache-lru` — Use LRU cache for cross-request caching (stable data)
- `server-dedup-props` — Avoid passing same data through multiple props; use context
- `server-hoist-static-io` — Move static I/O outside of render functions
- `server-parallel-fetching` — Fetch independent data in parallel on server
- `server-after-nonblocking` — Use `after()` for non-blocking post-response work
- `server-serialization` — Avoid serializing large objects across server/client boundary

## Review Workflow

1. Run `arc skills run --name aibtc-maintenance -- review-pr --repo REPO --pr NUMBER` to get the diff
2. Check CRITICAL rules first — waterfalls and bundle issues have highest user-visible impact
3. Check HIGH server rules for Next.js App Router patterns
4. Note MEDIUM+ issues but don't block approval for them unless egregious
5. See AGENT.md for detailed rule explanations and code examples

## Composability

Pair with `composition-patterns` for component structure review. Both skills load together for landing-page PRs.
