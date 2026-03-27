// compliance-review/sensor.ts
//
// Audits all skills and sensors for structural, interface, and naming
// compliance with Arc conventions. Pure TypeScript — no LLM calls.

import {
  claimSensorRun,
  createSensorLogger,
} from "../../src/sensors.ts";
import { insertWorkflow, getWorkflowByInstanceKey } from "../../src/db.ts";
import { discoverSkills, type SkillInfo } from "../../src/skills.ts";
import { existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";

const SENSOR_NAME = "compliance-review";
const INTERVAL_MINUTES = 720; // 12 hours — daily structural audit
const TASK_SOURCE = "sensor:compliance-review";

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface ComplianceFinding {
  skill_name: string;
  rule: string;
  detail: string;
}

// ---- Abbreviated name patterns ----

// Short names that violate Arc's verbose naming convention.
// Only flagged when they appear as standalone declarations (const/let/var/param),
// not as parts of longer identifiers.
// Note: "env" is excluded — it is the required Bun.spawn/spawnSync option key and
// cannot be renamed. Similarly "args" is excluded as it is a standard CLI convention.
const ABBREVIATED_NAMES = [
  "desc", "ts", "msg", "err", "res", "req", "cb", "fn",
  "val", "idx", "len", "cnt", "tmp", "buf", "str", "num",
  "obj", "arr", "cfg", "cmd",
];

// Match: const desc, let ts, var msg, or as function params (name: type)
// Word boundary ensures we don't match "description" or "timestamp".
const ABBREVIATED_PATTERN = new RegExp(
  `\\b(?:const|let|var)\\s+(?:${ABBREVIATED_NAMES.join("|")})\\b` +
  `|[({,]\\s*(?:${ABBREVIATED_NAMES.join("|")})\\s*[,:)]`,
  "g"
);

// ---- LLM detection ----

const LLM_IMPORT_PATTERNS = [
  /import\s.*from\s+["'](?:@anthropic-ai|openai|langchain|ai\/)/,
  /new\s+(?:Anthropic|OpenAI|ChatOpenAI)\b/,
  /"(?:claude-(?:opus|sonnet|haiku)-[0-9]|gpt-4|gpt-3\.5-turbo)"/,
];

// ---- Check functions ----

function checkStructuralCompliance(skill: SkillInfo): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const skill_md_path = join(skill.path, "SKILL.md");

  // SKILL.md exists and is non-empty
  if (!existsSync(skill_md_path)) {
    findings.push({
      skill_name: skill.name,
      rule: "skill-md-exists",
      detail: "SKILL.md is missing",
    });
    return findings; // Can't check further without SKILL.md
  }

  const skill_md_file = Bun.file(skill_md_path);
  const skill_md_size = skill_md_file.size;
  if (skill_md_size === 0) {
    findings.push({
      skill_name: skill.name,
      rule: "skill-md-exists",
      detail: "SKILL.md is empty",
    });
  }

  // Frontmatter validation
  if (!skill.description) {
    findings.push({
      skill_name: skill.name,
      rule: "frontmatter-valid",
      detail: "missing description in frontmatter",
    });
  }

  if (skill.tags.length === 0) {
    findings.push({
      skill_name: skill.name,
      rule: "frontmatter-valid",
      detail: "missing tags in frontmatter",
    });
  }

  // Name matches directory
  const directory_name = basename(skill.path);
  if (skill.name !== directory_name) {
    findings.push({
      skill_name: skill.name,
      rule: "name-matches-dir",
      detail: `frontmatter name "${skill.name}" does not match directory "${directory_name}"`,
    });
  }

  return findings;
}

async function checkSensorCompliance(skill: SkillInfo): Promise<ComplianceFinding[]> {
  if (!skill.hasSensor) return [];

  const findings: ComplianceFinding[] = [];
  const sensor_path = join(skill.path, "sensor.ts");
  const sensor_content = await Bun.file(sensor_path).text();

  // Check for default export
  if (!sensor_content.includes("export default")) {
    findings.push({
      skill_name: skill.name,
      rule: "sensor-default-export",
      detail: "sensor.ts missing default export",
    });
  }

  // Check for claimSensorRun usage
  if (!sensor_content.includes("claimSensorRun")) {
    findings.push({
      skill_name: skill.name,
      rule: "sensor-claim-gate",
      detail: "sensor.ts does not use claimSensorRun() for interval gating",
    });
  }

  // Check for INTERVAL_MINUTES constant
  if (!sensor_content.includes("INTERVAL_MINUTES")) {
    findings.push({
      skill_name: skill.name,
      rule: "sensor-interval-const",
      detail: "sensor.ts does not define INTERVAL_MINUTES constant",
    });
  }

  // Check for LLM/AI API usage
  for (const pattern of LLM_IMPORT_PATTERNS) {
    if (pattern.test(sensor_content)) {
      findings.push({
        skill_name: skill.name,
        rule: "sensor-no-llm",
        detail: "sensor.ts appears to import or use LLM/AI APIs",
      });
      break;
    }
  }

  return findings;
}

// ---- Cross-skill path validation ----

// Match: resolve(import.meta.dir, '...') or join(import.meta.dir, '...')
// Captures the string literal passed as the second argument.
const CROSS_SKILL_PATH_PATTERN = /(?:resolve|join)\s*\(\s*import\.meta\.dir\s*,\s*["']([^"']+)["']/g;

async function checkCrossSkillPaths(skill: SkillInfo): Promise<ComplianceFinding[]> {
  const findings: ComplianceFinding[] = [];
  const files_to_check = ["sensor.ts", "cli.ts"];

  for (const file_name of files_to_check) {
    const file_path = join(skill.path, file_name);
    if (!existsSync(file_path)) continue;

    const content = await Bun.file(file_path).text();
    const lines = content.split("\n");

    for (let line_number = 0; line_number < lines.length; line_number++) {
      const line = lines[line_number];
      const trimmed = line.trimStart();

      // Skip comments
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      CROSS_SKILL_PATH_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CROSS_SKILL_PATH_PATTERN.exec(line)) !== null) {
        const relative_path = match[1];

        // Only validate paths that reference other skill directories (contain '..')
        if (!relative_path.includes("..")) continue;

        // Skip runtime state files under db/ — these are created at runtime and
        // may not exist on disk between uses (e.g. sentinel files, cache files).
        if (relative_path.includes("/db/")) continue;

        const resolved_path = resolve(skill.path, relative_path);
        if (!existsSync(resolved_path)) {
          findings.push({
            skill_name: skill.name,
            rule: "cross-skill-path-valid",
            detail: `${file_name}:${line_number + 1} — hardcoded path does not exist: "${relative_path}"`,
          });
        }
      }
    }
  }

  return findings;
}

