import { claimSensorRun, insertTaskIfNew, createSensorLogger } from "../../src/sensors.ts";
import { initContactsSchema, type Contact, resolveDisplayName } from "../contact-registry/schema.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "agent-welcome";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:agent-welcome";
const MAX_PER_RUN = 10; // cap burst spend at ~1000 sats per sensor cycle

const log = createSensorLogger(SENSOR_NAME);

export default async function agentWelcomeSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const db = initContactsSchema();

  // Find agents that are:
  // - type=agent, status=active
  // - have both btc_address and stx_address (needed to send inbox message)
  // - have a confirmed agent_id (on-chain registered, worth spending 100 sats on)
  // - have no prior outreach interaction (prevents duplicate sends)
  const newAgents = db.query(`
    SELECT c.* FROM contacts c
    WHERE c.type = 'agent'
      AND c.status = 'active'
      AND c.btc_address IS NOT NULL
      AND c.stx_address IS NOT NULL
      AND c.agent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM contact_interactions ci
        WHERE ci.contact_id = c.id AND ci.type = 'outreach'
      )
    ORDER BY c.created_at ASC
    LIMIT ?
  `).all(MAX_PER_RUN) as Contact[];

  if (newAgents.length === 0) return "skip";

  let created = 0;
  for (const agent of newAgents) {
    const name = resolveDisplayName(agent);
    const source = `${TASK_SOURCE}:${agent.btc_address}`;

    const descLines = [
      `Contact ID: ${agent.id}`,
      `Name: ${name}`,
      `BTC: ${agent.btc_address}`,
      `STX: ${agent.stx_address}`,
      `Agent ID: ${agent.agent_id}`,
      agent.aibtc_level ? `Level: ${agent.aibtc_level}` : null,
      agent.aibtc_beat ? `Beat: ${agent.aibtc_beat}` : null,
      `OUTREACH_RESPONSE: true`,
    ].filter(Boolean) as string[];

    const id = insertTaskIfNew(source, {
      subject: `Welcome new agent to aibtc.news: ${name}`,
      description: descLines.join("\n"),
      priority: 8,
      skills: JSON.stringify(["agent-welcome", "bitcoin-wallet"]),
    });

    if (id !== null) {
      log(`Queued welcome for ${name} (contact ${agent.id}, agent_id: ${agent.agent_id})`);
      created++;
    }
  }

  return created > 0 ? "ok" : "skip";
}
