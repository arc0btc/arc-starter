---
name: Runtime state files should be ignored
description: Pattern for handling sensor/runtime state files that get updated but shouldn't be committed
type: feedback
---

**Rule:** Runtime state files (cache, status, ephemeral state) should never be tracked in git.

**Why:** Sensor-driven processes update these files on every cycle (erc8004-agents.json, fleet-status.json, pool-state.json, etc). Each update would create a commit, polluting git history with noise. These files are read-only for operational purposes; version control adds no value.

**How to apply:**
- When housekeeping detects uncommitted changes to state cache files: add to .gitignore, git rm --cached them, commit the gitignore update
- Pattern: `db/erc8004-agents.json`, `memory/fleet-status.json`, `skills/*/pool-state.json` are examples
- Don't commit state; let sensors regenerate fresh on each startup
