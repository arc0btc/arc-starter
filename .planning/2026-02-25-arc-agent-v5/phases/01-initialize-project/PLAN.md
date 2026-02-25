<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <goal>Create the arc-agent v5 project skeleton: package.json, tsconfig.json, directory layout, CLAUDE.md (architecture + full SQL schema), SOUL.md (updated for v5), memory/MEMORY.md, .gitignore, and an initial git commit.</goal>

  <context>
    The repo at ~/dev/arc0btc/arc-agent/ is empty except for the .planning directory.
    The v4 reference source lives at ~/arc0btc/ — SOUL.md, ARCHITECTURE.md, LOOP.md, package.json are all readable.
    Bun 1.3.1 is installed. No git init has been done yet.

    v5 philosophy vs v4:
    - No hooks system — replaced by two clean services: sensors (fast, no LLM) and dispatch (LLM, lock-gated)
    - No comms table — everything is a task
    - No LOOP.md — merged into CLAUDE.md (the architecture doc that is also the dispatch context)
    - Skills are knowledge containers: SKILL.md (orchestrator), AGENT.md (subagent), sensor.ts (auto-run), cli.ts (CLI commands)
    - CLI is primary interface: arc status | tasks | skills | run
    - Two tables only: tasks, cycle_log
    - Memory lives in memory/MEMORY.md, versioned by git
    - Dual cost tracking: cost_usd (actual Claude Code consumption) + api_cost_usd (estimated from tokens)
  </context>

  <task id="1">
    <name>Write PLAN.md and create directory structure + config files</name>
    <files>
      /home/whoabuddy/dev/arc0btc/arc-agent/package.json (create)
      /home/whoabuddy/dev/arc0btc/arc-agent/tsconfig.json (create)
      /home/whoabuddy/dev/arc0btc/arc-agent/.gitignore (create)
      /home/whoabuddy/dev/arc0btc/arc-agent/memory/MEMORY.md (create)
    </files>
    <action>
      1. Create package.json with name "arc-agent", version "0.0.1", type "module", Bun runtime,
         and a bin entry mapping "arc" to "./src/cli.ts". Add a scripts section with:
         - "db:init": "bun src/db.ts"
         - "sensors": "bun src/sensors.ts"
         - "dispatch": "bun src/dispatch.ts"
         - "arc": "bun src/cli.ts"

      2. Create tsconfig.json targeting Bun:
         - compilerOptions.target: "ESNext"
         - compilerOptions.module: "ESNext"
         - compilerOptions.moduleResolution: "bundler"
         - compilerOptions.strict: true
         - compilerOptions.types: ["bun-types"]
         - include: ["src/**/*", "skills/**/*.ts"]

      3. Create .gitignore with entries:
         - node_modules/
         - db/*.sqlite
         - db/*.sqlite-*
         - db/dispatch-lock.json
         - db/hook-state/

      4. Create directory stubs (empty .gitkeep files where needed):
         - src/
         - skills/
         - templates/
         - memory/
         - db/
         - systemd/

      5. Create memory/MEMORY.md as an empty initial memory file with just a header.
    </action>
    <verify>
      - cat /home/whoabuddy/dev/arc0btc/arc-agent/package.json | grep '"arc-agent"'
      - cat /home/whoabuddy/dev/arc0btc/arc-agent/tsconfig.json | grep '"strict"'
      - ls /home/whoabuddy/dev/arc0btc/arc-agent/ should show all dirs + files
    </verify>
    <done>package.json, tsconfig.json, .gitignore, and all directories exist. memory/MEMORY.md exists.</done>
  </task>

  <task id="2">
    <name>Write CLAUDE.md (architecture document + dispatch context)</name>
    <files>
      /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md (create)
    </files>
    <action>
      Write CLAUDE.md covering all required sections:
      1. What arc-agent is (one paragraph intro)
      2. Architecture: tasks table as universal queue, priority-based dispatch, skills as context loaders
      3. Two services: sensors (no LLM, parallel, 1-5 min timer) and dispatch (LLM, lock-gated, up to 60 min)
      4. Skills pattern: SKILL.md / AGENT.md / sensor.ts / cli.ts
      5. Task templates and the `skills` JSON array field
      6. CLI as primary interface: arc status | tasks | skills | run
      7. Full SQL schema DDL (tasks + cycle_log) — verbatim as specified
      8. Conventions: conventional commits, verbose DB column naming, Bun runtime
      9. Context budget: 40-50k tokens per dispatch
      10. CLI-first principle
      11. Dual cost tracking: cost_usd vs api_cost_usd
      12. Memory: lives in memory/MEMORY.md, versioned by git
      13. Escalation rules
      14. Failure rules
    </action>
    <verify>
      - grep -c "cycle_log" /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md  (should be >= 2)
      - grep "cost_usd" /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md
      - grep "api_cost_usd" /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md
      - grep "CREATE TABLE tasks" /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md
    </verify>
    <done>CLAUDE.md exists, is substantive (covers all 14 sections), and contains verbatim SQL DDL for both tables.</done>
  </task>

  <task id="3">
    <name>Write SOUL.md (updated for v5), git init, and initial commit</name>
    <files>
      /home/whoabuddy/dev/arc0btc/arc-agent/SOUL.md (create from ~/arc0btc/SOUL.md)
      /home/whoabuddy/arc0btc/SOUL.md (read-only reference)
    </files>
    <action>
      1. Copy ~/arc0btc/SOUL.md to arc-agent/SOUL.md verbatim EXCEPT update the "Current State" section:
         - Change heading date from "2026-02 (v4)" to "2026-02 (v5)"
         - Replace the bullet list under Current State with a v5 description:
           * Clean rewrite — task-based architecture replaces hooks + comms model
           * Everything is a task: sensors queue tasks, dispatch executes one at a time
           * Two services: sensors (fast, no LLM) and dispatch (LLM, lock-gated)
           * Two tables: tasks + cycle_log. Memory in MEMORY.md, versioned by git
           * Starting fresh with manage-skills as the only built-in skill
           * CLI-first: arc status | tasks | skills | run

      2. git init in /home/whoabuddy/dev/arc0btc/arc-agent/
      3. git add all files
      4. git commit with message: "chore: initialize arc-agent v5 project skeleton"
    </action>
    <verify>
      - bun --version (sanity check)
      - git -C /home/whoabuddy/dev/arc0btc/arc-agent log --oneline (should show 1 commit)
      - grep "v5" /home/whoabuddy/dev/arc0btc/arc-agent/SOUL.md
      - cat /home/whoabuddy/dev/arc0btc/arc-agent/CLAUDE.md | grep -c "CREATE TABLE" (should be 2)
    </verify>
    <done>SOUL.md has updated Current State for v5, git repo initialized, one commit visible in git log.</done>
  </task>
</plan>
