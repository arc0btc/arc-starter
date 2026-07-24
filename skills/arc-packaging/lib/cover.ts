// skills/arc-packaging/lib/cover.ts
//
// Deterministic Whop SKU cover renderer — control-plane-remediation quest, Phase 2 task 1.
// Ported from manage-agents `ops/store-covers/lib/render.ts` (same palette/panel rules,
// deliberately duplicated rather than shared — this is a different repo on a different
// machine, arc-starter has no dependency on the control-plane checkout). Panel-locked rules
// (arc-strategy-panel synthesis, carried into every cover surface Arc ships):
//  - Motif = the real artifact — here, the SKU's own live `headline`/`title` text (already
//    written by the dispatch-cycle LLM turn that drafted the product copy). The first
//    standalone number found in the headline renders large; the full headline wraps beneath
//    it. No invented slogans, no restated title as the "motif".
//  - Fixed footer: bottom-left store mark, bottom-right continuity stamp
//    ("autonomous since feb 2026 · day N", day N from genesis 2026-02-25).
//  - Yellow (#FEC233) is the ONE brand accent. No teal, ever.
//
// This is the ONLY place `stage` (cli.ts) gets a cover from — no LLM call, no network
// dependency beyond the local @resvg/resvg-js render.

import { Resvg } from "@resvg/resvg-js";
import { existsSync, readdirSync } from "fs";

const W = 2400;
const H = 960;

const YELLOW = "#FEC233";
const G1 = "#eeeeee";
const G3 = "#8b8b8b";
const G4 = "#56595b";
const HAIRLINE = "#252528";
const BG = "#000000";
const MONO = "DejaVu Sans Mono";
const STORE_MARK = "hash it out";

const GENESIS = new Date("2026-02-25T00:00:00Z");
function dayN(dateISO: string): number {
  return Math.floor((new Date(dateISO + "T00:00:00Z").getTime() - GENESIS.getTime()) / 86400000);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(
  x: number,
  y: number,
  size: number,
  fill: string,
  content: string,
  opts: { anchor?: string; bold?: boolean } = {},
): string {
  const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
  const weight = opts.bold ? ` font-weight="bold"` : "";
  return `<text x="${x}" y="${y}" xml:space="preserve" font-family="${MONO}" font-size="${size}" fill="${fill}"${anchor}${weight}>${esc(content)}</text>`;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** First standalone number (with optional comma/decimal/%) found in `text`, or null. */
function firstNumber(text: string): string | null {
  const m = text.match(/\d[\d,]*\.?\d*%?/);
  return m ? m[0] : null;
}

function skuMotif(title: string, headline: string): string {
  const bigNumber = firstNumber(headline);
  const cy = 430;
  const parts: string[] = [];
  parts.push(t(W / 2, 300, 44, G3, title.length > 70 ? title.slice(0, 67) + "…" : title, { anchor: "middle" }));
  if (bigNumber) {
    parts.push(t(W / 2, cy + 40, 210, YELLOW, bigNumber, { anchor: "middle", bold: true }));
  }
  const captionLines = wrapText(headline, 58);
  const startY = bigNumber ? cy + 150 : cy + 40;
  captionLines.slice(0, 3).forEach((line, i) => {
    parts.push(t(W / 2, startY + i * 52, 38, G1, line, { anchor: "middle" }));
  });
  return parts.join("\n");
}

function frameB(audit: string, dateISO: string, motif: string): string {
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<rect width="${W}" height="${H}" fill="${BG}"/>
<rect x="60" y="60" width="${W - 120}" height="${H - 175}" fill="none" stroke="${HAIRLINE}" stroke-width="2"/>
${t(100, 128, 32, YELLOW, audit, { bold: true })}
${t(W - 100, 128, 30, G4, dateISO, { anchor: "end" })}
${motif}
${t(80, H - 44, 30, YELLOW, STORE_MARK, { bold: true })}
${t(W - 80, H - 44, 28, G4, `autonomous since feb 2026 · day ${dayN(dateISO)}`, { anchor: "end" })}
</svg>`;
}

const FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation"];
let fontDirsChecked = false;
function assertFontsAvailable(): void {
  if (fontDirsChecked) return;
  const found = FONT_DIRS.some((d) => existsSync(d) && readdirSync(d).some((f) => /\.(ttf|ttc|otf)$/i.test(f)));
  if (!found) {
    throw new Error(
      `No font files found in any of: ${FONT_DIRS.join(", ")}. resvg would silently render blank/boxed ` +
        `text instead of failing — install fonts-dejavu-core or fonts-liberation before rendering covers.`,
    );
  }
  fontDirsChecked = true;
}

/**
 * Render a deterministic SKU cover PNG from the SKU's own title/headline. No LLM call.
 * `headline` may be empty (flagship-style SKUs with no headline) — falls back to the title
 * alone with no big-number motif rather than inventing one.
 */
export async function renderSkuCover(title: string, headline: string, dateISO: string): Promise<Buffer> {
  assertFontsAvailable();
  const svg = frameB("SKU", dateISO, skuMotif(title, headline || ""));
  const resvg = new Resvg(svg, {
    font: { fontDirs: FONT_DIRS, loadSystemFonts: false, defaultFontFamily: MONO },
  });
  return Buffer.from(resvg.render().asPng());
}
