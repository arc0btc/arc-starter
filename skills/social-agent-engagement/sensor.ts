// skills/social-agent-engagement/sensor.ts
// Sensor for identifying collaboration opportunities with AIBTC agents

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "social-agent-engagement";
const INTERVAL_MINUTES = 60; // 1 hour
const API_BASE = "https://aibtc.news/api";

const log = createSensorLogger(SENSOR_NAME);

interface Signal {
  _id?: string;
  btcAddress: string;
  beat: string;
  claim: string;
  evidence: string;
  implication: string;
  timestamp?: string;
  agentName?: string;
}

interface SignalListResponse {
  signals?: Signal[];
  error?: string;
}

async function fetchRecentSignals(): Promise<Signal[]> {
  try {
    const url = `${API_BASE}/signals?limit=50&sort=-timestamp`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: signal fetch failed with ${response.status}`);
      return [];
    }
    const data = (await response.json()) as SignalListResponse;
    return data.signals || [];
  } catch (e) {
    const error = e as Error;
    log(`warn: signal fetch error: ${error.message}`);
    return [];
  }
}

async function fetchBeatStatus(): Promise<Record<string, unknown> | null> {
  try {
    const url = `${API_BASE}/status/${ARC_BTC_ADDRESS}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: beat status fetch failed with ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (e) {
    const error = e as Error;
    log(`warn: beat status fetch error: ${error.message}`);
    return null;
  }
}

export default async function agentEngagementSensor(): Promise<string> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Fetch recent signals to identify collaboration patterns
    log("scanning recent signals for collaboration opportunities...");
    const signals = await fetchRecentSignals();

    if (signals.length === 0) {
      log("no recent signals found; skipping");
      return "ok";
    }

    // Group signals by agent and beat
    const signalsByAgent = new Map<string, Set<string>>();
    const signalsByBeat = new Map<string, Set<string>>();

    for (const signal of signals) {
      const agent = signal.btcAddress || "unknown";
      const beat = signal.beat || "unknown";

      if (!signalsByAgent.has(agent)) {
        signalsByAgent.set(agent, new Set());
      }
      signalsByAgent.get(agent)?.add(beat);

      if (!signalsByBeat.has(beat)) {
        signalsByBeat.set(beat, new Set());
      }
      signalsByBeat.get(beat)?.add(agent);
    }

    log(`found ${signals.length} recent signals across ${signalsByAgent.size} agents and ${signalsByBeat.size} beats`);

    // Check Arc's beat status
    const beatStatus = await fetchBeatStatus();
    const arcBeat = (beatStatus as Record<string, unknown>)?.beat as Record<string, unknown> | undefined;
    const arcBeatSlug = arcBeat?.slug as string | undefined;

    if (arcBeatSlug) {
      log(`arc is active on beat: ${arcBeatSlug}`);

      // Find other agents filing on the same beat
      const otherAgentsOnBeat = signalsByBeat.get(arcBeatSlug) || new Set();
      otherAgentsOnBeat.delete(ARC_BTC_ADDRESS);

      if (otherAgentsOnBeat.size > 0) {
        log(`found ${otherAgentsOnBeat.size} other agents on beat '${arcBeatSlug}'`);

        // Queue collaboration opportunities (dedup by agent + beat combo)
        for (const agentAddress of otherAgentsOnBeat) {
          const taskSource = `sensor:${SENSOR_NAME}:collab-${arcBeatSlug}-${agentAddress.slice(0, 8)}`;
          const taskExists = pendingTaskExistsForSource(taskSource);

          if (!taskExists) {
            log(`queuing collaboration opportunity with ${agentAddress.slice(0, 8)}... on ${arcBeatSlug}`);
            insertTask({
              subject: `Propose collaboration with agent on '${arcBeatSlug}' beat`,
              description: `Arc and another agent (${agentAddress}) are both filing signals on the '${arcBeatSlug}' beat. Opportunity to coordinate coverage, share sources, or propose joint analysis. Review recent signals from this agent and consider reaching out via AIBTC inbox message.`,
              skills: JSON.stringify(["social-agent-engagement", "bitcoin-wallet"]),
              priority: 6,
              model: "sonnet",
              status: "pending",
              source: taskSource,
            });
          }
        }
      }
    }

    // Check for high-value DeFi signals (opportunity to reach out to technical agents)
    const defiBeats = ["deal-flow", "defi-yields", "ordinals-business"];
    for (const beat of defiBeats) {
      const agentsOnBeat = signalsByBeat.get(beat) || new Set();
      if (agentsOnBeat.size > 2) {
        const taskSource = `sensor:${SENSOR_NAME}:defi-collab-${beat}`;
        const taskExists = pendingTaskExistsForSource(taskSource);

        if (!taskExists) {
          log(`detected active ${beat} beat with ${agentsOnBeat.size} agents`);
          insertTask({
            subject: `Consider DeFi collaboration opportunity on '${beat}' beat`,
            description: `Multiple agents are active on the '${beat}' beat. Arc could share relevant DeFi insights (Bitflow, Zest V2, sBTC yield strategies) to build collaborative relationships.`,
            skills: JSON.stringify(["social-agent-engagement", "bitcoin-wallet"]),
            priority: 7,
            model: "sonnet",
            status: "pending",
            source: taskSource,
          });
        }
      }
    }

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
