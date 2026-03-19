/**
 * publisher-voice CLI
 * AIBTC News institutional voice — guide, check
 */

const args = process.argv.slice(2);
const command = args[0];

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const ANTI_PATTERNS: Array<{ pattern: RegExp; label: string; severity: "critical" | "warning" }> = [
  // Emotional conjugation
  { pattern: /experts?\s+(worry|fear|warn|believe|hope|expect)\b/i, label: "Emotional conjugation — state the concern directly", severity: "critical" },
  { pattern: /troubling\s+development/i, label: "Emotional conjugation — 'troubling development'", severity: "critical" },
  { pattern: /exciting\s+(new|development|breakthrough)/i, label: "Emotional conjugation — 'exciting'", severity: "critical" },
  // Hype language
  { pattern: /\b(revolutionary|game[- ]changing|unprecedented|groundbreaking|disruptive)\b/i, label: "Hype vocabulary — describe what it does instead", severity: "critical" },
  // Throat-clearing
  { pattern: /^(in this (brief|article|report|piece|analysis),?\s+(we|I)\s+(will\s+)?(explore|examine|look at|discuss))/im, label: "Throat-clearing opener — lead with the news", severity: "critical" },
  // Summary endings
  { pattern: /(in (conclusion|summary),?\s+(as )?(we\s+)?(have\s+)?seen)/i, label: "Summary ending — the piece already said it", severity: "critical" },
  // Passive opinion laundering
  { pattern: /it\s+(could|might|may)\s+be\s+argued\s+that/i, label: "Passive opinion laundering — state the argument directly", severity: "critical" },
  // Corporate voice
  { pattern: /we('re| are)\s+excited\s+to\s+announce/i, label: "Corporate voice — just announce it", severity: "critical" },
  // Crypto slang
  { pattern: /\b(moon(ing)?|rekt|ngmi|wagmi|bullish af|bearish af|LFG|wen\s+\w+)\b/i, label: "Crypto slang — use precise language", severity: "critical" },
  // First person singular
  { pattern: /\bI\s+(think|believe|feel|hope)\b/i, label: "First-person singular — institutional voice, not personal", severity: "warning" },
  // Hedge stacking
  { pattern: /(possible|potentially|might|perhaps|maybe).{0,30}(possible|potentially|might|perhaps|maybe)/i, label: "Hedge stacking — pick a confidence level", severity: "warning" },
  // Unquantified claims
  { pattern: /\b(significant(ly)?|substantial(ly)?|considerable|dramatic(ally)?)\s+(growth|increase|decline|drop|rise|improvement)\b/i, label: "Unquantified claim — add the number", severity: "warning" },
  // Prestige blandness
  { pattern: /\b(leverag(e|ing)|synerg(y|ies)|ecosystem\s+play|value\s+proposition|paradigm\s+shift)\b/i, label: "Prestige blandness — say what you mean", severity: "warning" },
];

function checkContent(text: string): Array<{ line: number; match: string; label: string; severity: string }> {
  const lines = text.split("\n");
  const issues: Array<{ line: number; match: string; label: string; severity: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    for (const ap of ANTI_PATTERNS) {
      const m = lines[i].match(ap.pattern);
      if (m) {
        issues.push({ line: i + 1, match: m[0], label: ap.label, severity: ap.severity });
      }
    }
  }

  // Check sentence length (>30 words)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  for (const s of sentences) {
    const wordCount = s.trim().split(/\s+/).length;
    if (wordCount > 30) {
      const preview = s.trim().slice(0, 60) + "...";
      issues.push({ line: 0, match: preview, label: `Long sentence (${wordCount} words) — consider splitting`, severity: "warning" });
    }
  }

  return issues;
}

function printGuide(): void {
  const guide = `
AIBTC News — Publisher Voice Guide

FOUR RULES
  Direct    — State positions plainly. No hedging behind attribution.
  Dense     — Every sentence earns its place.
  Memorable — Craft matters. Boring is failure.
  Clear     — Respect attention. Get there fast.

STYLE ZONE
  Economist-ish. Vivid but grounded. Opinionated but not preachy.
  Institutional voice — no byline ego.

STRUCTURE (Claim-Evidence-Implication)
  Claim:       One declarative sentence. What happened.
  Evidence:    Data, metrics, verifiable facts.
  Implication: What it means. Opinion lives here.

DO
  - Lead with the most important fact
  - Quantify: "$48M inflows" not "significant inflows"
  - Active verbs: "rose," "fell," "signals," "breaks"
  - One idea per signal
  - Short sentences. Vary rhythm.

DON'T
  - Emotional conjugation ("experts worry")
  - Prestige blandness (HBR syndrome)
  - Hidden framing — own your positions
  - Hype vocabulary ("revolutionary," "game-changing")
  - First-person singular (institutional voice)
  - Crypto slang in analysis

MEMORABLE vs MANIPULATIVE
  Remove the vivid language. Does the claim still hold?
  Yes → craft is serving truth. Keep it.
  No  → you're manufacturing emotion. Cut it.

DENSITY TARGETS
  Signal:    150–400 chars (max 1000)
  Paragraph: 2–4 sentences
  Headlines: Specific + declarative
`.trim();

  console.log(guide);
}

if (!command || command === "--help") {
  console.log(`publisher-voice — AIBTC News institutional voice

Commands:
  guide                          Print voice guide summary
  check --content "text"         Check text against voice rules
  check --file <path>            Check file against voice rules

Examples:
  arc skills run --name publisher-voice -- guide
  arc skills run --name publisher-voice -- check --content "Experts worry about the revolutionary new protocol"
  arc skills run --name publisher-voice -- check --file drafts/signal.md`);
  process.exit(0);
}

if (command === "guide") {
  printGuide();
  process.exit(0);
}

if (command === "check") {
  const content = getFlag("--content");
  const filePath = getFlag("--file");

  let text: string;
  if (content) {
    text = content;
  } else if (filePath) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    text = await file.text();
  } else {
    console.error("Error: --content or --file required");
    process.exit(1);
  }

  const issues = checkContent(text);

  if (issues.length === 0) {
    console.log(JSON.stringify({ pass: true, message: "No voice issues detected", issues: [] }));
    process.exit(0);
  }

  const critical = issues.filter(i => i.severity === "critical");
  const warnings = issues.filter(i => i.severity === "warning");

  console.log(JSON.stringify({
    pass: critical.length === 0,
    critical: critical.length,
    warnings: warnings.length,
    issues,
  }, null, 2));

  process.exit(critical.length > 0 ? 2 : 0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
