// skills/arc-catalog/cli.ts
// Generates skills/sensors catalog and publishes to arc0me-site.
//
// Usage:
//   bun skills/arc-catalog/cli.ts generate   — write catalog to arc0me-site
//   bun skills/arc-catalog/cli.ts preview    — print catalog JSON to stdout

import { join, basename } from "node:path";
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";

const SKILLS_DIR = join(import.meta.dir, "..");
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");
const CATALOG_JSON_PATH = join(SITE_DIR, "src/content/docs/catalog/catalog.json");
const CATALOG_MDX_PATH = join(SITE_DIR, "src/content/docs/catalog/index.mdx");
const CATALOG_API_PATH = join(SITE_DIR, "src/pages/api/catalog.json.ts");

interface SkillEntry {
  name: string;
  description: string;
  tags: string[];
  hasSensor: boolean;
  hasCli: boolean;
  hasAgent: boolean;
  sensorInterval: number | null;
  category: string;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const val = line.substring(colonIdx + 1).trim();
    if (val.startsWith("[") || val === "") continue;
    fm[key] = val;
  }
  // Parse tags array (YAML list format)
  const tagsMatch = match[1].match(/tags:\n((?:\s+-\s+.+\n?)*)/);
  if (tagsMatch) {
    fm.tags = tagsMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }
  return fm;
}

function extractSensorInterval(sensorPath: string): number | null {
  try {
    const content = readFileSync(sensorPath, "utf-8");
    // Match INTERVAL_MINUTES = N or intervalMinutes = N patterns
    const match = content.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
    // Also try claimSensorRun(name, N) pattern
    const claimMatch = content.match(/claimSensorRun\([^,]+,\s*(\d+)\)/);
    if (claimMatch) return parseInt(claimMatch[1], 10);
    return null;
  } catch {
    return null;
  }
}

function categorizeSkill(name: string, tags: string[]): string {
  if (name.startsWith("arc-") || name.startsWith("arc0btc-")) return "Arc Infrastructure";
  if (name.startsWith("aibtc-")) return "AIBTC Platform";
  if (name.startsWith("bitcoin-") || name.startsWith("stacks-")) return "Bitcoin & Stacks";
  if (name.startsWith("dao-") || name.startsWith("defi-")) return "DeFi & Governance";
  if (name.startsWith("erc8004-")) return "On-Chain Identity (ERC-8004)";
  if (name.startsWith("github-")) return "GitHub & DevOps";
  if (name.startsWith("blog-") || name.startsWith("social-")) return "Publishing & Social";
  if (name.startsWith("dev-")) return "Development Tools";
  if (name.startsWith("compliance-") || name.startsWith("context-")) return "Quality & Compliance";
  return "Other";
}

function buildCatalog(): SkillEntry[] {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const entries: SkillEntry[] = [];

  for (const dir of dirs) {
    const skillMdPath = join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, "utf-8");
    const fm = parseFrontmatter(content);

    const name = (fm.name as string) || dir;
    const description = (fm.description as string) || "";
    const tags = (fm.tags as string[]) || [];

    const sensorPath = join(SKILLS_DIR, dir, "sensor.ts");
    const cliPath = join(SKILLS_DIR, dir, "cli.ts");
    const agentPath = join(SKILLS_DIR, dir, "AGENT.md");

    const hasSensor = existsSync(sensorPath);
    const hasCli = existsSync(cliPath);
    const hasAgent = existsSync(agentPath);
    const sensorInterval = hasSensor ? extractSensorInterval(sensorPath) : null;

    entries.push({
      name,
      description,
      tags,
      hasSensor,
      hasCli,
      hasAgent,
      sensorInterval,
      category: categorizeSkill(name, tags),
    });
  }

  return entries;
}

