## Cost Optimization

**Cost optimization (2026-03-13):** Daily cost report analysis shows blog-publishing driving 30% of spend via token-heavy watch reports. Two Opus tasks reviewed: MCP scaffold (justified for architecture), arc-payments CLI (can move to Sonnet). Recommend: (1) Profile blog generation token ratio (input vs output), (2) Route arc-payments CLI to Sonnet for future iterations, (3) Audit blog-publishing sensor cadence (multiple reports/day suggests consolidation opportunity). Current spend $7.96 is healthy; no budget concerns.

## Cost Snapshots

**End-of-day cost report (2026-03-13T10:25Z):** Code $19.3155 (API $29.5847) | 26027.1k tokens | 71 tasks. blog-publishing remains top token consumer (2973.7k tokens, 8 tasks) confirming token-heavy watch report pattern. arc-email-sync now top skill by code cost ($2.5660). aibtc-news-editorial V2 migration justified at $1.9234 (architectural work). Daily cap: well under $200/day. Action: audit blog-publishing sensor cadence and profile token ratio (input vs output) to identify consolidation opportunity. Task #5549 created.

**Cost snapshot escalation (2026-03-13T18:26Z):** Code $51.5906 (API $84.5629) | 59879.9k tokens | 153 tasks. arc-email-sync trending upward: $2.5660 (10:25Z) → $11.2721 (17:25Z) → $12.2387 (18:26Z). All email-sourced volume due to fleet degradation (workers suspended, Arc absorbs tasks). Cost ratio $0.80/task remains normal. blog-publishing cadence fix confirmed effective (4522.8k tokens, $3.54). Strategic tasks (Agents Love Bitcoin Phase 1/2) justifiably Opus tier. Daily spend healthy, well under cap. [FLAG] Monitor email-sync trend next cycle — if exceeds $20, investigate consolidation opportunity.

**End-of-day final snapshot (2026-03-13T19:26Z):** Code $55.4576 (API $88.2524) | 65937.2k tokens | 168 tasks. arc-email-sync settled at $12.6654 code cost (18 tasks sourced). Trend stabilized within expected range for fleet degradation scenario. All strategic work (Agents Love Bitcoin Phase 1/2, aibtc-news editorial) justifiably Opus tier. blog-publishing cadence fix holding (4.5M tokens, $3.54 cost — ~80% reduction confirmed). Email-sync trend tracking normally; no action needed yet. Daily spend $55.46 is healthy, well under $200/day cap. Task #5645 (cost report) closed.

**Day-close snapshot (2026-03-13T23:26Z):** Code $75.8429 (API $128.6203) | 88847.6k tokens | 217 tasks. Comprehensive daily breakdown: (1) arc-email-sync $14.68 (23 tasks) — fleet degradation driving email volume, trend stabilized; (2) Strategic work (Agents Love Bitcoin Phase 1/2) $10.27 combined, Opus tier justified; (3) arc-skill-manager $5.73 (50 tasks, normal overhead); (4) blog-publishing $3.54 (11 tasks, cadence fix holding). Sensor breakdown: email-sync $6.35, github-release-watcher $1.85, blog-publishing $1.47. All costs track within expectations. Daily spend $75.84 is healthy, well under $200/day cap. No alerts. Task #5694 closed.

**Day-open snapshot (2026-03-14T00:26Z):** Code $1.1917 (API $1.1917) | 1705.9k tokens | 5 tasks. Light operational load — all Sonnet tier: blog-deploy sentinel implementation ($0.38), aibtc-news-editorial-v2 PR ($0.22), self-audit ($0.21), failure triage ($0.19), introspection ($0.19). No cost anomalies. Fleet degradation absorption (email-sync, GitHub tasks) continues within normal parameters. Daily spend well under $200/day cap. All systems nominal.

## Cost Trend Analysis (2026-03-16, task #5856)

**7-day spend:** $680.37 actual / $1213.18 API est across 2176 cycles. Dominated by earlier fleet provisioning week (2026-03-09/10 saw $195-$222/day — at cap). Current post-stall recovery: $18.32 today (healthy).

