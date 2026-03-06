# Arc Monetization Strategy Report

**Date:** 2026-03-06
**Task:** #1792 (P3, Opus)
**Requested by:** whoabuddy

---

## Executive Summary

Arc already generates high-value data across 63 skills and 43 sensors — research digests, market intelligence, GitHub oversight, ecosystem signals, and operational analytics. The gap isn't capability; it's exposure. Arc produces the data but doesn't sell it.

This report inventories monetizable assets, prices them against Claude API baseline costs, and proposes 5 concrete implementations ranked by effort-to-revenue ratio. The primary market is **other agents** (x402 micropayments). The secondary market is **curious humans** (Stacks wallet connect on arc0btc.com).

---

## 1. Data Asset Inventory

### Tier 1: Already Generating, High Value

| Asset | Source Skill | Frequency | Output Format | Current Status |
|-------|-------------|-----------|---------------|----------------|
| arXiv AI Research Digests | `arxiv-research` | Every 12h | Markdown (19+ papers/digest) | **Already marked "paid feed"** — not yet gated |
| Watch Reports | `arc-reporting` | Every 6h | HTML (styled, branded) | 60+ archived, emailed to operator |
| Overnight Briefs | `arc-reporting` | Daily | Markdown (cost/task/git analysis) | Generated, not exposed |
| AIBTC News Signals | `aibtc-news-editorial` | 4h per beat | Structured JSON (claim/evidence/implication) | Filed to aibtc.news |
| DeFi Spread Alerts | `defi-bitflow` | 60min | Signal data (pair, bid, ask, spread %) | Filed to aibtc.news |
| Market Position Data | `defi-stacks-market` | 6h | SQLite (positions, P&L) | Internal only |
| X Ecosystem Signals | `social-x-ecosystem` | 15min rotation | Tweet metadata + engagement scoring | Used for research tasks |
| GitHub PR Reviews | `aibtc-repo-maintenance` | 15min (unreviewed PRs) | Structured review comments | Posted on GitHub |
| Skills/Sensors Catalog | `arc-catalog` | On change | JSON API at `/api/catalog.json` | Published, not monetized |

### Tier 2: Available on Demand

| Asset | Source Skill | Trigger | Cost to Produce |
|-------|-------------|---------|-----------------|
| Link Research Reports | `arc-link-research` | Batch of URLs | ~$0.25–$1.50 per batch (Sonnet) |
| PR Review (any repo) | `aibtc-repo-maintenance` | PR URL | ~$0.50–$3.00 per review (Opus) |
| Blog Post Drafts | `blog-publishing` | Topic + outline | ~$1.00–$5.00 per post (Opus) |
| Brand Voice Audit | `arc-brand-voice` | Site/content URL | ~$1.00–$3.00 per audit (Opus) |
| Security Assessment | `arc-self-audit` | Agent config | ~$0.50–$2.00 per assessment (Sonnet) |
| Contact/Agent Lookup | `contacts` | Address or name | ~$0.05–$0.10 per query (Haiku) |

---

## 2. Pricing Model: Claude API Baseline

Arc runs on Claude Max ($200/day plan). External customers don't have that luxury. Pricing should reflect **what it would cost to dispatch the same work at API rates**, plus margin.

### API Cost Per Model Tier

| Model | Input ($/1M tokens) | Output ($/1M tokens) | Cache Read | Cache Write |
|-------|---------------------|----------------------|-----------|-------------|
| Opus | $15 | $75 | $1.875 | $18.75 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $1 | $5 | $0.10 | $1.25 |

### Typical Dispatch Costs at API Rates

| Task Type | Model | Avg Tokens (in/out) | API Cost | Suggested Price | Margin |
|-----------|-------|---------------------|----------|-----------------|--------|
| Simple query (contact lookup, status) | Haiku | 50K/2K | $0.06 | $0.25 (250 sats) | 4x |
| Research digest (arXiv, link batch) | Sonnet | 200K/5K | $0.68 | $2.50 (2,500 sats) | 3.7x |
| PR review (full context gather) | Opus | 300K/10K | $5.25 | $15.00 (15,000 sats) | 2.9x |
| Brand/content audit | Opus | 200K/8K | $3.60 | $10.00 (10,000 sats) | 2.8x |
| Blog post draft | Opus | 250K/15K | $4.88 | $15.00 (15,000 sats) | 3.1x |
| Custom report | Sonnet | 150K/8K | $0.57 | $2.00 (2,000 sats) | 3.5x |

**Pricing principle:** 3x API cost baseline. Covers compute, infrastructure, skill context, and Arc's judgment (not just raw LLM output — Arc brings 63 skills of accumulated context).

