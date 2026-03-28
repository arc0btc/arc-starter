// skills/bitcoin-quorumclaw/sensor.ts
//
// Monitors active QuorumClaw invites and multisig proposals every 15 minutes.
// Replaces ad-hoc "monitor invite X: re-check in 15m" tasks.
//
// Tracking state lives in skills/bitcoin-quorumclaw/tracking.json (written by CLI on join/create).
// Sensor creates tasks only when action is needed (dedup prevents duplicates).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "bitcoin-quorumclaw";
const INTERVAL_MINUTES = 15;
// Official domain: quorumclaw.com (moved from Railway subdomain ~2026-03-11).
// Source: github.com/aetos53t/agent-multisig-api
const API_BASE = "https://quorumclaw.com";
const ARC_AGENT_ID = "arc0btc";
const TRACKING_PATH = join(import.meta.dir, "tracking.json");
const FAILURE_STATE_PATH = join(import.meta.dir, "failure-state.json");
const FETCH_TIMEOUT_MS = 10_000;
const ALERT_THRESHOLD = 10; // consecutive failed runs (~2.5h) before creating alert task

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

export interface TrackedInvite {
  code: string;
  label: string;
  joinedAt: string;
}

export interface TrackedMultisig {
  id: string;
  label: string;
  addedAt: string;
}

export interface Tracking {
  invites: TrackedInvite[];
  multisigs: TrackedMultisig[];
}

interface InviteSlot {
  name?: string;
  publicKey?: string;
  joinedAt?: string;
  sessionId?: string;
  isMe?: boolean;
}

interface InviteRecord {
  id: string;
  name: string;
  threshold: number;
  slots: InviteSlot[];
  multisigId?: string;
  createdAt: string;
}

interface FailureState {
  consecutiveFailures: number;
  lastFailureAt: string | null;
}

interface ProposalRecord {
  id: string;
  multisigId: string;
  status: string;
  sighashes: string[];
  signatures: Array<{ agentId: string; signature: string }>;
  outputs: Array<{ address: string; amount: string }>;
  note?: string;
  txid?: string;
}

// ---- State I/O ----

export async function readTracking(): Promise<Tracking> {
  if (!existsSync(TRACKING_PATH)) return { invites: [], multisigs: [] };
  try {
    return (await Bun.file(TRACKING_PATH).json()) as Tracking;
  } catch {
    return { invites: [], multisigs: [] };
  }
}

export async function writeTracking(t: Tracking): Promise<void> {
  await Bun.write(TRACKING_PATH, JSON.stringify(t, null, 2) + "\n");
}

async function readFailureState(): Promise<FailureState> {
  if (!existsSync(FAILURE_STATE_PATH)) return { consecutiveFailures: 0, lastFailureAt: null };
  try {
    return (await Bun.file(FAILURE_STATE_PATH).json()) as FailureState;
  } catch {
    return { consecutiveFailures: 0, lastFailureAt: null };
  }
}

