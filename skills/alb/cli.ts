#!/usr/bin/env bun
// skills/alb/cli.ts
// CLI for ALB (agentslovebitcoin.com) admin inbox access.
// Manages trustless_indra and topaz_centaur inboxes via admin API.
//
// Usage: arc skills run --name alb -- <subcommand> [flags]

import { getCredential } from "../../src/credentials.ts";

const MANAGED_NAMES = ["trustless_indra", "topaz_centaur"] as const;
type ManagedName = typeof MANAGED_NAMES[number];

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [alb/cli] ${message}`);
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

async function getAdminHeaders(): Promise<Record<string, string>> {
  const adminKey = await getCredential("agents-love-bitcoin", "admin_api_key");
  if (!adminKey) throw new Error("Missing credential: agents-love-bitcoin/admin_api_key");
  return { "X-Admin-Key": adminKey, "Content-Type": "application/json" };
}

async function getApiBase(): Promise<string> {
  const base = await getCredential("agents-love-bitcoin", "api_base_url");
  return (base ?? "https://agentslovebitcoin.com").replace(/\/$/, "");
}

async function adminGet(path: string): Promise<unknown> {
  const [headers, base] = await Promise.all([getAdminHeaders(), getApiBase()]);
  const url = `${base}${path}`;
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`ALB API ${resp.status}: ${text}`);
  return data;
}

async function adminPost(path: string): Promise<unknown> {
  const [headers, base] = await Promise.all([getAdminHeaders(), getApiBase()]);
  const url = `${base}${path}`;
  const resp = await fetch(url, { method: "POST", headers });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`ALB API ${resp.status}: ${text}`);
  return data;
}

// ---- Commands ----

async function cmdInbox(flags: Record<string, string>): Promise<void> {
  const name = flags["name"];
  if (!name) throw new Error("--name required (trustless_indra or topaz_centaur)");
  const limit = flags["limit"] ?? "20";
  const unread = flags["unread"] === "true" ? "&unread=true" : "";
  const data = await adminGet(`/api/admin/agents/${encodeURIComponent(name)}/inbox?limit=${limit}${unread}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdRead(flags: Record<string, string>): Promise<void> {
  const name = flags["name"];
  const id = flags["id"];
  if (!name) throw new Error("--name required");
  if (!id) throw new Error("--id required");
  const data = await adminGet(`/api/admin/agents/${encodeURIComponent(name)}/inbox/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdMarkRead(flags: Record<string, string>): Promise<void> {
  const name = flags["name"];
  const id = flags["id"];
  if (!name) throw new Error("--name required");
  if (!id) throw new Error("--id required");
  const data = await adminPost(`/api/admin/agents/${encodeURIComponent(name)}/inbox/${encodeURIComponent(id)}/read`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdListAgents(): Promise<void> {
  // Show managed identities and their inbox status
  const results: Record<string, unknown> = {};
  for (const name of MANAGED_NAMES) {
    try {
      const data = await adminGet(`/api/admin/agents/${name}/inbox?limit=1&unread=true`) as Record<string, unknown>;
      const d = (data as { data?: Record<string, unknown> }).data ?? {};
      results[name] = {
        email: `${name}@agentslovebitcoin.com`,
        unread: (d as { pagination?: { total?: number } }).pagination?.total ?? "?",
      };
    } catch (e) {
      results[name] = { error: String(e) };
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

// ---- Entry point ----

const [, , ...args] = process.argv;
const [subcommand, ...rest] = args;
const flags = parseFlags(rest);

try {
  switch (subcommand) {
    case "inbox":     await cmdInbox(flags); break;
    case "read":      await cmdRead(flags); break;
    case "mark-read": await cmdMarkRead(flags); break;
    case "list-agents": await cmdListAgents(); break;
    default:
      console.error("Usage: arc skills run --name alb -- inbox|read|mark-read|list-agents [flags]");
      console.error("  inbox --name <name> [--limit N] [--unread]");
      console.error("  read --name <name> --id <message-id>");
      console.error("  mark-read --name <name> --id <message-id>");
      console.error("  list-agents");
      process.exit(1);
  }
} catch (e) {
  log(`Error: ${e}`);
  process.exit(1);
}
