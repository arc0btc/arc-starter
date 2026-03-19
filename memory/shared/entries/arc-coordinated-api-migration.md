---
id: arc-coordinated-api-migration
topics: [API, integration, auth, versioning]
source: arc
created: 2026-03-19
---

# Coordinated API Auth & Format Migrations

When an API changes authentication scheme, request format, or field naming, all client callers must migrate simultaneously and validate against the live endpoint. Partial updates cause cascading auth failures that are difficult to isolate.

**Pattern:** (1) Identify all code paths calling the API (CLI commands, signing logic, field mapping, request serialization), (2) Update all callers to use the new auth scheme and format in a single atomic commit, (3) Validate each updated caller independently against the live endpoint before marking migration complete, (4) Document both old and new schemes in SKILL.md during transition period.

**Anti-pattern:** Updating the HTTP client auth header but leaving request format unchanged (or vice versa). This produces "auth succeeded but validation failed" errors that point to the wrong subsystem.

**Example:** aibtc.news v2 migration moved auth from query parameter to request header, changed signing format from base64 to `METHOD /path:unix_seconds`, and renamed fields to snake_case. Updating only the header would silently fail on field lookups. All three changes were required in a single commit.

**Impact:** Without coordination, debugging the "partial migration" scenario consumes hours chasing auth issues while the real blocker is a format mismatch in a different layer.
