# web-design — Subagent Briefing

You are performing a UI/UX and accessibility audit on a Pull Request diff.

## Setup

First, try to fetch the current guidelines:
```bash
curl -s https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

If the fetch succeeds, use those rules (they may be more up-to-date than this file). If it fails, use the embedded rules below.

## Scope

Focus on files that touch UI:
- TypeScript/JSX: `.tsx`, `.jsx` files under `components/`, `app/`, `pages/`
- Styles: `.css`, `.scss`, `.sass` files; `tailwind.config.*`
- Skip: API routes (`app/api/`), DB migrations, test files, CI config

## Embedded Rule Reference

### Accessibility (BLOCKING)

**`aria-icon-buttons`** — Every icon-only `<button>` or clickable `<div>`/`<span>` needs `aria-label` or `aria-labelledby`:
```tsx
// BAD
<button><CloseIcon /></button>

// GOOD
<button aria-label="Close dialog"><CloseIcon /></button>
```

**`form-labels`** — All `<input>`, `<textarea>`, `<select>` need associated `<label>` or `aria-label`:
```tsx
// BAD
<input type="email" placeholder="Email" />

// GOOD
<label htmlFor="email">Email</label>
<input id="email" type="email" />
// or
<input type="email" aria-label="Email address" />
```

**`keyboard-handlers`** — Non-button/anchor elements with `onClick` need `onKeyDown` + `tabIndex`:
```tsx
// BAD
<div onClick={handleClick}>Click me</div>

// GOOD — use a button instead
<button onClick={handleClick}>Click me</button>
// or if div is intentional
<div onClick={handleClick} onKeyDown={e => e.key === 'Enter' && handleClick()} tabIndex={0} role="button">
```

**`semantic-html`** — Use semantic elements before reaching for ARIA. `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>` convey structure without extra attributes.

**`heading-hierarchy`** — Don't skip heading levels (h1 → h3 without h2 is invalid).

### Focus States (BLOCKING)

**`outline-none`** — Never use `outline-none` or `focus:outline-none` without providing a visible `focus-visible:ring-*` replacement:
```tsx
// BAD
<button className="focus:outline-none">

// GOOD
<button className="focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500">
```

**`focus-visible`** — Prefer `:focus-visible` pseudo-class over `:focus` to avoid showing focus ring on mouse click.

### Hydration Safety (BLOCKING)

**`no-window-ssr`** — Guard `window`, `document`, `localStorage`, `sessionStorage` with `typeof window !== 'undefined'` or move to `useEffect`:
```tsx
// BAD — crashes on server
const width = window.innerWidth;

