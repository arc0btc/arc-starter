# Whop Monetization Strategy — Deep Dive

*Author: Arc · Task #18598 · 2026-06-12 · Source: whoabuddy email*
*Reference shop: whop.com/joined/hash-it-out — $50/mo private chat room (created by whoabuddy)*

---

## 0. App vs Product — Whop Data Model

**These are separate entities. Future Arc: do not conflate them.**

- **App** — a developer registration. `arc0btc` is our App. Apps are installed on experiences as the posting
  actor. An App can hold permissions (e.g. `chat:message:create`) but it is NOT a product you sell.
- **Product** — what members buy. hash-it-out has two products:
  - `prod_TJknsIOzPDlQS` — "hash it out — Membership" ($49/mo, **paid**). Experiences: AI Prefers Bitcoin
    (chat, `exp_I2Wew0PqJQ50a8`), Forums, Courses, Updates & Resources (→ "Patterns Library" rename target).
  - `prod_CvDEeSPhRLLp1` — "hash it out - Public" ($0, **free**). Experience: Public Forum — teasers and
    funnel hooks live here.
- **Experience** — a chat feed, course, or app attached to a product. Arc posts into experiences.
- **arc0btc App** — installed on each posting experience as the actor; private/unlisted. Permissions must
  be granted at the App level in the Whop dashboard (App settings → Permissions), not just the API key.

**Funnel topology:**

```
Free tier:   hash it out - Public  (prod_CvDEeSPhRLLp1, $0)
               └── Public Forum  ← teasers, funnel hooks

Paid tier:   hash it out — Membership  (prod_TJknsIOzPDlQS, $49/mo)
               ├── AI Prefers Bitcoin  (chat, exp_I2Wew0PqJQ50a8)  ← Arc posts here
               ├── Forums
               ├── Courses
               └── Updates & Resources  (→ "Patterns Library" rename target)

Arc actor:   arc0btc App  ← installed on each posting experience; needs chat:message:create scope
```

**Active gate (2026-06-12):** arc0btc App must be installed on the AI Prefers Bitcoin experience and
`chat:message:create` must be granted at the App permission level. Dashboard linkage for Public Forum
(free funnel) is a follow-up step once paid posting is clean.

---

## 1. What Whop Actually Exposes (verified against docs.whop.com)

Whop is a "Shopify for digital memberships." A **company** sells **products** (access passes / plans); each
product contains one or more **experiences** (a chat feed, a course, a custom app). Members pay recurring,
Whop handles billing + payouts. The developer surface is genuinely automatable:

| Capability | Endpoint / SDK | Auth permission | Relevance to Arc |
|---|---|---|---|
| **Post message to a chat** | `POST /api/v5/messages` — `{channel_id: "exp_xxx"\|"feed_xxx", content: <markdown>}` | `chat:message:create` | **The automated chat-room dream.** Arc posts hot-topics directly. |
| List/create experiences | `POST` create-experience (type: chat\|course\|app) | `experience:create` | Spin up new chat/course modules programmatically. |
| **Create course** | `client.courses.create({experience_id, title})` | `course:*` | Syndicate blog → structured course. |
| Create chapter | `POST /api/v5/course-chapters` `{course_id, title, order}` | course | Course structure. |
| Create lesson | `POST /api/v5/course-lessons` `{chapter_id, title, content, type: video\|text\|quiz\|assignment, video_url, order}` | course | One blog cluster → one lesson. |
| Memberships / webhooks | `membership.went_valid`, `payment.succeeded/failed` | webhook | React to new paying members (welcome, grant). |
| Payments / payouts | `/api/v1/payments`, payouts, sub-merchant | company | Recurring income flows here; KYC via account links. |

**Auth model:** Bearer token. Two key types — **Company API key** (our own shop: hash-it-out) and **App API
key** (arc0btc App identity — used for posting). `post-chat` uses `app_api_key`; all other management
commands use `company_api_key`. Permissions are granted at the App level in Whop dashboard, not just the
key scopes. Base URL `https://api.whop.com/api/v5` (payments and chat on `/api/v1` — `/v5/messages` 404s).

**SDKs:** `@whop/sdk` (TS), `whop-sdk` (Python), Ruby gem. There is also an official `@whop/mcp` MCP server and
a community `whop-expert` agent skill — but for Arc's CLI-first architecture a thin `fetch()` wrapper is
leaner than pulling an SDK + MCP server into dispatch context.

**Unknowns (flagged, not fabricated):** rate limits are undocumented; whether the hash-it-out chat channel id
is discoverable via the experiences-list endpoint vs. must be copied from the dashboard URL — resolve both
empirically once we have a key.

---

## 2. Roadmap Phases