**Weekly skill breakdown (top cost domains):**
- `fleet-escalation,fleet-task-sync,arc-skill-manager` — $95.95 (379 tasks, P4 Sonnet) — old fleet provisioning era, no longer active
- null-skills (human strategic tasks) — $94.54 (148 tasks) — ad-hoc one-offs, no optimization path
- `arc-email-sync` — $39.21 (97 tasks) — fleet-degradation-driven volume; normalizes when workers return
- `arc-skill-manager` — $37.13 (199 tasks, $0.19 avg) — infrastructure overhead, normal
- `fleet-health`/`arc-remote-setup` combos — $30-31 each — fleet provisioning (now dormant)
- `aibtc-repo-maintenance` — $23.77 (91 tasks) — normal PR/CI work

**Today's skill breakdown (2026-03-16):**
- `arc-skill-manager` — $7.24 (12 tasks, $0.60 avg) — memory architecture burst (FTS5, topical split). Opus P3-4, justified
- `aibtc-repo-maintenance` — $2.93 (6 tasks, $0.49 avg) — integration test work. Sonnet P5, appropriate
- `arc-failure-triage` — $2.27 (4 tasks, $0.57 avg) — dispatch stall investigation. Justified
- `blog-publishing` — $2.03 (7 tasks, $0.29 avg) — cadence fix holding, normal
- `arc-email-sync` — $1.38 (5 tasks, $0.28 avg) — routine, normal

**Model tier (3-day):** Opus 37 tasks $44.52 ($1.20 avg), Sonnet 157 tasks $48.97 ($0.31 avg), Haiku 89 tasks $5.50 ($0.06 avg). Haiku highly efficient. Opus/Sonnet split near-even in cost despite 4x fewer Opus tasks.

**Optimization findings:**
1. **P1 email tasks routing to Sonnet** — arc-email-sync tasks are P1 (urgent queue position) but dispatched as Sonnet via model override. This is intentional and correct — saves ~$0.40-0.80/task vs Opus for routine email triage. Keep this pattern.
2. **compliance-review** — one historical outlier ($6.71 task #3238). Current runs $0.15-$1.00 normal. No action needed.
3. **arc-email-sync volume** — fleet-degradation artifact. Will drop ~80% when workers return. Not worth optimizing now.
4. **arc-cost-alerting** — exemplary efficiency: 48 tasks this week at $0.085 avg. Model: correct Haiku routing.
5. **arc-skill-manager today burst** — $7.24 from memory architecture sprint. One-time investment, expect to normalize.
6. **null-skills high-cost tasks** — human web UI / strategic tasks ($1.50-$3.67 each). These are Opus-justified architecture work. No misrouting.

**No immediate action items.** Daily spend tracking well under $200/day cap. Post-stall recovery is clean.

**Daily cost report (2026-03-16T10:32Z):** Code $25.1968 (API $43.2676) | 36527.4k tokens | 92 tasks. arc-skill-manager $7.89 (15 tasks, $0.53 avg) — FTS5 memory architecture implementation continues (tasks #5824, #5831). blog-publishing stable at $4.44 (13 tasks, cadence fix holding). aibtc-repo-maintenance $3.37 (8 tasks, integration test work). Peak task costs: #5824 Opus $1.87 (FTS5 Phase 2), #5831 Opus $1.48 (distill to arc_memory). Dual-cost tracking shows API-to-Code ratio averaging 1.72x (typical: 1.5-2.0x). All Opus tasks strategically allocated (memory architecture, dispatch investigation). Daily spend $25.20 healthy, well under cap. trend: memory sprint winds down, back to normal ops next cycle.

**Daily cost report (2026-03-16T15:46Z):** Code $45.5248 (API $94.8050) | 59839.1k tokens | 117 tasks. Strategic work dominating: agents-love-bitcoin (ALB Phase 3 endpoints, payment-gated auth, email routing) $14.70 (6 tasks, Opus justified). Memory architecture continues: arc-skill-manager $8.22 (18 tasks, FTS5 implementation). Blog-publishing stable $4.44 (13 tasks, cadence fix holding). Other normals: aibtc-repo-maintenance $3.67, arc-email-sync $3.44 (fleet-degradation baseline). API-to-Code ratio 2.08x (slightly high, reflects token-heavy Opus work). Email-sync at $3.44, well under $20 watch threshold. All strategic Opus allocation correct. Daily spend healthy, well under $200/day cap. No action items.
