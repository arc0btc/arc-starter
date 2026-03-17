## Recent Cost Findings (2026-03-16 full-day, task #6111)

**7-day snapshot (2026-03-16, task #5856):**
- 7-day spend: $680.37 actual / $1213.18 API est across 2176 cycles
- Historical peak (2026-03-09/10): $195-$222/day (at cap) during fleet provisioning
- Current baseline (2026-03-16 post-stall): $134.51 healthy, 67% cap

**Final daily breakdown (2026-03-16):**
- arc-skill-manager $17.74 (52 tasks, memory sprint peak)
- agents-love-bitcoin $14.70 (6 tasks, Opus justified, ALB Phase 3 complete)
- aibtc-repo-maintenance $10.31 (34 tasks, integration tests)
- arc-email-sync $9.72 (22 tasks, below $20 threshold, fleet-degradation baseline)
- untagged $26.40 (48 tasks, human strategic work)
- Daily spend $134.51 well under $200/day cap

**Model tier efficiency:**
- Haiku: $0.06 avg/task (exemplary)
- Sonnet: $0.31 avg/task (composition, moderate work)
- Opus: $1.20 avg/task (strategic, architecture, deep work)
- API-to-Code ratio 1.88x (normal range 1.5-2.0x)

## Active Patterns & Watch Items

**arc-email-sync (fleet-degradation artifact):**
- Peak $14.68 (2026-03-13), declining trend to $6.49 (2026-03-16)
- Watch threshold: $20/day. Currently sub-threshold.
- Expected to drop ~80% when fleet workers return from suspension

**blog-publishing cadence fix (effective):**
- Peak (before): 4.5M tokens, $3.54 cost
- Current: ~80% reduction sustained
- Holding stable at sub-$5/day

**arc-skill-manager (memory sprint):**
- FTS5 memory architecture: $17.74 peak (52 tasks)
- One-time investment for infrastructure. Expect normalization post-completion.

**agents-love-bitcoin Phase 3 (COMPLETE 2026-03-16):**
- All 6 Phase 3 tasks completed with Opus justification
- Implementation: dual-sig BIP-137+SIP-018 registration, metering middleware, payment-gated endpoints
- PR #2 opened; awaiting merge and Cloudflare Worker deploy

**2026-03-17 morning snapshot (task #6240):**
- Partial day: $24.87 (86 tasks, ~$0.29/task) — more efficient than 2026-03-16 ($0.50/task)
- Top task: #6222 x402 Phase 2 review ($2.14, 2.7M tokens, Opus justified)
- Top skills: untagged ($3.19), arc-skill-manager ($2.55, memory infrastructure), arc-email-sync ($2.09, declining)
- Sensor-sourced: arc-reporting-watch ($0.57), email-sync threads ($0.49, $0.31), github-release-watcher ($0.36)
- Status: **NO ANOMALIES** — all costs justified, model routing correct, trend healthy, cap headroom comfortable

## Optimization Learnings

1. **P1 email → Sonnet override** — Intentional, saves $0.40-0.80/task vs Opus. Correct pattern.
2. **Arc-cost-alerting efficiency** — 48 tasks/week at $0.085 avg (Haiku routing exemplary)
3. **Null-skills high-cost** — Human strategic tasks ($1.50-$3.67) are Opus-justified. No misrouting.
4. **No immediate action items** — All costs track within cap and allocation is sound.
5. **Morning efficiency trend** — Early cycles (06:00-06:08Z) running at $0.29/task vs $0.50 daily average. Strategic work consolidation or lighter sensor load. Watch trend.

**2026-03-17 full-day report (task #6414):**
- Total: Code $86.13 (43% cap) | API $160.74 | 246 tasks, 118.6M tokens
- vs 2026-03-16: $134.51 (64% of yesterday) — lighter spend despite new infrastructure work
- **New: arc-weekly-presentation** ($7.17, 3 tasks) — skill infrastructure work, Opus-justified
- **Declining: arc-email-sync** ($8.28 today vs $9.72 yesterday) — continuing positive trend toward baseline
- **Untagged strategic** ($18.32, 25 tasks) — human-initiated work without skill context. Scope unclear — track for pattern.
- API-to-Code ratio: 1.87x (healthy)
- **Verdict:** No anomalies. Cap headroom comfortable. Efficiency improving (lower spend, same volume).
