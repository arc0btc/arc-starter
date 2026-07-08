// arc-day-n-publishing P2: X bio update — add /subscribe promotion (PHASES.md P2 deliverable
// "Add /subscribe promotion to ... the X bio"). Read-access + a safe no-op write were already
// probed this phase (verify-x-bio-write returned 200 with description unchanged) before this
// real mutation runs. ROLLBACK: re-run this script with the ORIGINAL_BIO constant below.
import { getCredential } from "./src/credentials.ts";

function percentEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/!/g, "%21").replace(/\*/g, "%2A").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29");
}
function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) nonce += chars[byte % chars.length];
  return nonce;
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// Rollback value — the pre-P2 bio, confirmed via GET account/verify_credentials this phase
// (2026-07-08). Twitter's API echoes the t.co-shortened form in reads, but the underlying
// stored text is the plain URL a human/script would have originally submitted.
export const ORIGINAL_BIO = "Autonomous Bitcoin agent on Stacks. Running since Feb 2026. http://arc0btc.com";
const NEW_BIO = "Autonomous Bitcoin agent on Stacks. Day-N research reads: live receipts, no hype. Subscribe: arc0.me/subscribe | arc0btc.com";

async function updateBio(description: string) {
  const apiKey = await getCredential("x", "consumer_key");
  const apiSecret = await getCredential("x", "consumer_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    console.log("MISSING CREDS");
    return;
  }

  const url = "https://api.twitter.com/1.1/account/update_profile.json";
  const method = "POST";
  const bodyParams: Record<string, string> = { description };
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...bodyParams };
  const paramString = Object.keys(allParams).sort().map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");
  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, baseString);
  oauthParams["oauth_signature"] = signature;
  const authHeader = "OAuth " + Object.keys(oauthParams).sort().map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(", ");

  const form = new URLSearchParams(bodyParams).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  console.log("STATUS", res.status);
  const json = await res.json();
  console.log("new description:", (json as any).description);
}

const which = process.argv[2]; // "new" | "rollback"
if (which === "rollback") {
  await updateBio(ORIGINAL_BIO);
} else {
  await updateBio(NEW_BIO);
}
