/**
 * Shared Cloudflare helpers.
 *
 * Usage:
 *   import { verifyCloudflareToken } from "../../src/cloudflare.ts";
 *   const { ok, error } = await verifyCloudflareToken();
 *   if (!ok) { process.stderr.write(`Cloudflare preflight failed: ${error}\n`); process.exit(1); }
 *
 * Credentials required in store:
 *   cloudflare/account_id  — Cloudflare account ID
 *   cloudflare/api_token   — Cloudflare API token (account-scoped)
 *
 * Uses /client/v4/accounts/{account_id}/tokens/verify (account-scoped endpoint).
 * The user-scoped /user/tokens/verify endpoint returns 401 for account-scoped tokens.
 */

import { getCredential } from "./credentials.ts";

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
}

export interface TokenVerifyResult {
  ok: boolean;
  error?: string;
  status?: string;
}

/**
 * Load cloudflare/account_id and cloudflare/api_token from the credential store.
 * Returns null with an error message if either credential is missing.
 */
export async function getCloudflareCredentials(): Promise<
  { creds: CloudflareCredentials; error: null } | { creds: null; error: string }
> {
  const accountId = await getCredential("cloudflare", "account_id");
  if (!accountId) {
    return { creds: null, error: "cloudflare/account_id credential not found" };
  }
  const apiToken = await getCredential("cloudflare", "api_token");
  if (!apiToken) {
    return { creds: null, error: "cloudflare/api_token credential not found" };
  }
  return { creds: { accountId, apiToken }, error: null };
}

/**
 * Verify the Cloudflare API token using the account-scoped endpoint.
 * Returns { ok: true, status } on success, { ok: false, error } on failure.
 */
export async function verifyCloudflareToken(): Promise<TokenVerifyResult> {
  const { creds, error } = await getCloudflareCredentials();
  if (!creds) return { ok: false, error };

  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/tokens/verify`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return { ok: false, error: `Network error verifying token: ${e instanceof Error ? e.message : String(e)}` };
  }

  let body: { success?: boolean; result?: { status?: string }; errors?: { message: string }[] };
  try {
    body = await resp.json() as typeof body;
  } catch {
    return { ok: false, error: `Unexpected response (HTTP ${resp.status}) — could not parse JSON` };
  }

  if (!resp.ok || !body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${resp.status}`;
    return { ok: false, error: `Token verification failed: ${msg}` };
  }

  return { ok: true, status: body.result?.status };
}
