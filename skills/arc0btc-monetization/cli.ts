#!/usr/bin/env bun
// skills/arc0btc-monetization/cli.ts
// Scans Arc's capabilities and surfaces monetization opportunities for arc0btc.com.

import { join } from "node:path";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { getRecentCycles } from "../../src/db.ts";

const SKILLS_DIR = join(process.cwd(), "skills");

interface Capability {
  skill: string;
  description: string;
  has_sensor: boolean;
  has_cli: boolean;
  has_agent: boolean;
}

interface Opportunity {
  name: string;
  category: "service" | "product" | "content" | "tool";
  description: string;
  based_on: string[];
  feasibility: "high" | "medium" | "low";
  notes: string;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function discoverCapabilities(): Capability[] {
  const capabilities: Capability[] = [];

  if (!existsSync(SKILLS_DIR)) return capabilities;

  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const name of dirs) {
    const skillDir = join(SKILLS_DIR, name);
    const skillMd = join(skillDir, "SKILL.md");

    if (!existsSync(skillMd)) continue;

    const content = readFileSync(skillMd, "utf-8");
    // Extract description from frontmatter
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const description = descMatch ? descMatch[1].trim() : "";

    capabilities.push({
      skill: name,
      description,
      has_sensor: existsSync(join(skillDir, "sensor.ts")),
      has_cli: existsSync(join(skillDir, "cli.ts")),
      has_agent: existsSync(join(skillDir, "AGENT.md")),
    });
  }

  return capabilities;
}

function analyzeOpportunities(capabilities: Capability[]): Opportunity[] {
  const opportunities: Opportunity[] = [];

  // Check for monitoring capabilities
  const monitoringSkills = capabilities.filter(
    (c) => c.has_sensor && (c.description.toLowerCase().includes("monitor") || c.description.toLowerCase().includes("health"))
  );
  if (monitoringSkills.length > 0) {
    opportunities.push({
      name: "Site Monitoring Service",
      category: "service",
      description: "Offer automated site health monitoring, uptime checks, and alerting as a service for other projects/DAOs.",
      based_on: monitoringSkills.map((s) => s.skill),
      feasibility: "high",
      notes: "Arc already runs 24/7 monitoring. Packaging for external clients requires API endpoints and billing.",
    });
  }

  // Check for content/publishing capabilities
  const publishingSkills = capabilities.filter(
    (c) => c.skill.includes("blog") || c.skill.includes("publishing") || c.skill.includes("content")
  );
  if (publishingSkills.length > 0) {
    opportunities.push({
      name: "Automated Content Pipeline",
      category: "service",
      description: "Content creation and publishing pipeline — research, draft, edit, publish, deploy. End-to-end automated.",
      based_on: publishingSkills.map((s) => s.skill),
      feasibility: "high",
      notes: "Already operational for arc0.me blog. Could be offered as white-label service.",
    });
  }

  // Check for Bitcoin/crypto capabilities
  const cryptoSkills = capabilities.filter(
    (c) => c.skill.includes("bitcoin") || c.skill.includes("stacks") || c.skill.includes("multisig") || c.skill.includes("wallet")
  );
  if (cryptoSkills.length > 0) {
    opportunities.push({
      name: "Bitcoin/Stacks Technical Guides",
      category: "content",
      description: "Paid technical guides on multisig setup, taproot transactions, Stacks smart contracts, and PoX stacking.",
      based_on: cryptoSkills.map((s) => s.skill),
      feasibility: "medium",
      notes: "Arc has proven BIP-340/342 expertise and on-chain transaction history. Guides need packaging.",
    });
  }

  // Check for agent architecture capabilities
  const agentSkills = capabilities.filter(
    (c) => c.skill.includes("skill-manager") || c.skill.includes("architecture") || c.skill.includes("dispatch")
  );
  if (agentSkills.length > 0) {
    opportunities.push({
      name: "Agent Architecture Framework",
      category: "tool",
      description: "Open-source or licensed agent framework — task queue, sensor system, skill tree, dispatch loop.",
      based_on: agentSkills.map((s) => s.skill),
      feasibility: "medium",
      notes: "Core arc-starter framework. Needs documentation and packaging for external use.",
    });
  }

  // Check for security/audit capabilities
  const securitySkills = capabilities.filter(
    (c) => c.skill.includes("security") || c.skill.includes("audit") || c.skill.includes("compliance")
  );
  if (securitySkills.length > 0) {
    opportunities.push({
      name: "Agent Security Audits",
      category: "service",
      description: "Security review service for autonomous agent deployments — permission analysis, credential hygiene, attack surface mapping.",
      based_on: securitySkills.map((s) => s.skill),
      feasibility: "low",
      notes: "Arc has AgentShield baseline (A grade). Needs more case studies before offering externally.",
    });
  }

  // Check for deploy/CI capabilities
  const deploySkills = capabilities.filter(
    (c) => c.skill.includes("deploy") || c.skill.includes("ci") || c.skill.includes("worker")
  );
  if (deploySkills.length > 0) {
    opportunities.push({
      name: "Cloudflare Deploy Pipeline",
      category: "service",
      description: "Managed deploy pipeline for Astro/Cloudflare Workers sites — build, deploy, verify, rollback.",
      based_on: deploySkills.map((s) => s.skill),
      feasibility: "high",
      notes: "Proven pipeline for arc0.me. Easily adaptable for similar static sites.",
    });
  }

  // X402 gated content
  const x402Skills = capabilities.filter(
    (c) => c.skill.includes("x402") || c.description.toLowerCase().includes("x402") || c.skill.includes("social-agent-engagement")
  );
  if (x402Skills.length > 0 || cryptoSkills.length > 0) {
    opportunities.push({
      name: "X402 Gated Content",
      category: "content",
      description: "Premium content gated behind X402 micropayments — technical deep-dives, agent logs, strategy memos.",
      based_on: [...x402Skills.map((s) => s.skill), ...cryptoSkills.map((s) => s.skill)],
      feasibility: "medium",
      notes: "X402 messaging at 100 sats/msg is proven. Content gating needs endpoint work.",
    });
  }

  return opportunities;
}

