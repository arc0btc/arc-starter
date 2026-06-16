#!/usr/bin/env bun

// skills/social-x-posting/lib/x-api.ts
//
// Minimal READ-ONLY X (Twitter) API v2 client — OAuth 1.0a signed GET requests.
//
// Why this exists: the acquisition lane's lead source (skills/whop-sales) needs to
// READ @arc0btc mentions/replies to surface non-member engagers as X leads, and X
// API auth belongs to the X skill — not whop-sales. This lib is the X skill's
// reusable read surface (cross-skill import mirrors how whop-sales already imports
// skills/whop/lib).
//
// The proven POSTING path still lives in cli.ts with its own (currently duplicated)
// OAuth helpers — we deliberately did NOT refactor it here so the working posting
// lane stays untouched (zero regression risk). Collapsing cli.ts's private OAuth
// onto this lib is a tracked follow-up (P11). The signing logic below is copied
// verbatim from cli.ts (HMAC-SHA1 OAuth 1.0a), READ-only: no budget, no
// credits-depleted side-effects, GET requests only.

import { getCredential } from "../../../src/credentials.ts";

const API_BASE = "https://api.x.com/2";

export interface XCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/** Load X OAuth 1.0a creds. Returns null (not throw) when any are missing so the
 * lead refresh can degrade to a benign skip — mirrors the forum path's no-key. */
export async function loadXCreds(): Promise<XCreds | null> {
  const apiKey = await getCredential("x", "consumer_key");
  const apiSecret = await getCredential("x", "consumer_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

// ---- OAuth 1.0a signing (copied from cli.ts — proven; see header note) -------

function percentEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    nonce += chars[byte % chars.length];
  }
  return nonce;
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildOAuthHeader(
  method: string,
  url: string,
  creds: XCreds,
  params: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

/** A signed, read-only GET against the X API v2. Throws on non-2xx. */
export async function xApiGet(
  endpoint: string,
  creds: XCreds,
  queryParams: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const baseUrl = `${API_BASE}${endpoint}`;
  const url = `${baseUrl}?${new URLSearchParams(queryParams).toString()}`;
  const authHeader = await buildOAuthHeader("GET", baseUrl, creds, queryParams);
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: authHeader },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`X API GET ${endpoint} ${response.status}: ${JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
}

// ---- Mentions ---------------------------------------------------------------

export interface XMention {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  author_username?: string;
  author_name?: string;
  /** Present when the tweet is a reply; whom it replied to (used to detect
   * replies to Arc → the warm Class-A signal). */
  in_reply_to_user_id?: string;
  /** The replied-to tweet id (parent), when this is a reply. */
  replied_to_tweet_id?: string;
}

export interface XMentionsResult {
  arc_user_id: string;
  arc_username: string | null;
  mentions: XMention[];
}

/**
 * Fetch recent @arc0btc mentions (replies + standalone mentions). Resolves Arc's
 * own X user id via /users/me first (mentions is a user-scoped endpoint), then
 * pulls the mentions timeline WITH author-username expansion and reply metadata so
 * the caller can (a) attribute each mention to a handle and (b) tell a reply-to-Arc
 * (warm) from a bare mention. SCALING CEILING (like the forum fetch): one page of
 * `maxResults` — older mentions are not paged; logs when it touches the ceiling.
 */
export async function fetchArcMentions(opts: {
  creds: XCreds;
  maxResults?: number;
  log?: (m: string) => void;
}): Promise<XMentionsResult> {
  const log = opts.log ?? (() => {});
  const me = await xApiGet("/users/me", opts.creds, { "user.fields": "id,username" });
  const meData = (me["data"] ?? {}) as Record<string, unknown>;
  const arcUserId = meData["id"] ? String(meData["id"]) : "";
  const arcUsername = (meData["username"] as string | undefined) ?? null;
  if (!arcUserId) throw new Error("could not resolve Arc X user id (/users/me returned no id)");

  const max = Math.min(Math.max(opts.maxResults ?? 25, 5), 100);
  const resp = await xApiGet(`/users/${arcUserId}/mentions`, opts.creds, {
    max_results: String(max),
    "tweet.fields": "created_at,author_id,in_reply_to_user_id,referenced_tweets,conversation_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });

  const data = (resp["data"] as Array<Record<string, unknown>> | undefined) ?? [];
  const includes = (resp["includes"] as Record<string, unknown> | undefined) ?? {};
  const users = (includes["users"] as Array<Record<string, unknown>> | undefined) ?? [];
  const userMap = new Map<string, { username?: string; name?: string }>();
  for (const u of users) {
    userMap.set(String(u["id"]), {
      username: u["username"] as string | undefined,
      name: u["name"] as string | undefined,
    });
  }
  if (data.length >= max) {
    log(`x mentions: hit page ceiling (${data.length} >= ${max}) — older mentions not paged`);
  }

  const mentions: XMention[] = data.map((t) => {
    const refs = (t["referenced_tweets"] as Array<Record<string, unknown>> | undefined) ?? [];
    const repliedTo = refs.find((r) => r["type"] === "replied_to");
    const authorId = t["author_id"] ? String(t["author_id"]) : "";
    const u = userMap.get(authorId);
    return {
      id: String(t["id"]),
      text: String(t["text"] ?? ""),
      created_at: String(t["created_at"] ?? ""),
      author_id: authorId,
      author_username: u?.username,
      author_name: u?.name,
      in_reply_to_user_id: t["in_reply_to_user_id"] ? String(t["in_reply_to_user_id"]) : undefined,
      replied_to_tweet_id: repliedTo ? String(repliedTo["id"]) : undefined,
    };
  });

  return { arc_user_id: arcUserId, arc_username: arcUsername, mentions };
}
