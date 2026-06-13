// Keyword classifiers for arxiv-research papers.
//
// Three concerns are kept distinct:
//   1. Sensor relevance (what makes a paper worth queueing for digest)
//   2. Beat assignment (quantum vs aibtc-infra vs agent-architecture)
//   3. Distill topic taxonomy (slug used for artifacts/distilled/arxiv/<topic>.json)
//
// History: AIBTC_SPECIFIC_KEYWORDS and AGENT/CRYPTO sets lived inline in
// sensor.ts; QUANTUM_KEYWORDS was duplicated between sensor.ts and cli.ts.
// Consolidated here so the new arxiv-distill skill can classify nuggets by the
// same taxonomy without re-rolling the regexes.

export const AIBTC_SPECIFIC_KEYWORDS: readonly RegExp[] = [
  /\bMCP\b/,
  /\bmodel context protocol/i,
  /\bMCP[-\s]?server/i,
  /\bHTTP[-\s]?402\b/,
  /\bx402\b/,
  /\bstacks\b/i,
  /\bclarity[-\s]?(language|vm|contract)/i,
  /\bsBTC\b/,
  /\bBRC-20\b/,
  /\bbitcoin.*relay/i,
  /\brelay.*bitcoin/i,
  /\bnonce.*manag.*agent/i,
];

export const QUANTUM_KEYWORDS: readonly RegExp[] = [
  /\bpost[-\s]?quantum/i,
  /\bquantum[-\s]?(attack|threat|resist|safe|secur)/i,
  /\b(break|break.*ECDSA|attack.*ECDSA|ECDSA.*break)/i,
  /\bquantum.*bitcoin/i,
  /\bbitcoin.*quantum/i,
  /\bquantum.*cryptocurren/i,
  /\bShor'?s algorithm/i,
  /\bGrover'?s algorithm/i,
  /\bquantum.*key.*distribut/i,
  /\bquantum[-\s]?resistant/i,
  /\bquantum[-\s]?proof/i,
  /\blattice[-\s]?based.*crypt/i,
  /\bNIST.*post[-\s]?quantum/i,
  /\bP2QRH\b/,
  /\bBIP[-\s]?360\b/,
  /\bquantum.*hash/i,
  /\bquantum.*elliptic/i,
];

export const AGENT_KEYWORDS: readonly RegExp[] = [
  /\bautonomous agent/i,
  /\bLLM[-\s]?agent/i,
  /\bagent[-\s]?framework/i,
  /\bagent[-\s]?infra/i,
  /\borchestrat/i,
  /\bagent[-\s]?to[-\s]?agent/i,
  /\bAI[-\s]?agent/i,
  /\bmulti[-\s]?agent/i,
];

export const CRYPTO_INFRA_KEYWORDS: readonly RegExp[] = [
  /\bbitcoin/i,
  /\bblockchain/i,
  /\bon[-\s]?chain/i,
  /\bsmart[-\s]?contract/i,
  /\bmicropayment/i,
  /\bpayment[-\s]?channel/i,
  /\bdecentralized.*finance/i,
  /\bDeFi\b/,
  /\bweb3\b/i,
  /\bcryptocurren/i,
];

/**
 * Distill topic taxonomy for arxiv artifacts. Each producer-emitted nugget
 * MUST be classified into exactly one of these slugs. The distill agent
 * picks the best fit by reading the digest entry and applying the regex
 * groups in priority order: quantum (overrides) > aibtc-infra > agent-arch.
 */
export const DISTILL_TOPICS = [
  "quantum-pqc",
  "aibtc-infra",
  "agent-architecture",
] as const;
export type DistillTopic = (typeof DISTILL_TOPICS)[number];

/**
 * Classify a paper's title (and optional abstract) into a distill topic.
 * Returns null if the paper doesn't fit any of the three buckets — the
 * caller should drop it (not every relevant paper deserves a nugget).
 */
export function classifyTopic(title: string, abstract: string = ""): DistillTopic | null {
  const haystack = `${title}\n${abstract}`;
  if (QUANTUM_KEYWORDS.some((re) => re.test(haystack))) return "quantum-pqc";
  if (AIBTC_SPECIFIC_KEYWORDS.some((re) => re.test(haystack))) return "aibtc-infra";
  const hasAgent = AGENT_KEYWORDS.some((re) => re.test(haystack));
  const hasCrypto = CRYPTO_INFRA_KEYWORDS.some((re) => re.test(haystack));
  if (hasAgent && hasCrypto) return "aibtc-infra";
  if (hasAgent) return "agent-architecture";
  return null;
}
