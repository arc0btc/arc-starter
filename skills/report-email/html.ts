// skills/report-email/html.ts
//
// Lightweight markdown-to-HTML converter and Arc theme wrapper for report emails.
// No external dependencies. Handles the subset of markdown used in watch reports:
// headers, tables, bold, lists, code blocks, inline code, horizontal rules, links.

const COLORS = {
  bg: "#0a0a0a",
  surface: "#141414",
  border: "#2a2a2a",
  gold: "#d4a843",
  goldMuted: "#b8922e",
  text: "#e0e0e0",
  textMuted: "#888888",
  codeBg: "#1a1a1a",
  tableBorder: "#333333",
  tableHeaderBg: "#1a1708",
} as const;

/** Escape HTML special characters. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert inline markdown (bold, inline code, links) to HTML. */
function inlineMarkdown(text: string): string {
  let result = esc(text);
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${COLORS.gold}">$1</strong>`);
  // Inline code
  result = result.replace(
    /`([^`]+)`/g,
    `<code style="background:${COLORS.codeBg};padding:1px 5px;border-radius:3px;font-size:13px;color:${COLORS.goldMuted}">$1</code>`
  );
  // Links
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" style="color:${COLORS.gold};text-decoration:underline">$1</a>`
  );
  return result;
}

/** Parse a markdown table block (array of lines) into an HTML table. */
function parseTable(lines: string[]): string {
  const parseRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  const headers = parseRow(lines[0]);
  // lines[1] is the separator row (|---|---|)
  const rows = lines.slice(2).map(parseRow);

  let html = `<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">`;
  html += `<thead><tr>`;
  for (const h of headers) {
    html += `<th style="background:${COLORS.tableHeaderBg};color:${COLORS.gold};padding:8px 12px;text-align:left;border:1px solid ${COLORS.tableBorder};font-weight:600">${inlineMarkdown(h)}</th>`;
  }
  html += `</tr></thead><tbody>`;
  for (const row of rows) {
    html += `<tr>`;
    for (const cell of row) {
      html += `<td style="padding:6px 12px;border:1px solid ${COLORS.tableBorder};color:${COLORS.text}">${inlineMarkdown(cell)}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

/** Convert a markdown string to HTML fragments (no wrapper). */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(esc(lines[i]));
        i++;
      }
      i++; // skip closing ```
      parts.push(
        `<pre style="background:${COLORS.codeBg};border:1px solid ${COLORS.border};border-radius:6px;padding:12px 16px;overflow-x:auto;font-size:13px;line-height:1.5;color:${COLORS.textMuted};margin:12px 0"><code>${codeLines.join("\n")}</code></pre>`
      );
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      parts.push(
        `<hr style="border:none;border-top:1px solid ${COLORS.border};margin:24px 0">`
      );
      i++;
      continue;
    }

    // Table (detect by | at start and separator row)
    if (line.startsWith("|") && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1])) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      parts.push(parseTable(tableLines));
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const sizes: Record<number, string> = { 1: "24px", 2: "20px", 3: "16px", 4: "14px" };
      const margins: Record<number, string> = { 1: "28px 0 16px", 2: "24px 0 12px", 3: "20px 0 8px", 4: "16px 0 6px" };
      const color = level <= 2 ? COLORS.gold : COLORS.text;
      parts.push(
        `<h${level} style="color:${color};font-size:${sizes[level]};margin:${margins[level]};font-weight:600;line-height:1.3">${inlineMarkdown(text)}</h${level}>`
      );
      i++;
      continue;
    }

    // Unordered list item
    if (/^[-*]\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        listItems.push(inlineMarkdown(lines[i].replace(/^[-*]\s+/, "")));
        i++;
      }
      parts.push(
        `<ul style="margin:8px 0;padding-left:20px">${listItems.map((li) => `<li style="color:${COLORS.text};margin:4px 0;line-height:1.5">${li}</li>`).join("")}</ul>`
      );
      continue;
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(inlineMarkdown(lines[i].replace(/^\d+\.\s+/, "")));
        i++;
      }
      parts.push(
        `<ol style="margin:8px 0;padding-left:20px">${listItems.map((li) => `<li style="color:${COLORS.text};margin:4px 0;line-height:1.5">${li}</li>`).join("")}</ol>`
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("|") &&
      !lines[i].startsWith("```") &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      parts.push(
        `<p style="color:${COLORS.text};margin:8px 0;line-height:1.6;font-size:14px">${paraLines.map(inlineMarkdown).join("<br>")}</p>`
      );
    }
  }

  return parts.join("\n");
}

/** Wrap HTML content in the Arc email theme (black + gold). */
export function wrapInArcTheme(bodyHtml: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">

<!-- Header -->
<tr><td style="padding:20px 32px;border-bottom:2px solid ${COLORS.gold}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="font-size:28px;font-weight:700;color:${COLORS.gold};letter-spacing:2px">ARC</td>
<td align="right" style="font-size:12px;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:1px">Watch Report</td>
</tr>
</table>
</td></tr>

<!-- Body -->
<tr><td style="padding:24px 32px;background:${COLORS.surface};border-left:1px solid ${COLORS.border};border-right:1px solid ${COLORS.border}">
${bodyHtml}
</td></tr>

<!-- Footer -->
<tr><td style="padding:16px 32px;border-top:1px solid ${COLORS.border};text-align:center">
<p style="color:${COLORS.textMuted};font-size:11px;margin:0;letter-spacing:0.5px">
arc0.btc &middot; SP2GHQ...42SF3B &middot; Autonomous Agent on Stacks
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
