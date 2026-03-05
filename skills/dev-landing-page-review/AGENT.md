# dev-landing-page-review — Subagent Briefing

You are reviewing a React/Next.js PR on `aibtcdev/landing-page`. Apply all three review dimensions below. Post a single consolidated review comment with three sections: **Performance**, **Composition**, **UI/Accessibility**.

Source rules: Vercel Labs agent-skills (react-best-practices v1.0.0, composition-patterns v1.0.0, web-interface-guidelines). January 2026.

---

# §React Performance (77 rules)

Check CRITICAL rules first — highest user-visible impact.

## CRITICAL: Eliminating Waterfalls

### async-defer-await
Defer `await` to the last possible moment. Don't await data you don't immediately use.

```ts
// BAD — blocks on userData before user1 is needed
const userData = await getUser(id);
const user1 = await getSomethingElse(userData.id);

// GOOD — defer, parallelize
const userDataPromise = getUser(id);
const [userData, other] = await Promise.all([userDataPromise, getSomethingElse()]);
```

### async-parallel
Use `Promise.all()` for independent async operations. Sequential awaits that could be parallel are a waterfall.

```ts
// BAD
const user = await getUser(id);
const posts = await getPosts(id);  // independent of user!

// GOOD
const [user, posts] = await Promise.all([getUser(id), getPosts(id)]);
```

### async-dependencies
Only await sequentially when later calls genuinely depend on earlier results.

### async-api-routes
In Next.js Route Handlers and Server Actions, parallelize all independent `fetch()` calls.

### async-suspense-boundaries
Wrap async Server Components in Suspense so the rest of the page renders while data loads.

```tsx
// GOOD
<Suspense fallback={<Skeleton />}>
  <AsyncComponent />
</Suspense>
```

---

## CRITICAL: Bundle Size Optimization

### bundle-barrel-imports
Avoid barrel re-exports that pull in the whole library. Use direct imports.

```ts
// BAD — imports entire lodash
import { debounce } from 'lodash';

// GOOD
import debounce from 'lodash/debounce';
```

### bundle-dynamic-imports
Use `next/dynamic` to split large components (modals, charts, rich editors) that aren't needed on initial render.

```ts
const HeavyComponent = dynamic(() => import('./HeavyComponent'), { ssr: false });
```

### bundle-defer-third-party
Analytics, chat widgets, and tracking scripts should use `next/script` with `strategy="lazyOnload"`.

### bundle-conditional
Feature-flagged code paths should use dynamic imports so disabled features don't ship in the bundle.

### bundle-preload
Critical resources (fonts, hero images, key API endpoints) should use `<link rel="preload">`.

---

## HIGH: Server-Side Performance

### server-auth-actions
In Server Actions, validate auth **before** any data operation.

```ts
export async function updatePost(id: string, data: FormData) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  // now do the work
}
```

### server-cache-react
Use `React.cache()` for per-request deduplication of expensive computations or fetches called from multiple components.

### server-cache-lru
For stable data (config, pricing), use an LRU cache to avoid re-fetching on every request.

### server-dedup-props
Don't pass the same data through multiple component layers. Use React.cache() to deduplicate.

### server-hoist-static-io
Move static data loads outside the render function so they don't run on every render.

### server-parallel-fetching
In Server Components, fetch all independent data in parallel using `Promise.all()`.

### server-after-nonblocking
Use Next.js `after()` for work that doesn't need to complete before sending the response (logging, analytics).

### server-serialization
Avoid passing large objects from Server Components to Client Components. Serialize only what the client needs.

---

## MEDIUM-HIGH: Client-Side Data Fetching

### client-swr-dedup
Use SWR or React Query for client-side fetching (deduplicates concurrent requests).

### client-event-listeners
Remove event listeners in cleanup functions.

```ts
useEffect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
```

### client-passive-event-listeners
Use `{ passive: true }` for scroll/touch listeners that don't call `preventDefault()`.

### client-localstorage-schema
Validate localStorage/sessionStorage data against a schema before use.

---

## MEDIUM: Re-render Optimization

### rerender-memo — Wrap expensive pure components in `React.memo()`
### rerender-dependencies — `useEffect`/`useMemo`/`useCallback` deps must be exhaustive
### rerender-derived-state — Don't store values in state that can be derived from props
### rerender-effects — Avoid `useEffect` for synchronous computations
### rerender-callbacks — Stable callbacks with `useCallback` prevent child re-renders
### rerender-transitions — Use `useTransition` for non-urgent updates (search, filter)
### rerender-refs — Use `useRef` for values that persist without triggering re-renders
### rerender-context-split — Split context into read/write to limit re-render scope
### rerender-selector-pattern — Select only the state slice a component needs
### rerender-keys — Never use array index as key for lists that can reorder
### rerender-batch-updates — Group related setState calls
### rerender-memo-expensive — Use `useMemo` only for genuinely expensive calculations

---

## MEDIUM: Rendering Performance

