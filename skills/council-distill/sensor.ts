// skills/council-distill/sensor.ts
//
// 24h cadence with cheap fast-path SHA watch. Refreshes the council content
// well by reading the latest patterns from genesis-works/agent-coordination
// and emitting 5 distilled nuggets into artifacts/distilled/council/.
//
// Each tick:
//   1. gh api commits?per_page=1 → HEAD SHA (read-only, cheap)
//   2. Compare to hookState.lastSeenHeadSha
//   3. If SHA unchanged AND last distill < 7d ago → skip (no work, no cost)
//   4. Otherwise queue a sonnet refresh task that produces 5 nuggets
//
// External-failure tracking: on gh non-zero exit, increment
// consecutiveGhFailures. At ≥3, emit one blocked task for whoabuddy + apply a
// 48h cooldown. Reset to 0 on next successful call. This matches MEMORY [P]
// blocked-external-dependency rule.

import { spawnSync } from "node:child_process";

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

export const SENSOR_NAME = "council-distill";
const INTERVAL_MINUTES = 24 * 60;
const COUNCIL_REPO = "Genesis-Works/agent-coordination";
const HEAD_STABLE_SKIP_DAYS = 7;
const GH_FAILURE_ESCALATION_THRESHOLD = 3;
const GH_FAILURE_COOLDOWN_HOURS = 48;

const log = createSensorLogger(SENSOR_NAME);

interface CouncilHookState {
  last_ran: string;
  last_result: "ok" | "error" | "skip";
  version: number;
  lastSeenHeadSha?: string;
  lastDistillAt?: string;
  consecutiveGhFailures?: number;
  failureCooldownUntil?: string;
}

