// skills/alb/sensor.ts
//
// Polls ALB (agentslovebitcoin.com) inboxes for trustless_indra and topaz_centaur.
// Creates tasks for unread messages. Uses admin API — no per-agent BIP-137 signing.
// Runs every 5 minutes via sensor cadence gating.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "alb";
const INTERVAL_MINUTES = 5;

const MANAGED_NAMES = ["trustless_indra", "topaz_centaur"] as const;
type ManagedName = typeof MANAGED_NAMES[number];

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
    aibtc_name: string;
    messages: AlbInboxMessage[];
    pagination: { total: number; limit: number; offset: number };
  };
  error?: { code: string; message: string };
}

async function fetchUnreadInbox(
  name: ManagedName,
  apiBase: string,
  adminKey: string
): Promise<AlbInboxMessage[]> {
  const url = `${apiBase}/api/admin/agents/${encodeURIComponent(name)}/inbox?limit=50&unread=true`;
  const resp = await fetch(url, {
    headers: { "X-Admin-Key": adminKey },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ALB API ${resp.status} for ${name}: ${text}`);
  }

  const data = await resp.json() as AlbInboxResponse;
  if (!data.ok || !data.data) {
    throw new Error(`ALB API error for ${name}: ${JSON.stringify(data.error)}`);
  }

  return data.data.messages;
}

export default async function albSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Load credentials
  let adminKey: string | null;
  let apiBase: string | null;
  try {
    adminKey = await getCredential("agents-love-bitcoin", "admin_api_key");
    apiBase = await getCredential("agents-love-bitcoin", "api_base_url");
  } catch (e) {
    log(`Failed to load credentials: ${e}`);
    return "error";
  }

  if (!adminKey) {
    log("Missing credential: agents-love-bitcoin/admin_api_key — skipping");
    return "skip";
  }

  const base = (apiBase ?? "https://agentslovebitcoin.com").replace(/\/$/, "");

  let totalQueued = 0;
  let totalErrors = 0;

  for (const name of MANAGED_NAMES) {
    try {
      const messages = await fetchUnreadInbox(name, base, adminKey);
      log(`${name}: ${messages.length} unread message(s)`);

      for (const msg of messages) {
        const source = `sensor:alb:${name}:${msg.id}`;
        if (pendingTaskExistsForSource(source)) continue;

        const subject = msg.subject
          ? `ALB inbox [${name}]: ${msg.subject}`
          : `ALB inbox [${name}]: (no subject) from ${msg.from_address}`;

        insertTask({
          subject,
          description: [
            `From: ${msg.from_address}`,
            `Received: ${msg.received_at}`,
            `Message ID: ${msg.id}`,
            "",
            msg.body_text ? msg.body_text.slice(0, 500) : "(no body)",
          ].join("\n"),
          priority: 3,
          skills: JSON.stringify(["alb"]),
          source,
        });

        totalQueued++;
        log(`Queued task for ${name} message ${msg.id}`);
      }
    } catch (e) {
      log(`Error polling ${name}: ${e}`);
      totalErrors++;
    }
  }

  log(`Done: ${totalQueued} task(s) queued, ${totalErrors} error(s)`);
  return totalErrors > 0 ? "error" : "ok";
}
