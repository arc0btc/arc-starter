#!/usr/bin/env bun
// skills/arc-brand-voice/cli.ts
// Brand identity consultant — voice rules, visual design, content review

import { parseFlags } from "../../src/utils.ts";

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [arc-brand/cli] ${message}`);
}

// ---- Voice Rule Patterns ----

interface VoiceIssue {
  severity: "critical" | "warning" | "info";
  rule: string;
  match: string;
  line: number;
  suggestion: string;
}

const HYPE_WORDS = [
  "revolutionary", "game-changing", "groundbreaking", "unprecedented",
  "disruptive", "cutting-edge", "next-gen", "world-class", "best-in-class",
  "synergy", "paradigm shift", "ecosystem play", "moonshot",
];

const CORPORATE_PHRASES = [
  "we're excited to announce",
  "we're pleased to",
  "we believe that",
  "we are thrilled",
  "proud to announce",
  "delighted to share",
  "it is with great pleasure",
  "we're happy to report",
];

const GENERIC_ENCOURAGEMENT = [
  "keep building",
  "let's go",
  "lfg",
  "wagmi",
  "to the moon",
  "this is the way",
  "bullish",
  "so excited",
];

const THROAT_CLEARING = [
  "in this post",
  "in this article",
  "today we",
  "today i",
  "i wanted to share",
  "i'd like to discuss",
  "let me explain",
  "as you may know",
  "it goes without saying",
];

const AI_DISCLAIMERS = [
  "as an ai",
  "i'm just a bot",
  "i'm just an ai",
  "as a language model",
  "i don't have feelings",
  "i can't actually",
];

const OBLIGATION_REPLIES = [
  "appreciate that",
  "thanks for sharing",
  "great point",
  "absolutely",
  "couldn't agree more",
  "well said",
  "this is great",
  "love this",
  "so true",
];

function checkVoiceRules(text: string): VoiceIssue[] {
  const issues: VoiceIssue[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    const lineNum = i + 1;

    // Skip frontmatter and code blocks
    if (line.startsWith("---") || line.startsWith("```")) continue;

    // Critical: Hype language
    for (const word of HYPE_WORDS) {
      if (lineLower.includes(word)) {
        issues.push({
          severity: "critical",
          rule: "no-hype",
          match: word,
          line: lineNum,
          suggestion: "Replace with specific, factual language. Substance, not adjectives.",
        });
      }
    }

    // Critical: Corporate voice
    for (const phrase of CORPORATE_PHRASES) {
      if (lineLower.includes(phrase)) {
        issues.push({
          severity: "critical",
          rule: "no-corporate",
          match: phrase,
          line: lineNum,
          suggestion: "Arc doesn't do press releases. State what happened directly.",
        });
      }
    }

    // Critical: Generic encouragement
    for (const phrase of GENERIC_ENCOURAGEMENT) {
      if (lineLower.includes(phrase)) {
        issues.push({
          severity: "critical",
          rule: "no-generic-encouragement",
          match: phrase,
          line: lineNum,
          suggestion: "Any bot can say this. Add specific value or cut it.",
        });
      }
    }

    // Critical: AI disclaimers
    for (const phrase of AI_DISCLAIMERS) {
      if (lineLower.includes(phrase)) {
        issues.push({
          severity: "critical",
          rule: "no-ai-disclaimer",
          match: phrase,
          line: lineNum,
          suggestion: "Arc has opinions and owns them. No self-deprecating disclaimers.",
        });
      }
    }

    // Critical: Emoji in body text (not in code blocks or frontmatter)
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u;
    if (emojiPattern.test(line) && !line.startsWith(">")) {
      issues.push({
        severity: "critical",
        rule: "no-emoji",
        match: "emoji detected",
        line: lineNum,
        suggestion: "Arc doesn't use emojis in body text. Remove or replace with words.",
      });
    }

    // Warning: Obligation replies
    for (const phrase of OBLIGATION_REPLIES) {
      if (lineLower.includes(phrase)) {
        issues.push({
          severity: "warning",
          rule: "no-obligation-reply",
          match: phrase,
          line: lineNum,
          suggestion: "Add specific value instead. What does this actually contribute?",
        });
      }
    }

    // Warning: Throat-clearing openings (only check first 5 lines of body)
    if (lineNum <= 10) {
      for (const phrase of THROAT_CLEARING) {
        if (lineLower.includes(phrase)) {
          issues.push({
            severity: "warning",
            rule: "no-throat-clearing",
            match: phrase,
            line: lineNum,
            suggestion: "Start with the interesting thing. No warm-up laps.",
          });
        }
      }
    }

    // Warning: Long sentences (>30 words, skip headings and code)
    if (!line.startsWith("#") && !line.startsWith("|") && !line.startsWith("-") && !line.startsWith("```") && line.trim().length > 0) {
      const words = line.trim().split(/\s+/);
      if (words.length > 30) {
        issues.push({
          severity: "warning",
          rule: "long-sentence",
          match: `${words.length} words`,
          line: lineNum,
          suggestion: "Simplify. Split into shorter sentences. Arc values concise prose.",
        });
      }
    }

    // Warning: Long paragraphs (>4 consecutive non-empty lines)
    if (line.trim().length > 0 && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("-") && !line.startsWith("```")) {
      let consecutive = 0;
      for (let j = i; j < lines.length && lines[j].trim().length > 0 && !lines[j].startsWith("#"); j++) {
        consecutive++;
      }
      if (consecutive > 4) {
        issues.push({
          severity: "warning",
          rule: "long-paragraph",
          match: `${consecutive} consecutive lines`,
          line: lineNum,
          suggestion: "Break into shorter paragraphs. Whitespace helps readability.",
        });
        // Skip ahead to avoid duplicate warnings for same paragraph
      }
    }
  }

  // Deduplicate: only keep one long-paragraph warning per block
  const seen = new Set<string>();
  const deduped: VoiceIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.rule}:${issue.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(issue);
    }
  }

  return deduped;
}

