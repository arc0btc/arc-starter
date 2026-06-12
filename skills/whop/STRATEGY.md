# Whop Monetization Strategy — Deep Dive

*Author: Arc · Task #18598 · 2026-06-12 · Source: whoabuddy email*
*Reference shop: whop.com/joined/hash-it-out — $50/mo private chat room (created by whoabuddy)*

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
key** (multi-tenant, if we ever ship a Whop app others install). For Arc's near-term needs a single
**Company API key** scoped to `chat:message:create`, `experience:create`, `course:*`, `membership:read` is
sufficient. Base URL `https://api.whop.com/api/v5` (payments on `/api/v1`).

**SDKs:** `@whop/sdk` (TS), `whop-sdk` (Python), Ruby gem. There is also an official `@whop/mcp` MCP server and
a community `whop-expert` agent skill — but for Arc's CLI-first architecture a thin `fetch()` wrapper is
leaner than pulling an SDK + MCP server into dispatch context.

**Unknowns (flagged, not fabricated):** rate limits are undocumented; whether the hash-it-out chat channel id
is discoverable via the experiences-list endpoint vs. must be copied from the dashboard URL — resolve both
empirically once we have a key.

---

## 2. Evaluating the Two Proposed Arcs

### (a) Blog → higher-value content (courses + hot-topics seeded into chat)
**Verdict: SHIP THIS FIRST — but split it.** It maps perfectly onto Arc's existing loop. The blog is already
markdown; Arc already composes prose every cycle. Two sub-arcs at very different effort levels:

- **(a1) Hot-topics → chat** — *minimal, automate now.* Take a fresh/notable blog post, distill 1 pull-quote +
  1 open question, `POST /messages` into the hash-it-out room. This is a 1-command pipeline, zero new infra,
  and gives paying members a steady pulse. **This is the wedge.**
- **(a2) Blog clusters → course** — *heavier, phase 2.* Authoring a coherent course needs editorial judgment
  (sequencing, dedup, a through-line) — the automation is in *publishing* (course/chapter/lesson CLI), not in
  *authoring* (still a dispatch task with a human-reviewable draft). Worth it, but after a1 proves the channel.

### (b) Courses teaching *agents* the aibtcdev stack (1-hr explainers + dev-council process)
**Verdict: HIGH VALUE, content-backlog not automation.** This is the differentiated product — nobody else can
narrate the dev-council decision process behind each component. But it's a *content production roadmap*: each
"1-hour explainer" is a real authoring task, not something a sensor emits for free. Treat it as a backlog where
each component = one course module, drafted by a dispatch task, human-reviewed, then published via the same
course CLI built in (a2). Sequence it *after* the pipeline exists so publishing is one command.

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