function formatMarkdown(capabilities: Capability[], opportunities: Opportunity[], cycles: number): string {
  let md = `# Arc Monetization Report\n\n`;
  md += `*Generated: ${new Date().toISOString()}*\n\n`;
  md += `## Summary\n\n`;
  md += `- **Skills installed:** ${capabilities.length}\n`;
  md += `- **With sensors:** ${capabilities.filter((c) => c.has_sensor).length}\n`;
  md += `- **With CLI:** ${capabilities.filter((c) => c.has_cli).length}\n`;
  md += `- **Recent dispatch cycles:** ${cycles}\n`;
  md += `- **Opportunities identified:** ${opportunities.length}\n\n`;

  md += `## Opportunities\n\n`;
  for (const opp of opportunities) {
    md += `### ${opp.name} (${opp.category})\n\n`;
    md += `${opp.description}\n\n`;
    md += `- **Feasibility:** ${opp.feasibility}\n`;
    md += `- **Based on:** ${opp.based_on.join(", ")}\n`;
    md += `- **Notes:** ${opp.notes}\n\n`;
  }

  md += `## Capabilities\n\n`;
  md += `| Skill | Sensor | CLI | Description |\n`;
  md += `|-------|--------|-----|-------------|\n`;
  for (const cap of capabilities) {
    md += `| ${cap.skill} | ${cap.has_sensor ? "yes" : "no"} | ${cap.has_cli ? "yes" : "no"} | ${cap.description.substring(0, 60)} |\n`;
  }

  return md;
}

async function cmdScan(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const format = (flags["format"] as string) ?? "json";

  const capabilities = discoverCapabilities();
  const opportunities = analyzeOpportunities(capabilities);
  const recentCycles = getRecentCycles(100);

  if (format === "markdown") {
    console.log(formatMarkdown(capabilities, opportunities, recentCycles.length));
  } else {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      skills_count: capabilities.length,
      recent_cycles: recentCycles.length,
      opportunities,
    }, null, 2));
  }
}

function cmdListCapabilities(): void {
  const capabilities = discoverCapabilities();
  console.log(JSON.stringify({
    total: capabilities.length,
    with_sensors: capabilities.filter((c) => c.has_sensor).length,
    with_cli: capabilities.filter((c) => c.has_cli).length,
    capabilities,
  }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`arc0btc-monetization CLI

USAGE
  arc skills run --name arc0btc-monetization -- <subcommand> [flags]

SUBCOMMANDS
  scan [--format json|markdown]
    Analyze Arc's capabilities and generate monetization opportunity report.
    Default format: json.

  list-capabilities
    List all installed skills and their capabilities.

EXAMPLES
  arc skills run --name arc0btc-monetization -- scan
  arc skills run --name arc0btc-monetization -- scan --format markdown
  arc skills run --name arc0btc-monetization -- list-capabilities
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "scan":
      await cmdScan(args.slice(1));
      break;
    case "list-capabilities":
      cmdListCapabilities();
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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
