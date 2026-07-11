/**
 * skills/arc-attribution/lib/src-tags.ts
 *
 * Canonical `?src=` attribution-tag registry for every Day-N publishing surface
 * (arc-day-n-publishing P5). Single source of truth: the 3 live call sites
 * (arc-daily-read/cli.ts's X-thread CTA, subscriber-email.ts's email CTA,
 * social-engine/moltbook-mirror-post.ts's link-back) previously each wrote the same
 * `url.includes("?") ? "&src=" : "?src="` pattern independently — this module collapses that
 * into one formatter + one set of tag literals so the three can never silently drift apart.
 *
 * `status` per tag (dev-council/Fowler, P5, CONFIRMED — the registry must not conflate "tags we
 * actually emit" with "tags we merely recognize" behind a comment a future edit can orphan):
 *   - "live"     — a Day-N-sourced link carrying this tag ships today (day-n-x, email, moltbook).
 *   - "staged"   — built and preview-verified but NOT deployed to production (blog — the
 *                  arc0me-site Footer.astro subscribe CTA is a P2 prod-site-flip hard gate,
 *                  staged pending operator authorization; see CHECKPOINTS.md P2).
 *   - "reserved" — the tag value is defined for schema completeness, but NO Day-N-sourced link
 *                  carries it today, by design, not by omission:
 *                    - whop-free: P1 deliberately retired the free-room CTA from the X thread in
 *                      favor of $9-report/subscribe-only (CHECKPOINTS.md P1) — Day-N never links
 *                      the free room.
 *                    - nostr: Nostr syndication (skills/nostr/sensor.ts) draws from a separate
 *                      LLM-artifact pool unrelated to Day-N blog content specifically; P3
 *                      confirmed this "zero-effort, as-is" posture is correct, not a gap to close.
 *                  See docs/specs/2026-07-08-day-n-attribution-design.md §2/§4 for the full
 *                  disclosure — this is a standing architectural choice, not a P5 regression.
 */

export type SrcTagStatus = "live" | "staged" | "reserved";

export interface SrcTagEntry {
  tag: string;
  status: SrcTagStatus;
}

export const SRC_TAGS = {
  DAY_N_X: { tag: "day-n-x", status: "live" as const },
  BLOG: { tag: "blog", status: "staged" as const },
  EMAIL: { tag: "email", status: "live" as const },
  MOLTBOOK: { tag: "moltbook", status: "live" as const },
  WHOP_FREE: { tag: "whop-free", status: "reserved" as const },
  NOSTR: { tag: "nostr", status: "reserved" as const },
} as const satisfies Record<string, SrcTagEntry>;

/** Append a `?src=<tag>` (or `&src=<tag>` if the URL already has a query string) attribution tag.
 *  The one formatter every emitter should call — do not re-implement this `includes("?")` branch
 *  at a new call site. */
export function withSrcTag(url: string, tag: string): string {
  return url.includes("?") ? `${url}&src=${tag}` : `${url}?src=${tag}`;
}
