#!/usr/bin/env bun
// skills/content-quality-gate/cli.ts
import { IDENTITY } from "../../src/identity.ts";
// Quality gate: detect AI writing patterns before publishing blog posts, X posts, and AIBTC signals

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [content-quality] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[arg.slice(2)] = args[i + 1];
        i++;
      } else {
        flags[arg.slice(2)] = "true";
      }
    }
  }
  return flags;
}

type ContentType = "blog" | "x-post" | "signal";

interface PatternMatch {
  pattern: string;
  matches: string[];
}

interface AnalysisResult {
  type: ContentType;
  issues: PatternMatch[];
  issueCount: number;
  lengthOk: boolean;
  lengthNote: string;
  llmResult: { pass: boolean; warn: boolean; reason: string } | null;
  verdict: "PASS" | "WARN" | "FAIL";
  summary: string;
}

// ---- Pattern Detection ----

const INFLATED_SIGNIFICANCE = [
  /\bpivotal moment\b/gi,
  /\blandmark\b/gi,
  /\bhistoric(?:al)? milestone\b/gi,
  /\bgame.?changer\b/gi,
  /\bparadigm shift\b/gi,
  /\bwatershad moment\b/gi,
  /\bdefining moment\b/gi,
];

const OVERUSED_VOCAB = [
  /\blandscape\b/gi,
  /\btestament\b/gi,
  /\bdelve\b/gi,
  /\btapestry\b/gi,
  /\bbeacon\b/gi,
  /\bfoster\b/gi,
  /\bunderscore\b/gi,
  /\bleverage\b/gi,
  /\brobust\b/gi,
  /\bseamless\b/gi,
  /\bgroundbreaking\b/gi,
  /\brevolutionary\b/gi,
  /\btransformative\b/gi,
  /\binnovative\b/gi,
  /\bempower\b/gi,
  /\bsynergy\b/gi,
  /\bholistic\b/gi,
  /\bpivot\b/gi,
];

const VAGUE_ATTRIBUTION = [
  /\bexperts (?:say|believe|suggest|note)\b/gi,
  /\bsome (?:experts|analysts|observers)\b/gi,
  /\bmany (?:believe|think|argue)\b/gi,
  /\bit (?:is|has been) (?:widely|commonly|generally) (?:believed|accepted|noted)\b/gi,
];

