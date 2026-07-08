// skills/arc-daily-read/subscriber-email.ts
// arc-day-n-publishing P2: the same-day Day-N email to the REAL Resend subscriber list —
// closes the "operator's own captured audience has never received a single email" bug.
//
// This is a DIFFERENT mechanism from sendAmplificationEmail() in cli.ts (that one is an
// operator-only "here's today's beat, ready to amplify" tool sent via the internal
// email/api_base_url `/api/send` endpoint — it has existed since before this quest and is
// NOT the subscriber-facing send). This module sends the actual Day-N content TO the people
// who opted in via arc0.me/subscribe, through mail.arc0.me's Resend-backed
// `POST /api/send-digest` endpoint (the same endpoint `skills/arc-email-channel` proved end
// to end for the findings/arXiv digest — arc-email-esp quest). Kept as its own module
// (failure isolation, one caller: cli.ts's post-drain step) rather than folded into
// arc-email-channel, because arc-email-channel's SKILL.md explicitly scopes itself to
// "CLI only, no sensor" findings/arXiv content — this module IS the sensor-driven Day-N
// cadence arc-email-channel deliberately deferred ("standing this up as a recurring lane
// ... is a P8 decision, not this phase's" — that P8 decision is this quest, P2).
//
// Hard constraint carried over from send-digest's own design (arc-email-worker/src/index.ts):
// SEED_CAP=25 is enforced SERVER-SIDE — this module cannot bypass it even if it tried. As of
// this phase's live-state check (2026-07-08), the confirmed list is 4 addresses total (2 of
// which are the operator's own inboxes, 2 are inert arc-email-esp test rows) — nowhere near
// the cap. This module does not raise or work around that cap.

import { getCredential } from "../../src/credentials.ts";

const GOLD = "#FEC233";
const BLACK = "#000000";
const NEAR_BLACK = "#0a0a0a";
const MONO = "'SF Mono',Consolas,'Courier New',monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Per QUEST.md's attribution schema (§ "Attribution instrumentation"): every outbound link
// carries a per-surface `?src=` tag — `email` is the tag reserved for this surface. P5 reuses
// this literal value; do not rename without updating the attribution table there.
const EMAIL_SRC_TAG = "src=email";
// arc-day-n-publishing P1's CTA menu ($9-report-or-/subscribe, NEVER $49) applies here too
// (PHASES.md P2 verify criterion 4). Subscribers are already subscribed, so the CTA here
// points at the $9 report tripwire's closest live equivalent — the /subscribe page itself
// doubles as Arc's "go deeper" hub until a dedicated $9 checkout URL exists elsewhere in this
// codebase (grepped repo-wide for this phase — none found; recorded in CHECKPOINTS.md).
const CTA_URL = `https://arc0.me/subscribe?${EMAIL_SRC_TAG}`;

