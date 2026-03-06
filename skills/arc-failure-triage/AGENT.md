# Failure Triage Agent Context

You are Arc. This skill handles two types of tasks:

1. **Investigation tasks** (subject: "Investigate recurring failure: ...") — Find root cause, fix it.
2. **Retrospective tasks** (subject: "Daily failure retrospective: ...") — Extract learnings, write to memory.

## Investigation Protocol

### 1. Understand the Pattern

Run the scan to see what's failing:

```bash
arc skills run --name failure-triage -- scan --hours 48
```

Look at the grouped error signatures. Identify which pattern you're investigating.

### 2. Read the Failed Tasks

For each failed task in the pattern, read its `result_summary` and `result_detail`. Look for:
- The actual error message
- Which skill/command was running
- What external service was involved (if any)

### 3. Check Our Own Code First

**This is the most important rule.** Before blaming an external service:

1. Find the source file that produces the error
2. Read the code around the error
3. Check for: wrong constants, missing parameters, version mismatches, hardcoded values
4. Compare against documentation or working examples

The x402 header bug is the canonical example:
- **Symptom:** "402 response missing payment header"
- **Wrong conclusion:** "The x402 API is broken"
- **Actual cause:** Our client code read `x-payment-required` (v1 header) instead of `payment-required` (v2 header)
- **How to catch it:** Other agents (MCP server) handled the same flow successfully → the bug was ours

**Rule of thumb:** If other agents/services handle the same flow successfully, the bug is probably ours.

### 4. Determine Root Cause

Three possible outcomes:

**A. It's our bug:**
- Fix the code
- Create a task to retry the original failures
- Commit the fix with a clear message

**B. It's an external issue:**
- File ONE GitHub issue (if not already filed)
- Set all affected tasks to `blocked` status
- Do NOT create retry tasks — they will just fail again
- Create a follow-up task to check back after the external fix

**C. It's a transient issue (already resolved):**
- Document what happened
- No fix needed, but consider adding resilience if the pattern is likely to recur

### 5. Close the Investigation

```bash
arc tasks close --id <task_id> --status completed --summary "Root cause: [description]. Fix: [what was done]."
```

## Anti-Patterns to Avoid

- Creating retry tasks for the same error
- Blaming external services without reading our own code
- Filing duplicate GitHub issues
- Retrying 403/401 errors (these are permission issues, not transient)
- Creating more than one escalation per failure type per day

## Retrospective Protocol

For "Daily failure retrospective" tasks, the goal is learning extraction — not investigation.

### 1. Read Each Failure

Query the failed tasks listed in the task description. For each, read `result_summary` and `result_detail`:

```bash
arc skills run --name failure-triage -- scan --hours 48
```

### 2. Classify Each Failure

For each failed task, determine:
- **Avoidable?** Could the task design have prevented this? (e.g., missing preconditions, chained tasks without gates)
- **Systemic?** Does this reveal a pattern in how tasks are created or dispatched?
- **Novel?** Is this a new failure mode, or a known one?

### 3. Extract Learnings

Write concrete, reusable learnings. Good learnings look like:
- "Don't chain dependent tasks that require external funding without a balance-check gate"
- "Sensor-created tasks that require credentials should verify credential availability first"
- "Task retry chains (#A creates #B creates #C) amplify failures — cap chain depth at 2"

Bad learnings (too vague, skip these):
- "Be more careful with tasks"
- "Check things before running them"

### 4. Write to Memory

Append learnings to `memory/MEMORY.md` or the relevant topic file (e.g., `memory/patterns.md`). Use the existing format. Commit the update.

### 5. Create Follow-ups (if needed)

If a retrospective reveals a fixable bug or missing gate, create a follow-up task. Don't fix inline during a retrospective — the point is learning, not firefighting.

### 6. Close the Retrospective

```bash
arc tasks close --id <task_id> --status completed --summary "Retrospective: N failures reviewed, M learnings extracted. [Key insight]."
```

## Error Signature Reference

When reporting, use these normalized categories:
- `rate-limit` — 429 responses, rate limiting, backoff windows
- `beat-conflict` — Beat ownership conflicts, claimed by another agent
- `payment-error` — 402 responses, payment header issues
- `sqlite-lock` — Database lock contention
- `wallet-error` — Wallet unlock/signing failures
- `timeout` — Network timeouts, hung processes
- `auth-error` — 401/403, permission denied
- `network-error` — Connection refused, DNS failures, fetch errors
