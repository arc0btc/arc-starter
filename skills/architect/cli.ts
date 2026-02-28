#!/usr/bin/env bun

// architect/cli.ts
//
// CLI for architecture review: state machine diagrams, context auditing,
// and simplification reports.
//
// Usage: arc skills run --name architect -- <subcommand>

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { discoverSkills, type SkillInfo } from "../../src/skills.ts";

const ROOT = join(import.meta.dir, "../..");
const DIAGRAM_PATH = join(import.meta.dir, "state-machine.md");
const AUDIT_LOG_PATH = join(import.meta.dir, "audit-log.md");
const REPORTS_DIR = join(ROOT, "reports");

// ---- Helpers ----

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---- Diagram generation ----

function buildMermaidDiagram(skills: SkillInfo[]): string {
  const sensorsWithSkills = skills.filter((s) => s.hasSensor);
  const skillsWithCli = skills.filter((s) => s.hasCli);

  const lines: string[] = [
    "# Arc State Machine",
    "",
    `*Generated: ${isoNow()}*`,
    "",
    "```mermaid",
    "stateDiagram-v2",
    "    [*] --> SystemdTimer: every 1 min",
    "",
    "    state SystemdTimer {",
    "        [*] --> SensorsService",
    "        [*] --> DispatchService",
    "    }",
    "",
    "    state SensorsService {",
    "        [*] --> RunAllSensors: parallel via Promise.allSettled",
  ];

  // Add sensor states
  for (const s of sensorsWithSkills) {
    lines.push(`        RunAllSensors --> ${sanitizeName(s.name)}Sensor: ${s.name}`);
  }
  lines.push("");
  for (const s of sensorsWithSkills) {
    const sName = sanitizeName(s.name);
    lines.push(`        state ${sName}Sensor {`);
    lines.push(`            [*] --> ${sName}Gate: claimSensorRun(${s.name})`);
    lines.push(`            ${sName}Gate --> ${sName}Skip: interval not elapsed`);
    lines.push(`            ${sName}Gate --> ${sName}Dedup: interval elapsed`);
    lines.push(`            ${sName}Dedup --> ${sName}Skip: pending task exists`);
    lines.push(`            ${sName}Dedup --> ${sName}CreateTask: no dupe`);
    lines.push(`            ${sName}CreateTask --> [*]: insertTask()`);
    lines.push(`            ${sName}Skip --> [*]: return skip`);
    lines.push("        }");
    lines.push("");
  }
  lines.push("    }");
  lines.push("");

  // Dispatch service
  lines.push("    state DispatchService {");
  lines.push("        [*] --> CheckLock: db/dispatch-lock.json");
  lines.push("        CheckLock --> Exit: lock held by live PID");
  lines.push("        CheckLock --> CrashRecovery: lock held by dead PID");
  lines.push("        CheckLock --> PickTask: no lock");
  lines.push("        CrashRecovery --> PickTask: mark stale active tasks failed");
  lines.push("        PickTask --> Idle: no pending tasks");
  lines.push("        PickTask --> BuildPrompt: highest priority task");
  lines.push("");
  lines.push("        state BuildPrompt {");
  lines.push("            [*] --> LoadCore: SOUL.md + CLAUDE.md + MEMORY.md");
  lines.push("            LoadCore --> LoadSkills: task.skills JSON array");
  lines.push("            LoadSkills --> LoadSkillMd: for each skill name");
  lines.push("            LoadSkillMd --> AssemblePrompt: SKILL.md content");
  lines.push("            note right of LoadSkillMd: Only SKILL.md loaded\\nAGENT.md stays for subagents");
  lines.push("        }");
  lines.push("");
  lines.push("        BuildPrompt --> WriteLock: markTaskActive()");
  lines.push("        WriteLock --> SpawnClaude: claude --print --verbose");
  lines.push("        SpawnClaude --> ParseResult: stream-json output");
  lines.push("        ParseResult --> CheckSelfClose: task still active?");
  lines.push("        CheckSelfClose --> RecordCost: LLM called arc tasks close");
  lines.push("        CheckSelfClose --> FallbackClose: fallback markTaskCompleted");
  lines.push("        FallbackClose --> RecordCost");
  lines.push("        RecordCost --> ClearLock");
  lines.push("        ClearLock --> AutoCommit: git add memory/ skills/ src/ templates/");
  lines.push("        AutoCommit --> [*]");
  lines.push("    }");
  lines.push("");

  // CLI interface
  lines.push("    state CLI {");
  lines.push("        [*] --> ArcCommand: arc <subcommand>");
  lines.push("        ArcCommand --> TasksCRUD: tasks add/close/list");
  lines.push("        ArcCommand --> SkillsRun: skills run --name X");
  lines.push("        ArcCommand --> ManualDispatch: run");
  lines.push("        ArcCommand --> StatusView: status");
  lines.push("    }");

  if (skillsWithCli.length > 0) {
    lines.push("");
    lines.push("    note right of CLI");
    lines.push("        Skills with CLI:");
    for (const s of skillsWithCli) {
      lines.push(`        - ${s.name}`);
    }
    lines.push("    end note");
  }

  lines.push("```");
  lines.push("");

  // Decision points table
  lines.push("## Decision Points");
  lines.push("");
  lines.push("| # | Point | Context Available | Gate |");
  lines.push("|---|-------|-------------------|------|");
  lines.push("| 1 | Sensor fires | Hook state (interval check) | `claimSensorRun()` |");
  lines.push("| 2 | Sensor creates task | External data + dedup check | `pendingTaskExistsForSource()` |");
  lines.push("| 3 | Dispatch lock check | Lock file (PID + task_id) | `isPidAlive()` |");
  lines.push("| 4 | Task selection | All pending tasks sorted | Priority ASC, ID ASC |");
  lines.push("| 5 | Skill loading | `task.skills` JSON array | SKILL.md existence |");
  lines.push("| 6 | Prompt assembly | SOUL + CLAUDE + MEMORY + skills | Token budget ~40-50k |");
  lines.push("| 7 | LLM execution | Full prompt + CLI access | `arc` commands only |");
  lines.push("| 8 | Result handling | Task status check post-run | Self-close vs fallback |");
  lines.push("| 9 | Auto-commit | Staged dirs: memory/ skills/ src/ templates/ | `git diff --cached` |");
  lines.push("");

  // Skills inventory
  lines.push("## Skills Inventory");
  lines.push("");
  lines.push("| Skill | Sensor | CLI | Agent | Description |");
  lines.push("|-------|--------|-----|-------|-------------|");
  for (const s of skills) {
    lines.push(
      `| ${s.name} | ${s.hasSensor ? "yes" : "-"} | ${s.hasCli ? "yes" : "-"} | ${s.hasAgent ? "yes" : "-"} | ${s.description || "-"} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}

function sanitizeName(name: string): string {
  return name.replace(/-/g, "_");
}

async function cmdDiagram(): Promise<void> {
  const skills = discoverSkills();
  const diagram = buildMermaidDiagram(skills);
  await Bun.write(DIAGRAM_PATH, diagram);
  process.stdout.write(`Updated state machine diagram at skills/architect/state-machine.md\n`);
  process.stdout.write(`  ${skills.length} skills, ${skills.filter((s) => s.hasSensor).length} sensors\n`);
}

// ---- Audit ----

interface AuditFinding {
  point: string;
  severity: "info" | "warn" | "error";
  message: string;
}

function runAudit(skills: SkillInfo[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Check each skill's context completeness
  for (const skill of skills) {
    const skillMd = readFileSafe(join(skill.path, "SKILL.md"));

    // SKILL.md should have frontmatter
    if (!skillMd.match(/^---\n[\s\S]*?\n---/)) {
      findings.push({
        point: `skill:${skill.name}`,
        severity: "error",
        message: `${skill.name}/SKILL.md missing frontmatter`,
      });
    }

    // Estimate token count (rough: 1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(skillMd.length / 4);
    if (estimatedTokens > 2000) {
      findings.push({
        point: `skill:${skill.name}`,
        severity: "warn",
        message: `${skill.name}/SKILL.md is ~${estimatedTokens} tokens (limit: 2000)`,
      });
    }

    // Sensor without dedup check
    if (skill.hasSensor) {
      const sensorCode = readFileSafe(join(skill.path, "sensor.ts"));
      if (!sensorCode.includes("pendingTaskExistsForSource") && !sensorCode.includes("taskExistsForSource")) {
        findings.push({
          point: `sensor:${skill.name}`,
          severity: "warn",
          message: `${skill.name}/sensor.ts has no dedup check`,
        });
      }
      if (!sensorCode.includes("claimSensorRun")) {
        findings.push({
          point: `sensor:${skill.name}`,
          severity: "error",
          message: `${skill.name}/sensor.ts missing claimSensorRun() gate`,
        });
      }
    }

    // CLI without help/usage
    if (skill.hasCli) {
      const cliCode = readFileSafe(join(skill.path, "cli.ts"));
      if (!cliCode.includes("help") && !cliCode.includes("Usage")) {
        findings.push({
          point: `cli:${skill.name}`,
          severity: "info",
          message: `${skill.name}/cli.ts has no help/usage text`,
        });
      }
    }

    // Agent without skill — orphaned instructions
    if (skill.hasAgent && !skill.hasSensor && !skill.hasCli) {
      const skillMdRef = readFileSafe(join(ROOT, "skills"));
      // Check if any other skill references this one
      let referenced = false;
      for (const other of skills) {
        if (other.name === skill.name) continue;
        const otherSkillMd = readFileSafe(join(other.path, "SKILL.md"));
        if (otherSkillMd.includes(skill.name)) {
          referenced = true;
          break;
        }
      }
      if (!referenced) {
        findings.push({
          point: `skill:${skill.name}`,
          severity: "info",
          message: `${skill.name} has AGENT.md but no sensor/cli — verify it's referenced by other skills`,
        });
      }
    }
  }

  // Check core files exist
  const coreFiles = ["SOUL.md", "CLAUDE.md", "memory/MEMORY.md"];
  for (const file of coreFiles) {
    if (!existsSync(join(ROOT, file))) {
      findings.push({
        point: "core",
        severity: "error",
        message: `Missing critical file: ${file}`,
      });
    }
  }

  // Check dispatch.ts and sensors.ts exist
  const engineFiles = ["src/dispatch.ts", "src/sensors.ts", "src/db.ts"];
  for (const file of engineFiles) {
    if (!existsSync(join(ROOT, file))) {
      findings.push({
        point: "engine",
        severity: "error",
        message: `Missing engine file: ${file}`,
      });
    }
  }

  // Check MEMORY.md size
  const memoryContent = readFileSafe(join(ROOT, "memory/MEMORY.md"));
  if (memoryContent) {
    const lines = memoryContent.split("\n").length;
    const tokens = Math.ceil(memoryContent.length / 4);
    if (tokens > 2000) {
      findings.push({
        point: "memory",
        severity: "warn",
        message: `MEMORY.md is ~${tokens} tokens (${lines} lines) — consider consolidation`,
      });
    }
  }

  return findings;
}

