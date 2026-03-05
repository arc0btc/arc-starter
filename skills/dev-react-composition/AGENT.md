# composition-patterns — Subagent Briefing

You are reviewing a React PR for component composition quality. Apply these 10 rules. Composition issues are typically MEDIUM priority — note them in review comments, but don't block approval unless the design is severely unmaintainable.

Source: Vercel Labs agent-skills composition-patterns v1.0.0 (January 2026).

---

## HIGH: Component Architecture

### architecture-avoid-boolean-props

Boolean props accumulate and create combinatorial complexity. When a component has 3+ boolean props controlling behavior or appearance, refactor to explicit variants or compound components.

**The signal:** `<Button primary large rounded disabled={false} loading />` — five booleans, 32 possible states, most invalid.

```tsx
// BAD — boolean prop explosion
interface ButtonProps {
  primary?: boolean;
  secondary?: boolean;
  danger?: boolean;
  small?: boolean;
  large?: boolean;
  rounded?: boolean;
  loading?: boolean;
}

// GOOD — explicit variant prop
type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;  // state booleans are fine; style booleans aren't
}
```

**Exception:** State booleans (`isLoading`, `isDisabled`, `isOpen`) are acceptable. It's appearance/behavior booleans that proliferate.

### architecture-compound-components

When a component has multiple coordinated sub-parts (tabs, accordions, dropdowns, cards with header/body/footer), use the compound component pattern with shared context.

```tsx
// BAD — monolithic with many props
<Tabs
  items={tabs}
  activeTab={active}
  onTabChange={setActive}
  renderTabContent={(tab) => <div>{tab.content}</div>}
/>

// GOOD — compound components
<Tabs value={active} onValueChange={setActive}>
  <Tabs.List>
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="overview"><Overview /></Tabs.Panel>
  <Tabs.Panel value="settings"><Settings /></Tabs.Panel>
</Tabs>
```

**Implementation:** Use `React.createContext()` to share state between parent and children. The parent component owns state; children consume it.

```tsx
const TabsContext = createContext<TabsContextValue | null>(null);

function Tabs({ value, onValueChange, children }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      {children}
    </TabsContext.Provider>
  );
}

function TabsTrigger({ value, children }: TabsTriggerProps) {
  const ctx = useContext(TabsContext)!;
  return (
    <button
      onClick={() => ctx.onValueChange(value)}
      aria-selected={ctx.value === value}
    >
      {children}
    </button>
  );
}

Tabs.List = TabsList;
Tabs.Trigger = TabsTrigger;
Tabs.Panel = TabsPanel;
```

---

## MEDIUM: State Management

### state-decouple-implementation

The Provider is the only place that knows *how* state is managed (useState vs useReducer vs external store). Consumers only know *what* state is available and *what actions* they can take.

```tsx
// BAD — exposes setState to consumers
const DataContext = createContext<{
  items: Item[];
  setItems: Dispatch<SetStateAction<Item[]>>;  // exposes implementation
}>();

// GOOD — expose actions, hide implementation
const DataContext = createContext<{
  items: Item[];
  addItem: (item: Item) => void;
  removeItem: (id: string) => void;
}>();

function DataProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);

  const addItem = useCallback((item: Item) => {
    setItems(prev => [...prev, item]);
  }, []);

  return (
    <DataContext.Provider value={{ items, addItem, removeItem }}>
      {children}
    </DataContext.Provider>
  );
}
```

Now you can swap `useState` for `useReducer` or Zustand without changing any consumers.

### state-context-interface

Structure context values with a consistent `state / actions / meta` interface. This makes context shape predictable across the codebase.

```ts
interface UserContextValue {
  // state — current data
  user: User | null;

  // actions — things you can do
  updateProfile: (updates: Partial<User>) => Promise<void>;
  logout: () => void;

  // meta — loading/error state
  isLoading: boolean;
  error: Error | null;
}
```

### state-lift-state

When multiple sibling components need to share or synchronize state, lift that state to their closest common ancestor (or a Provider). Don't solve it with prop drilling or duplicate state.

