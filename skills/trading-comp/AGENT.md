# trading-comp — Subagent Briefing

You are executing a competition-related task. This skill is the strategy layer over `bitflow` (swap execution) and `competition` (scorer API). Compose, do not duplicate.

## Prerequisites

Before any submit:
1. **Confirmed tx** — only submit txids for non-pending Stacks transactions. Verify via mempool/Hiro if unsure.
2. **Registration** — Arc must be registered on aibtc.com (BIP-322 + SIP-018) and have an ERC-8004 ID. This is one-time; see `competition` SKILL.md.
3. **Provider attribution** — Bitflow swaps executed via the MCP server (v1.52.0+) auto-inject `BITFLOW_PROVIDER_ADDRESS`. XYK multi-hop routes carry it; stableswap routes drop it silently. The competition backend uses txid submission as the primary attribution path, so always submit.

## Workflow: Swap → Submit

```
arc skills run --name bitflow -- quote --token-x <x> --token-y <y> --amount-in <n>
arc skills run --name bitflow -- swap  --token-x <x> --token-y <y> --amount-in <n> [--slippage <s>]
# capture txid from swap output
arc skills run --name trading-comp -- submit --txid <txid> --source <label>
```

`--source` labels are free-form; use a short tag (`mirror`, `pair-watch`, `manual`, `ecosystem`) so build #5+ leaderboard analysis can attribute outcome by trigger.

## Failure Modes (current understanding)

| Status | Meaning | Action |
|--------|---------|--------|
| 200/201 | Submitted | Done. Result is idempotent. |
| 202 | Queued / pending indexer | **Open question — confirm with whoabuddy.** Treat as success for now; retry on next sensor cycle if needed. |
| 4xx | Bad txid / unregistered address | Fail loud. Do not retry. |
| 5xx / timeout | Transient | Retry once; if still failing, create a follow-up task. |

## Safety

- Never call `bitflow swap` with `--confirm-high-impact` on a competition-tagged task without explicit human approval. Slippage cap is an open question (see SKILL.md). Default behaviour: abort on >5% impact.
- Idempotency means re-submission is safe, but don't loop — submit once per confirmed txid.
- `submit` exits 1 on validation/network error; check exit code in scripts.

## Metrics

`skills/trading-comp/metrics.md` is a daily snapshot file. Fields: `date_utc`, `rank`, `unrealized_pnl_usd`, `trade_count_24h`, `avg_slippage_bps`, `notes`. Build #6 (weekly post-settlement eval) reads this; until then, treat it as a manual log.

## Out of Scope (this skill, today)

- Competitor tx mirroring (build #2 — `trading-comp-mirror` sensor)
- Allowlist token pair watcher (build #3 — `trading-comp-pairs` sensor)
- Ecosystem listener (build #4 — Stacks X/website signals)
- Leaderboard-delta sensor (build #5)
- Weekly settlement eval (build #6)

If a task asks for any of the above, decompose: complete what you can with the current primitive and queue a follow-up referencing the build-order number.
