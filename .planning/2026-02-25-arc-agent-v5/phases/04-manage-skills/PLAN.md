<?xml version="1.0" encoding="utf-8"?>
<plan>
  <goal>Create the manage-skills skill and implement skill discovery in the CLI, establishing the pattern all future skills follow.</goal>
  <context>
    The arc-agent repo lives at ~/dev/arc0btc/arc-agent. Bun runtime is used throughout.
    src/cli.ts has a placeholder cmdSkills() that prints "Skills not yet implemented."
    The skills/ directory exists but is empty.
    Skill discovery: scan skills/*/SKILL.md, parse YAML frontmatter (name, description, tags).
    A skill is valid if it contains SKILL.md. Optional: AGENT.md, sensor.ts, cli.ts.
  </context>

  <task id="1">
    <name>Create src/skills.ts — skill discovery module</name>
    <files>src/skills.ts (new)</files>
    <action>
      Create src/skills.ts with:
      - Interface SkillInfo { name: string; description: string; path: string; hasSensor: boolean; hasCli: boolean; hasAgent: boolean; tags: string[] }
      - function discoverSkills(): SkillInfo[] — reads skills/ dir, for each subdir with SKILL.md,
        parses YAML frontmatter block (lines between first --- and second ---), extracts name/description/tags,
        checks for existence of sensor.ts, cli.ts, AGENT.md in that dir, returns array of SkillInfo.
      - Export discoverSkills and SkillInfo.
      Frontmatter parsing: simple line-by-line extraction (no external YAML lib):
        - name: value
        - description: value
        - tags: [a, b] or multi-line list items (- item)
      Use node:fs (readdirSync, readFileSync, existsSync) and node:path (join).
    </action>
    <verify>
      After creating skills/manage-skills/SKILL.md (task 2), run:
        bun -e "import { discoverSkills } from './src/skills.ts'; console.log(JSON.stringify(discoverSkills(), null, 2))"
      Should print JSON with at least one entry for manage-skills.
    </verify>
    <done>src/skills.ts exports discoverSkills() that correctly parses SKILL.md frontmatter and detects optional files.</done>
  </task>

  <task id="2">
    <name>Create manage-skills skill files (SKILL.md, AGENT.md, cli.ts)</name>
    <files>
      skills/manage-skills/SKILL.md (new),
      skills/manage-skills/AGENT.md (new),
      skills/manage-skills/cli.ts (new)
    </files>
    <action>
      Create skills/manage-skills/SKILL.md with:
        - YAML frontmatter: name, description, tags
        - Section: What Skills Are (knowledge containers, 4-file pattern)
        - Section: The 4-File Pattern (SKILL.md required; AGENT.md, sensor.ts, cli.ts optional)
        - Section: How to Create a New Skill (steps)
        - Section: Checklist (concrete testable items prefixed with [ ])
        - Section: CLI Commands (arc skills, arc skills show, arc skills run)
        Keep under 2000 tokens (~1500 words).

      Create skills/manage-skills/AGENT.md with:
        - Brief subagent instructions for creating/modifying skills
        - The 4-file pattern
        - Frontmatter format (name, description, tags)
        - SKILL.md token limit: 2000 tokens
        - Checklist section requirement
        - sensor.ts pattern (export default function, shouldRun gate, createTask calls)
        - cli.ts pattern (process.argv parsing, standalone bun execution)

      Create skills/manage-skills/cli.ts with:
        - `create <name> [--description TEXT]` subcommand: scaffolds skills/<name>/SKILL.md template
        - `list` subcommand: prints discovered skills (name + description columns)
        - `show <name>` subcommand: prints SKILL.md content for named skill
        Uses discoverSkills() from ../../src/skills.ts
        Skills root path: join(import.meta.dir, "../../skills")
        On unknown command or missing args: print usage to stderr, exit 1.
    </action>
    <verify>
      bun skills/manage-skills/cli.ts list         -- should list manage-skills
      bun skills/manage-skills/cli.ts show manage-skills  -- should print SKILL.md
      bun skills/manage-skills/cli.ts create test-skill --description "A test"  -- creates skills/test-skill/SKILL.md
      ls skills/test-skill/SKILL.md
      rm -rf skills/test-skill
    </verify>
    <done>manage-skills skill directory with SKILL.md, AGENT.md, cli.ts all working correctly.</done>
  </task>

  <task id="3">
    <name>Wire skill discovery into src/cli.ts — replace placeholder cmdSkills()</name>
    <files>src/cli.ts (modify)</files>
    <action>
      Replace the placeholder cmdSkills() with a full implementation:

      function cmdSkills(args: string[]): void
        - sub === undefined or "list": list all skills in a compact table
            Columns: name (20), description (40), sensor (6), cli (6)
            Header + separator line
        - sub === "show": skills show <name> -- print SKILL.md content
            Error if skill not found
        - sub === "run": skills run <skill> [args]
            Discover skill, check for cli.ts, spawn: bun skills/<skill>/cli.ts [args]
            Pass through exit code
            Error if skill not found or no cli.ts
        Import discoverSkills from "./skills.ts"
        Use existsSync from node:fs, spawnSync from node:child_process for "run".

      Also update cmdHelp() to document:
        arc skills                    -- list skills
        arc skills show <name>        -- show SKILL.md
        arc skills run <name> [args]  -- run skill CLI

      Update the switch in main() to call cmdSkills(argv.slice(1)).
    </action>
    <verify>
      bun src/cli.ts skills                         -- lists manage-skills
      bun src/cli.ts skills show manage-skills      -- prints SKILL.md
      bun src/cli.ts skills run manage-skills create test-skill --description "A test"
      bun src/cli.ts skills                         -- now lists manage-skills and test-skill
      rm -rf skills/test-skill
    </verify>
    <done>src/cli.ts skills command fully implemented with list, show, and run subcommands.</done>
  </task>
</plan>