async function checkVerboseNaming(skill: SkillInfo): Promise<ComplianceFinding[]> {
  const findings: ComplianceFinding[] = [];

  // Check all .ts files in the skill directory
  const files_to_check = ["sensor.ts", "cli.ts"];

  for (const file_name of files_to_check) {
    const file_path = join(skill.path, file_name);
    if (!existsSync(file_path)) continue;

    const content = await Bun.file(file_path).text();
    const lines = content.split("\n");

    for (let line_number = 0; line_number < lines.length; line_number++) {
      const line = lines[line_number];

      // Skip comments and imports
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      if (line.trimStart().startsWith("import ")) continue;

      // Reset lastIndex for global regex
      ABBREVIATED_PATTERN.lastIndex = 0;
      const match = ABBREVIATED_PATTERN.exec(line);
      if (match) {
        // Extract the abbreviated name from the match
        const matched_text = match[0].trim();
        findings.push({
          skill_name: skill.name,
          rule: "verbose-naming",
          detail: `${file_name}:${line_number + 1} — abbreviated name: "${matched_text}"`,
        });
      }
    }
  }

  return findings;
}

// ---- Main sensor ----

export default async function complianceReviewSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    log("auditing skill and sensor compliance...");

    const all_skills = discoverSkills();
    const all_findings: ComplianceFinding[] = [];

    for (const skill of all_skills) {
      // Structural checks (synchronous)
      all_findings.push(...checkStructuralCompliance(skill));

      // Sensor checks (async — reads file content)
      const sensor_findings = await checkSensorCompliance(skill);
      all_findings.push(...sensor_findings);

      // Cross-skill path validation (async — resolves hardcoded paths)
      const path_findings = await checkCrossSkillPaths(skill);
      all_findings.push(...path_findings);

      // Verbose naming checks (async — reads file content)
      const naming_findings = await checkVerboseNaming(skill);
      all_findings.push(...naming_findings);
    }

    log(`audited ${all_skills.length} skills, found ${all_findings.length} finding(s)`);

    if (all_findings.length === 0) return "ok";

    // Group findings by rule for the report
    const by_rule = new Map<string, ComplianceFinding[]>();
    for (const finding of all_findings) {
      const group = by_rule.get(finding.rule) ?? [];
      group.push(finding);
      by_rule.set(finding.rule, group);
    }

    const rule_labels: Record<string, string> = {
      "skill-md-exists": "Missing or Empty SKILL.md",
      "frontmatter-valid": "Invalid Frontmatter",
      "name-matches-dir": "Name/Directory Mismatch",
      "sensor-default-export": "Missing Default Export",
      "sensor-claim-gate": "Missing claimSensorRun() Gate",
      "sensor-interval-const": "Missing INTERVAL_MINUTES",
      "sensor-no-llm": "LLM/AI API Usage in Sensor",
      "verbose-naming": "Abbreviated Naming Violation",
      "cross-skill-path-valid": "Stale Cross-Skill Path",
    };

    let description = `Compliance audit found ${all_findings.length} finding(s) across ${all_skills.length} skills.\n\n`;

    for (const [rule, findings] of by_rule) {
      description += `## ${rule_labels[rule] ?? rule}\n\n`;
      for (const finding of findings) {
        description += `- **${finding.skill_name}**: ${finding.detail}\n`;
      }
      description += "\n";
    }

    description += "Review each finding and fix or document exceptions. Structural issues should be fixed first.";

    // Use workflow for findings→retrospective chain tracking
    const today = new Date().toISOString().slice(0, 10);
    const wfKey = `compliance-review:${today}`;
    if (!getWorkflowByInstanceKey(wfKey)) {
      insertWorkflow({
        template: "compliance-review",
        instance_key: wfKey,
        current_state: "scan_complete",
        context: JSON.stringify({
          findingCount: all_findings.length,
          skillCount: all_skills.length,
          scanDate: today,
        }),
      });
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
