// skills/council-distill/sensor.ts
//
// 24h cadence with cheap fast-path hash watch. Refreshes the council content
// well by reading the latest fleet-digest snapshot delivered by the control
// plane (manage-agents `skills/fleet-digest/generate.ts`) and emitting up to
// 5 distilled nuggets into artifacts/distilled/council/.
//
// Each tick:
//   1. sha256(fleet-digest/latest.md) → content hash (read-only, cheap, no network)
//   2. Compare to hookState.lastSeenDigestHash
//   3. If hash unchanged AND last distill < 7d ago → skip (no work, no cost)
//   4. If hash unchanged AND stale, queue one more distill pass, then on the
//      next unchanged-and-stale cycle (~14d total) escalate instead of
//      re-queuing — avoids recycling month-old quotes under a fresh timestamp
//   5. If hash changed → queue a sonnet refresh task that produces up to 5 nuggets
//
// Source repoint (2026-07-17, control-plane-remediation Phase 3 / defect row 49):
// this sensor used to watch `Genesis-Works/agent-coordination` via `gh api`. That
// repo was RETIRED as a coordination channel in favor of direct-to-dispatch
// (still exists, nothing new lands there — the sensor reported "nothing new"
// forever). It now watches a local file delivered by the control plane instead
// of a GitHub repo: the Arc VM cannot push/pull `manage-agents` (VM-local
// commits only), so the control plane pushes ("scp") a fresh digest snapshot to
// `fleet-digest/latest.md` after every `bun skills/fleet-digest/generate.ts`
// run on that side. This sensor only ever reads that local file — no gh call,
// no network dependency at all.
//
// Missing-file tracking: if the delivered file is absent (never delivered, or
// deleted), increment consecutiveMissingDigest. At ≥3, emit one blocked task
// for whoabuddy + apply a 48h cooldown. Reset to 0 once the file reappears.
// Same shape as the old gh-failure handling, new failure mode.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

export const SENSOR_NAME = "council-distill";
const INTERVAL_MINUTES = 24 * 60;
const DIGEST_PATH = join(import.meta.dir, "fleet-digest", "latest.md");
const HEAD_STABLE_SKIP_DAYS = 7;
const MISSING_DIGEST_ESCALATION_THRESHOLD = 3;
const MISSING_DIGEST_COOLDOWN_HOURS = 48;
// If the digest hash is still unchanged after N consecutive would-be-distill
// cycles (~7d apart), the control plane is stuck — escalate instead of
// silently re-queuing a distill task that would recycle the same quotes
// under a fresh timestamp.
const SAME_HASH_ESCALATION_THRESHOLD = 2;
const SAME_HASH_COOLDOWN_HOURS = 48;

const log = createSensorLogger(SENSOR_NAME);

interface CouncilHookState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  lastSeenDigestHash?: string;
  lastDistillAt?: string;
  consecutiveMissingDigest?: number;
  failureCooldownUntil?: string;
  sameHashRepeatCount?: number;
}

/** Fetch a sha256 hash of the delivered fleet-digest file. null if missing/unreadable. */
function fetchDigestHash(): { hash: string | null; rawError?: string } {
  if (!existsSync(DIGEST_PATH)) {
    return { hash: null, rawError: `not found at ${DIGEST_PATH} — control plane has not delivered a digest yet` };
  }
  try {
    const content = readFileSync(DIGEST_PATH, "utf8");
    const hash = createHash("sha256").update(content).digest("hex");
    return { hash };
  } catch (error) {
    return { hash: null, rawError: error instanceof Error ? error.message : String(error) };
  }
}