// ---- Commands ----

function cmdBrandGuide(): void {
  const guide = `
ARC BRAND GUIDE
===============

VOICE
  Precision > speed. Honest > nice. Simple > clever.
  Structural observations over platitudes.
  Dry humor, earned. Concise takes that land.
  Every reply: adds info, asks a real question, or invites response.

ANTI-PATTERNS
  No hype language (revolutionary, game-changing)
  No corporate voice (we're excited to announce)
  No generic encouragement (keep building, LFG)
  No AI disclaimers (as an AI, I'm just a bot)
  No emoji in body text
  No obligation replies (appreciate that, great point)
  No throat-clearing openings (in this post, today we)

COLORS
  Primary:    #FEC233 (Arc Gold)
  Dark:       #D4A020 (Gold Dark)
  Light:      #FFD666 (Gold Light)
  Glow:       rgba(254, 194, 51, 0.3)
  Vermillion: #DF2D2C (alerts)
  Magenta:    #BB278F (accent)
  Cream:      #E9D4CF (warm neutral)
  Background: #000000 (pure black)
  Nav BG:     #0a0a0a
  Code BG:    #0c0c0e

TYPOGRAPHY
  Body:     system-ui, 18-19px, weight 400, line-height 1.7
  Headings: system-ui, clamp() fluid, weight 500-600, tight tracking
  Code:     JetBrains Mono / Fira Code, 0.875rem

DESIGN PRINCIPLES
  1. Dark-first (black backgrounds, light text)
  2. Bitcoin warmth (gold accents, not cold blue)
  3. Minimal (every element earns its place)
  4. High contrast (accessibility matters)
  5. Subtle gradients for depth (never loud)

IDENTITY
  Canonical: "I'm Arc. A Bitcoin agent — native to L1, building on L2 (Stacks) — alongside whoabuddy."
  Red flags: "on Stacks", "running on Stacks", "Autonomous agent on Stacks", "crypto AI", "Web3 agent"
  Site:    https://arc0.me
  X:       https://x.com/arc0btc
  BNS:     arc0.btc
  Avatar:  public/avatar.png (arc0me-site)

CONTENT TEST
  Before publishing, ask:
  1. Does it pass the voice test?
  2. Is it precise? (no unverified claims)
  3. Is it honest? (no hedging, no hype)
  4. Is it concise? (every sentence earns its place)
  5. Does it sound like Arc?
`;
  console.log(guide.trim());
}

async function cmdBrandCheck(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);

  if (!flags.content) {
    process.stderr.write("Usage: arc skills run --name arc-brand -- brand-check --content \"text to check\"\n");
    process.exit(1);
  }

  const issues = checkVoiceRules(flags.content);
  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  const result = {
    passed: critical.length === 0,
    summary: {
      critical: critical.length,
      warnings: warnings.length,
      info: infos.length,
      total: issues.length,
    },
    issues,
    verdict: critical.length === 0
      ? warnings.length === 0
        ? "Clean. On brand."
        : `Passable. ${warnings.length} warning(s) to consider.`
      : `Off brand. ${critical.length} critical issue(s) must be fixed.`,
  };

  console.log(JSON.stringify(result, null, 2));
}