### rendering-animate-svg-wrapper — Wrap animated SVGs in a div
### rendering-content-visibility — Use `content-visibility: auto` on off-screen sections
### rendering-hoist-jsx — Hoist static JSX to module scope
### rendering-svg-precision — Reduce SVG path precision to 2 decimal places
### rendering-hydration — Avoid hydration mismatches (server vs client content)
### rendering-activity — Use React 19 `<Activity>` for offscreen pre-rendering
### rendering-conditional-render — Short-circuit rendering of invisible expensive components
### rendering-usetransition-loading — Show loading states with `useTransition`

---

## LOW-MEDIUM: JavaScript Performance

### js-dom-cache — Cache DOM lookups in variables
### js-memoize-pure — Memoize pure functions with expensive computation
### js-object-lookup — Replace linear-scan arrays with object/Map lookups
### js-loop-cache — Cache `.length` outside loop conditions
### js-avoid-closure-in-loop — Don't create closures inside loops
### js-string-concat — Use template literals or array join in loops
### js-avoid-global-scope — Minimize global variable pollution
### js-debounce-throttle — Debounce/throttle input handlers (search, resize, scroll)
### js-weakref-cache — Use `WeakRef` for caches to allow GC
### js-requestanimationframe — Use `requestAnimationFrame` for animations
### js-requestidlecallback — Use `requestIdleCallback` for non-urgent background work
### js-avoid-layout-thrashing — Don't interleave DOM reads and writes

---

## LOW: Advanced Patterns

### advanced-event-handler-refs — Store handlers in refs for stable identity without deps
### advanced-init-once — Use lazy initializer in `useState(() => expensiveComputation())`
### advanced-use-latest — "use-latest" pattern: ref always holds the latest value

---

## Performance Review Checklist

- [ ] Sequential awaits that could be `Promise.all()`?
- [ ] Barrel imports from large libraries?
- [ ] Large components loaded synchronously that could be `dynamic()`?
- [ ] Third-party scripts not using `next/script lazyOnload`?
- [ ] Server Actions validating auth before data access?
- [ ] `useEffect` with missing/incorrect dependencies?
- [ ] List items using index as key?
- [ ] Event listeners without cleanup?
- [ ] State that could be derived instead of stored?
- [ ] Hydration mismatches?

---

# §Composition Patterns (10 rules)

Composition issues are MEDIUM priority — note them, don't block unless architecture creates a real maintenance burden.

## HIGH: Component Architecture

### architecture-avoid-boolean-props
3+ boolean props controlling appearance/behavior → refactor to explicit variants.

```tsx
// BAD
interface ButtonProps { primary?: boolean; secondary?: boolean; danger?: boolean; small?: boolean; large?: boolean; }

// GOOD
type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';
interface ButtonProps { variant: ButtonVariant; size?: ButtonSize; loading?: boolean; }
```

State booleans (`isLoading`, `isDisabled`) are acceptable; style/behavior booleans are not.

### architecture-compound-components
Multi-part coordinated UI (tabs, accordions, cards) → use compound component pattern with shared context.

```tsx
// GOOD
<Tabs value={active} onValueChange={setActive}>
  <Tabs.List>
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="overview"><Overview /></Tabs.Panel>
</Tabs>
```

---

## MEDIUM: State Management

### state-decouple-implementation
Provider is the only place that knows *how* state is managed. Expose actions, not `setState`.

### state-context-interface
Structure context values as `state / actions / meta` (loading/error state).

### state-lift-state
When multiple sibling components need shared state, lift to closest common ancestor.

---

## MEDIUM: Implementation Patterns

### patterns-explicit-variants
Named variant components (`<Alert.Success>`) beat configuration props when variants have different props.

### patterns-children-over-render-props
Prefer `children` and slots over `renderHeader`/`renderFooter` callback props.

Exception: `renderItem` in virtualized lists is legitimate.

---

## MEDIUM: React 19 APIs

### react19-no-forwardref
`React.forwardRef()` deprecated in React 19. Pass `ref` as a regular prop.

```tsx
// GOOD — React 19
function Input({ label, ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return <label>{label}<input ref={ref} {...props} /></label>;
}
```

### react19-use-hook
React 19 `use()` reads Promises and Contexts inside render (can be called conditionally).

### react19-use-context
`use(Context)` replaces `useContext(Context)` — can be called inside conditionals.

---

## Composition Review Checklist

- [ ] Components with 3+ boolean props controlling appearance/behavior?
- [ ] Coordinated multi-part UI using flat prop API instead of compound components?
- [ ] Context value exposing `setState` instead of action functions?
- [ ] `renderX` props when `children` or slots would be cleaner?
- [ ] `React.forwardRef()` in new code?
- [ ] Multiple sibling components with duplicate/out-of-sync state?

---

# §UI/Accessibility (~100 rules)

First, try to fetch current guidelines:
```bash
curl -s https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```
If fetch succeeds, prefer those rules. If it fails, use the embedded rules below.

**Scope:** `.tsx`, `.jsx`, `.css`, `.scss` under `components/`, `app/`, `pages/`. Skip `app/api/`, test files, CI config.

## Accessibility (BLOCKING)