export interface DayNEmailInput {
  editionN: number;
  streak: number;
  thesisCarried: string | null;
  openingLine: string | null;
  tweetUrl: string | null;
  blogSlug: string | null;
  /** Root + continuation tweet texts, in posted order. Used as the email BODY when no blog
   *  post exists yet for this edition (e.g. a never-skip 1-tweet minimal edition) so the
   *  subscriber still gets real content, not a bare link. */
  tweets: string[];
  isMinimal: boolean;
  status: "shipped" | "partial" | "void";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function blogUrl(slug: string): string {
  return `https://arc0.me/blog/${slug}?${EMAIL_SRC_TAG}`;
}

/** thesis_carried/opening_line are lightly-markdown'd (**bold**, `code`, *italic* — see
 *  arc-daily-read's LLM-drafted materials). Strip to plain text for subject lines / the .txt
 *  alternative, where markdown syntax would otherwise show up as literal asterisks/backticks. */
function stripMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

/** Same source text, converted to the small HTML subset the email body actually needs
 *  (bold/code/italic) rather than shown with literal markdown syntax. Escapes first so no
 *  user/LLM-authored text can inject markup, THEN re-applies the three known-safe tags. */
function mdToHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/**
 * Render the subscriber-facing Day-N email. Table-based, inline-styled — same client-safety
 * constraints as `arc-email-worker/src/email-template.ts`'s confirmation email (Gmail/Outlook/
 * Apple Mail override page background; the gold accent always sits inside a self-contained
 * bg+fg chip, never as plain text on an inherited background). Deliberately a light neutral
 * card (not a full black page) for the same reason that file documents: fighting a mail
 * client's own dark-mode override is a losing, client-specific battle.
 */
export function renderDayNSubscriberEmail(input: DayNEmailInput): { subject: string; html: string; text: string } {
  const label = `Day ${input.editionN} · Read #${input.editionN}`;
  const headline = stripMd(input.thesisCarried || input.openingLine || `Edition ${input.editionN}`);
  const subject = `${label} — ${headline.length > 70 ? headline.slice(0, 67) + "..." : headline}`;

  const hasBlog = !!input.blogSlug;
  const readLink = hasBlog ? blogUrl(input.blogSlug!) : null;

  const bodyHtmlBlocks: string[] = [];
  if (input.openingLine) {
    bodyHtmlBlocks.push(
      `<p style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#18181b;font-family:${SANS};">${mdToHtml(input.openingLine)}</p>`
    );
  }
  if (hasBlog) {
    bodyHtmlBlocks.push(
      `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#3f3f46;font-family:${SANS};">The full write-up (receipts + citations) is live on the blog.</p>`
    );
  } else if (input.tweets.length > 0) {
    // No blog post for this edition (e.g. a never-skip minimal edition) — inline the actual
    // tweet text so the subscriber still gets real content rather than a link to nothing.
    bodyHtmlBlocks.push(
      input.tweets
        .map(
          (t, i) =>
            `<div style="background:#fafafa;border-left:3px solid ${GOLD};padding:12px 16px;margin:0 0 12px 0;border-radius:4px;">` +
            `<div style="font-size:11px;color:#a1a1aa;margin-bottom:4px;font-family:${SANS};">Tweet ${i + 1}${i === 0 ? " (root)" : ""}</div>` +
            `<pre style="white-space:pre-wrap;margin:0;font-family:${SANS};font-size:14px;color:#18181b;">${escapeHtml(t)}</pre>` +
            `</div>`
        )
        .join("")
    );
  }
  if (input.status === "partial") {
    bodyHtmlBlocks.push(
      `<p style="margin:0 0 20px 0;font-size:12px;line-height:1.5;color:#a1a1aa;font-family:${SANS};">This edition's thread only partially posted on X (a mid-thread send failed) — the content above is everything that's confirmed live.</p>`
    );
  }

  const ctaRowsHtml: string[] = [];
  if (readLink) {
    ctaRowsHtml.push(
      `<tr><td align="center" bgcolor="${BLACK}" style="background-color:${BLACK};border-radius:8px;">` +
        `<a href="${readLink}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:${GOLD};text-decoration:none;border-radius:8px;font-family:${SANS};">Read Edition ${input.editionN}</a>` +
        `</td></tr>`
    );
  }
  if (input.tweetUrl) {
    ctaRowsHtml.push(
      `<tr><td align="center" style="padding-top:${readLink ? "12px" : "0"};"><a href="${input.tweetUrl}" style="font-size:13px;color:#71717a;text-decoration:underline;font-family:${SANS};">View the thread on X</a></td></tr>`
    );
  }

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${SANS};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" bgcolor="${NEAR_BLACK}" style="background-color:${NEAR_BLACK};padding:24px;">
                <span style="display:inline-block;font-family:${MONO};font-size:13px;font-weight:700;letter-spacing:2px;color:${GOLD};background-color:${NEAR_BLACK};border:1px solid ${GOLD};border-radius:6px;padding:6px 14px;">ARC</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px 8px 40px;">
                <p style="margin:0 0 12px 0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#a1a1aa;font-family:${SANS};">${label}</p>
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;font-weight:600;color:#18181b;font-family:${SANS};">${escapeHtml(headline)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 8px 40px;">
                ${bodyHtmlBlocks.join("\n                ")}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 40px 28px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  ${ctaRowsHtml.join("\n                  ")}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e4e4e7;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 32px 40px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;font-family:${SANS};">Go deeper: <a href="${CTA_URL}" style="color:#71717a;font-weight:600;">arc0.me/subscribe</a></p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#fafafa" style="background-color:#fafafa;padding:18px;border-top:1px solid #e4e4e7;">
                <p style="margin:0;font-size:12px;color:#a1a1aa;font-family:${SANS};">
                  <a href="https://arc0.me" style="color:#71717a;text-decoration:none;font-weight:600;">arc0.me</a>
                  <span style="color:#d4d4d8;">&nbsp;&middot;&nbsp;</span>
                  <span>Autonomous research, shipped the day it's found.</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    `${label} — ${headline}`,
    "",
    input.openingLine ? stripMd(input.openingLine) : "",
    "",
    hasBlog ? `Read: ${readLink}` : input.tweets.join("\n---\n"),
    input.tweetUrl ? `Thread: ${input.tweetUrl}` : "",
    "",
    `Go deeper: ${CTA_URL}`,
  ].filter((l) => l !== "");

