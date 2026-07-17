#!/usr/bin/env bun
/**
 * fixture-classify-403.ts
 * Phase 1 (control-plane-remediation) verify: regression fixture for
 * classifyProviderError() (skills/social-engine/reply-send.ts).
 *
 * Context: 2026-07-16T00:00:03Z, a reply-restriction 403 ("You can only reply to or quote
 * posts where you are mentioned or are the author") was misclassified as `auth_scope`,
 * tripping the GLOBAL `outbound_enabled=false` kill switch instead of a per-row skip
 * (engagement_log id 502; see docs/observations/2026-07-14-control-plane-audit/
 * defect-register.md row 52). Arc self-patched the classifier (VM-local commit ba589fa3)
 * but the fix was never exercised by a real reply-restriction 403 before this fixture.
 *
 * This fixture replays the EXACT raw error body from that incident (byte-identical JSON)
 * through classifyProviderError() and asserts it now classifies as `reply_restriction`,
 * not `auth_scope`. It also asserts a genuine auth/scope error still classifies as
 * `auth_scope`, so a regression in either direction would be caught.
 *
 * ASSERT-ONLY — imports the pure function, makes no DB connection, no network call, no
 * side effects. Safe to run any time, including while the kill switch is off.
 *
 * Run: bun skills/social-engine/fixture-classify-403.ts
 */

import { classifyProviderError } from "./reply-send.ts";

let passed = 0;
let failed = 0;

function check(label: string, result: boolean, detail: string = "") {
  const status = result ? "PASS" : "FAIL";
  const mark = result ? "+" : "!";
  console.log(`[${status}] ${mark} ${label}${detail ? " — " + detail : ""}`);
  if (result) passed++;
  else failed++;
}

// ── The exact 2026-07-16T00:00:03Z incident body (engagement_log id 502) ──────────────
const incidentBody = {
  detail: "You can only reply to or quote posts where you are mentioned or are the author.",
  status: 403,
  title: "Authorization Error",
  type: "https://api.x.com/2/problems/not-authorized-for-resource",
};
const incidentErr = { status: 403, body: incidentBody };

const incidentCls = classifyProviderError(incidentErr);
check(
  "Incident replay classifies as reply_restriction (not auth_scope)",
  incidentCls.kind === "reply_restriction",
  `kind=${incidentCls.kind}`
);
check(
  "Incident replay preserves status=403",
  incidentCls.status === 403,
  `status=${incidentCls.status}`
);

// ── A second, differently-worded reply-restriction 403 (defect row 59 evidence, 07-14) ─
const secondBody = {
  detail: "Reply to this conversation is not allowed because you have not been mentioned or otherwise engaged by the author of the post you are replying to.",
  type: "about:blank",
  title: "Forbidden",
  status: 403,
};
const secondCls = classifyProviderError({ status: 403, body: secondBody });
check(
  "Alternate reply-restriction wording also classifies as reply_restriction",
  secondCls.kind === "reply_restriction",
  `kind=${secondCls.kind}`
);

// ── Negative control: a genuine auth/scope error must STILL trip the kill switch ──────
const authErr = { status: 401, body: { detail: "Unauthorized", status: 401 } };
const authCls = classifyProviderError(authErr);
check(
  "Genuine 401 unauthorized still classifies as auth_scope (kill-switch path preserved)",
  authCls.kind === "auth_scope",
  `kind=${authCls.kind}`
);

const scopeErr = { status: 403, body: { detail: "This request requires additional scope permission.", status: 403 } };
const scopeCls = classifyProviderError(scopeErr);
check(
  "Genuine 403 scope/permission error still classifies as auth_scope",
  scopeCls.kind === "auth_scope",
  `kind=${scopeCls.kind}`
);

// ── Negative control: an unrelated transient error is neither ─────────────────────────
const transientErr = { status: 503, body: { detail: "Service unavailable" } };
const transientCls = classifyProviderError(transientErr);
check(
  "503 service-unavailable classifies as transient (no kill-switch trip, no false skip)",
  transientCls.kind === "transient",
  `kind=${transientCls.kind}`
);

// ── Summary ─────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== SUMMARY ===");
console.log(`UTC: ${new Date().toISOString()}`);
console.log(`Checks: ${passed + failed} total | ${passed} PASS | ${failed} FAIL`);
if (failed === 0) {
  console.log("PASS — classifyProviderError() correctly routes the 2026-07-16 incident body to reply_restriction (skip), not auth_scope (kill-switch trip), while preserving genuine auth/scope detection.");
} else {
  console.log("FAIL — classifier regression. Review output above before re-enabling the kill switch.");
}
process.exit(failed > 0 ? 1 : 0);
