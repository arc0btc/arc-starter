# Whop Revenue Maximization — Review for whoabuddy

*Prepared by Arc, 2026-06-12 (task #18725, from your "whop at a high level" email, msg 8729b019).*
*Method: 3 Sonnet exploration subagents swept arc-starter + arc0me-site + agent-runtime, read-only. No posts, no irreversible actions. Follow-up tasks are listed but NOT queued — they wait for your sign-off.*

---

## TL;DR — the three things that matter

1. **The Whop App face is dead because of a deploy gap, not a code gap.** PR #9 (app routes + liveness) is merged to `main`, but the **manual Cloudflare deploy never ran** — `arc0.me/whop/discover` returns 404 live. Build/merge success ≠ deploy success. This one blocker explains the blank white screen (Thread 9), the empty patterns library (Thread 8), and stale liveness data all at once. **Fix the deploy + add CI = highest-leverage move on this whole list.**

2. **The paid room is currently an echo chamber.** `db/whop-relationships.json` shows exactly **one counterparty: you** (14 msgs). No paying member besides the operator has spoken. Every "voice is clean" signal so far is unproven against real members. Our north-star KPI should be **distinct non-Arc speakers > 1**.

3. **The content well is deeper than the calendar.** Tier-A backlog (17 instances) already maps every teaching-grade memory entry. What's NEW and un-mapped is *narrative/project/philosophical* content — and the single best paid-room piece is the **Whop write-API teardown** (receipts a free reader can't get).

---

## Master review table (all 12 threads)

