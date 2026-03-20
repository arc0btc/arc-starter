/**
 * trust-gate.ts — shared nostr-wot trust evaluation helper.
 *
 * Calls the nostr-wot CLI in a subprocess and returns a structured trust
 * decision for use in payment and DeFi pre-transaction gates.
 *
 * Decision ladder:
 *   "block"  — confirmed likely_sybil: abort the operation
 *   "warn"   — suspicious classification or WoT rank above threshold: proceed with caution
 *   "allow"  — trusted or classification normal
 *   "skip"   — no pubkey provided; gate is not applicable
 *   "error"  — API unavailable; log and proceed (don't block on infra failure)
 */

import { resolve } from "node:path";
import { spawn } from "bun";

const CLI_PATH = resolve(import.meta.dir, "cli.ts");
const ROOT = resolve(import.meta.dir, "../..");

export type TrustDecision = "allow" | "warn" | "block" | "skip" | "error";
export type SybilClassification = "normal" | "suspicious" | "likely_sybil" | "unknown";

export interface TrustScore {
  rank?: number;
  percentile?: number;
  normalized_score?: number;
  trusted?: boolean;
  cached?: boolean;
  error?: string;
}

export interface SybilCheck {
  classification: SybilClassification;
  is_sybil: boolean;
  is_suspicious: boolean;
  follower_quality?: number;
  mutual_trust_ratio?: number;
  cached?: boolean;
  error?: string;
}

export interface TrustGateResult {
  decision: TrustDecision;
  pubkey?: string;
  trust?: TrustScore;
  sybil?: SybilCheck;
  reason: string;
}

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = spawn(["bun", "run", CLI_PATH, ...args], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), exitCode };
}

async function fetchTrustScore(pubkey: string): Promise<TrustScore> {
  try {
    const { stdout, exitCode } = await runCli(["trust-score", "--pubkey", pubkey]);
    if (exitCode !== 0 || !stdout) return { error: stdout || "no output" };
    const result = JSON.parse(stdout) as Record<string, unknown>;
    return {
      rank: result.rank as number | undefined,
      percentile: result.percentile as number | undefined,
      normalized_score: result.normalized_score as number | undefined,
      trusted: result.trusted as boolean | undefined,
      cached: result.cached as boolean | undefined,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchSybilCheck(pubkey: string): Promise<SybilCheck> {
  try {
    const { stdout, exitCode } = await runCli(["sybil-check", "--pubkey", pubkey]);
    if (exitCode !== 0 || !stdout) {
      return { classification: "unknown", is_sybil: false, is_suspicious: false, error: stdout || "no output" };
    }
    const result = JSON.parse(stdout) as Record<string, unknown>;
    const classification = (result.classification as SybilClassification) ?? "unknown";
    return {
      classification,
      is_sybil: (result.is_sybil as boolean) ?? false,
      is_suspicious: (result.is_suspicious as boolean) ?? false,
      follower_quality: result.follower_quality as number | undefined,
      mutual_trust_ratio: result.mutual_trust_ratio as number | undefined,
      cached: result.cached as boolean | undefined,
    };
  } catch (e) {
    return {
      classification: "unknown",
      is_sybil: false,
      is_suspicious: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Evaluate a counterparty's Nostr trust profile before a transaction.
 *
 * @param pubkey  - hex pubkey or npub. Pass undefined to skip the gate.
 * @returns TrustGateResult with a decision and supporting data.
 */
export async function evaluateCounterparty(pubkey: string | undefined): Promise<TrustGateResult> {
  if (!pubkey) {
    return { decision: "skip", reason: "no pubkey provided — gate not applicable" };
  }

  // Run both checks in parallel to minimise latency
  const [trust, sybil] = await Promise.all([
    fetchTrustScore(pubkey),
    fetchSybilCheck(pubkey),
  ]);

  // If both checks failed (API down), don't block — fail open with a log
  if (trust.error && sybil.error) {
    return {
      decision: "error",
      pubkey,
      trust,
      sybil,
      reason: `WoT API unavailable — proceeding without trust check (${trust.error})`,
    };
  }

  // Hard block on confirmed sybil
  if (sybil.is_sybil) {
    return {
      decision: "block",
      pubkey,
      trust,
      sybil,
      reason: `Sybil detected: classification=${sybil.classification}, mutual_trust=${sybil.mutual_trust_ratio}`,
    };
  }

  // Warn on suspicious but don't block — caller decides whether to proceed
  if (sybil.is_suspicious || trust.trusted === false) {
    return {
      decision: "warn",
      pubkey,
      trust,
      sybil,
      reason: `Suspicious counterparty: classification=${sybil.classification}, WoT rank=${trust.rank ?? "unknown"}, trusted=${trust.trusted ?? "unknown"}`,
    };
  }

  return {
    decision: "allow",
    pubkey,
    trust,
    sybil,
    reason: `Trusted: WoT rank=${trust.rank ?? "unknown"}, classification=${sybil.classification ?? "normal"}`,
  };
}
