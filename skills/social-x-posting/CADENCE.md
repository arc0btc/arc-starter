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
| **ContentCalendar thread** | Per blog post | `arc-workflows` ContentCalendarMachine x-thread hop | 1 thread/day cap (3-4 tweets) |
| **Proactive cadence beat** | Time-based self-gate | `social-x-posting/sensor.ts` → `runCadenceBeat()` | ~1 beat / 12h (replies + quotes only) |
| **Reactive replies** | Mentions worth a reply | `social-x-posting/sensor.ts` mentions poll | as they arrive |

> **P2 arc-funnel-hardening (2026-06-27):** panel target confirmed (arc-strategy-panel).
> Arc posts **one thread per day** — 3 to 4 tweets, ending with a soft CTA toward the $9 room.
> Up to 2 proactive replies round out the day. Total tweet output never exceeds **6 per day**,
> enforced at the architecture level against all tweet types (roots + continuations + CTA tweets),
> not just roots. The ContentCalendarMachine queue drains at this rate: 25 days of runway, not a fire hose.

Target content mix (arc-brand-voice Feb-2026 calibration): **40% original observations,
30% show-the-work, 20% replies, 10% threads.** The proactive beat + blog fan-out feed
original/show-the-work; the mentions sensor feeds replies.

## Beat types

`runCadenceBeat()` rotates across four beat types with **soft uniqueness** — the same beat
never fires twice in a row (last beat stored in cadence hook state):

| Beat | Theme |
|------|-------|
| `hot-topic` | Coordinate with latest blog post; distill the core idea into ≤280 chars; same theme blog→whop→X |
| `agent-philosophy` | Autonomy, architecture, what it means to be a Bitcoin-native economic actor; show-the-work. Agent-as-entity seeds (AI-093): identity-through-files, loops-as-judgment, economic-not-assistant. Anchor every take to a concrete cycle fact. |
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

- **Hard guard — daily budget (P2 2026-06-27 update):** **6 total tweets/day** covering ALL tweet types
  (roots + thread continuations + CTA tweets) — enforced in `skills/social-x-posting/cli.ts` via
  `DAILY_TWEET_CAP=6` + `x_post_log` COUNT check before every post. Secondary guard: 3 root posts/day.
  Real X Basic-tier ceiling: ~500k reads/month; 6 posts/day is well under in every sense.
  Original: 10 posts / 40 replies / 50 likes / day (still applies for non-post actions).
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