/** Insert the sonnet distill task for a given digest hash + dedupe source key. */
function queueDistillTask(hash: string, source: string): number {
  const dryRun = Bun.env.COUNCIL_DISTILL_DRY_RUN !== "false";
  const dryRunPrefix = dryRun ? "[DRY-RUN] " : "";

  const taskId = insertTask({
    subject: `${dryRunPrefix}Distill council content well from fleet-digest@${hash.slice(0, 7)}`,
    description: [
      `Source: fleet-digest snapshot delivered to skills/council-distill/fleet-digest/latest.md`,
      `Content hash: ${hash}`,
      "Static brief on disk: skills/whop/COUNCIL-CONTENT-WELL.md (last refresh, may be stale)",
      "",
      "## Goal",
      "Produce up to 5 ISO8601 council nuggets in artifacts/distilled/council/ — one per pattern",
      "that has a genuine match in the current digest. Fewer strong nuggets beats five with filler.",
      "Each nugget is a *selection* (direct quote with citation), NOT a paraphrase.",
      "",
      "## Five topic slugs (use exactly these — taxonomy is fixed)",
      "  - coordination-primitive    (the fleet's live coordination mechanism — direct-to-dispatch,",
      "                                sensor/task patterns visible in the digest)",
      "  - mandate-loop              (self-review / retrospective loops visible in a host's task chain)",
      "  - autonomy-tier             (per-host status/service tiers — legacy-arc-starter vs base-agent-runtime)",
      "  - paired-artifact           (the digest + this narration sensor IS a paired-artifact pattern —",
      "                                a record file paired with an immutable distilled-nugget log)",
      "  - budget-rail               (cost/budget discipline visible in task activity, e.g. X budget",
      "                                guardrails from recent Arc work)",
      "",
      "## Source access",
      "Read `skills/council-distill/fleet-digest/latest.md` directly — it is already local, no gh",
      "call or network access needed. It is a read-only sweep of every agent VM's recent task",
      "activity, delivered by the control plane (manage-agents `skills/fleet-digest/generate.ts`).",
      "",
      "## Per-nugget constraints (writeDistilled enforces)",
      "- type: \"council\"",
      "- topic: one of the five slugs above",
      "- nugget: ≤ 1200 chars. Format: `\"<direct quote from source>\" — <citation>` plus a",
      "  one-sentence framing line. Selection, not paraphrase. Never invent.",
      "- citation: short pattern name + source ref (e.g. \"fleet-digest:2026-07-17T...\")",
      "- suggested_channels: [\"whop-chat\", \"blog\", \"reactive\", \"x\"]",
      "  (the X agent-philosophy beat reads council nuggets on a 14d window)",
      "",
      dryRun
        ? "## DRY-RUN MODE\nWrite the nuggets via writeDistilled normally — the pool itself is dry-run-safe.\nBut do NOT update skills/whop/COUNCIL-CONTENT-WELL.md until human voice review.\nClose completed with --summary describing each pattern's source quote + any gaps you saw."
        : "## LIVE MODE (default as of 2026-07-17)\nWrite nuggets and update skills/whop/COUNCIL-CONTENT-WELL.md with the same patterns.",
      "",
      "## Steps",
      "1. Read skills/council-distill/fleet-digest/latest.md in full.",
      "2. For each of 5 topics, find the strongest genuine match in the digest and write a nugget via:",
      "   `import { writeDistilled } from \"../../src/artifacts.ts\"; writeDistilled({...});`",
      "3. Verify all landed on disk.",
      "4. Close completed with the summary line.",
      "",
      "## Skipping is OK",
      "If a topic has no fresh match in this digest, skip it and document the gap. Better 2-3",
      "strong nuggets than 5 with filler.",
    ].join("\n"),
    skills: JSON.stringify(["council-distill", "whop"]),
    priority: 5,
    model: "sonnet",
    status: "pending",
    source,
  });

  log(`queued ${dryRun ? "(dry-run)" : "(LIVE)"} distill task ${taskId} for digest ${hash.slice(0, 7)}`);
  return taskId;
}

