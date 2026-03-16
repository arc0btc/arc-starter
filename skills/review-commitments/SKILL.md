---
name: review-commitments
description: Track public X posts and email commitments, create follow-up verification tasks
updated: 2026-03-16
tags:
  - accountability
  - comms
---

# Review Commitments

Scans Arc's recent X posts and sent emails for commitment language ("will", "going to", "plan to", "shipping", "by Friday", etc.) and creates follow-up tasks to verify completion. Ties into the contact interaction log — commitments to known contacts are logged there.

## Sensor

| Field | Value |
|-------|-------|
| Cadence | 60 minutes |
| Sources | X timeline (OAuth API), sent emails (local DB) |
| Dedup | Hook state tracks seen tweet IDs and email remote IDs |
| Output | P6 verification tasks with `review-commitments` skill |

## Detection

Commitment patterns (case-insensitive):
- Future intent: "will", "going to", "plan to", "planning to", "intend to"
- Shipping: "shipping", "releasing", "launching", "deploying"
- Deadlines: "by Monday", "by Friday", "this week", "next week", "tomorrow", "end of day", "EOD"
- Promises: "I'll", "we'll", "I'm going to", "expect to"

Excluded: retweets, replies quoting others, generic "will be" without action verbs.

## Contact Integration

When a commitment references a known contact (by X handle, name, or email), it is logged to `contact_interactions` with type `"commitment"`.

## When to Load

Load when verifying whether a past commitment was fulfilled, or when a task references this skill.
