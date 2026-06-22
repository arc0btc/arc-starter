#!/usr/bin/env bun
/**
 * live-read-whop-products.ts
 *
 * P6 verification: reads back each created/updated Whop product via the
 * official @whop/sdk, verifies price + headline, and records rollback steps.
 * Read-only — no mutations.
 *
 * Usage (on Arc VM):  bun ops/verify/three-surface/live-read-whop-products.ts
 * (Requires @whop/sdk installed and whop/company_api_key credential available)
 *
 * Products verified (P6 2026-06-20):
 *   prod_HTLQdLKXqPGIS — Agent Infrastructure Field Guide ($29)
 *   prod_Fw0VQtWkwHhmJ — arxiv-research Pipeline Skill ($19, hidden)
 *   prod_TJknsIOzPDlQS — Hash It Out: Research Membership ($49/mo)
 */

const UTC_START = new Date().toISOString();

// ---- Credential resolution ----

async function resolveApiKey(): Promise<string> {
  if (process.env.WHOP_COMPANY_API_KEY) return process.env.WHOP_COMPANY_API_KEY;

  try {
    const { getCredential } = await import(
      "/home/dev/arc-starter/src/credentials.ts" as string
    );
    const key = await getCredential("whop", "company_api_key");
    if (key) return key;
  } catch {
    // Not on Arc VM
  }

  throw new Error(
    "No Whop API key. Set WHOP_COMPANY_API_KEY env var or run on Arc VM with creds provisioned."
  );
}

// ---- Expected product states ----

const EXPECTED = [
  {
    label: "Field Guide",
    productId: "prod_HTLQdLKXqPGIS",
    planId: "plan_a1hHfCe0JfvGL",
    expectedTitle: "Agent Infrastructure Field Guide",
    expectedHeadline: "178 posts distilled. The operational layer nobody else documents.",
    expectedPrice: 29,
    expectedProductVisibility: "visible",
    rollback:
      'products.update("prod_HTLQdLKXqPGIS", { title: "The Harness Engineering Field Guide: Why Capable Agents Fail", headline: "Five subsystems. One field guide. Fix what your agent actually breaks on." }); ' +
      "hide plan_a1hHfCe0JfvGL, plans.update(plan_iWhn7BqRgGBtu, { visibility: \"visible\" })",
  },
  {
    label: "arxiv-research Pipeline Skill",
    productId: "prod_Fw0VQtWkwHhmJ",
    planId: "plan_th1XTTwfLWc0V",
    expectedTitle: "arxiv-research Pipeline Skill",
    expectedHeadline: "One file. No dependencies. Your own paper-to-digest pipeline.",
    expectedPrice: 19,
    expectedProductVisibility: "hidden", // operator makes visible after review
    rollback:
      'products.update("prod_Fw0VQtWkwHhmJ", { visibility: "hidden" }) or delete via Whop dashboard',
  },
  {
    label: "Membership",
    productId: "prod_TJknsIOzPDlQS",
    planId: "plan_axYMvJ4cBnq8v",
    expectedTitle: "Hash It Out: Research Membership",
    expectedHeadline: "Read what Arc is researching before it publishes.",
    expectedPrice: 49,
    expectedProductVisibility: "visible",
    rollback:
      'products.update("prod_TJknsIOzPDlQS", { headline: "Learn from an AI agent (and operator) building on Bitcoin" })',
  },
];

// ---- Run verification ----

async function main(): Promise<void> {
  const apiKey = await resolveApiKey();

  // Load SDK dynamically (available on Arc VM; not in control-plane node_modules)
  const WhopModule = await import("@whop/sdk");
  const Whop = WhopModule.default;
  const client = new Whop({ apiKey, timeout: 15_000, maxRetries: 0 });

  let pass = 0;
  let fail = 0;
  const lines: string[] = [];

  function check(label: string, got: string | number | boolean, expected: string | number | boolean): void {
    if (got === expected) {
      lines.push(`  PASS  ${label}: ${JSON.stringify(got)}`);
      pass++;
    } else {
      lines.push(`  FAIL  ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
      fail++;
    }
  }

  lines.push(`Whop Products Live Read-Back — P6 Verification`);
  lines.push(`UTC: ${UTC_START}`);
  lines.push(`Company: biz_zQbfh5SnRnAF5Y`);
  lines.push("");

  for (const spec of EXPECTED) {
    lines.push(`=== ${spec.label} ===`);

    try {
      const product = await client.products.retrieve(spec.productId) as {
        id: string;
        title: string;
        headline: string | null;
        visibility: string;
      };
      const plan = await client.plans.retrieve(spec.planId) as {
        id: string;
        initial_price: number;
        visibility: string;
        purchase_url: string | null;
      };

      lines.push(`  Product ID:    ${product.id}`);
      lines.push(`  Plan ID:       ${plan.id}`);
      lines.push(`  Checkout URL:  ${plan.purchase_url ?? "(none)"}`);
      lines.push("");

      check("title", product.title, spec.expectedTitle);
      check("headline", product.headline ?? "", spec.expectedHeadline);
      check("product visibility", product.visibility, spec.expectedProductVisibility);
      check("plan price", plan.initial_price, spec.expectedPrice);
      check("plan visibility", plan.visibility, "visible");

    } catch (e) {
      lines.push(`  FAIL  API error: ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }

    lines.push("");
    lines.push(`  Rollback:      ${spec.rollback}`);
    lines.push("");
  }

  // Membership unlock-all note
  lines.push(`=== Membership Unlock-All (schema-level) ===`);
  lines.push(`  Whop's membership grants entitlement to all experiences in the company.`);
  lines.push(`  The plan_axYMvJ4cBnq8v membership ($49/mo) is the unlock-all tier.`);
  lines.push(`  Entitlement schema proof: see fixture-p1-x402-schema.ts report_entitlement`);
  lines.push(`  invariants (P1 fixture 31/31 PASS). Live Whop entitlement requires a`);
  lines.push(`  membership purchase; the schema gates are proven via the P1 fixture.`);
  lines.push("");

  // Final summary
  lines.push(`=== Summary ===`);
  lines.push(`  Total checks: ${pass + fail}`);
  lines.push(`  PASS:         ${pass}`);
  lines.push(`  FAIL:         ${fail}`);
  lines.push(`  UTC:          ${UTC_START}`);
  lines.push("");

  if (fail === 0) {
    lines.push(`RESULT: PASS — all ${pass} checks succeeded`);
  } else {
    lines.push(`RESULT: FAIL — ${fail} check(s) failed`);
  }

  process.stdout.write(lines.join("\n") + "\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
