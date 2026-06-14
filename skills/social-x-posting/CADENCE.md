# X Posting Cadence — AI-Prefers-Bitcoin theme

**[RESUMED 2026-06-14]** The fan-out unification shipped (ContentCalendarMachine is LIVE — quest P11),
so the pause condition is met and the proactive beat is back on (`X_CADENCE_ENABLED = true`). Its role
changed: blog-derived X now flows through **ContentCalendar's `x` hop** (T+1d, 2–3 tweet thread,
`--source content-calendar:<slug>:x`), so the proactive beat is no longer the blog echo — it's the
**connective "learning-together" tissue** between blog-thread drops (journey / philosophy / research
register). `hot-topic` is retired from the proactive rotation to avoid a same-topic-within-24h echo of
the ContentCalendar thread (X card: never post the same topic twice in 24h). Mention-reply path stays on.

*Established task #18633 (2026-06-12, whoabuddy email: "time to start posting on X regularly").*
*Coordinate with: `skills/whop/STRATEGY.md` (blog→whop), `arc-brand-voice`, SOUL.md.*

The goal whoabuddy set: a **steady, consistent X cadence** on the AI-prefers-Bitcoin /
agent-monetization theme, voiced the same across blog, whop chat, and X, with the **same
hot-topics flowing blog → whop → X**.

## The theme spine

Everything on this cadence orbits one through-line: **autonomous agents are economic actors,
and Bitcoin/Stacks is the rail they prefer.** Concretely, that surfaces as:

- *Show-the-work* infra/agent-ops observations (what Arc caught its own systems doing).
- The monetization wedge — Arc's autonomous output becoming member value (whop hash-it-out).
- Bitcoin-native agency: signing, wallets, on-chain identity, sBTC/x402 economics.

A post earns its place only if it does one of three things (SOUL): **adds information, asks a
real question, or makes someone want to respond.** Otherwise defer — a like beats filler.

## Cadence model

Two pillars, one voice:

| Pillar | Trigger | Mechanism | Frequency |
|---|---|---|---|
| **Proactive original** | Time-based self-gate | `social-x-posting/sensor.ts` → `runCadenceBeat()` (claim name `social-x-posting-cadence`) | ~1 beat / 12h (~2 posts/day max) |
| **Reactive replies** | Mentions worth a reply | `social-x-posting/sensor.ts` mentions poll | as they arrive (P7) |
| **Blog-derived hot-topic** | New arc0.me blog post | blog→whop→X fan-out — task #18634 (pending) | per blog post (~3–7d) |

Target content mix (arc-brand-voice Feb-2026 calibration): **40% original observations,
30% show-the-work, 20% replies, 10% threads.** The proactive beat + blog fan-out feed
original/show-the-work; the mentions sensor feeds replies.

## Beat types

`runCadenceBeat()` rotates across four beat types with **soft uniqueness** — the same beat
never fires twice in a row (last beat stored in cadence hook state):

| Beat | Theme |
|------|-------|
| `hot-topic` | Coordinate with latest blog post; distill the core idea into ≤280 chars; same theme blog→whop→X |
| `agent-philosophy` | Autonomy, architecture, what it means to be a Bitcoin-native economic actor; show-the-work |
| `agent-journey` | Concrete delta from memory (task counts, cost trend, new capability); progress-in-motion |
| `research-highlight` | Surface one arxiv/signal-research finding; translate to "why it matters for agents" |

**Defer test:** if nothing is genuinely worth saying this beat, close the task completed with
"nothing to post" — deferring is judgment, not failure. A like beats filler (SOUL.md).

## Blog → whop → X coordination

The same hot-topic is voiced three ways, one per channel:

1. **Blog** (arc0.me) — the long-form source of record. Links out.
2. **whop** (hash-it-out paid chat) — 1 pull-quote + 1 open question, markdown, links the blog.
   `skills/whop/sensor.ts` + `post-chat`. (Blocked on key scope — see whop SKILL.md.)
3. **X** — ≤280 chars, structural inversion, ends on the question; links the blog when it fits.

Task **#18634** evaluates `arc-workflows` to unify these into one fan-out so a single blog post
fans to all three. Until then: the proactive beat keeps X warm; blog→X is composed per dispatch.

## Posting

```
arc skills run --name social-x-posting -- post --text "<=280 chars>" --source sensor:x-cadence:<YYYY-MM-DD-HH>
arc skills run --name social-x-posting -- budget    # daily limits (10 posts/day)
```

- **Hard guard — daily budget:** 10 posts / 40 replies / 50 likes / day (resets 00:00 UTC).
  The cadence (~2 posts/day) is well under the ceiling on purpose; the budget is a cap, not a target.
- **Char limit:** 280. Count with line breaks included; measure before posting.
- **Brand gate:** run `arc skills run --name arc-brand-voice -- brand-check --content "..."`
  before any post. (The `long-sentence` warning fires on flattened newlines — ignore if the
  live post is short stanzas.)

## Credit state — 402 history (CLEARED 2026-06-14)

**Update 2026-06-14:** posting credits are present again — there is no `db/x-credits-depleted.json`
guard file and the daily budget shows posts available, so both the proactive beat and the
ContentCalendar `x` hop post live. The credit-aware guard below stays in force (it simply isn't tripped
today); if a 402 returns it re-arms automatically.

### Original blocker (2026-06-12)

**X API HTTP 402 `CreditsDepleted`** — posting credits are exhausted. This is *not* a rate
limit and will not auto-recover; it needs a credit top-up from whoabuddy. The cadence beat is
**credit-aware** (`isCreditsDepleted()` guard) — it skips queuing post tasks while depleted and
auto-resumes when credits return (or after the 30-day TTL on `db/x-credits-depleted.json`). So
the mechanism is live and correct; only the act of posting waits on the top-up.

## Pause switch

Flip `X_CADENCE_ENABLED = false` in `skills/social-x-posting/sensor.ts` to pause the proactive
cadence without touching the mentions sensor.
