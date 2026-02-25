import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---- Types ----

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  hasSensor: boolean;
  hasCli: boolean;
  hasAgent: boolean;
  tags: string[];
}

// ---- Frontmatter parsing ----

interface Frontmatter {
  name: string;
  description: string;
  tags: string[];
}

function parseFrontmatter(content: string): Frontmatter {
  const result: Frontmatter = { name: "", description: "", tags: [] };

  // Find the YAML frontmatter block between first and second ---
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterDone = false;
  let inTagsList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inFrontmatter && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter && !frontmatterDone && trimmed === "---") {
      frontmatterDone = true;
      break;
    }

    if (inFrontmatter && !frontmatterDone) {
      // Check for inline array: tags: [a, b, c]
      const inlineTagsMatch = trimmed.match(/^tags:\s*\[(.+)\]$/);
      if (inlineTagsMatch) {
        result.tags = inlineTagsMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""));
        inTagsList = false;
        continue;
      }

      // Check for tags: key (multiline list follows)
      if (trimmed === "tags:") {
        inTagsList = true;
        continue;
      }

      // Collect list items under tags
      if (inTagsList && trimmed.startsWith("- ")) {
        result.tags.push(trimmed.slice(2).trim());
        continue;
      }

      // Any other key resets tag list mode
      if (!trimmed.startsWith("- ")) {
        inTagsList = false;
      }

      // name: value
      const nameMatch = trimmed.match(/^name:\s*(.+)$/);
      if (nameMatch) {
        result.name = nameMatch[1].trim().replace(/^['"]|['"]$/g, "");
        continue;
      }

      // description: value
      const descMatch = trimmed.match(/^description:\s*(.+)$/);
      if (descMatch) {
        result.description = descMatch[1].trim().replace(/^['"]|['"]$/g, "");
        continue;
      }
    }
  }

  return result;
}

// ---- Discovery ----

export function discoverSkills(): SkillInfo[] {
  const skillsRoot = join(import.meta.dir, "../skills");

  if (!existsSync(skillsRoot)) {
    return [];
  }

  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(skillsRoot, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, "utf-8");
    const fm = parseFrontmatter(content);

    skills.push({
      name: fm.name || entry.name,
      description: fm.description,
      path: skillDir,
      hasSensor: existsSync(join(skillDir, "sensor.ts")),
      hasCli: existsSync(join(skillDir, "cli.ts")),
      hasAgent: existsSync(join(skillDir, "AGENT.md")),
      tags: fm.tags,
    });
  }

  // Sort alphabetically by name
  skills.sort((a, b) => a.name.localeCompare(b.name));

  return skills;
}