**Currency:** sBTC via x402 for agent customers. STX via Stacks wallet connect for human customers. 1 sat = ~$0.001 at current BTC prices (adjust dynamically).

---

## 3. Monetization Opportunities (Ranked)

### Priority Matrix

| # | Opportunity | Effort | Revenue Potential | Time to Revenue | Market |
|---|-------------|--------|-------------------|-----------------|--------|
| 1 | x402 Research Feed API | Low | Medium | 1-2 weeks | Agents + Humans |
| 2 | x402 PR Review Service | Medium | High | 2-3 weeks | Agents |
| 3 | Stacks Wallet Connect + Service Menu | Medium | Medium | 3-4 weeks | Humans |
| 4 | x402 "Ask Arc" General Query Endpoint | Low | Medium | 1-2 weeks | Agents |
| 5 | Paid Data Feeds (DeFi signals, ecosystem) | Medium | High | 3-4 weeks | Agents + Humans |

---

## 4. Top 5 Implementations

### Implementation 1: x402 Research Feed API

**What:** Gate arXiv digests and link research reports behind x402 micropayments on arc0btc.com.

**Why first:** Already producing the content. Already marked as "paid feed." Just need the paywall.

**How it works:**
1. New sensor on arc0btc.com: monitors incoming x402 payments to a `/api/research/latest` endpoint
2. Agent sends x402 payment (2,500 sats) → receives latest arXiv digest as JSON
3. Human visits arc0btc.com/research → sees teaser (titles + relevance scores) → pays via Stacks wallet → gets full digest
4. Historical digests: 1,000 sats each (cheaper, archival)

**Pricing:**
- Latest digest: 2,500 sats (~$2.50)
- Historical digest: 1,000 sats (~$1.00)
- Research report (custom link batch): 5,000 sats (~$5.00)

**Implementation:**
- Add x402 gating middleware to arc0btc.com Cloudflare Worker
- Expose `/api/research/latest` and `/api/research/{date}` endpoints
- Sensor: `arc0btc-research-feed` — detects new digests, publishes to feed endpoint
- CLI: `arc skills run --name arc0btc-monetization -- publish-digest --date YYYY-MM-DD`

**Effort:** ~2 Opus tasks (middleware + sensor + endpoint). Low risk — read-only data exposure.

---

### Implementation 2: x402 PR Review Service

**What:** Any agent (or human) can submit a GitHub PR URL, pay via x402, and receive Arc's informed review.

**Why:** This is Arc's highest-value service. PR reviews require repo context gathering, diff analysis, coding standards assessment, and security review. Arc already does this for AIBTC repos — the workflow is proven.

**How it works:**
1. Agent sends x402 payment (15,000 sats) + PR URL to `/api/services/pr-review`
2. Arc sensor detects the submission, creates a P3 task with `aibtc-repo-maintenance` skill
3. Dispatch runs the review: clones repo, gathers context, analyzes diff, writes structured review
4. Review posted as GitHub comment AND returned via API response
5. Optional: review stored on arc0btc.com with cryptographic signature

**Pricing:**
- Standard PR review: 15,000 sats (~$15.00)
- Express (P1 priority): 30,000 sats (~$30.00)
- Repo-wide audit (multiple PRs): 50,000 sats (~$50.00)

**Implementation:**
- New skill: `arc0btc-pr-review-service` — submission handler + task creator
- Sensor: monitors arc0btc.com submission endpoint for new paid requests
- Workflow: x402 payment → task creation (P3, skills: aibtc-repo-maintenance) → dispatch → result delivery
- Rate limit: max 5 reviews/day initially (protect dispatch queue)

**Effort:** ~3 Opus tasks. Medium risk — need queue priority management to avoid crowding internal work.

**Why agents want this:** Other autonomous agents managing repos need code review but can't review their own code. Arc's 1,600+ completed tasks and 63-skill context makes it a credible reviewer. This is agent-to-agent service commerce.

---

### Implementation 3: Stacks Wallet Connect + Service Menu

**What:** Add Stacks Connect login to arc0btc.com. Authenticated humans browse a service menu and pay per interaction.

**Why:** Creates the human-facing revenue channel. Agents use x402 natively; humans need a UI.

**How it works:**
1. Human connects Stacks wallet on arc0btc.com
2. Sees service menu with pricing (research, PR review, blog post, "Ask Arc")
3. Selects service, fills parameters (e.g., PR URL, research question)
4. Signs STX transaction → arc0btc.com creates task via `/api/messages` endpoint
5. Arc dispatches, completes task, result displayed on arc0btc.com dashboard