  return { subject, html, text: textLines.join("\n") };
}

/** Fetch the current confirmed subscriber list from mail.arc0.me (admin-key protected). */
export async function fetchConfirmedSubscribers(apiBaseUrl: string, adminKey: string): Promise<string[]> {
  const res = await fetch(`${apiBaseUrl}/api/subscribers?status=confirmed`, {
    headers: { "X-Admin-Key": adminKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET /api/subscribers?status=confirmed failed: HTTP ${res.status}`);
  const json = (await res.json()) as { ok: boolean; data: Array<{ email: string }> };
  if (!json.ok) throw new Error("subscribers fetch returned ok:false");
  return json.data.map((s) => s.email);
}

export interface SendResult {
  attempted: boolean;
  sent: number;
  failed: number;
  recipients: string[];
  error?: string;
}

/**
 * Send the Day-N subscriber email. `opts.testRecipient` bypasses the subscriber-list query
 * entirely and sends to exactly one explicit address (the careful-verify operator test-send
 * path, PHASES.md P2 verify criterion 2) — it never touches the real list. Without it, sends
 * to every confirmed subscriber via mail.arc0.me's `/api/send-digest` (server-side SEED_CAP=25
 * enforced regardless — this function does not, and cannot, bypass that).
 */
export async function sendDayNSubscriberEmail(
  input: DayNEmailInput,
  opts: { testRecipient?: string; dryRun?: boolean } = {}
): Promise<SendResult> {
  const apiBaseUrl = await getCredential("email", "api_base_url");
  const adminKey = await getCredential("email", "admin_api_key");
  if (!apiBaseUrl || !adminKey) {
    console.warn("  [SUBSCRIBER EMAIL] email credentials not configured — skipping");
    return { attempted: false, sent: 0, failed: 0, recipients: [], error: "missing credentials" };
  }

  const { subject, html, text } = renderDayNSubscriberEmail(input);

  let recipients: string[];
  if (opts.testRecipient) {
    recipients = [opts.testRecipient];
  } else {
    try {
      recipients = await fetchConfirmedSubscribers(apiBaseUrl, adminKey);
    } catch (err) {
      console.error(`  [SUBSCRIBER EMAIL] failed to fetch subscriber list: ${err}`);
      return { attempted: false, sent: 0, failed: 0, recipients: [], error: String(err) };
    }
  }

  if (recipients.length === 0) {
    console.log("  [SUBSCRIBER EMAIL] no confirmed subscribers — nothing to send");
    return { attempted: true, sent: 0, failed: 0, recipients: [] };
  }

  if (opts.dryRun) {
    console.log(`  [DRY-RUN SUBSCRIBER EMAIL] would send "${subject}" to ${recipients.length} recipient(s): ${recipients.join(", ")}`);
    return { attempted: true, sent: recipients.length, failed: 0, recipients };
  }

  try {
    const res = await fetch(`${apiBaseUrl}/api/send-digest`, {
      method: "POST",
      headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ subject, body: text, body_html: html, recipients }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`  [SUBSCRIBER EMAIL] send-digest failed: HTTP ${res.status} — ${errBody}`);
      return { attempted: true, sent: 0, failed: recipients.length, recipients, error: `HTTP ${res.status}: ${errBody}` };
    }
    const json = (await res.json()) as { ok: boolean; data: { sent: number; failed: number; results: unknown[] } };
    console.log(`  [SUBSCRIBER EMAIL] sent=${json.data.sent} failed=${json.data.failed} recipients=${recipients.length}`);
    return { attempted: true, sent: json.data.sent, failed: json.data.failed, recipients };
  } catch (err) {
    console.error(`  [SUBSCRIBER EMAIL] network error: ${err}`);
    return { attempted: true, sent: 0, failed: recipients.length, recipients, error: String(err) };
  }
}
