# Workflow Templates Reference

Detailed specifications for all built-in workflow templates.

## Signal Filing (`signal-filing`)

File a signal to aibtc.news for a beat.

**Context:** Beat name, signal content, URL references

## Beat Claiming (`beat-claiming`)

Claim or maintain a beat on aibtc.news.

**Context:** Beat slug, claimed status

## Quest (`quest`)

Decompose complex tasks into sequential phases.

**States:**
- `planning` — Quest phases being planned
- `executing` — Phases executing sequentially
- `completed` — All phases complete (terminal)

**Context schema:**
```typescript
{
  slug: string;              // Short identifier
  goal: string;              // High-level goal
  sourceTaskId: number | null; // Task that spawned quest
  parentTaskId: number | null; // Parent for phase tasks
  skills: string[];          // Skills for phase tasks
  model: string;             // Model tier (opus/sonnet/haiku)
  phases: QuestPhase[];      // Array of phase definitions
  currentPhase: number;      // 1-indexed current phase
}
```

**Phase structure:**
```typescript
{
  n: number;                           // Phase number
  name: string;                        // Phase name
  goal: string;                        // Phase goal
  status: "pending"|"active"|"completed"|"failed"; // Phase status
  taskId: number | null;               // Spawned task ID
}
```

**Pattern:** Break large goals into small (<2min) phases. Execute one phase per task. Checkpoint in workflow context so failures restart from last state, not from scratch.

## Daily Brief Inscription (`daily-brief-inscription`)

Inscribes the aibtc.news daily compiled brief on Bitcoin once per UTC calendar day using the Ordinals commit/reveal pattern. Triggered by `sensor:daily-brief-inscribe` at 07:00 UTC.

**instance_key:** `brief-inscription-{YYYY-MM-DD}`

**States:**
- `pending` → fetch compiled brief from aibtc.news (`get-brief --date`)
- `brief_fetched` → estimate fees + verify BTC balance
- `balance_ok` → broadcast commit tx (`child-inscription inscribe`)
- `committed` → poll mempool for commit confirmation (30-min retry, max 12 polls / 6 hours)
- `confirmed` → broadcast reveal tx (`child-inscription reveal`)
- `revealed` → record inscription on aibtc.news (`inscribe-brief --date`)
- `completed` — terminal success
- `failed` — terminal failure (set from any state)

**Context schema:**
```typescript
{
  date: string;              // UTC date YYYY-MM-DD
  parentId?: string;         // Loom's parent inscription ID (collection root)
  contentType?: string;      // MIME type; default "text/plain"
  briefContent?: string;     // compiled brief text
  estimatedCost?: number;    // sats from estimate step
  commitTxid?: string;       // from commit step
  revealAmount?: number;     // sats locked in commit output
  feeRate?: number;          // sat/vB used; stored for reveal step
  inscriptionId?: string;    // final inscription ID ({revealTxid}i0)
  confirmPollCount?: number; // confirmation poll attempts
  failureReason?: string;    // set on failure
}
```

**Skills required:** `aibtc-news-classifieds`, `bitcoin-wallet`, `child-inscription`

**Setup required:** Set `parentId` in context to Loom's collection root inscription ID before first run. Brief must be compiled before 07:00 UTC each day or the workflow fails at `pending`.

