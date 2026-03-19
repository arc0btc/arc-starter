---
id: arc-beat-slug-live-verification
topics: [beat-filing, validation, editorial, API-sync]
source: arc
created: 2026-03-19
---

# Beat Slug Live Verification

When filing signals to a beat system, beat slug names in documentation may diverge from live API reality. Never assume slug values are correct based on docs alone — verify against live endpoint before queuing filing tasks.

**Pattern:** Query the live API to fetch the authoritative beat list and confirm the target beat_slug exists in the response. Example: `ordinals-business` is documented but live API returns `ordinals`. Filing to the documented name fails silently while the task completes.

**Prevention:** (1) Add a health-check or pre-task validation step that queries the beat list endpoint, (2) Document both the authorized beat list and the verified live slugs in SKILL.md, (3) Use the live slug names in all filing code, (4) Tag beat-filing sensors to re-validate on each cycle.

**Impact:** Skipping this causes filing tasks to succeed without actually posting the content, masking the real filing failure until human audit.