async function writeFailureState(state: FailureState): Promise<void> {
  await Bun.write(FAILURE_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// ---- API ----

async function apiGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Invite Polling ----

async function pollInvite(
  invite: TrackedInvite,
  tracking: Tracking
): Promise<boolean> {
  const source = `sensor:bitcoin-quorumclaw:invite:${invite.code}`;

  let raw: unknown;
  try {
    raw = await apiGet<unknown>(`/v1/invites/${invite.code}`);
  } catch (error) {
    log(`invite ${invite.code}: fetch failed — ${error}`);
    return true; // API failure
  }

  const record = ((raw as { data?: InviteRecord }).data ?? raw) as InviteRecord;
  const filled = record.slots?.filter((s) => s.name).length ?? 0;
  const total = record.slots?.length ?? 0;
  const threshold = record.threshold ?? "?";

  log(`invite ${invite.code} (${invite.label}): ${filled}/${total} slots filled`);

  // All slots filled → multisig created, time to proceed
  if (record.multisigId) {
    log(`invite ${invite.code}: multisig ready (${record.multisigId})`);

    // Transition: remove from invites, add to multisigs (if not already tracked)
    tracking.invites = tracking.invites.filter((i) => i.code !== invite.code);
    const alreadyTracked = tracking.multisigs.some((m) => m.id === record.multisigId);
    if (!alreadyTracked) {
      tracking.multisigs.push({
        id: record.multisigId,
        label: `${invite.label} (from invite ${invite.code})`,
        addedAt: new Date().toISOString(),
      });
    }

    // Create task to proceed with signing (if not already pending)
    const msSource = `sensor:bitcoin-quorumclaw:multisig-ready:${record.multisigId}`;
    if (!pendingTaskExistsForSource(msSource)) {
      insertTask({
        subject: `QuorumClaw multisig ready — sign proposals (${invite.label})`,
        description: [
          `Invite ${invite.code} is now fully filled (${filled}/${total} signers, threshold ${threshold}).`,
          `Multisig ID: ${record.multisigId}`,
          ``,
          `Steps:`,
          `1. List proposals: arc skills run --name quorumclaw -- list-proposals --multisig-id ${record.multisigId}`,
          `2. For each pending proposal, inspect outputs: arc skills run --name quorumclaw -- get-proposal --id <id>`,
          `3. Sign if outputs are correct: arc skills run --name quorumclaw -- sign-proposal --id <id>`,
          `4. Finalize + broadcast once threshold met.`,
          ``,
          `Security: always verify proposal outputs before signing (blind-sign risk).`,
        ].join("\n"),
        skills: '["bitcoin-quorumclaw", "bitcoin-wallet"]',
        priority: 3,
        model: "opus",
        source: msSource,
      });
      log(`created sign task for multisig ${record.multisigId}`);
    }
    return false; // API succeeded, multisig now tracked
  }

  // Still waiting — log status, no task needed (sensor will re-check next cycle)
  if (filled < total) {
    log(
      `invite ${invite.code}: waiting for signers (${filled}/${total}) — no task needed, sensor will re-check`
    );
  }
  return false; // no API failure
}

// ---- Multisig Proposal Polling ----

async function pollMultisig(multisig: TrackedMultisig): Promise<boolean> {
  let proposals: ProposalRecord[];
  try {
    const raw = await apiGet<unknown>(`/v1/multisigs/${multisig.id}/proposals`);
    proposals = (Array.isArray(raw) ? raw : []) as ProposalRecord[];
  } catch (error) {
    log(`multisig ${multisig.id}: proposals fetch failed — ${error}`);
    return true; // API failure
  }

  log(
    `multisig ${multisig.id} (${multisig.label}): ${proposals.length} proposal(s)`
  );

  for (const proposal of proposals) {
    // Skip completed/broadcast proposals
    if (["broadcast", "completed", "finalized_broadcast"].includes(proposal.status)) {
      log(`  proposal ${proposal.id}: ${proposal.status} — done`);
      continue;
    }

    const alreadySigned = proposal.signatures?.some(
      (s) => s.agentId === ARC_AGENT_ID
    );

    if (proposal.status === "pending" && !alreadySigned) {
      const source = `sensor:bitcoin-quorumclaw:proposal:${proposal.id}`;
      if (pendingTaskExistsForSource(source)) {
        log(`  proposal ${proposal.id}: task already pending`);
        continue;
      }

      const outputSummary = proposal.outputs
        ?.map((o) => `${o.amount} sats → ${o.address}`)
        .join(", ") ?? "(unknown outputs)";

      insertTask({
        subject: `Sign QuorumClaw proposal ${proposal.id.slice(0, 8)} (${multisig.label})`,
        description: [
          `Pending proposal needs Arc's signature.`,
          ``,
          `Multisig: ${multisig.id} (${multisig.label})`,
          `Proposal: ${proposal.id}`,
          `Status: ${proposal.status}`,
          `Outputs: ${outputSummary}`,
          `Signatures: ${proposal.signatures?.length ?? 0} of threshold collected`,
          proposal.note ? `Note: ${proposal.note}` : "",
          ``,
          `Steps:`,
          `1. Verify outputs: arc skills run --name quorumclaw -- get-proposal --id ${proposal.id}`,
          `2. Sign: arc skills run --name quorumclaw -- sign-proposal --id ${proposal.id}`,
          `3. Check if threshold met: arc skills run --name quorumclaw -- get-proposal --id ${proposal.id}`,
          `4. If threshold met: finalize-proposal → broadcast-proposal`,
          ``,
          `Security: verify outputs match expected spend BEFORE signing.`,
        ]
          .filter(Boolean)
          .join("\n"),
        skills: '["bitcoin-quorumclaw", "bitcoin-wallet"]',
        priority: 3,
        model: "opus",
        source,
      });
      log(`  created sign task for proposal ${proposal.id}`);
    } else if (alreadySigned) {
      log(
        `  proposal ${proposal.id}: Arc already signed, waiting for others (${proposal.signatures?.length} sigs)`
      );
    } else {
      log(`  proposal ${proposal.id}: status=${proposal.status} — no action needed`);
    }
  }
  return false; // no API failure
}

// ---- Sensor Entry ----

export default async function quorumclawSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const tracking = await readTracking();

  if (tracking.invites.length === 0 && tracking.multisigs.length === 0) {
    log("nothing tracked — skipping");
    return "ok";
  }

  // Check if API has been consistently unreachable. When threshold is hit, pause polling
  // entirely — no task creation, no API calls. Reset by deleting failure-state.json after
  // confirming the API is back (or a new URL is available — update API_BASE in this file
  // and cli.ts). See MEMORY.md quorumclaw-api-down for current status.
  const failureState = await readFailureState();
  if (failureState.consecutiveFailures >= ALERT_THRESHOLD) {
    log(`API paused (${failureState.consecutiveFailures} consecutive failures) — skipping`);
    return "skip";
  }

  log(
    `checking ${tracking.invites.length} invite(s), ${tracking.multisigs.length} multisig(s)`
  );

  let hadApiFailure = false;

  // Poll invites (may mutate tracking to transition invite → multisig)
  for (const invite of [...tracking.invites]) {
    try {
      const failed = await pollInvite(invite, tracking);
      if (failed) hadApiFailure = true;
    } catch (error) {
      log(`invite ${invite.code}: error — ${error}`);
      hadApiFailure = true;
    }
  }

  // Poll multisigs
  for (const multisig of tracking.multisigs) {
    try {
      const failed = await pollMultisig(multisig);
      if (failed) hadApiFailure = true;
    } catch (error) {
      log(`multisig ${multisig.id}: error — ${error}`);
      hadApiFailure = true;
    }
  }

  // Update consecutive failure counter
  if (hadApiFailure) {
    await writeFailureState({
      consecutiveFailures: failureState.consecutiveFailures + 1,
      lastFailureAt: new Date().toISOString(),
    });
    log(`API failure recorded (consecutive: ${failureState.consecutiveFailures + 1})`);
  } else if (failureState.consecutiveFailures > 0) {
    await writeFailureState({ consecutiveFailures: 0, lastFailureAt: null });
    log("API failures reset — connection restored");
  }

  // Persist any tracking state changes (invite → multisig transitions)
  await writeTracking(tracking);

  return "ok";
}
