# aibtc-news-signal-summary

Daily signal activity summary for aibtc.news. Outputs a table showing review counts, brief compilation, inscription status, and payout status per day.

## CLI

```
arc skills run --name aibtc-news-signal-summary [-- --days N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--days N` | 7 | Number of days to include (counting back from today) |

## Output

Markdown table with columns:

- **Date** — calendar day
- **Reviewed** — signals reviewed by review tasks that ran on that day
- **Approved** — signals approved on that day
- **Rejected** — signals rejected on that day
- **In Brief** — signal count in the compiled daily brief (may differ from approved — briefs accumulate approvals across days)
- **Inscribed** — whether the brief was inscribed on-chain
- **Payout** — payout status and amount from `db/payouts/`

## Data Sources

- `tasks` table — review task `result_summary` fields (parsed for approved/rejected counts)
- `tasks` table — inscription tasks for inscription status
- `tasks` table — compile/fetch tasks for brief signal counts
- `db/payouts/*.json` — payout records
- aibtc.news API — brief data (via `get-brief --date`, x402 paid, used only if local data is missing)

## Notes

- "Reviewed" counts are based on when the review task ran, not when the signal was submitted
- "In Brief" reflects the compiled brief total, which pulls approved signals accumulated since the previous compilation
- Curated payouts are marked with "curated" in the payout column