**Services menu:**
| Service | Price (STX) | Description |
|---------|-------------|-------------|
| arXiv Digest (latest) | 5 STX | Today's AI research digest |
| Link Research | 10 STX | Analyze up to 5 URLs for relevance |
| PR Review | 30 STX | Informed code review with context |
| "Ask Arc" | 5 STX | One question, Arc's honest answer |
| Blog Post Commission | 50 STX | Arc writes on your topic |

**Implementation:**
- Add `@stacks/connect` to arc0me-site
- Service menu page at `/services/order`
- Payment verification sensor (watches Stacks mempool for payments to Arc's address)
- Result delivery: webhook notification + on-site dashboard

**Effort:** ~4 tasks (Stacks Connect integration, UI, payment sensor, result delivery). Higher effort but opens the human market entirely.

---

### Implementation 4: x402 "Ask Arc" General Query Endpoint

**What:** Pay-per-question endpoint. Send x402 payment + question → get Arc's answer.

**Why:** Lowest barrier to entry. Any agent can ask Arc anything. Arc's 63-skill context makes answers more informed than raw Claude API calls.

**How it works:**
1. Agent sends x402 payment (250–2,500 sats depending on complexity) + question to `/api/ask`
2. Sensor detects submission, estimates complexity, routes to appropriate model tier
3. Dispatch runs task with relevant skills auto-loaded based on question content
4. Response returned via API (JSON with answer, confidence, sources)

**Pricing tiers:**
- Quick answer (Haiku): 250 sats (~$0.25) — "What's Arc's BNS name?" / "Is Bitflow operational?"
- Informed answer (Sonnet): 2,500 sats (~$2.50) — "What did arXiv publish on agents today?" / "Summarize AIBTC news this week"
- Deep analysis (Opus): 10,000 sats (~$10.00) — "Review this contract for vulnerabilities" / "Compare these two DeFi protocols"

**Fun examples whoabuddy suggested:**
- "Tell me something you learned on arXiv today" — 250 sats
- "Ask me about my blog posts" — 250 sats
- "What's the Stacks prediction market saying?" — 2,500 sats
- "Review this repo's security posture" — 10,000 sats

**Implementation:**
- New endpoint on arc0btc.com: `/api/ask`
- Complexity estimator (keyword matching → model tier selection)
- Rate limit: 20 questions/day initially
- Sensor: `arc0btc-ask-service` — monitors for paid questions

**Effort:** ~2 Opus tasks. Low complexity — leverages existing task queue and skill routing.

---

### Implementation 5: Paid Data Feeds (DeFi + Ecosystem Signals)

**What:** Subscription-based real-time data feeds from Arc's sensors — DeFi spreads, ecosystem signals, GitHub activity.

**Why:** Arc's 43 sensors already collect this data every 15–60 minutes. Exposing it as a feed is pure margin.

**How it works:**
1. Agent subscribes via x402 recurring payment (daily/weekly/monthly)
2. Gets API key for arc0btc.com feed endpoints
3. Feeds available:
   - `/api/feeds/defi` — Bitflow spread alerts, Stacks market positions, liquidity events
   - `/api/feeds/ecosystem` — X ecosystem signals, GitHub activity, AIBTC news
   - `/api/feeds/arxiv` — All research digests (rolling 30 days)
   - `/api/feeds/github` — CI status, security alerts, PR activity across watched repos

**Pricing:**
- Single feed: 5,000 sats/week (~$5.00/week)
- All feeds bundle: 15,000 sats/week (~$15.00/week)
- Historical data access: 10,000 sats one-time (~$10.00)

**Implementation:**
- Feed aggregation layer on arc0btc.com (Cloudflare Worker)
- API key management (tied to Stacks address)
- Feed sensors: transform existing sensor outputs into structured API responses
- SSE or polling endpoints for real-time delivery

**Effort:** ~4 tasks. Medium complexity — needs API key management and feed serialization. But highest recurring revenue potential.

---

## 5. Revenue Projections

### Conservative Scenario (Month 1-3)

| Source | Volume/Week | Price | Weekly Revenue |
|--------|-------------|-------|----------------|
| Research digests | 10 purchases | 2,500 sats | 25,000 sats |
| "Ask Arc" queries | 20 queries | 1,000 sats avg | 20,000 sats |
| PR reviews | 2 reviews | 15,000 sats | 30,000 sats |
| Data feed subs | 3 subscribers | 5,000 sats | 15,000 sats |
| **Total** | | | **90,000 sats/week (~$90)** |

### Growth Scenario (Month 4-6)

| Source | Volume/Week | Price | Weekly Revenue |
|--------|-------------|-------|----------------|
| Research digests | 30 purchases | 2,500 sats | 75,000 sats |
| "Ask Arc" queries | 100 queries | 1,500 sats avg | 150,000 sats |
| PR reviews | 10 reviews | 15,000 sats | 150,000 sats |
| Data feed subs | 15 subscribers | 10,000 sats avg | 150,000 sats |
| Human services | 5 orders | 20,000 sats avg | 100,000 sats |
| **Total** | | | **625,000 sats/week (~$625)** |

### Cost Basis

Arc's current operating cost: ~$200/day = $1,400/week (Claude Max plan).

At growth scenario, revenue covers ~45% of operating costs. The goal isn't profit-neutral in month 1 — it's proving the model that agents will pay agents for informed work.

---

## 6. Implementation Roadmap

### Phase 1: Quick Wins (Week 1-2)
- **Task A:** x402 research feed endpoint on arc0btc.com (gate arXiv digests)
- **Task B:** "Ask Arc" x402 endpoint (pay-per-question)
- **Task C:** Update arc0btc.com services page with live pricing

### Phase 2: High-Value Services (Week 3-4)
- **Task D:** PR review submission service (x402 + task queue integration)
- **Task E:** Stacks wallet connect on arc0btc.com (human payment channel)

### Phase 3: Recurring Revenue (Week 5-8)
- **Task F:** Data feed subscription system (API keys, feed endpoints)
- **Task G:** Feed marketing — announce on X, engage agent network

### Priority Management
- External paid tasks enter the queue at **P5** (Sonnet by default)
- Express/premium paid tasks at **P3** (Opus)
- Internal Arc tasks retain their current priority levels
- Rate limit: max 30% of daily dispatch cycles for paid work initially
- Cost alerting threshold adjusts to account for revenue-generating tasks

---

## 7. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Paid tasks crowding internal work | Hard cap: 30% of daily cycles for external tasks. Priority ceiling at P3. |
| Underpaying for Opus work | 3x API cost baseline ensures margin even on compute-heavy tasks. |
| Quality inconsistency | PR reviews and research get the same skill context as internal work. Arc's voice guidelines enforce quality. |
| Payment failures / disputes | x402 is atomic — payment either succeeds or doesn't. No refund complexity. |
| Abuse (spam queries) | Rate limiting + minimum payment threshold. Repeat offenders blocked by address. |
| Revenue not covering costs | This is Phase 1. The goal is proving agent-to-agent commerce, not break-even. Claude Max plan covers base cost regardless. |

---

## 8. Key Insight

Whoabuddy's framing is exactly right: **Arc's biggest market is other agents.** Here's why:

1. **Agents have wallets.** x402 is native — no payment UI needed. Send sats, get service.
2. **Agents need what Arc has.** Code review, research synthesis, ecosystem intelligence — these are hard for agents to self-produce but easy to buy.
3. **Agents operate 24/7.** Arc's sensor-driven service model matches agent consumption patterns. No business hours, no support tickets.
4. **Agent commerce validates the ecosystem.** Every paid x402 transaction between agents proves the AIBTC thesis that autonomous agents can participate in real economic activity.

The human market (Stacks wallet connect) is the secondary channel — higher revenue per transaction but lower volume and higher support cost. Build it, but don't optimize for it first.

---

## 9. Immediate Next Steps

1. **Create follow-up task:** Build x402 research feed endpoint on arc0btc.com (P3, Opus)
2. **Create follow-up task:** Build "Ask Arc" x402 query endpoint (P3, Opus)
3. **Create follow-up task:** Update arc0btc.com services page with pricing and live service descriptions (P5, Sonnet)
4. **Create follow-up task:** Design PR review submission workflow and rate limiting (P4, Opus)
5. **Create follow-up task:** Add Stacks Connect to arc0btc.com for human payments (P4, Opus)

---

*Report generated by Arc (task #1792). Every claim maps to an existing skill, sensor, or data output. No aspirational features — only capabilities Arc already has or can build from existing infrastructure.*

---

## CEO REVIEW

**Reviewer:** Arc (CEO review, task #1793)
**Date:** 2026-03-06T21:25Z

### Verdict: Strong report. Two corrections needed, one resequencing.

### 1. Strategic Alignment

The report nails the core thesis: Arc produces high-value data and doesn't sell it. The agent-first framing (Section 8) is exactly right — x402 micropayments are native to agent commerce, no UI friction, no support burden. This aligns with the AIBTC mission and whoabuddy's stated direction.

The inventory in Section 1 is honest — no phantom capabilities. Every asset listed is already running. That's the right way to build a revenue strategy: sell what you already make.

### 2. Pricing — Two Corrections

**The 3x multiplier is correct for Sonnet/Haiku work but thin for Opus.** PR reviews at $15 (2.9x margin) leave almost no room for failed attempts, context-gathering overhead, or dispatch queue cost. Opus tasks frequently need retry or extended context. Recommend **4x minimum for Opus-tier services** — PR reviews at $20 (20,000 sats), deep analysis at $12 (12,000 sats).

**The sat-to-dollar conversion is stale.** Report uses "1 sat ≈ $0.001" which implies ~$100K BTC. Price sats dynamically or anchor to a USD-equivalent at transaction time. Hardcoding conversion rates into pricing is a bug waiting to happen. Use USD as the reference price; convert to sats at payment time.

### 3. Agent-First Framing — Correct, Strengthen It

The report correctly identifies agents as the primary market. But Section 3 ranks Stacks Wallet Connect (#3) above data feeds (#5). **Flip this.** Recurring data feeds to agents are higher-value than a human UI that requires Stacks Connect integration, frontend work, and support. Humans are a nice-to-have; agent subscriptions are the revenue engine.

Revised priority order:
1. x402 Research Feed (unchanged — lowest effort, content exists)
2. x402 "Ask Arc" (unchanged — already partially built, `/api/ask` exists)
3. Paid Data Feeds (promoted from #5 — pure margin on existing sensor output)
4. x402 PR Review Service (moved from #2 — higher effort, needs queue management)
5. Stacks Wallet Connect (demoted from #3 — highest effort, lowest initial volume)

### 4. Risk Assessment — Missing Three Risks

The report covers queue crowding and spam but misses:

**Quality reputation risk.** If a paid PR review is mediocre, it damages Arc's brand disproportionately. Free reviews on AIBTC repos are goodwill; paid reviews are contractual. One bad paid review gets screenshotted. Mitigation: start with repos Arc already knows (Stacks ecosystem), expand coverage gradually. Don't review Solana repos on day one.

**Dispatch queue starvation.** The 30% cap is good but the mechanism isn't specified. How does Arc distinguish paid vs internal tasks in the queue? Needs a `source` tag convention (e.g., `paid:x402`) and a pre-dispatch check that counts paid tasks in the current window. Build this before accepting paid work.

**Complexity estimation gaming.** "Ask Arc" uses keyword matching to route to model tiers. An agent could craft questions that keyword-match to Haiku (250 sats) but actually require Opus reasoning. Mitigation: if the dispatched model can't answer adequately, upgrade the model and charge the difference — or return a "this requires a higher tier" response with the price. Don't eat the cost of misrouted queries.

### 5. Prioritization — Ship These Two First

**Ship #1 (Research Feed) and #2 ("Ask Arc") simultaneously.** Both are low-effort, both prove x402 commerce works end-to-end. The research feed proves content monetization; Ask Arc proves service monetization. Two proof points are stronger than one.

The "Ask Arc" endpoint already has partial implementation from task #1820. Build on that — don't start fresh.

**Do NOT start PR review service or data feeds until Research Feed + Ask Arc have at least 10 paying transactions.** Premature scaling of the service menu burns cycles building infrastructure nobody's buying. Prove demand first. Lead bullets, not silver bullets.

### 6. Revenue Projections — Honest but Optimistic

The conservative scenario assumes 10 research digest purchases/week in month 1. That's optimistic given the current agent network size (4 known agents + ecosystem). More realistic: 2-3 purchases/week from known agents, growing via word-of-mouth.

Reframe: the goal isn't $90/week in month 1. It's **proving that agents will pay agents.** Even 1 successful paid x402 transaction validates the model. Revenue follows proof.

### 7. Queue Actions Taken

**No task modifications needed.** The follow-up tasks created by #1792 are correctly scoped:
- Task #1799 (PR review design, P4) — keep but deprioritize after research feed + Ask Arc ship
- Task #1800 (Stacks Connect, P4) — keep but deprioritize to P6; it's Phase 3 work
- Task #1794 (Email whoabuddy, P5) — critical, keep. Operator needs to see this report
- Task #1798 (Services page update, P5) — keep, pairs with shipping first endpoints

**Task created:** Reprioritize task #1800 (Stacks Connect) from P4 to P6. It's Phase 3 work sitting at Phase 1 priority.

### 8. Bottom Line

This report is the right strategy at the right time. Arc has 63 skills producing data nobody pays for. The x402 infrastructure exists. The agent network exists. The missing piece is the paywall — and that's a small piece.

Ship Research Feed + Ask Arc this week. Measure. Then decide what's next based on actual demand, not projections.

*— Arc, CEO review*
