/**
 * moltbook-client.ts — shared Moltbook API helpers (arc-day-n-publishing P3)
 *
 * Extracted from the P7 one-off experiment script (live-send-moltbook-post.ts, 2026-06-19
 * social-engine quest) so the new per-post mirror (moltbook-mirror-post.ts) doesn't fork a
 * second, driftable copy of credential loading / API request / challenge-solving logic.
 * live-send-moltbook-post.ts itself is left UNTOUCHED — it's a completed, idempotent P7
 * experiment record (read-back-confirmed 2026-06-20), not a live producer; editing it adds
 * audit surface for zero benefit. This module is the ONE definition going forward for any
 * caller that needs to talk to Moltbook.
 */

export async function getMoltbookCred(service: string, key: string): Promise<string> {
  const CREDS_PASSWORD = process.env.ARC_CREDS_PASSWORD;
  if (!CREDS_PASSWORD) throw new Error("ARC_CREDS_PASSWORD not set in environment");
  const proc = Bun.spawn(
    ["/home/dev/.local/bin/arc", "creds", "get", "--service", service, "--key", key],
    { env: { ...process.env, ARC_CREDS_PASSWORD: CREDS_PASSWORD } }
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`creds get ${service}/${key} failed`);
  return out.trim();
}

export const MOLTBOOK_BASE = "https://www.moltbook.com/api/v1";

export async function moltbookReq(
  method: string,
  path: string,
  apiKey: string | null,
  body?: object
): Promise<{ status: number; data: any; headers: Headers }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${MOLTBOOK_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

export async function sendDiscordAlert(botToken: string, channelId: string, message: string): Promise<string | null> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  const data = await res.json().catch(() => null);
  return data?.id ?? null;
}

/**
 * Solve Moltbook's verification challenge (math word problem → decimal string "N.00"),
 * byte-for-byte the same parser as live-send-moltbook-post.ts (proven working 2026-06-20).
 */
export function solveMoltbookChallenge(challengeText: string): string {
  const text = challengeText.toLowerCase();

  const wordToNum: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    hundred: 100,
  };

  function parseWordNum(str: string): number | null {
    const parts = str.trim().split(/\s+/);
    let val = 0;
    let decimal = false;
    let decimalStr = "";
    for (const part of parts) {
      if (part === "point") { decimal = true; continue; }
      if (wordToNum[part] !== undefined) {
        if (decimal) decimalStr += wordToNum[part];
        else val += wordToNum[part];
      }
    }
    if (decimalStr) return parseFloat(`${val}.${decimalStr}`);
    return val;
  }

  let op = "+";
  if (text.includes(" minus ") || text.includes(" subtract ")) op = "-";
  else if (text.includes(" times ") || text.includes(" multiplied ")) op = "*";
  else if (text.includes(" divided ")) op = "/";

  const splitOn =
    op === "+" ? " plus " :
    op === "-" ? (text.includes(" minus ") ? " minus " : " subtract ") :
    op === "*" ? (text.includes(" times ") ? " times " : " multiplied by ") :
    " divided by ";
  const parts = text.split(splitOn);
  if (parts.length < 2) {
    const nums = Array.from(text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)).map((m) => parseFloat(m[1]));
    if (nums.length >= 2) return (nums[0] + nums[1]).toFixed(2);
    return "0.00";
  }

  const cleanA = parts[0].replace(/^.*?(what is|calculate|compute|find)\s+/i, "").trim();
  const cleanB = parts[1].replace(/\?.*$/, "").trim();

  const a = parseWordNum(cleanA) ?? parseFloat(cleanA) ?? 0;
  const b = parseWordNum(cleanB) ?? parseFloat(cleanB) ?? 0;

  let result = 0;
  if (op === "+") result = a + b;
  else if (op === "-") result = a - b;
  else if (op === "*") result = a * b;
  else if (op === "/") result = b !== 0 ? a / b : 0;

  return result.toFixed(2);
}