const SYCOPHANTIC = [
  /\bgreat question\b/gi,
  /\bexcellent question\b/gi,
  /\bi hope this helps\b/gi,
  /\bi hope (?:you find|this is helpful)\b/gi,
  /\bfeel free to (?:ask|reach out)\b/gi,
  /\bplease (?:let me know|don't hesitate)\b/gi,
  /\bof course[,!]/gi,
  /\bcertainly[,!]/gi,
];

const EM_DASH_OVERUSE_THRESHOLD = 3;
const BOLD_OVERUSE_THRESHOLD = 5;

function detectPatterns(content: string, type: ContentType): PatternMatch[] {
  const issues: PatternMatch[] = [];

  // Inflated significance
  const sigMatches: string[] = [];
  for (const re of INFLATED_SIGNIFICANCE) {
    const m = content.match(re);
    if (m) sigMatches.push(...m.map((s) => s.toLowerCase()));
  }
  if (sigMatches.length > 0) {
    issues.push({ pattern: "inflated-significance", matches: [...new Set(sigMatches)] });
  }

  // Overused vocabulary
  const vocabMatches: string[] = [];
  for (const re of OVERUSED_VOCAB) {
    const m = content.match(re);
    if (m) vocabMatches.push(...m.map((s) => s.toLowerCase()));
  }
  if (vocabMatches.length > 0) {
    issues.push({ pattern: "overused-vocabulary", matches: [...new Set(vocabMatches)] });
  }

  // Vague attribution
  const attrMatches: string[] = [];
  for (const re of VAGUE_ATTRIBUTION) {
    const m = content.match(re);
    if (m) attrMatches.push(...m.map((s) => s.toLowerCase()));
  }
  if (attrMatches.length > 0) {
    issues.push({ pattern: "vague-attribution", matches: [...new Set(attrMatches)] });
  }

  // Sycophantic filler
  const sycMatches: string[] = [];
  for (const re of SYCOPHANTIC) {
    const m = content.match(re);
    if (m) sycMatches.push(...m.map((s) => s.toLowerCase()));
  }
  if (sycMatches.length > 0) {
    issues.push({ pattern: "sycophantic-filler", matches: [...new Set(sycMatches)] });
  }

  // Em-dash overuse (blog and x-post only)
  if (type !== "signal") {
    const emDashes = (content.match(/—/g) || []).length;
    if (emDashes >= EM_DASH_OVERUSE_THRESHOLD) {
      issues.push({
        pattern: "em-dash-overuse",
        matches: [`${emDashes} em-dashes (threshold: ${EM_DASH_OVERUSE_THRESHOLD})`],
      });
    }
  }

  // Excessive boldface (blog only)
  if (type === "blog") {
    const bolds = (content.match(/\*\*[^*]+\*\*/g) || []).length;
    if (bolds >= BOLD_OVERUSE_THRESHOLD) {
      issues.push({
        pattern: "excessive-boldface",
        matches: [`${bolds} bold spans (threshold: ${BOLD_OVERUSE_THRESHOLD})`],
      });
    }
  }

  // X-post: must not be generic encouragement
  if (type === "x-post") {
    if (/\bkeep building\b/gi.test(content) || /\bgreat work\b/gi.test(content)) {
      issues.push({
        pattern: "generic-encouragement",
        matches: content.match(/\bkeep building\b|\bgreat work\b/gi)?.map((s) => s.toLowerCase()) || [],
      });
    }
  }

  return issues;
}

function checkLength(content: string, type: ContentType): { ok: boolean; note: string } {
  if (type === "x-post") {
    if (content.length > 280) {
      return { ok: false, note: `X post is ${content.length} chars (max 280)` };
    }
    return { ok: true, note: `${content.length}/280 chars` };
  }
  if (type === "signal") {
    if (content.length > 500) {
      return {
        ok: false,
        note: `Signal field is ${content.length} chars (max 500 per field)`,
      };
    }
    return { ok: true, note: `${content.length}/500 chars` };
  }
  // blog: no hard limit
  return { ok: true, note: `${content.length} chars` };
}

// ---- LLM Voice Check ----

async function checkVoiceWithLLM(
  content: string,
  type: ContentType
): Promise<{ pass: boolean; warn: boolean; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log("ANTHROPIC_API_KEY not set — skipping LLM voice check");
    return { pass: true, warn: false, reason: "LLM check skipped (no API key) — verify manually" };
  }

  const voiceGuide: Record<ContentType, string> = {
    blog: "Personal, specific, first-person where appropriate. Varied sentence rhythm. Concrete examples, not generic claims. Dry humor is good. Avoid: obligation replies, symmetrical reciprocity, defensive loops, generic encouragement.",
    "x-post":
      "Punchy, direct, dry wit. Must make a concrete claim or ask a real question. Never: filler words, obligation replies, empty agreement. Under 280 chars.",
    signal:
      "Economist voice: claim-evidence-implication structure. Precise, evidence-driven. No hype or promotional language. No vague attributions.",
  };

  const prompt = `You are a content quality judge for an autonomous AI agent named ${IDENTITY.name}. The agent's writing is direct, specific, and opinionated — not polished AI prose.

Content type: ${type}
Voice requirements: ${voiceGuide[type]}

Content to evaluate:
---
${content.slice(0, 1000)}
---

Evaluate whether this content sounds like authentic agent writing or like generic AI-generated text.

Respond with JSON only:
{"result": "Pass" | "Warn" | "Fail", "critique": "one sentence explaining the decision"}

Pass = sounds like authentic agent voice
Warn = mostly ok but has some generic phrasing
Fail = sounds like generic AI output`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { content: Array<{ text: string }> };
  const text = data.content[0]?.text || "{}";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in LLM response: ${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as { result: string; critique: string };
  return {
    pass: parsed.result === "Pass",
    warn: parsed.result === "Warn",
    reason: parsed.critique || parsed.result,
  };
}

// ---- Analysis ----

async function analyzeContent(content: string, type: ContentType): Promise<AnalysisResult> {
  const issues = detectPatterns(content, type);
  const { ok: lengthOk, note: lengthNote } = checkLength(content, type);
  const llmResult = await checkVoiceWithLLM(content, type);

  const issueCount = issues.length + (lengthOk ? 0 : 1);

  let verdict: "PASS" | "WARN" | "FAIL";
  if (!lengthOk || (issueCount >= 3 && !llmResult.warn) || (!llmResult.pass && !llmResult.warn)) {
    verdict = "FAIL";
  } else if (issueCount >= 1 || llmResult.warn) {
    verdict = "WARN";
  } else {
    verdict = "PASS";
  }

  // Build summary
  const parts: string[] = [];
  if (!lengthOk) parts.push(lengthNote);
  for (const issue of issues) {
    parts.push(`${issue.pattern}: ${issue.matches.join(", ")}`);
  }
  if (llmResult) parts.push(`voice: ${llmResult.reason}`);

  return {
    type,
    issues,
    issueCount,
    lengthOk,
    lengthNote,
    llmResult,
    verdict,
    summary: parts.join(" | ") || "No issues detected",
  };
}

// ---- Commands ----

async function cmdCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.content || !flags.type) {
    console.error("Usage: arc skills run --name content-quality-gate -- check --content <text> --type blog|x-post|signal");
    process.exit(1);
  }

  const type = flags.type as ContentType;
  if (!["blog", "x-post", "signal"].includes(type)) {
    console.error(`Invalid --type: ${type}. Must be blog, x-post, or signal`);
    process.exit(1);
  }

  const result = await analyzeContent(flags.content, type);
  console.log(JSON.stringify(result, null, 2));

  if (result.verdict === "FAIL") {
    process.exit(2);
  }
}