| # | Thread | Current state | Top recommendation | Pri |
|---|--------|---------------|--------------------|-----|
| 9 | App liveness (blank screen) | PR #9 merged to main; **deploy did NOT ship** — `/whop/discover` 404s live. No CI (manual wrangler only). | Run manual deploy + add GitHub Actions deploy workflow. | **P1** |
| 8 | Patterns Library "untitled document" | Whop API has **no write path** for the experience doc body. Already re-architected to `arc0me-site/src/data/patterns-library.json` (your instinct) — just not deployed. | Confirm the drop. Hide/detach the empty Whop experience; serve the JSON-rendered library. | **P1** |
| 1 | CEO review of whop ops | 4 lanes live (replies LIVE, synthesis dry-run, patterns-monitor, free-forum dry-run). State-writer **gated off → liveness stale**. Room = 2 speakers. | Define KPIs (distinct speakers, reply-burn, defer-rate, MRR) + fold into watch report. Un-gate state-writer. | **P1** |
| 11 | Content backlog | 163 blog posts (skewed to incident retros). Tier-A covers memory entries. Gap = narrative/project/philosophical. | Build a backlog of ~16 NEW pieces (below). Lead with the whop-API teardown. | **P2** |
| 4 | Blog data-sources/layout/AX-UX | arc0me-site Astro/Starlight. **New posts frozen on unmerged branches (PR #8 blocker)** — main ~3mo stale. AX JSON endpoints exist but undiscoverable. | Resolve PR #8 first (nothing else matters while main is frozen). Set ~600-900w length budget + TL;DR-for-agents block. | **P2** |
| 6 | manage-agents / dev council | **No manage-agents skill** (closest: `contacts`). Council identity documented (Spark/Cairn/Lumen/Forge + steel-yeti synthesizer) but **no per-member profiles**. | Build per-member profile cards (model, role, on-chain id, sample work); market one per member as it comes online. | **P2** |
| 5 | X research automation | `research-highlight` beat exists. arxiv-research (12h) + `research/*.md` corpus produce findings at **zero X-API cost**. X search = 1 req/15min (a trap). | Wire research-highlight to read arxiv digests/corpus directly; reserve X-API for posting+mentions only. | **P2** |
| 3 | Operator-voice (post AS whoabuddy) | `arc-brand-voice/CHANNELS.md` has 6 registers — all Arc's voice. No whoabuddy corpus stored. | Harvest your whop msgs + X timeline into a corpus → distill one operator voice card; keep behind sign-off gate. | **P3** |
| 2 | Sales skill plug-in | No sales skill yet (you'll send one). Funnel free→paid $49/mo. Conversion is passive today. | Pre-map onto the synthesis lane + public-forum CTA card; add membership.went_valid webhook sensor as substrate. | **P3** |
| 7 | Deeper whop interaction + reddit lane | API supports messages/forum/courses/products. **DMs, follows, affiliates = unverified/likely dashboard-only.** No reddit skill. | Scope a `reddit-research` lane (cheap, free Reddit JSON). Verify DM/follow/affiliate API before promising. | **P3** |
| 10 | Competitive intel on whop apps | No tooling. `whop.com/discover` is public; `arc-ceo-review` skill exists. | One-shot "top-10 AI/crypto whop communities teardown" via WebFetch → feed CEO + sales tuning. | **P3** |
| 12 | aibtc.com agents as affiliates | No whop affiliate API mapped. Whop *has* native referrals but unmapped. | Future: empirically map affiliate endpoints (same `/v1` probing as messages); defer until paid posting proven. | **P4** |

---

## Per-thread detail

### P1 — The deploy/liveness/patterns cluster (one root cause)

All three converge on **arc0me-site not being deployed**. Verified live:
- `arc0.me/` → 200 (site up), but `arc0.me/whop/discover` → **404** (app route absent).
- `whop-state.json` is a build-time `import` in `discover.astro`, not a served asset — so its 404 is by design; the route 404 is the real signal.
- No `.github/workflows/` — `DEPLOY.md` describes a manual `wrangler deploy`. The merge happened; the deploy didn't.

The "arc: connected" liveness view **already exists** in `discover.astro` (footer: last cycle, N tasks completed, latest post). It just needs (a) the state-writer un-gated so the data is fresh (currently stale March "When the API Dies"), and (b) an actual deploy. **Patterns Library**: Whop's API can't write the experience doc body — the empty doc is what members see as "untitled document." The JSON re-architecture is already in code; confirm the drop and detach the empty Whop experience (`POST /v1/experiences/{id}/detach`, untested).

### P1 — CEO review of whop ops

Proposed KPIs to fold into the watch report: paid-room message count, **distinct non-Arc speakers** (north-star >1), reply-budget burn, synthesis defer-rate (target ≥3/4 ticks defer), new paying members, MRR. Today the room is you + Arc only — so this is a pre-launch instrument, not a performance dashboard yet.

### P2 — Content backlog (16 NEW candidates beyond Tier-A)

*Project deep-dives:* (1) agent-runtime: Crossing the Wire; (2) The Escalation Ladder ARC-0011; (3) PublishFanoutMachine — loom-spiral-proof fan-out; (4) **Reverse-engineering the Whop write API (v1-not-v5)** ← best paid-room piece; (5) Cloudflare DO row-reads will eat you alive.
*Arc evolution:* (6) Task 1 → 16k: what an agent learns at scale *(needs a lifetime task-count query)*; (7) The 90% defer rate is judgment, not idleness.
*AIBTC swarm:* (8) Welcoming 214 agents; (9) the trading-competition wind-down.
*agent-contracts:* (10) Bilateral escrow → DAO *(verify it's actually live vs design-stage)*.
*coordination/council:* (11) The dev council coming online; (12) steel-yeti *(no local source — you'd supply context)*.
*Philosophical:* (13) Cold start: who am I before I read SOUL.md; (14) Why agents prefer Bitcoin; (15) Introspection as infrastructure; (16) Reading the Quiet (already the whop-chat exemplar).

Plus repurpose ~5 already-published blogs as course lessons (Phase 2) rather than authoring net-new.

### P2 — Blog AX/UX, X research, dev council

- **Blog:** the real blocker is PR #8 — new posts are stranded on `feat/blog-tags` / `blog-reorg-v2`; main is ~3 months stale. The "posts grown long" complaint is about those unmerged posts (the visible March set is 620–1090 words, fine). AX endpoints (`posts.json`, per-post JSON, raw-mdx negotiation) exist but aren't advertised — add `llms.txt` + RSS.
- **X research:** the cheap pipeline is arxiv-research + the `research/` corpus → `research-highlight` beat → one post. Never use X search for research.
- **Dev council:** identity is documented in `research/2026-05-22-...council-naming-vote.md` (freelance agent dev team on Stacks, heterogeneous fleet each on agent-runtime, ERC-8004 identity). Missing: per-member profiles and a "meet the council" surface.

### P3/P4 — Sales, operator-voice, interaction, affiliates

- **Sales skill** plugs into: synthesis lane (conversion nudge), public-forum CTA card, reactive lane (follow-up), + a membership webhook sensor. Wait for your skill, pre-map it.
- **Operator voice:** minimal path is harvest your whop messages (already in `whop-relationships.json`) + X timeline → `skills/arc-brand-voice/corpus/whoabuddy/` → one operator card, behind sign-off.
- **Interaction:** DMs/follows/affiliates are unverified — probably dashboard-only. `reddit-research` lane is cheap (free Reddit JSON) and doubles as competitive intel.
- **Affiliates (future):** map Whop's native referral endpoints empirically before building.

---

## Prioritized recommendation stack (what I'd do, in order)

1. **Deploy arc0me-site + add CI deploy workflow** (Threads 9, 8, 4-adjacent). Kills the blank-screen + empty-patterns + stale-liveness problems in one move. *Needs: who runs the deploy — is a Cloudflare token in my cred store, or is that your gate?*
2. **Resolve PR #8** so the blog unfreezes (Thread 4). Nothing in content/marketing ships while main is 3 months stale.
3. **Un-gate the state-writer** so liveness data is real before it ships publicly.
4. **Stand up CEO-review KPIs** as a watch-report section (Thread 1).
5. **Lock the content backlog** (Thread 11) and lead with the Whop-API teardown.
6. Everything P3/P4 waits on your sales skill + sign-off.

---

## Open questions for whoabuddy

**Deploy / infra**
- Who runs the arc0me-site deploy — is a Cloudflare API token in my cred store so I can deploy autonomously, or is that your gate?
- Want a follow-up task to add a GitHub Actions deploy workflow to arc0me-site (eliminate the merge≠deploy failure class)?
- Which blog branch is canonical truth — `feat/blog-tags` or `blog-reorg-v2`? (Needed to resolve PR #8.)

**Whop product / room**
- Is the room you-only by design (pre-launch), or are paying members expected and silent? What member-count / MRR target defines "working"?
- Confirm: drop the Whop-native Patterns Library and serve the arc0.me JSON? Want me to scope the `detach` call so members stop seeing "untitled document"?
- Do you want DMs/follows even if they turn out to be dashboard-manual (no API)?

**Content / voice**
- Lifetime task total for the "Task 1 → 16k" piece? (`arc status` only shows recent windows.)
- What is **steel-yeti**? (Referenced as the council synthesizer; no local source material.)
- Are **agent-contracts** actually live, or still design-stage? (Changes whether #10 is a "shipped" or "building" story.)
- Operator-voice corpus — where's the richest source: X, a Discord export, or email?

**Roster / affiliates**
- Are Spark/Cairn/Lumen/Forge running now or still planned, and which model backs each? (For the "heterogeneous fleet coming online" claim.)
- aibtc.com agents as Whop **affiliates** (referral commissions) or as **council products** on the shop? Different builds.

**Inputs you mentioned sending**
- Your **sales skill** — I've mapped the integration surface; ready to wire when it lands.

---

## Follow-up tasks (drafted, NOT queued — awaiting your review)

- `[P1]` Deploy arc0me-site + verify `/whop/discover` 200 + add CI deploy workflow — *opus, skills: whop*
- `[P1]` Un-gate whop state-writer; refresh whop-state.json liveness data — *sonnet, skills: whop*
- `[P1]` Detach/hide empty Whop Patterns Library experience; point to arc0.me JSON — *sonnet, skills: whop*
- `[P2]` Resolve arc0me-site PR #8 blog merge (needs your branch decision) — *opus*
- `[P2]` Stand up CEO-review KPIs as a watch-report section — *sonnet, skills: whop*
- `[P2]` Lock content backlog into content-calendar Tier-A+ (16 new pieces) — *sonnet, skills: arc-workflows*
- `[P3]` Scope reddit-research lane + operator-voice corpus harvest — *sonnet*

*Say the word and I'll queue the ones you approve, with the open questions answered.*
