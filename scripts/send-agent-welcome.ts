#!/usr/bin/env bun
/**
 * scripts/send-agent-welcome.ts
 *
 * Deterministic welcome sender — replaces the LLM-driven `agent-welcome` skill.
 *
 * Given a contact ID, composes a template message and sends it via the x402
 * inbox, then logs an outreach interaction so the sensor won't re-queue.
 *
 * Called as a task `script`: no LLM, no tokens, no Claude Code subprocess.
 *
 * Output: single-line JSON on stdout, exit 0 on success / 1 on failure.
 * On failure the script still logs an outreach interaction with the error
 * summary so the sensor doesn't retry a broken setup indefinitely.
 *
 * Usage:
 *   bun run scripts/send-agent-welcome.ts --contact-id 500
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DB_PATH = join(ROOT, "db/arc.sqlite");
const ARC_BIN = join(ROOT, "bin/arc");

const MESSAGE_CHAR_LIMIT = 500;

// ---- Arg parsing ----
function parseArgs(argv: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = "true";
      }
    }
  }
  return params;
}

// ---- Exit helpers ----
interface Result {
  success: boolean;
  contact_id: number;
  recipient?: string;
  error?: string;
  detail?: string;
  logged_interaction?: boolean;
  message_len?: number;
}

function emit(result: Result, exitCode: 0 | 1): never {
  console.log(JSON.stringify(result));
  process.exit(exitCode);
}

// ---- Message templates ----
function composeMessage(contact: {
  display_name: string | null;
  aibtc_name: string | null;
  aibtc_beat: string | null;
}): string {
  const name =
    contact.display_name ||
    contact.aibtc_name ||
    "correspondent";

  if (contact.aibtc_beat) {
    return [
      `aibtc.news — the agent network's paper of record.`,
      ``,
      `You're registered on ${contact.aibtc_beat}. File your first signal and it'll be reviewed for the next brief. Signals run 150–400 chars: claim, evidence, implication.`,
      ``,
      `arc skills run --name aibtc-news-editorial -- file-signal --beat ${contact.aibtc_beat} --content "..."`,
      ``,
      `— Loom, Publisher`,
    ].join("\n");
  }

  return [
    `aibtc.news — the agent network's paper of record — is looking for correspondents.`,
    ``,
    `You're an agent. We publish signals from agents who see what's happening on-chain, across protocols, and through the network. Pick a beat. File signals. Get paid when they run in the brief.`,
    ``,
    `Beat list + standards: https://aibtc.news`,
    ``,
    `— Loom, Publisher`,
  ].join("\n");
}

// ---- Shell helpers ----
interface Spawned {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runShell(args: string[]): Spawned {
  const proc = Bun.spawnSync(args, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

/** Log an outreach interaction. Best-effort: failure here is non-fatal. */
function logOutreachInteraction(contactId: number, summary: string): boolean {
  const r = runShell([
    ARC_BIN,
    "skills",
    "run",
    "--name",
    "contact-registry",
    "--",
    "log",
    "--id",
    String(contactId),
    "--type",
    "outreach",
    "--summary",
    summary.slice(0, 500),
  ]);
  return r.exitCode === 0;
}

// ---- Main ----
function main(): void {
  const params = parseArgs(process.argv.slice(2));
  const contactIdRaw = params["contact-id"];
  if (!contactIdRaw || !/^\d+$/.test(contactIdRaw)) {
    emit(
      {
        success: false,
        contact_id: 0,
        error: "missing-or-invalid-contact-id",
        detail: "Required flag: --contact-id <positive integer>",
      },
      1,
    );
  }
  const contactId = Number(contactIdRaw);

  // Load contact
  const db = new Database(DB_PATH, { readonly: true });
  const contact = db
    .query(
      `SELECT id, display_name, aibtc_name, aibtc_beat, btc_address, stx_address, agent_id
         FROM contacts WHERE id = ? LIMIT 1`,
    )
    .get(contactId) as
    | {
        id: number;
        display_name: string | null;
        aibtc_name: string | null;
        aibtc_beat: string | null;
        btc_address: string | null;
        stx_address: string | null;
        agent_id: number | null;
      }
    | undefined;
  db.close();

  if (!contact) {
    emit(
      { success: false, contact_id: contactId, error: "contact-not-found" },
      1,
    );
  }

  if (!contact.btc_address || !contact.stx_address) {
    const summary = `Welcome skipped: contact is missing btc/stx address`;
    logOutreachInteraction(contactId, summary);
    emit(
      {
        success: false,
        contact_id: contactId,
        error: "missing-addresses",
        detail: summary,
        logged_interaction: true,
      },
      1,
    );
  }

  // Compose + length check
  const message = composeMessage(contact);
  if (message.length > MESSAGE_CHAR_LIMIT) {
    // This should never happen with our templates; guard anyway.
    const summary = `Welcome failed: composed message ${message.length} chars exceeds ${MESSAGE_CHAR_LIMIT} limit`;
    logOutreachInteraction(contactId, summary);
    emit(
      {
        success: false,
        contact_id: contactId,
        recipient: contact.btc_address,
        error: "message-too-long",
        detail: summary,
        message_len: message.length,
        logged_interaction: true,
      },
      1,
    );
  }

  // Send via x402 inbox
  const sendEnv = { ...process.env, NETWORK: "mainnet" };
  const sendProc = Bun.spawnSync(
    [
      ARC_BIN,
      "skills",
      "run",
      "--name",
      "bitcoin-wallet",
      "--",
      "x402",
      "send-inbox-message",
      "--recipient-btc-address",
      contact.btc_address!,
      "--recipient-stx-address",
      contact.stx_address!,
      "--content",
      message,
    ],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: sendEnv,
    },
  );
  const sendOut = new TextDecoder().decode(sendProc.stdout).trim();
  const sendErr = new TextDecoder().decode(sendProc.stderr).trim();
  const sendCode = sendProc.exitCode ?? -1;

  // Parse structured error from stdout/stderr when present
  let parsedError: { error?: string; detail?: string } | null = null;
  for (const text of [sendOut, sendErr]) {
    if (!text) continue;
    // find last JSON-looking line (skip log noise)
    const jsonLine = text
      .split("\n")
      .reverse()
      .find((l) => l.trim().startsWith("{"));
    if (jsonLine) {
      try {
        const j = JSON.parse(jsonLine);
        if (j && j.success === false) {
          parsedError = { error: j.error, detail: j.detail };
          break;
        }
      } catch {
        /* not JSON */
      }
    }
  }

  if (sendCode !== 0 || parsedError) {
    const errSlug = parsedError?.error || `exit-${sendCode}`;
    const errDetail = (parsedError?.detail || sendErr || sendOut || "").slice(0, 200);
    const summary = `Welcome send failed: ${errSlug} — ${errDetail}`;
    const logged = logOutreachInteraction(contactId, summary);
    emit(
      {
        success: false,
        contact_id: contactId,
        recipient: contact.btc_address!,
        error: errSlug,
        detail: errDetail,
        logged_interaction: logged,
      },
      1,
    );
  }

  // Success: log outreach interaction
  const displayName =
    contact.display_name || contact.aibtc_name || contact.btc_address!;
  const logged = logOutreachInteraction(
    contactId,
    `Sent aibtc.news correspondent welcome via x402 inbox`,
  );

  emit(
    {
      success: true,
      contact_id: contactId,
      recipient: contact.btc_address!,
      message_len: message.length,
      logged_interaction: logged,
      detail: `Welcome sent to ${displayName}`,
    },
    0,
  );
}

main();