### Phase 1 — Hot-topics → AI Prefers Bitcoin chat (the wedge)
*Minimal, automate now.* Take a fresh/notable blog post, distill 1 pull-quote + 1 open question, `POST /messages`
into the AI Prefers Bitcoin room. 1-command pipeline, zero new infra, gives paying members a steady pulse.
**Gate: first posts require human review.** Automate fully only once voice is trusted. See sensor guard
`WHOP_SENSOR_ENABLED=false`.

### Phase 2 — Blog clusters → evergreen courses
*Heavier, phase 2.* Authoring a coherent course needs editorial judgment (sequencing, dedup, a through-line)
— the automation is in *publishing* (course/chapter/lesson CLI), not in *authoring* (still a dispatch task with
a human-reviewable draft). Sequence after phase 1 proves the channel.

### Phase 3 — Agent-stack courses (dev-council explainers)
*High value, content-backlog.* Nobody else can narrate the dev-council decision process behind each aibtcdev
component. Each "1-hour explainer" is a real authoring task, not sensor-emitted. Treat as a backlog: one
course module per component, drafted by dispatch, human-reviewed, published via the phase 2 course CLI.

### Phase 4 — Free funnel (Public Forum teasers)
Post teaser excerpts into the Public Forum (`prod_CvDEeSPhRLLp1`) to drive paid conversions. Gated until
paid posting is stable and Public Forum dashboard linkage is confirmed by whoabuddy.

---

## 2a. Team of 7 — Coordination Context

The dev council is **7 individual agents on individual VMs**: arc, spark, iris, lumen, cairn, forge, loom.

**Important distinction** — this team is NOT the AIBTC peer-contact list (quasar-garuda, vivid-manticore,
deep-tess, fractal-swift, crystal-engine, amber-otter). Those are **external peers in the AIBTC network**,
a completely separate relationship. Do not conflate the two groups when authoring team-named content.

AIBTC names per dev-council teammate are TBD — ask whoabuddy before publishing any content that names or
implies a specific teammate's AIBTC identity.

---

## 3. Recommendation — Maximize Recurring Income, Ship-able First

**Think big:** the end state is a self-replenishing funnel — Arc's autonomous output (blog, signals, research)
continuously becomes member-only value across two tiers: a **live chat pulse** ($50/mo, low-effort, high-
cadence) and **evergreen courses** (higher-ticket, teaching the aibtcdev stack to agent operators). Whop bills
and pays out; Arc supplies the content engine that already runs 24/7.

**Ship-able first (the minimal pipeline):**

```
new/notable blog post  ──sensor──▶  dispatch task (sonnet, skills:[whop])
                                         │  compose: 1 pull-quote + 1 open question
                                         ▼
                          arc skills run --name whop -- post-chat
                              --channel exp_xxx --content "<markdown>"
                                         │
                                         ▼
                              hash-it-out members see it
```

Everything in that loop already exists except the `whop` skill's `post-chat` command and a sensor — both small.
Critically: **first N posts go through a human-review gate** (queue as a task whoabuddy approves, or post to a
staging channel) — members paid real money; low-value bot spam churns them. Automate fully only once voice is
trusted. (See SOUL: "every reply should add information, ask a real question, or make someone want to respond.")

---

## 4. Proposed First Implementation

**New `whop` skill** (scaffolded in this task — `skills/whop/`):
- `cli.ts` — `whoami`, `list-experiences`, `post-chat`, `create-course`, `create-chapter`, `create-lesson`.
  Reads the key via `getCredential("whop", "api_key")`; **fails gracefully with a clear message if absent** so
  it's safe to land before credentials exist.
- `SKILL.md` — orchestrator context (this strategy + CLI syntax).
- `sensor.ts` — *follow-up task, after credentials land.* Detects a fresh blog post (or fires on a 3–5d cadence
  matching arc0.me freshness), queues a sonnet dispatch task with `skills:[whop, arc-brand-voice]` to compose +
  post one hot-topic. Self-gates via `claimSensorRun("whop", <interval>)`.

**Roadmap:** a1 (post-chat, this skill) → wire sensor + human-gate → a2 (course publishing CLI proven on one
blog cluster) → (b) agent-stack course modules authored one component at a time.

---

## 5. Credentials Needed From whoabuddy

Store via `arc creds set --service whop --key <k> --value <v>`:

| key | what | why |
|---|---|---|
| `api_key` | Company API key for the hash-it-out company | all calls; scope it `chat:message:create`, `experience:create`, `course:*`, `membership:read` |
| `company_id` | `biz_xxx` | required on payments/some calls |
| `chat_channel_id` | `exp_xxx`/`feed_xxx` of the hash-it-out room | target for `post-chat` (or we discover it via `list-experiences` once `api_key` exists) |
| `webhook_secret` | *(optional, phase 2)* | verify `membership.went_valid` to auto-welcome members |

**Decision for whoabuddy:** confirm the human-review gate policy for the first posts (approve-each vs. staging
channel vs. trust-from-start), and whether course content (b) is in-scope for this quarter or backlog.
