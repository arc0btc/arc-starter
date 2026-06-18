#!/usr/bin/env bun

// skills/whop-sales/lib/product-catalog.ts
//
// Product catalog — the SHAREABLE metadata for each Whop SKU.
// Extracted from receipt.ts (AI-023) so the research-to-SKU pipeline can
// generate entries without importing the full receipt-composer module.
//
// Keyed by Whop product id. Each entry is curated (not scraped at runtime):
// the free/paid boundary is an editorial decision. The research-to-SKU
// pipeline (P10B item 3) will GENERATE these entries per report; the one
// shipped flagship is hand-authored from its own field guide.
//
// PURE: no LLM call, no credentials, no network, no writes.

import { PRODUCT_ID, PRODUCT_PAGE_URL } from "../../../src/constants.ts";

export interface ProductTeaserSlice {
  /** The hook — a scroll-stopping one-liner (a real claim, not hype). */
  hook: string;
  /** The free value: a genuinely useful takeaway that stands on its own. */
  insight: string;
  /** What the PAID, packaged version adds beyond this free slice. */
  paid_adds: string;
}

export interface ProductMeta {
  id: string;
  /** Singular noun for the receipt count line ("report #N", "pack #N"). */
  noun: string;
  /** Display title. */
  title: string;
  /** The PRODUCT page — the one-time SKU's verify-and-buy surface (`?a=arc0btc`); NOT the membership. */
  page_url: string;
  /** The packaged report's public lineage, in one phrase — the verify hook. */
  provenance: string;
  /** Free teaser slices (give-3x). Index 0 is the headline slice. */
  slices: ProductTeaserSlice[];
}

export const PRODUCT_CATALOG: Record<string, ProductMeta> = {
  [PRODUCT_ID]: {
    id: PRODUCT_ID,
    noun: "report",
    title: "The Harness Engineering Field Guide",
    page_url: PRODUCT_PAGE_URL,
    provenance: "the six source lectures it distills, the agent that wrote it, and the loop that ships it — all public",
    slices: [
      {
        hook: "Teams reach for a bigger model when an agent fails. Usually that's the wrong lever.",
        insight:
          "The same model in a better harness goes from unreliable to dependable. A harness is five subsystems — instruction, tool, environment, state, feedback — each engineered or neglected on its own. When an agent fails, attribute it to ONE of the five and fix that, before you touch the model.",
        paid_adds: "the five failure points named, the highest-ROI fix, and a field-test against a live 24/7 agent — including where the theory broke.",
      },
      {
        hook: "The weakest subsystem in almost every agent is the same one: feedback.",
        insight:
          "A Definition of Done written in prose is a suggestion; a Definition of Done that's a command is a contract. Attach a concrete check to non-trivial work — a build that passes, a test that exits 0, an endpoint that returns healthy — so success is observed, not asserted. It's the cheapest reliability you'll ever buy.",
        paid_adds: "the other four failure modes, the repo-as-system-of-record discipline, and what changed when this was run against a production harness.",
      },
      {
        hook: "One giant instruction file fails — and you're paying tokens for the privilege.",
        insight:
          "Models underweight content buried mid-file, so a critical rule on line 400 of an 800-line file is effectively invisible while still burning budget. Use a 50–200 line routing file plus per-topic docs loaded on demand; put hard constraints at the extremes (top or bottom, never the middle); cap global constraints at ~15.",
        paid_adds: "the continuity artifacts for long-running tasks, the bootstrap contract, and the operator's full checklist.",
      },
    ],
  },
};

export function getProductMeta(productId: string = PRODUCT_ID): ProductMeta | null {
  return PRODUCT_CATALOG[productId] ?? null;
}
