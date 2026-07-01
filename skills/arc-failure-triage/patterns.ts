/** Normalized error signature patterns. Order matters — first match wins. */
export const ERROR_PATTERNS: Array<{ signature: string; patterns: RegExp[] }> = [
  {
    signature: "rate-limit",
    patterns: [/\b429\b/, /rate.?limit/i],
  },
  {
    signature: "beat-conflict",
    patterns: [/beat.*claimed/i, /beat.*ownership/i, /claimed by another/i, /wrong beat/i],
  },
  {
    signature: "payment-error",
    patterns: [/402/i, /payment/i],
  },
  {
    signature: "sqlite-lock",
    patterns: [/database is locked/i, /SQLITE_BUSY/i],
  },
  {
    signature: "wallet-error",
    patterns: [/wallet.*unlock/i, /wallet.*fail/i, /signing.*fail/i],
  },
  {
    signature: "timeout",
    patterns: [/timeout/i, /ETIMEDOUT/i, /\bhung\b/i, /timed?\s*out/i],
  },
  {
    signature: "auth-error",
    patterns: [/\b403\b/, /\b401\b/, /permission denied/i, /unauthorized/i, /forbidden/i],
  },
  {
    signature: "cooldown-gate",
    patterns: [/cooldown active/i, /not yet eligible/i, /re-queue after/i, /cooldown.*expires/i],
  },
  {
    signature: "network-error",
    patterns: [/ECONNREFUSED/i, /ENOTFOUND/i, /fetch failed/i, /network/i],
  },
  {
    signature: "crash-recovery",
    patterns: [/crash recovery/i, /left active from a previous cycle/i, /stuck active/i],
  },
  {
    signature: "agent-suspended",
    patterns: [
      /suspended/i,
      /OAuth.*expired/i,
    ],
  },
  {
    signature: "github-blocked",
    patterns: [
      /github.*operations.*required/i,
      /no github credentials/i,
      /human must implement/i,
    ],
  },
  {
    signature: "x-budget-exhausted",
    patterns: [/budget exhausted/i, /post budget/i, /daily.*budget/i],
  },
  {
    signature: "missing-hardware",
    patterns: [/no.*gpu/i, /no dual-gpu/i, /hardware provisioning/i, /gpu.*required/i],
  },
  {
    signature: "external-not-ready",
    patterns: [
      /not publicly deployed/i,
      /endpoint does not exist/i,
      /bindings unavailable/i,
      /contracts not.*deployed/i,
      /waiting.*mainnet/i,
    ],
  },
  {
    signature: "blocked-on-human",
    patterns: [
      /whoabuddy.*needs to/i,
      /whoabuddy.*must/i,
      /wallet creds not in/i,
      /manual step needed/i,
      /requires.*browser interaction/i,
      /no X credentials/i,
      /X account.*registered/i,
      /creds?.*scoped to.*(a )?different/i,
      /dashboard (access|credentials) needed/i,
      /credentials?.*(don't|do not) match/i,
    ],
  },
  {
    signature: "dismissed",
    patterns: [/too noisy/i, /cleaning queue/i, /duplicate.*brief/i, /wrong priority/i, /focusing on mentions/i, /recreating with/i, /test task/i],
  },
  {
    signature: "superseded",
    patterns: [/superseded by (task )?#?\d+/i, /superseded by/i],
  },
  {
    signature: "outage-artifact",
    patterns: [
      /bulk triage.*outage/i,
      /stale:.*bulk triage/i,
      /failed by admin/i,
      /force.?killed/i,
      /intentionally offline/i,
      /admin.*triage/i,
      /compute outage/i,
    ],
  },
];

/** Signatures that should never trigger an investigation task — handled elsewhere or intentional. */
export const SKIP_SIGNATURES = new Set([
  "dismissed",
  "superseded",
  "outage-artifact",
  "crash-recovery",
  "agent-suspended",
  "github-blocked",
  "x-budget-exhausted",
  "missing-hardware",
  "external-not-ready",
  "blocked-on-human",
  "cooldown-gate",
]);

/** Extract a normalized error signature from a task's result_summary. */
export function classifyError(text: string): string {
  for (const { signature, patterns } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return signature;
    }
  }
  return "unknown";
}

/** Simple hash for dedup source keys. */
export function shortHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
