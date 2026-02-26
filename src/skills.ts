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

/** Strip leading/trailing quotes from a YAML value. */
function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(content: string): Frontmatter {
  const result: Frontmatter = { name: "", description: "", tags: [] };

  // Extract the YAML block between the first pair of --- delimiters
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return result;

  const lines = fmMatch[1].split("\n");
  let inTagsList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Inline array: tags: [a, b, c]
    const inlineTagsMatch = trimmed.match(/^tags:\s*\[(.+)\]$/);
    if (inlineTagsMatch) {
      result.tags = inlineTagsMatch[1].split(",").map(unquote);
      inTagsList = false;
      continue;
    }

    // Multiline tags list header
    if (trimmed === "tags:") {
      inTagsList = true;
      continue;
    }

    // Collect list items under tags, or end tag collection on non-list line
    if (inTagsList) {
      if (trimmed.startsWith("- ")) {
        result.tags.push(trimmed.slice(2).trim());
        continue;
      }
      inTagsList = false;
    }

    // Simple key: value pairs
    const kvMatch = trimmed.match(/^(name|description):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      result[key as "name" | "description"] = unquote(value);
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