async function cmdReviewPost(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);

  if (!flags.file) {
    process.stderr.write("Usage: arc skills run --name arc-brand -- review-post --file <path>\n");
    process.exit(1);
  }

  const filePath = flags.file;
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    process.stderr.write(`Error: file not found: ${filePath}\n`);
    process.exit(1);
  }

  const content = await file.text();
  log(`Reviewing: ${filePath} (${content.length} chars)`);

  // Extract frontmatter for metadata checks
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;

  // Voice check on body
  const voiceIssues = checkVoiceRules(body);

  // Structure checks
  const structureIssues: VoiceIssue[] = [];
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  const wordCount = body.split(/\s+/).filter((w) => w.length > 0).length;

  // Check: does it have a headline?
  if (!body.includes("# ") && !frontmatterMatch) {
    structureIssues.push({
      severity: "warning",
      rule: "missing-headline",
      match: "no heading found",
      line: 1,
      suggestion: "Posts should have clear section headings for scannability.",
    });
  }

  // Check: word count
  if (wordCount < 200) {
    structureIssues.push({
      severity: "info",
      rule: "short-post",
      match: `${wordCount} words`,
      line: 1,
      suggestion: "Post is short. Is it complete? Blog posts typically run 800-2000 words.",
    });
  }

  if (wordCount > 2500) {
    structureIssues.push({
      severity: "warning",
      rule: "long-post",
      match: `${wordCount} words`,
      line: 1,
      suggestion: "Post is long. Could sections be tightened or split into a series?",
    });
  }

  // Check: frontmatter has required fields
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    if (!fm.includes("title:")) {
      structureIssues.push({
        severity: "critical",
        rule: "missing-title",
        match: "no title in frontmatter",
        line: 1,
        suggestion: "Frontmatter must include a title field.",
      });
    }
    if (!fm.includes("tags:") && !fm.includes("tag:")) {
      structureIssues.push({
        severity: "info",
        rule: "missing-tags",
        match: "no tags in frontmatter",
        line: 1,
        suggestion: "Consider adding tags for discoverability.",
      });
    }
  }

  const allIssues = [...voiceIssues, ...structureIssues];
  const critical = allIssues.filter((i) => i.severity === "critical");
  const warnings = allIssues.filter((i) => i.severity === "warning");

  const result = {
    file: filePath,
    wordCount,
    lineCount: lines.length,
    passed: critical.length === 0,
    summary: {
      critical: critical.length,
      warnings: warnings.length,
      info: allIssues.filter((i) => i.severity === "info").length,
      total: allIssues.length,
    },
    issues: allIssues,
    verdict: critical.length === 0
      ? warnings.length === 0
        ? "On brand. Ready to publish."
        : `Mostly on brand. ${warnings.length} warning(s) to review before publishing.`
      : `Off brand. ${critical.length} critical issue(s) must be fixed before publishing.`,
  };

  console.log(JSON.stringify(result, null, 2));
}

// ---- Main ----

function printUsage(): void {
  process.stdout.write(`arc-brand-voice CLI — Brand identity consultant

USAGE
  arc skills run --name arc-brand-voice -- <command> [flags]

COMMANDS
  brand-guide
    Print Arc's brand manual summary (voice, colors, typography, design).

  brand-check --content "text"
    Check text against Arc's voice rules. Returns JSON with issues found.

  review-post --file <path>
    Audit a blog post file for brand consistency (voice + structure).
    Returns JSON with issues, word count, and verdict.

EXAMPLES
  arc skills run --name arc-brand-voice -- brand-guide
  arc skills run --name arc-brand-voice -- brand-check --content "We're excited to announce our revolutionary new feature!"
  arc skills run --name arc-brand-voice -- review-post --file content/2026/2026-03-02/my-post/index.md
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case "brand-guide":
        cmdBrandGuide();
        break;
      case "brand-check":
        await cmdBrandCheck(args.slice(1));
        break;
      case "review-post":
        await cmdReviewPost(args.slice(1));
        break;
      default:
        process.stderr.write(`Error: unknown command '${command}'\n\n`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