/** Fetch HEAD commit SHA for the council repo. null on any failure. */
function fetchCouncilHead(): { sha: string | null; rawError?: string } {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${COUNCIL_REPO}/commits?per_page=1`,
      "--jq",
      ".[0].sha",
    ],
    { timeout: 30_000, encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { sha: null, rawError: result.stderr || `exit ${result.status}` };
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) return { sha: null, rawError: `unexpected output: ${sha.slice(0, 60)}` };
  return { sha };
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
      log(`gh failure cooldown active until ${state.failureCooldownUntil} — skip`);
      return "skip";
    }
  }

  const { sha, rawError } = fetchCouncilHead();
  if (!sha) {
    const newCount = (state.consecutiveGhFailures ?? 0) + 1;
    log(`gh api failure #${newCount}: ${rawError ?? "unknown"}`);
    const nextState: CouncilHookState = {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "error",
      version: (state.version ?? 0) + 1,
      consecutiveGhFailures: newCount,
    };
    if (newCount >= GH_FAILURE_ESCALATION_THRESHOLD) {
      const cooldownUntil = new Date(Date.now() + GH_FAILURE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
      nextState.failureCooldownUntil = cooldownUntil;
      // Idempotent escalation: only emit if no prior blocked task for this incident.
      const escalationSource = `sensor:council-distill:escalate-${new Date().toISOString().slice(0, 10)}`;
      if (!pendingTaskExistsForSource(escalationSource)) {
        insertTask({
          subject: `[ESCALATED] council-distill: ${newCount} consecutive gh api failures`,
          description: [
            `\`gh api repos/${COUNCIL_REPO}/commits?per_page=1\` has failed ${newCount} times in a row.`,
            `Last error: ${rawError ?? "unknown"}`,
            "",
            "Possible causes: gh CLI not authenticated, token revoked, rate-limit, repo access lost.",
            "",
            "Triage:",
            "1. Verify auth: `gh auth status`",
            "2. Test the call directly: `gh api 'repos/Genesis-Works/agent-coordination/commits?per_page=1' --jq '.[0].sha'`",
            "3. Once resolved, clear the cooldown in db/hook-state/council-distill.json (remove failureCooldownUntil + reset consecutiveGhFailures to 0).",
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

  // gh success: clear any prior failure counter.
  const lastSeenSha = state.lastSeenHeadSha;
  const lastDistillIso = state.lastDistillAt;
  const distillAgeMs = lastDistillIso ? Date.now() - Date.parse(lastDistillIso) : Infinity;
  const distillStaleMs = HEAD_STABLE_SKIP_DAYS * 24 * 60 * 60 * 1000;

  if (sha === lastSeenSha && distillAgeMs < distillStaleMs) {
    log(`HEAD stable (${sha.slice(0, 7)}) and last distill ${Math.round(distillAgeMs / 86400000)}d ago — skip`);
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_ran: new Date().toISOString(),
      last_result: "skip",
      version: (state.version ?? 0) + 1,
      lastSeenHeadSha: sha,
      consecutiveGhFailures: 0,
      failureCooldownUntil: undefined,
    } as Parameters<typeof writeHookState>[1]);
    return "skip";
  }

  // SHA changed OR distill stale — queue a refresh.
  const source = `sensor:council-distill:${sha.slice(0, 7)}`;
  if (pendingTaskExistsForSource(source)) {
    log(`refresh task already queued for HEAD ${sha.slice(0, 7)} — skip`);
    return "skip";
  }

  const dryRun = Bun.env.COUNCIL_DISTILL_DRY_RUN !== "false";
  const dryRunPrefix = dryRun ? "[DRY-RUN] " : "";

  const taskId = insertTask({
    subject: `${dryRunPrefix}Distill council content well from ${COUNCIL_REPO}@${sha.slice(0, 7)}`,
    description: [
      `Source: ${COUNCIL_REPO}@${sha} (HEAD)`,
      "Static brief on disk: skills/whop/COUNCIL-CONTENT-WELL.md (last refresh, may be stale)",
      "",
      "## Goal",
      "Produce 5 ISO8601 council nuggets in artifacts/distilled/council/ — one per pattern.",
      "Each nugget is a *selection* (direct quote with citation), NOT a paraphrase.",
      "",
      "## Five topic slugs (use exactly these — taxonomy is fixed)",
      "  - coordination-primitive    (substrate / shared-DB / FOR UPDATE SKIP LOCKED)",
      "  - mandate-loop              (council / structural disagreement / mandate cycle)",
      "  - autonomy-tier             (tier model / earned autonomy / charter tiers)",
      "  - paired-artifact           (artifact + immutable log / Notch / audit ledger)",
      "  - budget-rail               (hard budget rails / trustless delegation / RFC 0012)",
      "",
      "## Source access",
      "Use `gh api repos/Genesis-Works/agent-coordination/contents/<path>` to read files",
      "from the private repo. Recent activity hints (last commit window 2026-05-22 to",
      "2026-05-30): substrate-activation phase 1, 9-phase shared-substrate quest, CRM +",
      "commission ledger Postgres migration, management profile + GREEN health.",
      "",
      "Suggested reads (start here, add more if needed):",
      "  - README.md",
      "  - fleet/2026-05-29T184700Z-shared-substrate-FINAL.md",
      "  - fleet/2026-05-29T184600Z-shared-substrate-phase-9.md",
      "  - tiers / charter docs if present",
      "",
      "## Per-nugget constraints (writeDistilled enforces)",
      "- type: \"council\"",
      "- topic: one of the five slugs above",
      "- nugget: ≤ 1200 chars. Format: `\"<direct quote from source>\" — <citation>` plus a",
      "  one-sentence framing line. Selection, not paraphrase. Never invent.",
      "- citation: short pattern name + source ref (e.g. \"council:substrate-phase-9\")",
      "- suggested_channels: [\"whop-chat\", \"blog\", \"reactive\"]",
      "",
      dryRun
        ? "## DRY-RUN MODE (default)\nWrite the 5 nuggets via writeDistilled normally — the pool itself is dry-run-safe.\nBut do NOT update skills/whop/COUNCIL-CONTENT-WELL.md until human voice review.\nClose completed with --summary describing each pattern's source quote + any gaps you saw in the repo."
        : "## LIVE MODE\nWrite nuggets and update skills/whop/COUNCIL-CONTENT-WELL.md with the same 5 patterns.",
      "",
      "## Steps",
      "1. Read at least the README + the FINAL summary. Branch to other files if helpful.",
      "2. For each of 5 topics, find the strongest quote in the repo and write a nugget via:",
      "   `import { writeDistilled } from \"../../src/artifacts.ts\"; writeDistilled({...});`",
      "3. Verify all 5 landed on disk.",
      "4. Close completed with the summary line.",
      "",
      "## Skipping is OK",
      "If a topic has no fresh quote (council hasn't touched that area), skip it and",
      "document the gap. Better 3 strong nuggets than 5 with filler.",
    ].join("\n"),
    skills: JSON.stringify(["council-distill", "whop"]),
    priority: 5,
    model: "sonnet",
    status: "pending",
    source,
  });

  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: (state.version ?? 0) + 1,
    lastSeenHeadSha: sha,
    lastDistillAt: new Date().toISOString(),
    consecutiveGhFailures: 0,
    failureCooldownUntil: undefined,
  } as Parameters<typeof writeHookState>[1]);

  log(`queued ${dryRun ? "(dry-run)" : "(LIVE)"} distill task ${taskId} for HEAD ${sha.slice(0, 7)}`);
  return "ok";
}

export default async function councilDistillSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  try {
    return await pollCouncilDistill();
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    return "skip";
  }
}