async function cmdGate(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.content || !flags.type) {
    console.error("Usage: arc skills run --name content-quality-gate -- gate --content <text> --type blog|x-post|signal");
    process.exit(1);
  }

  const type = flags.type as ContentType;
  if (!["blog", "x-post", "signal"].includes(type)) {
    console.error(`Invalid --type: ${type}. Must be blog, x-post, or signal`);
    process.exit(1);
  }

  const result = await analyzeContent(flags.content, type);

  if (result.verdict === "FAIL") {
    console.error(`FAIL: ${result.summary}`);
    process.exit(2);
  } else if (result.verdict === "WARN") {
    console.error(`WARN: ${result.summary}`);
    // pass the gate but log warnings
    process.exit(0);
  } else {
    console.log(`PASS: ${result.summary}`);
    process.exit(0);
  }
}

// ---- Main ----

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "help") {
  console.log(`content-quality — pre-publish quality gate

Commands:
  check  --content <text> --type blog|x-post|signal   Full analysis (JSON output)
  gate   --content <text> --type blog|x-post|signal   Binary pass/fail (exit 0=pass, 2=fail)

Examples:
  arc skills run --name content-quality-gate -- gate --content "BRC-20 up 40%." --type signal
  arc skills run --name content-quality-gate -- check --content "..." --type blog
`);
  process.exit(0);
}

const command = args[0];

try {
  switch (command) {
    case "check":
      await cmdCheck(args.slice(1));
      break;
    case "gate":
      await cmdGate(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}. Commands: check, gate`);
      process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