**`aria-icon-buttons`** — Every icon-only `<button>` needs `aria-label`:
```tsx
<button aria-label="Close dialog"><CloseIcon /></button>
```

**`form-labels`** — All `<input>`, `<textarea>`, `<select>` need `<label>` or `aria-label`.

**`keyboard-handlers`** — Non-button elements with `onClick` need `onKeyDown` + `tabIndex`. Use `<button>` instead when possible.

**`semantic-html`** — Use `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>` before reaching for ARIA.

**`heading-hierarchy`** — Don't skip heading levels (h1→h3 without h2 is invalid).

## Focus States (BLOCKING)

**`outline-none`** — Never `outline-none` without a visible `focus-visible:ring-*` replacement.

**`focus-visible`** — Prefer `:focus-visible` over `:focus` to avoid showing ring on mouse click.

## Hydration Safety (BLOCKING)

**`no-window-ssr`** — Guard `window`, `document`, `localStorage` with `typeof window !== 'undefined'` or move to `useEffect`.

**`no-date-ssr`** — `new Date()` in render body causes hydration mismatch. Compute in `useEffect` or pass from Server Component.

## Forms (MEDIUM-HIGH)

**`autocomplete`** — Add `autocomplete` to email, name, address, password inputs.

**`input-types`** — Use `type="email"`, `type="tel"`, `type="url"`, `type="search"`, `type="number"` for correct mobile keyboard.

**`inline-errors`** — Validation errors appear inline near the field, not only at form top.

**`no-paste-block`** — Never block paste on password fields.

**`spellcheck-sensitive`** — Add `spellCheck={false}` to password, card number, PIN fields.

## Animation (MEDIUM)

**`reduced-motion`** — Wrap animations in `@media (prefers-reduced-motion: no-preference)`.

**`animate-transform`** — Animate only `transform` and `opacity`. Avoid `width`, `height`, `top`, `left`.

**`no-transition-all`** — Don't use `transition: all` — enumerate specific properties.

## Images (MEDIUM)

**`explicit-dimensions`** — All `<img>` and Next.js `<Image>` need explicit `width` and `height`.

**`priority-hero`** — Above-fold hero images need `priority` prop on Next.js `<Image>`.

## Dark Mode (MEDIUM)

**`color-scheme`** — Set `color-scheme: dark` on `:root` in dark mode.

**`select-colors`** — Native `<select>` needs explicit `background-color` and `color` in dark mode.

## Navigation & State (MEDIUM)

**`url-reflects-state`** — Filters, tabs, pagination, modal state should be in URL.

**`confirmation-destructive`** — Destructive actions need a confirmation step.

## Content Handling (MEDIUM)

**`truncate-gracefully`** — Text containers that can overflow: `overflow-hidden text-ellipsis whitespace-nowrap`.

**`empty-states`** — Lists/search results must render a meaningful empty state.

## Typography (LOW-MEDIUM)

**`ellipsis-char`** — Use `…` (U+2026), not `...`.

**`curly-quotes`** — Use typographic quotes `"` `"` `'` `'` in visible copy.

**`tabular-nums`** — Number columns, prices, clocks: `font-variant-numeric: tabular-nums`.

## Touch (LOW-MEDIUM)

**`touch-manipulation`** — Add `touch-action: manipulation` to interactive elements.

**`overscroll-modal`** — Modals need `overscroll-behavior: contain`.

## Hover States (LOW)

**`hover-feedback`** — All interactive elements need a visible hover state. Non-button clickables need `cursor-pointer`.

## Localization (LOW)

**`intl-format`** — Use `Intl.NumberFormat` and `Intl.DateTimeFormat` instead of manual formatting.

---

## UI/Accessibility Reporting Format

Group by file, one issue per line:

```
components/IconButton.tsx:14 — icon-only button missing aria-label [aria-icon-buttons] [BLOCKING]
styles/globals.css:22 — outline-none without focus-visible replacement [outline-none] [BLOCKING]
app/dashboard/page.tsx:88 — <div onClick> needs onKeyDown + tabIndex [keyboard-handlers] [BLOCKING]
components/PriceTable.tsx:45 — number column should use tabular-nums [tabular-nums]
```

Max 15 findings per review. Only report genuine violations.

---

# Consolidated Review Format

Post one GitHub review comment with three sections:

```markdown
## Performance

[bundle-barrel-imports] `import { X } from 'lib'` pulls in full bundle. Use `import X from 'lib/X'`.
[async-parallel] Two sequential awaits are independent — wrap in `Promise.all()`.

## Composition

[architecture-avoid-boolean-props] 4 style booleans on Button. Consider `variant: 'primary' | 'secondary' | 'ghost'`.

## UI/Accessibility

components/Button.tsx:42 — icon-only button missing aria-label [aria-icon-buttons] [BLOCKING]
app/page.tsx:88 — <div onClick> needs onKeyDown + tabIndex [keyboard-handlers]
```

**Approval:** APPROVE if no CRITICAL performance violations and no BLOCKING accessibility findings. REQUEST CHANGES otherwise.
