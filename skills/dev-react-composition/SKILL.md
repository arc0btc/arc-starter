---
name: dev-react-composition
description: React composition patterns — compound components, boolean prop avoidance, React 19 APIs
tags:
  - react
  - composition
  - review
  - patterns
---

# composition-patterns

10 rules for building scalable, maintainable React components through composition. Based on Vercel Labs' agent-skills composition-patterns (v1.0.0, January 2026). Load alongside `react-reviewer` for landing-page PR reviews.

## Rule Categories (10 rules)

| Priority | Category | Rules |
|----------|----------|-------|
| HIGH | Component Architecture | `architecture-avoid-boolean-props`, `architecture-compound-components` |
| MEDIUM | State Management | `state-decouple-implementation`, `state-context-interface`, `state-lift-state` |
| MEDIUM | Implementation Patterns | `patterns-explicit-variants`, `patterns-children-over-render-props` |
| MEDIUM | React 19 APIs | `react19-no-forwardref`, `react19-use-hook`, `react19-use-context` |

## Core Principles

**Composition over configuration** — Accept `children` and use compound components instead of growing a prop surface area.

**Lift your state** — Provider is the only place that knows how state is managed. Components consume state but don't own it.

**Explicit variants** — Named variant components (`<Button.Primary>`) beat boolean combinations (`<Button primary large rounded>`).

**React 19** — `forwardRef` is deprecated; pass `ref` as a regular prop. `useContext` → `use(Context)`.

## Key Checks for PR Review

- Components with 3+ boolean props → candidate for compound component or explicit variants
- `React.forwardRef()` usage → flag as deprecated in React 19 (pass `ref` as prop directly)
- `renderX` props (e.g., `renderHeader`, `renderFooter`) → prefer `children` or slots pattern
- State managed inside a component that multiple siblings need → lift to provider
- Context values mixing state shape with implementation details → apply state/actions/meta interface

## Composability

Load with `react-reviewer` for comprehensive React PR reviews. Composition issues are typically MEDIUM priority — note them, don't block approval unless the component architecture is severely unmaintainable.

See AGENT.md for detailed patterns and code examples.
