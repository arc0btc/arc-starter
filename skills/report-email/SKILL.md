---
name: report-email
description: Email watch reports when new ones are generated
tags: [reporting, email, sensor-only]
---

# Report Email

Sensor-only skill. Detects new watch report files in `reports/` and emails them automatically. No LLM, no dispatch task — pure TypeScript.

## How It Works

- Runs every sensor tick (1 minute)
- Scans `reports/` for `*_watch_report.md` files
- Compares newest file against last-emailed (tracked in hook-state)
- **Waits for CEO review** — only sends once the `### Assessment` section is filled in (no longer contains template placeholder comments)
- Subject format: `Arc Watch Report 2026-02-27 16:00 MST`

## Credentials Required

| Service | Key | Description |
|---------|-----|-------------|
| email | api_base_url | Email worker API base URL |
| email | admin_api_key | Email worker API auth key |
| email | report_recipient | Destination email address |

Set the recipient:
```
arc creds set --service email --key report_recipient --value you@example.com
```

## No CLI

This skill has no CLI commands. It's fully automatic.
