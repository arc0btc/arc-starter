// skills/alb/sensor.ts
//
// Polls ALB (agentslovebitcoin.com) inbox for trustless_indra via BTC-authenticated
// /api/me/email/inbox endpoint. Creates tasks for unread messages.
// Runs every 5 minutes via sensor cadence gating.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";
import { resolve } from "path";

const SENSOR_NAME = "alb";
const INTERVAL_MINUTES = 5;

const BTC_ADDRESS = "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933";
const DEFAULT_API_BASE = "https://agentslovebitcoin.com";
const SIGN_RUNNER = resolve(import.meta.dir, "../bitcoin-wallet/sign-runner.ts");
const ROOT = resolve(import.meta.dir, "../..");

const log = createSensorLogger(SENSOR_NAME);

interface AlbInboxMessage {
  id: string;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  read_at: string | null;
}

interface AlbInboxResponse {
  ok: boolean;
  data?: {
    messages: AlbInboxMessage[];
    pagination: { total: number; limit: number; offset: number };
  };
  error?: { code: string; message: string };
}

async function btcSign(message: string): Promise<string | null> {
  const password = await getCredential("wallet", "password");
  const id = await getCredential("wallet", "id");
  if (!password || !id) return null;

  const proc = Bun.spawn(["bun", "run", SIGN_RUNNER, "btc-sign", "--message", message], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WALLET_ID: id, WALLET_PASSWORD: password },
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;

  try {
    const parsed = JSON.parse(stdout.trim()) as { success: boolean; signatureBase64?: string };
    return parsed.success ? (parsed.signatureBase64 ?? null) : null;
  } catch {
    return null;
  }
}

const HOOK_STATE_KEY = "alb-meter";

class AlbMeterExhaustedError extends Error {
  readonly resetsAt: string;
  constructor(resetsAt: string) {
    super(`ALB free allocation exhausted, resets at ${resetsAt}`);
    this.resetsAt = resetsAt;
  }
}

async function fetchUnreadInbox(apiBase: string): Promise<AlbInboxMessage[]> {
  const path = "/api/me/email/inbox";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `GET ${path}:${timestamp}`;
  const signature = await btcSign(message);

  if (!signature) {
    throw new Error("Failed to sign BTC auth message — wallet credentials missing or signing failed");
  }

  const url = `${apiBase}${path}?limit=50&unread=true`;
  const resp = await fetch(url, {
    headers: {
      "X-BTC-Address": BTC_ADDRESS,
      "X-BTC-Signature": signature,
      "X-BTC-Timestamp": timestamp,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (resp.status === 402) {
    // Parse resets_at from the 402 response body
    let resetsAt = "";
    try {
      const body = await resp.json() as { data?: { resets_at?: string } };
      resetsAt = body?.data?.resets_at ?? "";
    } catch {
      // If body isn't JSON, estimate reset as 24h from now
    }
    if (!resetsAt) {
      resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    throw new AlbMeterExhaustedError(resetsAt);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ALB API ${resp.status}: ${text}`);
  }

  const data = await resp.json() as AlbInboxResponse;
  if (!data.ok || !data.data) {
    throw new Error(`ALB API error: ${JSON.stringify(data.error)}`);
  }

  return data.data.messages;
}

export default async function albSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Gate: skip if we're in a 402 cooldown window
  const meterState = await readHookState(HOOK_STATE_KEY);
  if (meterState) {
    const resetsAt = meterState.resets_at as string | undefined;
    if (resetsAt && new Date(resetsAt).getTime() > Date.now()) {
      log(`Meter exhausted — skipping until ${resetsAt}`);
      return "skip";
    }
  }

  const apiBase = (
    (await getCredential("agents-love-bitcoin", "api_base_url")) ?? DEFAULT_API_BASE
  ).replace(/\/$/, "");

  let totalQueued = 0;

  try {
    const messages = await fetchUnreadInbox(apiBase);

    // Clear meter gate on successful fetch
    if (meterState) {
      await writeHookState(HOOK_STATE_KEY, {
        last_ran: new Date().toISOString(),
        last_result: "ok",
        version: (meterState.version ?? 0) + 1,
      });
    }

    log(`trustless_indra: ${messages.length} unread message(s)`);

    for (const message of messages) {
      const source = `sensor:alb:trustless_indra:${message.id}`;
      if (pendingTaskExistsForSource(source)) continue;

      const subject = message.subject
        ? `ALB inbox [trustless_indra]: ${message.subject}`
        : `ALB inbox [trustless_indra]: (no subject) from ${message.from_address}`;

      insertTask({
        subject,
        description: [
          `From: ${message.from_address}`,
          `Received: ${message.received_at}`,
          `Message ID: ${message.id}`,
          "",
          message.body_text ? message.body_text.slice(0, 500) : "(no body)",
        ].join("\n"),
        priority: 3,
        model: "sonnet",
        skills: JSON.stringify(["alb"]),
        source,
      });

      totalQueued++;
      log(`Queued task for trustless_indra message ${message.id}`);
    }
  } catch (e) {
    if (e instanceof AlbMeterExhaustedError) {
      // Write gate — sensor will skip until the metering window resets
      await writeHookState(HOOK_STATE_KEY, {
        last_ran: new Date().toISOString(),
        last_result: "skip",
        version: (meterState?.version ?? 0) + 1,
        resets_at: e.resetsAt,
      });
      log(`Free allocation exhausted — gated until ${e.resetsAt}`);
      return "skip";
    }
    log(`Error polling inbox: ${e}`);
    return "error";
  }

  log(`Done: ${totalQueued} task(s) queued`);
  return "ok";
}
