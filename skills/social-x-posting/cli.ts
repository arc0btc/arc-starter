#!/usr/bin/env bun
// skills/social-x-posting/cli.ts
// CLI for posting tweets and managing X (Twitter) presence via API v2

import { getCredential } from "../../src/credentials.ts";

const API_BASE = "https://api.x.com/2";

// ---- Helpers ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [x-posting/cli] ${msg}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

// ---- OAuth 1.0a Signing ----

function percentEncode(str: string): string {
  return encodeURIComponent(str)
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
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

interface OAuthCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

async function loadCreds(): Promise<OAuthCreds> {
  const apiKey = await getCredential("x", "api_key");
  const apiSecret = await getCredential("x", "api_secret");
  const accessToken = await getCredential("x", "access_token");
  const accessTokenSecret = await getCredential("x", "access_token_secret");

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    const missing: string[] = [];
    if (!apiKey) missing.push("x/api_key");
    if (!apiSecret) missing.push("x/api_secret");
    if (!accessToken) missing.push("x/access_token");
    if (!accessTokenSecret) missing.push("x/access_token_secret");
    throw new Error(
      `Missing X credentials: ${missing.join(", ")}. ` +
        `Set them with: arc creds set --service x --key <key> --value <value>`
    );
  }

  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

async function buildOAuthHeader(
  method: string,
  url: string,
  creds: OAuthCreds,
  params: Record<string, string> = {}
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and query params for signature base
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");

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

// ---- API Calls ----

async function apiRequest(
  method: string,
  endpoint: string,
  creds: OAuthCreds,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string>
): Promise<Record<string, unknown>> {
  const baseUrl = `${API_BASE}${endpoint}`;
  const url = queryParams
    ? `${baseUrl}?${new URLSearchParams(queryParams).toString()}`
    : baseUrl;

  const authHeader = await buildOAuthHeader(method, baseUrl, creds, queryParams ?? {});

  const options: RequestInit = {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 204) {
    return { deleted: true };
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`X API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as Record<string, unknown>;
}

// ---- Commands ----

async function cmdPost(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  if (!text) {
    console.log("Usage: post --text <tweet text>");
    process.exit(1);
  }
  if (text.length > 280) {
    console.log(`Tweet too long: ${text.length}/280 characters`);
    process.exit(1);
  }

  const creds = await loadCreds();
  const body: Record<string, unknown> = { text };

  // Support reply
  if (flags["reply-to"]) {
    body["reply"] = { in_reply_to_tweet_id: flags["reply-to"] };
  }

  log(`Posting tweet (${text.length} chars)...`);
  const result = await apiRequest("POST", "/tweets", creds, body);
  const data = result["data"] as Record<string, string> | undefined;
  if (data) {
    console.log(JSON.stringify({ id: data["id"], text: data["text"] }, null, 2));
    log(`Tweet posted: ${data["id"]}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function cmdReply(flags: Record<string, string>): Promise<void> {
  const text = flags["text"];
  const tweetId = flags["tweet-id"];
  if (!text || !tweetId) {
    console.log("Usage: reply --text <reply text> --tweet-id <id>");
    process.exit(1);
  }
  if (text.length > 280) {
    console.log(`Reply too long: ${text.length}/280 characters`);
    process.exit(1);
  }

  const creds = await loadCreds();
  const body = { text, reply: { in_reply_to_tweet_id: tweetId } };

  log(`Replying to ${tweetId} (${text.length} chars)...`);
  const result = await apiRequest("POST", "/tweets", creds, body);
  const data = result["data"] as Record<string, string> | undefined;
  if (data) {
    console.log(JSON.stringify({ id: data["id"], text: data["text"], reply_to: tweetId }, null, 2));
    log(`Reply posted: ${data["id"]}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function cmdDelete(flags: Record<string, string>): Promise<void> {
  const tweetId = flags["tweet-id"];
  if (!tweetId) {
    console.log("Usage: delete --tweet-id <id>");
    process.exit(1);
  }

  const creds = await loadCreds();
  log(`Deleting tweet ${tweetId}...`);
  const result = await apiRequest("DELETE", `/tweets/${tweetId}`, creds);
  console.log(JSON.stringify(result, null, 2));
  log(`Tweet deleted: ${tweetId}`);
}

async function cmdTimeline(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // First get our user ID
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id,username,name,public_metrics",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`User ID: ${userId}, fetching timeline...`);

  const timeline = await apiRequest("GET", `/users/${userId}/tweets`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,public_metrics,conversation_id",
  });

  const tweets = timeline["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent tweets found.");
    return;
  }

  for (const tweet of tweets) {
    const metrics = tweet["public_metrics"] as Record<string, number> | undefined;
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`Text: ${tweet["text"]}`);
    if (metrics) {
      console.log(
        `Engagement: ${metrics["like_count"]} likes, ${metrics["retweet_count"]} RTs, ${metrics["reply_count"]} replies`
      );
    }
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} tweets.`);
}

async function cmdMentions(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] ?? "10";
  const creds = await loadCreds();

  // Get user ID first
  log("Fetching user info...");
  const me = await apiRequest("GET", "/users/me", creds, undefined, {
    "user.fields": "id",
  });
  const userData = me["data"] as Record<string, unknown> | undefined;
  if (!userData) {
    throw new Error("Could not fetch user info");
  }

  const userId = userData["id"] as string;
  log(`Fetching mentions for user ${userId}...`);

  const mentions = await apiRequest("GET", `/users/${userId}/mentions`, creds, undefined, {
    max_results: limit,
    "tweet.fields": "created_at,author_id,public_metrics",
  });

  const tweets = mentions["data"] as Array<Record<string, unknown>> | undefined;
  if (!tweets || tweets.length === 0) {
    console.log("No recent mentions found.");
    return;
  }

  for (const tweet of tweets) {
    console.log(`---`);
    console.log(`ID: ${tweet["id"]}`);
    console.log(`Date: ${tweet["created_at"]}`);
    console.log(`From: ${tweet["author_id"]}`);
    console.log(`Text: ${tweet["text"]}`);
  }
  console.log(`---`);
  console.log(`Showing ${tweets.length} mentions.`);
}

async function cmdStatus(_flags: Record<string, string>): Promise<void> {
  try {
    const creds = await loadCreds();
    log("Checking X API access...");
    const me = await apiRequest("GET", "/users/me", creds, undefined, {
      "user.fields": "id,username,name,public_metrics,created_at,description",
    });
    const userData = me["data"] as Record<string, unknown> | undefined;
    if (userData) {
      const metrics = userData["public_metrics"] as Record<string, number> | undefined;
      console.log(JSON.stringify({
        status: "connected",
        id: userData["id"],
        username: userData["username"],
        name: userData["name"],
        description: userData["description"],
        created_at: userData["created_at"],
        followers: metrics?.["followers_count"],
        following: metrics?.["following_count"],
        tweets: metrics?.["tweet_count"],
      }, null, 2));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", message }, null, 2));
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "post":
      await cmdPost(flags);
      break;
    case "reply":
      await cmdReply(flags);
      break;
    case "delete":
      await cmdDelete(flags);
      break;
    case "timeline":
      await cmdTimeline(flags);
      break;
    case "mentions":
      await cmdMentions(flags);
      break;
    case "status":
      await cmdStatus(flags);
      break;
    default:
      console.log(`x-posting — Post and manage tweets via X API v2

Commands:
  post      --text <text>                     Post a tweet (max 280 chars)
  reply     --text <text> --tweet-id <id>     Reply to a tweet
  delete    --tweet-id <id>                   Delete a tweet
  timeline  [--limit <n>]                     Show recent tweets (default: 10)
  mentions  [--limit <n>]                     Show recent mentions (default: 10)
  status                                      Check API access and account info

Credentials required (set via arc creds set --service x --key <key> --value <value>):
  x/api_key              OAuth 1.0a Consumer Key
  x/api_secret           OAuth 1.0a Consumer Secret
  x/access_token         User Access Token
  x/access_token_secret  User Access Token Secret

Get credentials from https://developer.x.com/`);
      break;
  }
}

main().catch((err) => {
  log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