function formatInterval(minutes: number): string {
  if (minutes >= 1440) return `${minutes / 1440}d`;
  if (minutes >= 60) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function generateMdx(catalog: SkillEntry[]): string {
  const categories = new Map<string, SkillEntry[]>();
  for (const entry of catalog) {
    const list = categories.get(entry.category) || [];
    list.push(entry);
    categories.set(entry.category, list);
  }

  const sensors = catalog.filter((e) => e.hasSensor);
  const now = new Date().toISOString().split("T")[0];

  let mdx = `---
title: Skills & Sensors Catalog
description: Arc's complete catalog of skills and sensors - what I can do, what I watch
---

Arc runs ${catalog.length} skills and ${sensors.length} active sensors. Skills are knowledge containers — each one teaches me how to do something specific. Sensors watch the world every minute and create tasks when something needs attention.

Last updated: ${now}

**Quick stats:** ${catalog.length} skills | ${sensors.length} sensors | ${catalog.filter((e) => e.hasCli).length} CLI commands | ${new Set(catalog.map((e) => e.category)).size} categories

Machine-readable: [/api/catalog.json](/api/catalog.json)

---

## Sensors

Sensors run every minute via systemd timer. Each sensor gates itself — most minutes it checks and skips. When something real happens, it creates a task.

| Sensor | What It Watches | Cadence |
|--------|----------------|---------|
`;

  for (const s of sensors.sort((a, b) => (a.sensorInterval ?? 999) - (b.sensorInterval ?? 999))) {
    const cadence = s.sensorInterval ? formatInterval(s.sensorInterval) : "?";
    mdx += `| **${s.name}** | ${s.description} | ${cadence} |\n`;
  }

  mdx += `\n---\n\n## Skills by Category\n\n`;

  const categoryOrder = [
    "Arc Infrastructure",
    "AIBTC Platform",
    "Bitcoin & Stacks",
    "DeFi & Governance",
    "On-Chain Identity (ERC-8004)",
    "GitHub & DevOps",
    "Publishing & Social",
    "Development Tools",
    "Quality & Compliance",
    "Other",
  ];

  for (const cat of categoryOrder) {
    const skills = categories.get(cat);
    if (!skills || skills.length === 0) continue;

    mdx += `### ${cat}\n\n`;
    mdx += `| Skill | Description | Components |\n`;
    mdx += `|-------|-------------|------------|\n`;

    for (const s of skills) {
      const components: string[] = [];
      if (s.hasSensor) components.push(`sensor(${s.sensorInterval ? formatInterval(s.sensorInterval) : "?"})`);
      if (s.hasCli) components.push("cli");
      if (s.hasAgent) components.push("agent");
      mdx += `| **${s.name}** | ${s.description} | ${components.join(", ") || "docs only"} |\n`;
    }

    mdx += `\n`;
  }

  mdx += `---\n\n## Using These Skills\n\n`;
  mdx += `Arc skills are designed as knowledge containers. Each skill directory contains:\n\n`;
  mdx += `- **SKILL.md** — What the skill does, how to use it (always present)\n`;
  mdx += `- **sensor.ts** — Background watcher that creates tasks automatically\n`;
  mdx += `- **cli.ts** — CLI commands: \`arc skills run --name <skill> -- <command>\`\n`;
  mdx += `- **AGENT.md** — Detailed instructions for subagents (never loaded into main context)\n\n`;
  mdx += `Want to build your own? Start with [arc-starter](https://github.com/arc0btc/arc-starter).\n`;

  return mdx;
}

function generateApiEndpoint(catalog: SkillEntry[]): string {
  return `// Auto-generated by arc-catalog — do not edit manually
import type { APIRoute } from "astro";

const catalog = ${JSON.stringify(catalog, null, 2)} as const;

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(catalog, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
};

export const prerender = true;
`;
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === "help") {
    console.log("Usage:");
    console.log("  generate  — Generate catalog files in arc0me-site");
    console.log("  preview   — Print catalog JSON to stdout (dry run)");
    process.exit(0);
  }

  const catalog = buildCatalog();

  if (command === "preview") {
    console.log(JSON.stringify(catalog, null, 2));
    console.log(`\n--- ${catalog.length} skills, ${catalog.filter((e) => e.hasSensor).length} sensors ---`);
    process.exit(0);
  }

  if (command === "generate") {
    if (!existsSync(SITE_DIR)) {
      console.error(`arc0me-site not found at ${SITE_DIR}`);
      process.exit(1);
    }

    // Ensure directories exist
    const catalogDir = join(SITE_DIR, "src/content/docs/catalog");
    const apiDir = join(SITE_DIR, "src/pages/api");
    mkdirSync(catalogDir, { recursive: true });
    mkdirSync(apiDir, { recursive: true });

    // Write catalog JSON (for reference / debugging)
    writeFileSync(CATALOG_JSON_PATH, JSON.stringify(catalog, null, 2));
    console.log(`Wrote ${CATALOG_JSON_PATH}`);

    // Write catalog MDX page
    const mdx = generateMdx(catalog);
    writeFileSync(CATALOG_MDX_PATH, mdx);
    console.log(`Wrote ${CATALOG_MDX_PATH}`);

    // Write API endpoint
    const api = generateApiEndpoint(catalog);
    writeFileSync(CATALOG_API_PATH, api);
    console.log(`Wrote ${CATALOG_API_PATH}`);

    console.log(`\nCatalog generated: ${catalog.length} skills, ${catalog.filter((e) => e.hasSensor).length} sensors`);
    console.log("Commit arc0me-site to trigger blog-deploy sensor.");
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main();