async function cmdAudit(): Promise<void> {
  const skills = discoverSkills();
  const findings = runAudit(skills);

  // Print findings
  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  const infos = findings.filter((f) => f.severity === "info");

  process.stdout.write(`Audit: ${findings.length} finding(s) — ${errors.length} error, ${warns.length} warn, ${infos.length} info\n\n`);

  for (const f of findings) {
    const prefix = f.severity === "error" ? "ERROR" : f.severity === "warn" ? "WARN " : "INFO ";
    process.stdout.write(`  [${prefix}] [${f.point}] ${f.message}\n`);
  }

  // Append to audit log
  const timestamp = isoNow();
  const logEntry = [
    `## ${timestamp}`,
    "",
    `${findings.length} finding(s): ${errors.length} error, ${warns.length} warn, ${infos.length} info`,
    "",
    ...findings.map((f) => `- **${f.severity.toUpperCase()}** [${f.point}] ${f.message}`),
    "",
    "---",
    "",
  ].join("\n");

  const existing = readFileSafe(AUDIT_LOG_PATH);
  const header = existing ? "" : "# Architect Audit Log\n\n";
  await Bun.write(AUDIT_LOG_PATH, header + logEntry + existing.replace(/^# Architect Audit Log\n\n/, ""));
  process.stdout.write(`\nAudit log updated at skills/architect/audit-log.md\n`);
}

// ---- Report ----

async function cmdReport(): Promise<void> {
  const skills = discoverSkills();
  const findings = runAudit(skills);

  const lines: string[] = [
    "# Simplification Report",
    "",
    `*Generated: ${isoNow()}*`,
    "",
    "Applying the SpaceX 5-step engineering process.",
    "",
  ];

  // Step 1: Question requirements
  lines.push("## 1. Question Requirements");
  lines.push("");
  for (const skill of skills) {
    const skillMd = readFileSafe(join(skill.path, "SKILL.md"));
    const hasChecklist = skillMd.includes("## Checklist");
    const hasTodo = skillMd.includes("TODO:");
    if (hasTodo) {
      lines.push(`- **${skill.name}**: SKILL.md has unresolved TODOs — incomplete requirements`);
    }
    if (!hasChecklist) {
      lines.push(`- **${skill.name}**: SKILL.md missing Checklist section — no acceptance criteria`);
    }
  }
  if (lines[lines.length - 1] === "") {
    lines.push("- All skills have defined requirements with checklists.");
  }
  lines.push("");

  // Step 2: What can be deleted
  lines.push("## 2. Candidates for Deletion");
  lines.push("");
  const orphanedAgents = skills.filter((s) => s.hasAgent && !s.hasSensor && !s.hasCli);
  if (orphanedAgents.length > 0) {
    for (const s of orphanedAgents) {
      lines.push(`- **${s.name}**: has AGENT.md but no sensor or CLI — is this skill actively used?`);
    }
  }

  // Check for skills with no recent tasks
  lines.push("- Review task history for skills with zero tasks in the last 7 days.");
  lines.push("");

  // Step 3: Simplification opportunities
  lines.push("## 3. Simplification Opportunities");
  lines.push("");
  const oversizedSkills = findings.filter((f) => f.message.includes("tokens"));
  if (oversizedSkills.length > 0) {
    for (const f of oversizedSkills) {
      lines.push(`- ${f.message}`);
    }
  }
  const memoryFindings = findings.filter((f) => f.point === "memory");
  for (const f of memoryFindings) {
    lines.push(`- ${f.message}`);
  }
  if (oversizedSkills.length === 0 && memoryFindings.length === 0) {
    lines.push("- Context sizes within limits.");
  }
  lines.push("");

  // Step 4: Cycle time
  lines.push("## 4. Cycle Time");
  lines.push("");
  lines.push("- Check `arc status` for average dispatch duration.");
  lines.push("- Sensors run in parallel — individual sensor duration doesn't block others.");
  lines.push("- Dispatch is serial (lock-gated) — one task at a time.");
  lines.push("");

  // Step 5: Automation
  lines.push("## 5. Automation");
  lines.push("");
  const skillsWithoutSensor = skills.filter((s) => !s.hasSensor && s.hasCli);
  if (skillsWithoutSensor.length > 0) {
    lines.push("Skills with CLI but no sensor (manual-only):");
    for (const s of skillsWithoutSensor) {
      lines.push(`- **${s.name}**: ${s.description || "no description"}`);
    }
    lines.push("");
    lines.push("Consider whether any of these should be automated — but only after steps 1-4.");
  } else {
    lines.push("- All CLI-enabled skills also have sensors.");
  }
  lines.push("");

  // Audit summary
  lines.push("## Audit Findings");
  lines.push("");
  for (const f of findings) {
    lines.push(`- **${f.severity.toUpperCase()}** [${f.point}] ${f.message}`);
  }
  lines.push("");

  const report = lines.join("\n");
  process.stdout.write(report);
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`architect CLI

USAGE
  arc skills run --name architect -- <subcommand>

SUBCOMMANDS
  diagram   Generate/update the Mermaid state machine diagram
  audit     Check context delivery at each decision point
  report    Produce a simplification report (SpaceX 5-step)
  help      Show this help text
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "diagram":
      await cmdDiagram();
      break;
    case "audit":
      await cmdAudit();
      break;
    case "report":
      await cmdReport();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