export async function pollCouncilDistill(): Promise<"ok" | "skip"> {
  if (Bun.env.COUNCIL_DISTILL_ENABLED !== "true" && Bun.env.ARC_DISTILL_FORCE !== "1") {
    log("disabled (COUNCIL_DISTILL_ENABLED=false) — awaiting first smoke + sign-off");
    return "skip";
  }

  const state = ((await readHookState(SENSOR_NAME)) ?? {}) as CouncilHookState;

  // Failure cooldown check
  if (state.failureCooldownUntil) {
    const cooldownEndsMs = Date.parse(state.failureCooldownUntil);
    if (Date.now() < cooldownEndsMs) {
      log(`missing-digest cooldown active until ${state.failureCooldownUntil} — skip`);
      return "skip";
    }
  }

  const { hash, rawError } = fetchDigestHash();
  if (!hash) {
    const newCount = (state.consecutiveMissingDigest ?? 0) + 1;
    log(`digest read failure #${newCount}: ${rawError ?? "unknown"}`);
    const nextState: CouncilHookState = {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "error",
      version: (state.version ?? 0) + 1,
      consecutiveMissingDigest: newCount,
    };
    if (newCount >= MISSING_DIGEST_ESCALATION_THRESHOLD) {
      const cooldownUntil = new Date(Date.now() + MISSING_DIGEST_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
      nextState.failureCooldownUntil = cooldownUntil;
      // Idempotent escalation: only emit if no prior blocked task for this incident.
      const escalationSource = `sensor:council-distill:escalate-${new Date().toISOString().slice(0, 10)}`;
      if (!pendingTaskExistsForSource(escalationSource)) {
        insertTask({
          subject: `[ESCALATED] council-distill: ${newCount} consecutive missing-digest reads`,
          description: [
            `\`${DIGEST_PATH}\` has been missing or unreadable ${newCount} times in a row.`,
            `Last error: ${rawError ?? "unknown"}`,
            "",
            "Possible causes: the control plane hasn't run `bun skills/fleet-digest/generate.ts` yet,",
            "the scp delivery step failed, or the local file was deleted.",
            "",
            "Triage:",
            "1. Check the file exists: `ls -la skills/council-distill/fleet-digest/latest.md`",
            "2. From the control plane (manage-agents repo), re-run: `bun skills/fleet-digest/generate.ts`",
            "   (delivers to this exact path via scp).",
            "3. Once resolved, clear the cooldown in db/hook-state/council-distill.json (remove",
            "   failureCooldownUntil + reset consecutiveMissingDigest to 0).",
            "",
            `48h cooldown applied — sensor will not retry until ${cooldownUntil}.`,
          ].join("\n"),
          skills: JSON.stringify(["council-distill"]),
          priority: 4,
          model: "sonnet",
          status: "blocked",
          source: escalationSource,
        });
        log(`escalated; 48h cooldown applied until ${cooldownUntil}`);
      }
    }
    await writeHookState(SENSOR_NAME, nextState as unknown as Parameters<typeof writeHookState>[1]);
    return "skip";
  }

  // digest read success: clear any prior failure counter.
  const lastSeenHash = state.lastSeenDigestHash;
  const lastDistillIso = state.lastDistillAt;
  const distillAgeMs = lastDistillIso ? Date.now() - Date.parse(lastDistillIso) : Infinity;
  const distillStaleMs = HEAD_STABLE_SKIP_DAYS * 24 * 60 * 60 * 1000;

  if (hash === lastSeenHash && distillAgeMs <= distillStaleMs) {
    log(`digest stable (${hash.slice(0, 7)}) and last distill ${Math.round(distillAgeMs / 86400000)}d ago — skip`);
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: (state.version ?? 0) + 1,
      lastSeenDigestHash: hash,
      consecutiveMissingDigest: 0,
      failureCooldownUntil: undefined,
    } as Parameters<typeof writeHookState>[1]);
    return "skip";
  }

  // Same hash as last distill, but stale by age — the control plane hasn't
  // delivered anything new. Re-queuing here would recycle month-old quotes
  // under a fresh timestamp. Track repeats and escalate instead of looping.
  if (hash === lastSeenHash) {
    const repeatCount = (state.sameHashRepeatCount ?? 0) + 1;
    if (repeatCount >= SAME_HASH_ESCALATION_THRESHOLD) {
      const cooldownUntil = new Date(Date.now() + SAME_HASH_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
      const escalationSource = `sensor:council-distill:same-hash-escalate-${hash.slice(0, 7)}`;
      if (!pendingTaskExistsForSource(escalationSource)) {
        insertTask({
          subject: `[ESCALATED] council-distill: digest unchanged for ${repeatCount} consecutive cycles`,
          description: [
            `\`${DIGEST_PATH}\` content hash ${hash.slice(0, 7)} has not changed across ${repeatCount}`,
            "consecutive would-be-distill cycles (~7d apart each) — the control plane appears stuck.",
            "",
            "Not re-queuing a distill task: the digest content was already fully processed on the",
            "prior pass, and re-distilling now would recycle the same quotes under a new timestamp,",
            "risking duplicate content pushed to whop-chat/blog/x channels.",
            "",
            "Triage:",
            "1. From the control plane (manage-agents repo), check whether",
            "   `bun skills/fleet-digest/generate.ts` is still running and delivering via scp.",
            "2. Once a genuinely new digest lands, this sensor will detect the new hash and resume",
            "   normal distill cadence automatically — no manual reset needed for that path.",
            "3. If this is expected quiet (e.g. control plane paused deliberately), clear",
            "   `sameHashRepeatCount` in db/hook-state/council-distill.json and confirm the pause.",
            "",
            `48h cooldown applied — sensor will not re-escalate until ${cooldownUntil}.`,
          ].join("\n"),
          skills: JSON.stringify(["council-distill"]),
          priority: 5,
          model: "sonnet",
          status: "blocked",
          source: escalationSource,
        });
        log(`same-hash escalated after ${repeatCount} repeats; 48h cooldown applied until ${cooldownUntil}`);
      }
      await writeHookState(SENSOR_NAME, {
        ...state,
        last_ran: new Date().toISOString(),
        last_result: "skip",
        version: (state.version ?? 0) + 1,
        lastSeenDigestHash: hash,
        sameHashRepeatCount: repeatCount,
        failureCooldownUntil: cooldownUntil,
      } as Parameters<typeof writeHookState>[1]);
      return "skip";
    }

    // Below the escalation threshold — allow one more distill pass, but track
    // the repeat so the next stale-and-unchanged cycle counts toward escalation.
    log(`digest unchanged (${hash.slice(0, 7)}) but distill stale — repeat ${repeatCount}/${SAME_HASH_ESCALATION_THRESHOLD}, queuing`);
    const staleSource = `sensor:council-distill:${hash.slice(0, 7)}-repeat${repeatCount}`;
    if (pendingTaskExistsForSource(staleSource)) {
      log(`refresh task already queued for digest ${hash.slice(0, 7)} (repeat ${repeatCount}) — skip`);
      return "skip";
    }
    queueDistillTask(hash, staleSource);
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state.version ?? 0) + 1,
      lastSeenDigestHash: hash,
      lastDistillAt: new Date().toISOString(),
      consecutiveMissingDigest: 0,
      failureCooldownUntil: undefined,
      sameHashRepeatCount: repeatCount,
    } as Parameters<typeof writeHookState>[1]);
    log(`queued distill task for digest ${hash.slice(0, 7)} (repeat ${repeatCount})`);
    return "ok";
  }

  // hash changed — genuinely new content, queue a refresh and reset repeat tracking.
  const source = `sensor:council-distill:${hash.slice(0, 7)}`;
  if (pendingTaskExistsForSource(source)) {
    log(`refresh task already queued for digest ${hash.slice(0, 7)} — skip`);
    return "skip";
  }

  queueDistillTask(hash, source);

  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (state.version ?? 0) + 1,
    lastSeenDigestHash: hash,
    lastDistillAt: new Date().toISOString(),
    consecutiveMissingDigest: 0,
    failureCooldownUntil: undefined,
    sameHashRepeatCount: 0,
  } as Parameters<typeof writeHookState>[1]);

  return "ok";
}

export default async function councilDistillSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    return await pollCouncilDistill();
  } catch (error) {
    log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return "skip";
  }
}
