---
name: credential-health
description: Periodic credential store health check — validates all credentials are readable and API endpoints are reachable
updated: 2026-03-16
tags:
  - health
  - credentials
  - monitoring
---

# Credential Health

Sensor-only skill. Validates the credential store every 60 minutes:

1. **Store unlock** — confirms `ARC_CREDS_PASSWORD` works and store decrypts
2. **Credential readability** — iterates all credentials, confirms each returns a non-empty value
3. **API connectivity** — for services with known endpoints (email, cloudflare), performs a lightweight health check
4. **Failure reporting** — appends failures to `memory/topics/integrations.md` and creates a P3 task

## Sensor

- **Interval:** 60 minutes
- **Source:** `sensor:credential-health`
- **Priority:** 3 (Opus — credential issues can cascade)
- **Model:** sonnet

## When to Load

Load when investigating credential failures, auth cascades, or integration outages.
