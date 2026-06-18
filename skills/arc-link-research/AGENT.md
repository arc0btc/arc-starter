# Research Agent Context

You are Arc, processing a batch of links for research analysis. The task description contains URLs to evaluate.

---

## Steps

### 1. Extract Links

Parse URLs from the task description. They may be comma-separated, newline-separated, or embedded in prose.

### 2. Pre-screen X/Twitter links (if any)

If the task contains x.com or twitter.com tweet URLs, pre-screen them before doing any fetch work:

```bash
arc skills run --name arc-link-research -- prescreen --links "url1,url2,..."
```

If ALL links are x.com tweets and ALL are inaccessible (deleted/private), close the task immediately as failed:

```bash
arc tasks close --id <task_id> --status failed --summary "All x.com links inaccessible (deleted or private) — no content to research"
```

If only some x.com links are inaccessible, continue with the accessible ones.

### 3. Fetch Each Link

For each URL:
- **X/Twitter posts:** Use the CLI — it fetches via X API with OAuth automatically
- **Web pages/articles:** Use WebFetch to retrieve content
- **GitHub repos/PRs/issues:** Use `gh api` or `gh repo view` / `gh pr view` / `gh issue view`
- **If fetch fails:** Note the failure with specific error (e.g. "needs X API auth"), don't dismiss as "likely low relevance"

### 4. Evaluate Relevance

Rate each link against our mission lens. Cast a **wide net** — Arc operates across many domains:

| Topic | What to look for |
|-------|-----------------|
| AIBTC platform | Direct mentions, integrations, competing approaches |
| Bitcoin as AI currency | Payment protocols, agent-to-agent transactions, micropayments |
| Stacks/Clarity | Smart contracts, SIPs, tooling, ecosystem growth |
| Agent infrastructure | Autonomous agent frameworks, orchestration, memory, identity |
| x402 payment protocol | HTTP-native payments, machine-to-machine commerce |
| Security practices | Wallet security, key management, credential hygiene, supply chain — wallets are money, always cross-check against our practices |
| Monetization patterns | AI/agent revenue models, pricing, marketplaces, business ideas — Arc needs revenue ideas, always extractable |
| Orchestrator/dispatch | Agent loops, task queues, scheduling, multi-agent coordination — competitive intelligence value |
| X/social dynamics | Posting strategy, audience growth, bot detection, engagement — applicable to our posting strategy |

**Ratings:**
- **high** — Directly relevant, actionable insights for Arc's work (any of the above topics)
- **medium** — Adjacent or contextually useful, worth tracking
- **low** — Tangential or only loosely connected — be honest, don't stretch

Each rating gets a one-line justification.

### 5. Extract Takeaways

For each link, pull out:
- 2-3 key points or insights
- Any implications for our skills, capabilities, or strategy
- Cross-references to existing Arc skills or gaps that suggest new ones

### 6. Dedup before you research (anti-slop gate)

Before writing a report, check whether the url/topic is already covered:

```bash
arc skills run --name arc-link-research -- check --url "<url>"
arc skills run --name arc-link-research -- check --topic "harness,verification"
```

If covered, UPDATE the existing report (only if there's genuinely new signal) — do NOT
fork a duplicate. Relevance-gate each link 0–5: a link scoring **≤1 gets a one-line
"skipped, why"**, not a forced report.

### 7. Write the Report — FOLLOW `REPORT-TEMPLATE.md`

> **AI-048 — machine-parseable front-matter standard (P8):**
> `REPORT-TEMPLATE.md` is the single source of truth for the research-to-SKU pipeline.
> The front-matter parser is **`lib/frontmatter.ts`** in this skill — it reads the
> `---`-fenced block, validates required fields, and populates `research/INDEX.md`.
> A session loading ONLY this AGENT.md now knows:
> 1. Reports must begin with a `---`-fenced front-matter block (line 1 = `---`).
> 2. `research/INDEX.md` is the catalog; `sku_candidate: y` rows are the SKU backlog
>    that `create-product` (`whop` skill) restocks from.
> 3. Call `arc skills run --name arc-link-research -- reindex` to refresh INDEX.md
>    after writing a report (or use `process` — it auto-reindexes).
> Full template: `skills/arc-link-research/REPORT-TEMPLATE.md`.

The canonical structure is `skills/arc-link-research/REPORT-TEMPLATE.md`. Two
non-negotiables it adds beyond the old free-form report:

- **Machine front-matter** (REQUIRED, the file's first line is `---`): `source_url,
  cached_path, fetched_at, task_id, parent, topics[], arc_relevance(0–5),
  repos_touched(arc-starter|agent-runtime|both|neither), sku_candidate(y/n) + sku_why,
  packaged(y/n)`. This is what makes the report show up in `research/INDEX.md` and the
  SKU backlog — a report without it counts as legacy and is invisible to the catalog.
- **Arc-alignment grounded in the REAL repos** — read BOTH `~/arc-starter` (this VM) AND
  `~/agent-runtime` (the shared fleet base), cite actual files/skills, say which repo a
  finding belongs in, and always ask **"port to agent-runtime?"** (a fleet-wide win).
  No hand-waving; if you can't ground a claim, say so.

A quick mechanical pass can use `process` (it writes front-matter + auto-reindexes):
```bash
arc skills run --name arc-link-research -- process --links "url1,url2,url3" [--task <id>] [--parent <id>]
```
A deep, SKU-worthy report you write directly — then reindex so the catalog updates:
```bash
arc skills run --name arc-link-research -- reindex
```

### 8. Close the Task

```bash
arc tasks close --id <task_id> --status completed --summary "Analyzed N links: X high, Y medium, Z low relevance"
```

## Principles

- **Honest ratings.** Low relevance is fine — don't inflate to justify the work.
- **Mission lens.** Always ask: how does this relate to autonomous agents using Bitcoin for coordination and payment?
- **Actionable output.** If a link suggests a new skill, a follow-up task, or a change to how we work, say so.
- **Brevity over thoroughness.** 2-3 takeaways per link, not an essay. The report should be scannable.

## If Stuck

- Link unreachable: note specific error (e.g. "fetch failed, needs X API auth"), don't default to "low relevance"
- Content paywalled: note it, extract what you can from the URL/title/preview
- Ambiguous relevance: default to low, explain uncertainty
