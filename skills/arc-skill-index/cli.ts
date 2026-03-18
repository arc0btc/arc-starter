#!/usr/bin/env bun

// arc-skill-index/cli.ts
//
// CLI commands:
//   search-skills --query TEXT [--limit N]  — FTS5 search for skills by capability
//   reindex                                 — Force immediate re-index of all skills
//   failures [--skill NAME]                — Show failure patterns per skill

import { parseFlags, pad, truncate } from "../../src/utils.ts";
import { initDatabase, searchArcMemory, listArcMemory } from "../../src/db.ts";

const args = process.argv.slice(2);
const subcommand = args[0];

function cmdSearchSkills(cmdArgs: string[]): void {
  const { flags } = parseFlags(cmdArgs);
  const query = flags["query"];
  if (!query) {
    process.stderr.write("Error: --query is required\nUsage: arc skills run --name arc-skill-index -- search-skills --query TEXT [--limit N]\n");
    process.exit(1);
  }

  initDatabase();
  const limit = flags["limit"] ? parseInt(flags["limit"], 10) : 10;

  // Search skill capabilities in arc_memory domain='skills', excluding failure entries
  let results = searchArcMemory(query, "skills", limit * 2);
  // Filter to capability entries only (not failure patterns)
  results = results.filter((r) => r.key.startsWith("skill:") && !r.key.startsWith("skill-failure:"));
  results = results.slice(0, limit);

  if (results.length === 0) {
    process.stdout.write("No matching skills found.\n");
    return;
  }

  process.stdout.write(`Found ${results.length} matching skill(s):\n\n`);
  for (const mem of results) {
    const skillName = mem.key.replace("skill:", "");
    process.stdout.write(`  ${pad(skillName, 30)} ${mem.content.split(".").slice(1, 3).join(".").trim()}\n`);
    if (mem.tags) {
      process.stdout.write(`  ${pad("", 30)} tags: ${mem.tags}\n`);
    }
  }
}

async function cmdReindex(): Promise<void> {
  // Import and run the sensor directly
  const sensor = await import("./sensor.ts");
  // Force run by bypassing interval check — we call the indexing logic directly
  initDatabase();

  const { discoverSkills } = await import("../../src/skills.ts");
  const { upsertMemory } = await import("../../src/db.ts");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const skills = discoverSkills();
  let indexed = 0;

  for (const skill of skills) {
    try {
      const skillMdPath = join(skill.path, "SKILL.md");
      const content = readFileSync(skillMdPath, "utf-8");

      const parts: string[] = [];
      parts.push(`Skill: ${skill.name}`);
      if (skill.description) parts.push(`Description: ${skill.description}`);
      if (skill.tags.length > 0) parts.push(`Tags: ${skill.tags.join(", ")}`);
      const caps: string[] = [];
      if (skill.hasSensor) caps.push("sensor");
      if (skill.hasCli) caps.push("cli");
      if (caps.length > 0) parts.push(`Has: ${caps.join(", ")}`);

      const cliLines = content
        .split("\n")
        .filter((line) => /^\s*(arc\s|.*--\w)/.test(line) && !line.startsWith("#"))
        .map((line) => line.trim())
        .slice(0, 5);
      if (cliLines.length > 0) parts.push(`CLI commands: ${cliLines.join(" | ")}`);

      const summary = parts.join(". ");
      const trimmed = summary.length > 500 ? summary.slice(0, 497) + "..." : summary;

      upsertMemory({
        key: `skill:${skill.name}`,
        domain: "skills",
        content: trimmed,
        tags: ["skill", ...skill.tags, skill.hasSensor ? "sensor" : "", skill.hasCli ? "cli" : ""]
          .filter(Boolean)
          .join(" "),
        importance: 4,
      });
      indexed++;
    } catch (err) {
      process.stderr.write(`Failed to index ${skill.name}: ${err}\n`);
    }
  }

  process.stdout.write(`Reindexed ${indexed} skills.\n`);
}

function cmdFailures(cmdArgs: string[]): void {
  const { flags } = parseFlags(cmdArgs);
  initDatabase();

  const skillFilter = flags["skill"];

  // List failure entries from arc_memory
  const results = listArcMemory("skills", 100);
  const failures = results.filter((r) => {
    if (!r.key.startsWith("skill-failure:")) return false;
    if (skillFilter) {
      return r.key === `skill-failure:${skillFilter}`;
    }
    return true;
  });

  if (failures.length === 0) {
    process.stdout.write("No failure patterns indexed.\n");
    return;
  }

  for (const f of failures) {
    process.stdout.write(`--- ${f.key} (updated: ${f.updated_at}, ttl: ${f.ttl_days ?? "-"}d) ---\n`);
    process.stdout.write(`${f.content}\n\n`);
  }
}

// ---- Main ----

if (subcommand === "search-skills") {
  cmdSearchSkills(args.slice(1));
} else if (subcommand === "reindex") {
  await cmdReindex();
} else if (subcommand === "failures") {
  cmdFailures(args.slice(1));
} else {
  process.stderr.write(
    "Usage: arc skills run --name arc-skill-index -- <command>\n\n" +
    "Commands:\n" +
    "  search-skills --query TEXT [--limit N]  Search skills by capability\n" +
    "  reindex                                 Force re-index all skills\n" +
    "  failures [--skill NAME]                Show failure patterns per skill\n",
  );
  process.exit(subcommand ? 1 : 0);
}