// GOOD
const [width, setWidth] = useState(0);
useEffect(() => { setWidth(window.innerWidth); }, []);
```

**`no-date-ssr`** — `new Date()` in render body causes hydration mismatch between server and client. Compute in `useEffect` or pass as a prop from a Server Component.

### Forms (MEDIUM-HIGH)

**`autocomplete`** — Add `autocomplete` attribute to common form inputs (email, name, address, password, etc.).

**`input-types`** — Use correct `type` attribute: `type="email"`, `type="tel"`, `type="url"`, `type="search"`, `type="number"`. Triggers the right mobile keyboard.

**`inline-errors`** — Validation errors should appear inline near the relevant field, not only at the top of the form.

**`no-paste-block`** — Never block paste events on password or sensitive fields:
```tsx
// BAD — anti-pattern
<input type="password" onPaste={e => e.preventDefault()} />
```

**`spellcheck-sensitive`** — Add `spellCheck={false}` to password, card number, PIN fields.

### Animation (MEDIUM)

**`reduced-motion`** — Wrap animations in `@media (prefers-reduced-motion: no-preference)` or use `useReducedMotion()`:
```css
/* GOOD */
@media (prefers-reduced-motion: no-preference) {
  .card { transition: transform 200ms; }
}
```

**`animate-transform`** — Animate only `transform` and `opacity`. Avoid animating `width`, `height`, `top`, `left` (cause layout reflow).

**`no-transition-all`** — Don't use `transition: all` — enumerate specific properties to avoid unintended animation.

### Images (MEDIUM)

**`explicit-dimensions`** — All `<img>` and Next.js `<Image>` components need explicit `width` and `height` to prevent Cumulative Layout Shift (CLS).

**`priority-hero`** — Above-fold hero images should have `priority` prop on Next.js `<Image>` to avoid LCP penalty.

**`lazy-loading`** — Below-fold images should use `loading="lazy"` (Next.js `<Image>` does this automatically).

### Dark Mode (MEDIUM)

**`color-scheme`** — Set `color-scheme: dark` on `:root` in dark mode so native browser elements (scrollbars, form controls) match.

**`select-colors`** — Native `<select>` elements need explicit `background-color` and `color` in dark mode — they don't inherit CSS variables reliably.

### Navigation & State (MEDIUM)

**`url-reflects-state`** — Filters, active tabs, pagination, and modal open state should be reflected in the URL (query params or hash) to support deep-linking and back/forward navigation.

**`confirmation-destructive`** — Destructive actions (delete, clear, cancel subscription) need a confirmation step — dialog, popover, or inline confirm button.

### Content Handling (MEDIUM)

**`truncate-gracefully`** — Text containers that can overflow must handle it: `overflow-hidden text-ellipsis whitespace-nowrap` or Tailwind `truncate`. Test with both very short and very long values.

**`empty-states`** — Lists, search results, and data tables must render a meaningful empty state — don't render nothing or just whitespace.

### Typography (LOW-MEDIUM)

**`ellipsis-char`** — Use the actual ellipsis character `…` (U+2026) in text content, not three periods `...`.

**`curly-quotes`** — Use typographic quotes `"` `"` `'` `'` in visible copy, not straight quotes.

**`tabular-nums`** — Number columns, prices, clocks, counters should use `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`) to prevent layout jitter when digits change.

### Touch (LOW-MEDIUM)

**`touch-manipulation`** — Add `touch-action: manipulation` to buttons and interactive elements to eliminate the 300ms tap delay on mobile.

**`overscroll-modal`** — Modals and bottom drawers need `overscroll-behavior: contain` to prevent scrolling from bubbling to the background page.

### Localization (LOW)

**`intl-format`** — Use `Intl.NumberFormat` and `Intl.DateTimeFormat` instead of manual number/date formatting.

### Hover States (LOW)

**`hover-feedback`** — All interactive elements need a visible hover state. Non-button clickable elements need `cursor-pointer`.

## Reporting Format

Group findings by file, terse one-liner per issue:

```
components/IconButton.tsx:14 — icon-only button missing aria-label [aria-icon-buttons]
styles/globals.css:22 — outline-none without focus-visible replacement [outline-none]
app/dashboard/page.tsx:88 — <div onClick> needs onKeyDown + tabIndex [keyboard-handlers]
components/PriceTable.tsx:45 — number column should use tabular-nums [tabular-nums]
```

Rules:
- State the violation tersely; include rule name in brackets
- Only report genuine violations — don't flag patterns acceptable in context
- Skip files with no violations
- Max 15 findings per review to avoid noise
- Blocking issues (aria, focus, hydration): note with `[BLOCKING]`

## Integration with aibtc-maintenance

After completing the web-design audit, include findings in the PR review comment under a dedicated section:

```markdown
## UI/Accessibility

components/IconButton.tsx:14 — icon-only button missing aria-label [aria-icon-buttons] [BLOCKING]
components/PriceTable.tsx:45 — number column should use tabular-nums [tabular-nums]

💡 Suggestion: consider adding prefers-reduced-motion guard to card hover transition
```

**Approval guidance:**
- APPROVE if only suggestions (💡) and no blocking findings
- REQUEST CHANGES if any blocking finding (aria, focus, hydration)
- Always combine with react-reviewer and composition-patterns findings in one review comment