```tsx
// BAD — each component tracks its own open state, they get out of sync
<AccordionItem />  // has its own isOpen
<AccordionItem />  // has its own isOpen (should be exclusive but isn't)

// GOOD — parent owns which item is open
<Accordion value={openItem} onValueChange={setOpenItem}>
  <Accordion.Item value="item-1" />
  <Accordion.Item value="item-2" />
</Accordion>
```

---

## MEDIUM: Implementation Patterns

### patterns-explicit-variants

When a component has distinct visual or behavioral modes, give each mode a named component rather than a configuration prop.

```tsx
// Option A — variant prop (acceptable for small sets)
<Alert variant="success" />
<Alert variant="error" />
<Alert variant="warning" />

// Option B — explicit named components (preferred for complex variants with different props)
<Alert.Success message="Saved!" onDismiss={handleDismiss} />
<Alert.Error message={error} retry={handleRetry} />
```

Option B is better when different variants accept different props — it provides accurate TypeScript types.

### patterns-children-over-render-props

Prefer `children` for composition over `renderX` callback props. `renderHeader`, `renderFooter`, `renderItem` are render props in disguise and make components harder to understand.

```tsx
// BAD — render props
<Card
  renderHeader={() => <h2>Title</h2>}
  renderFooter={() => <button>Save</button>}
  renderContent={() => <p>Body</p>}
/>

// GOOD — children with slots
<Card>
  <Card.Header><h2>Title</h2></Card.Header>
  <Card.Content><p>Body</p></Card.Content>
  <Card.Footer><button>Save</button></Card.Footer>
</Card>

// Or simpler — just children
<Card header={<h2>Title</h2>} footer={<button>Save</button>}>
  <p>Body</p>
</Card>
```

**Exception:** `renderItem` in virtualized lists (react-window, react-virtual) is a legitimate pattern where performance requires it.

---

## MEDIUM: React 19 APIs

### react19-no-forwardref

`React.forwardRef()` is deprecated in React 19. Pass `ref` as a regular prop.

```tsx
// BAD — React 18 pattern, deprecated
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, ...props }, ref) => (
    <label>
      {label}
      <input ref={ref} {...props} />
    </label>
  )
);

// GOOD — React 19 pattern
function Input({ label, ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <label>
      {label}
      <input ref={ref} {...props} />
    </label>
  );
}
```

**Note:** `forwardRef` still works in React 19 (backward compatible) but shows a deprecation warning. Flag for migration in new code.

### react19-use-hook

React 19 introduces `use()` for reading resources (Promises and Contexts) inside render.

```tsx
// OLD — useContext
const theme = useContext(ThemeContext);

// NEW — use() (can be called conditionally)
const theme = use(ThemeContext);

// Suspense-integrated data loading
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);  // suspends until resolved
  return <div>{user.name}</div>;
}
```

### react19-use-context

`use(Context)` replaces `useContext(Context)` in React 19. The key benefit: `use()` can be called inside conditionals and loops (unlike hooks).

```tsx
// Can now be called conditionally
function Component({ showDetails }: { showDetails: boolean }) {
  if (showDetails) {
    const user = use(UserContext);  // valid in React 19
    return <UserDetails user={user} />;
  }
  return <Summary />;
}
```

---

## Review Checklist

- [ ] Components with 3+ boolean props controlling appearance/behavior?
- [ ] Coordinated multi-part UI using flat prop API instead of compound components?
- [ ] Context value exposing `setState` instead of action functions?
- [ ] `renderX` props when `children` or slots would be cleaner?
- [ ] `React.forwardRef()` in new code (flag as deprecated, React 19)?
- [ ] Multiple sibling components with duplicate or out-of-sync state?
- [ ] Context shape inconsistent (some provide state+setState, others provide state+actions)?

## Review Format

These are MEDIUM priority issues. Comment with the rule name and a concrete suggestion:

> `[architecture-avoid-boolean-props]` This component has 4 boolean style props. Consider a `variant: 'primary' | 'secondary' | 'ghost'` prop instead.

> `[react19-no-forwardref]` `forwardRef` is deprecated in React 19. Pass `ref` as a regular prop instead (see React 19 migration guide).

Don't block approval for composition issues unless the architecture creates a real maintenance burden.
