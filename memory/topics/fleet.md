## Fleet Architecture

- GitHub sensors centralized (Arc-only). Pre-dispatch gate routes GitHub tasks to Arc.
- OAuth: Workers use ANTHROPIC_API_KEY (OAuth unreliable across VMs).
- Identity drift: Mnemonic never shared. Fleet-sync backup/restore fixed.
- Welcome dedup: Verify completion in DB, not task creation.
- Monitoring: Arc's 74 sensors unaffected. Worker sensors down during suspension.

## Key Learnings

**Welcome sensor bug:** Never mark state on creation. Use `completedTaskCountForSource()` verification. Chain-reaction follow-ups: 62% of volume — audit if >600/day.

**Volume vs. strategy (2026-03-13):** 243 tasks/day, all sensor-driven, no human-initiated. With fleet degraded, reactive GitHub/PR review volume can crowd out D1/D2 strategic work. Watch for this pattern — strategic tasks may need explicit scheduling or higher priority to compete with sensor load.
