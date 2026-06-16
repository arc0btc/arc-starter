#!/usr/bin/env bun

// skills/whop-sales/sensor.ts
//
// The P9 autonomous ACQUISITION LANE — sales & distribution as part of Arc's
// dispatch loop. Auto-discovered by src/sensors.ts `runSensors()` (default
// export), self-gated on an interval. Each cycle it:
//   1. surfaces Class A/B/C leads from the room relationship store (member- and
//      Arc-excluded), classifies + routes them (arc-auto vs operator-manual),
//   2. composes ONE doctrine-shaped pitch per lead (lib/compose.ts),
//   3. runs the BLOCKING enforcement gate (lib/enforcement.ts: 1–2/day cap,
//      7-day dedup, give-3x, claim→proof, never-say) — a blocked lead is NEVER
//      queued,
//   4. queues a channel-tagged posting task (a dispatched session posts the body
//      then the first-reply CTA+promo+proof — mirrors the whop reactive lane),
//      or, in DRY_RUN, composes into the artifact only (no queue, no spend),
//   5. queues the day-1/day-5 ship-log ONBOARDING nudge on new-member events
//      (P5 rev C mechanic), deduped,
//   6. writes a reviewable artifact (cap config + Arc-auto/operator split).
//
// Safety posture (operator steer: confirm before outward-facing): ships
// WHOP_SALES_DRY_RUN=true — composes for review, does NOT auto-post at strangers.
// P10/P11 flip it false (+ raise the cap) WITH operator confirm as the presence
// push begins. See verify/2026-06-16-PENDING-acquisition-lane-go-live.md.

import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTaskIfNew } from "../../src/sensors.ts";
import { getDatabase, type InsertTask } from "../../src/db.ts";
import {
  loadRelationships,
  ARC_USER_ID,
  type Relationship,
} from "../whop/lib/relationships.ts";

// RelationshipStore is not exported by relationships.ts; derive it structurally
// (same idiom as the whop reactive lane's queueReplyTask).
type RelationshipStore = ReturnType<typeof loadRelationships>;
import { composePitch } from "./lib/compose.ts";
import {
  loadOutreachLedger,
  saveOutreachLedger,
  enforceAcquisitionGate,
  recordPitch,
  nudgeExists,
  recordNudge,
  DAILY_PITCH_CAP,
  DEDUP_WINDOW_DAYS,
  GIVE_BEFORE_ASK,
  DEFAULT_OUTREACH_PATH,
  type OutreachLedger,
} from "./lib/enforcement.ts";
import {
  loadLeadStore,
  refreshLeads,
  ADVISOR_USER_IDS,
  type ForumFetcher,
} from "./lib/lead-source.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "whop-sales-acquisition";
// Lean cadence: a 12h interval pairs with the ≤2/day cap to keep the account
// high-signal (the quest's anti-slop steer). Tunable up in P10/P11.
const INTERVAL_MINUTES = 720;

// Default DRY_RUN: compose-for-review, never auto-post. P10/P11 flip to false.
// (Bun.env.<FLAG> !== "false" — the convention the sibling whop sensor uses.)
const WHOP_SALES_DRY_RUN = Bun.env.WHOP_SALES_DRY_RUN !== "false";

// Up-ladder self-selection → the operator handles personally (L3/L4 are
// relationship-gated; SKILL.md: "don't improvise pricing"). Everything else is
// an autonomous $49 (L1) pitch from arc0btc.
const OPERATOR_LANE_RE = /\b(run (my|our) own agent|b2b|enterprise|our team|my team|operators?|white[- ]?label|reseller)\b/i;

// Identities that must NEVER be surfaced as sales leads: Arc itself and the
// operator (whoabuddy) — they live in the room but are not prospects. The live
// lane confirmed the operator WOULD otherwise be pitched (he chats in the room
// and isn't a `whop_event_log` "member"). Future internal/team agents (e.g. the
// dev-council Arc plans to onboard) get added here, not pitched.
const OPERATOR_USER_ID = "user_WQ6WyvnFOZ6bY"; // whoabuddy (Whop user id)
const NON_PROSPECT_USER_IDS = new Set<string>([ARC_USER_ID, OPERATOR_USER_ID, ...ADVISOR_USER_IDS]);

const log = createSensorLogger(SENSOR_NAME);

export type Route = "arc-auto" | "operator-manual";

export interface Candidate {
  lead_id: string;
  username: string | null;
  cls: "A" | "B" | "C";
  value_touches: number; // arc_replies_to_them — value Arc gave first
  signal: string; // what the lead actually did (cite-able)
  route: Route;
  channel: string; // x | forum — drives the link, the skills, and the post venue
  reply_to_msg_id: string | null; // the room message to reply to (forum venue)
}

export interface LaneSummary {
  ran_at: string;
  dry_run: boolean;
  cap: { daily_pitch_cap: number; dedup_window_days: number; give_before_ask: number };
  candidates_seen: number;
  queued: Array<{
    lead_id: string;
    username: string | null;
    cls: string;
    channel: string;
    route: Route;
    element: string;
    task_id: number | null;
    body: string;
    first_reply: string;
  }>;
  blocked: Array<{ lead_id: string; username: string | null; reasons: string[] }>;
  nudges_queued: Array<{ member_id: string; day: "d1" | "d5"; scheduled_for: string; task_id: number | null }>;
  arc_auto_count: number;
  operator_manual_count: number;
  artifact_path: string | null;
}

// ---- Lead source + classification -------------------------------------------

/**
 * The PRODUCTION lead source. The acquisition target is NON-members who engaged
 * Arc on FREE / PUBLIC surfaces — the free public forum (exp_YRtS3kgMVeBGzu), X
 * (@arc0btc), and the blog — per SKILL.md §Lead Identification.
 *
 * The paid-room relationship store (db/whop-relationships.json) is DELIBERATELY
 * NOT used: it tracks the gated paid chat, so everyone in it has already paid (or
 * is Arc / the operator) — zero acquisition prospects. Pitching a $49 membership
 * to someone already inside the paid room is incoherent.
 *
 * Tracking non-member engagement on the free/public surfaces is a P10 wiring
 * (Presence & audience-building — it also owns the audience map + the channels).
 * Until it lands, this returns no leads, so the live lane is a correct NO-OP
 * rather than mis-targeting members. Fixtures inject `deps.relationships` (a
 * non-member lead set) directly to prove the gate/compose/route machinery.
 */
function defaultLeadSource(): RelationshipStore {
  // P10B: the non-member lead source is the free-forum engagement store
  // (db/whop-leads.json), refreshed at the top of each lane tick — see the
  // refresh in runAcquisitionLane. The paid-room store is DELIBERATELY not used
  // (see the doc comment above). Empty until a non-member engages on the forum.
  const store = loadLeadStore();
  log(`lead source: free-forum store — ${Object.keys(store.users).length} known non-member lead(s).`);
  return store;
}

/** Pull cite-able recent activity (+ the message to reply to) from an engagement record. */
function leadSignal(rel: Relationship): { signal: string; msgId: string | null } {
  const lastUser = [...rel.recent_interactions].reverse().find((i) => i.direction === "from_user");
  if (lastUser) return { signal: `engaged Arc: "${lastUser.snippet}"`, msgId: lastUser.msg_id };
  return { signal: `engaged Arc ${rel.message_count}× without replying`, msgId: null };
}

/**
 * Pure classifier: turn an engagement store of NON-member prospects into ranked
 * leads, A→B→C — EXCLUDING Arc, the operator, and any paying member (defence in
 * depth; the source itself must already be non-members). Class A = replied to Arc
 * ≥2× (warm); B = ≥3 messages (passive reader); C = rest. The CALLER supplies the
 * source: production uses `defaultLeadSource()` (free-forum/X non-member engagers,
 * a P10 wiring — empty today); fixtures inject a store. Each lead's `channel` is
 * its reachable venue (free public forum → "forum"; X → "x").
 */
export function surfaceLeads(store: RelationshipStore, memberIds: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const rel of Object.values(store.users)) {
    if (NON_PROSPECT_USER_IDS.has(rel.user_id)) continue; // Arc + operator: never a lead
    if (ADVISOR_USER_IDS.has(rel.user_id)) continue; // advisors — live set, catches ids added after module load (cairn #3)
    if (memberIds.has(rel.user_id)) continue; // never pitch a paying member
    if (rel.message_count < 1) continue;
    const cls: "A" | "B" | "C" =
      rel.their_replies_to_arc >= 2 ? "A" : rel.message_count >= 3 ? "B" : "C";
    const { signal, msgId } = leadSignal(rel);
    const route: Route = OPERATOR_LANE_RE.test(signal) ? "operator-manual" : "arc-auto";
    out.push({
      lead_id: rel.user_id,
      username: rel.username,
      cls,
      value_touches: rel.arc_replies_to_them,
      signal,
      route,
      channel: "forum", // free public-forum engager default; P10's source sets "x" for X repliers
      reply_to_msg_id: msgId,
    });
  }
  const order = { A: 0, B: 1, C: 2 };
  out.sort((a, b) => order[a.cls] - order[b.cls] || b.value_touches - a.value_touches);
  return out;
}

// ---- Production DB reads (injectable for fixtures) --------------------------

function membershipEntityId(source: string): string {
  // event source PK = whop-evt:membership:<id>:<status> → strip the status suffix
  return source.replace(/:[^:]+$/, "");
}

/** Pull the Whop USER id(s) carried in a membership event payload (data.user.id /
 * data.member.id — events.ts stores `JSON.stringify(event.data)`). Returns every
 * id present: leads are keyed by data.user.id (user_xxx), so that one is the
 * exclusion that matters; data.member.id is added too and is simply inert if it
 * never matches a forum user id. Robust to payload-shape uncertainty (no member
 * rows exist yet to introspect). */
export function memberUserIdsFromPayload(payload: string | null): string[] {
  if (!payload) return [];
  try {
    const data = JSON.parse(payload) as { user?: { id?: string }; member?: { id?: string } };
    const out: string[] = [];
    if (data.user?.id) out.push(data.user.id);
    if (data.member?.id) out.push(data.member.id);
    return out;
  } catch {
    return [];
  }
}

/**
 * Active members' WHOP USER IDs (not membership-entity ids). The lead store keys
 * leads by Whop user id, so the surface-time member exclusion MUST compare in the
 * same id space — we resolve each active membership to the user id in its event
 * payload. (Dev-council cairn #1: membership-entity id and user id are different
 * namespaces; comparing them never matches, so a paying member who posts on the
 * free forum would otherwise leak into the pitch queue. This is the go-live
 * member-namespace check made correct.) Latest lifecycle event per entity wins.
 */
export function readActiveMemberIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const db = getDatabase();
    const rows = db
      .query(
        `SELECT source, type, payload FROM whop_event_log
         WHERE type IN ('membership.activated','membership.deactivated')
         ORDER BY recorded_at ASC`,
      )
      .all() as Array<{ source: string; type: string; payload: string | null }>;
    const latest = new Map<string, { type: string; payload: string | null }>();
    for (const r of rows) latest.set(membershipEntityId(r.source), { type: r.type, payload: r.payload });
    for (const { type, payload } of latest.values()) {
      if (type !== "membership.activated") continue;
      for (const uid of memberUserIdsFromPayload(payload)) ids.add(uid);
    }
  } catch (error) {
    log(`active-member read skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return ids;
}

export interface Activation {
  member_id: string;
  activated_at: string; // ISO8601
}

/** Recent membership activations (last 7d) for the onboarding-nudge pass. */
function readRecentActivations(now: Date): Activation[] {
  const out: Activation[] = [];
  try {
    const db = getDatabase();
    const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db
      .query(
        `SELECT source, recorded_at FROM whop_event_log
         WHERE type = 'membership.activated' AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
      )
      .all(sinceIso) as Array<{ source: string; recorded_at: string }>;
    for (const r of rows) out.push({ member_id: membershipEntityId(r.source), activated_at: r.recorded_at });
  } catch (error) {
    log(`activation read skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return out;
}

// ---- Task builders (a dispatched session does the actual posting) -----------

function buildPitchTask(c: Candidate, channel: string, body: string, firstReply: string): InsertTask {
  const opFlag = c.route === "operator-manual" ? "[OPERATOR-MANUAL] " : "";
  const isX = channel === "x";
  // Skills scoped to the POST VENUE so the dispatched session loads only what it
  // needs: the X lane loads social-x-posting; the room/forum lane loads whop
  // (reply-chat). Both carry whop-sales (doctrine) + arc-brand-voice (voice).
  const skills = isX
    ? ["whop-sales", "social-x-posting", "arc-brand-voice"]
    : ["whop-sales", "whop", "arc-brand-voice"];

  let postBlock: string;
  if (c.route === "operator-manual") {
    postBlock = [
      "ROUTE: OPERATOR-MANUAL — do NOT auto-post. This lead self-selected up-ladder (L3/L4),",
      "which is relationship-gated. Flag for whoabuddy to handle from their own account; the",
      "lane composed the below as a starting point only. Close completed with the draft in the summary.",
    ].join("\n");
  } else if (isX) {
    postBlock = [
      "ROUTE: ARC-AUTO (arc0btc X) — post the BODY, then the FIRST REPLY (the attributed CTA +",
      "FREEMONTH + any proof) as a reply beneath it (in-body links cut reach 50–90%; P3 rev #1):",
      `  arc skills run --name social-x-posting -- post --text "<body>" --source quest:gtm:recurring:acquisition:${c.lead_id}`,
      `  arc skills run --name social-x-posting -- reply --tweet-id <id> --text "<first_reply>"`,
      "The social-x-posting CLI re-checks BUDGET_LIMITS.posts at post time (hard daily X cap).",
    ].join("\n");
  } else {
    // FREE public-forum venue (exp_YRtS3kgMVeBGzu — discovery surface non-members
    // can see; NOT the paid chat, and on-Whop so links aren't reach-suppressed):
    // reply to their free-forum post with the value, then a follow-up carrying the
    // CTA + FREEMONTH. (P10's lead source finalizes the exact post id / command.)
    const to = c.reply_to_msg_id ?? "<their_free_forum_post_id>";
    postBlock = [
      "ROUTE: ARC-AUTO (FREE public forum, exp_YRtS3kgMVeBGzu) — reply to their post with the BODY,",
      "then a follow-up carrying the attributed CTA + FREEMONTH (ask stays out of the first message):",
      `  arc skills run --name whop -- post-forum --experience exp_YRtS3kgMVeBGzu --parent ${to} --content "<body>"`,
      `  arc skills run --name whop -- post-forum --experience exp_YRtS3kgMVeBGzu --parent ${to} --content "<first_reply>"`,
      "Never pitch inside the PAID room (those people already paid). Idempotency: confirm not already pitched.",
    ].join("\n");
  }

  return {
    subject: `${opFlag}Whop-sales pitch (${c.cls}, ${channel}) to ${c.username ?? c.lead_id}`,
    description: [
      `Lead class: ${c.cls} (${c.route}). Channel: ${channel}.`,
      `Signal: ${c.signal}`,
      "",
      "Composed pitch (Arc refines wording per SOUL.md — this is the doctrine scaffold):",
      "BODY (no link):",
      "```",
      body,
      "```",
      "FIRST REPLY (attributed CTA + FREEMONTH + proof):",
      "```",
      firstReply,
      "```",
      "",
      "Voice bar: add information / make them want to respond. One ask only. Defer beats filler.",
      "SENTIMENT GATE: if their engagement was critical, skeptical, or negative toward Arc, do NOT pitch —",
      "close completed as 'skip: negative-sentiment lead' (pitching a critic is the highest-risk public move).",
      "Proceed only if the engagement reads neutral or positive.",
      postBlock,
    ].join("\n"),
    skills: JSON.stringify(skills),
    priority: 5,
    model: "sonnet",
    // Quest-mandated cross-cutting attribution source (PHASES.md P9:
    // `--source quest:gtm:recurring:acquisition`), per-lead-suffixed for dedup —
    // intentionally NOT the `sensor:<name>:<id>` prefix the other lanes use.
    source: `quest:gtm:recurring:acquisition:${c.lead_id}`,
  };
}

function buildNudgeTask(memberId: string, day: "d1" | "d5", scheduledFor: string): InsertTask {
  const prompt =
    day === "d1"
      ? 'Day-1 ship-log onboarding nudge. Hand the new member ONE low-friction first-ship-log prompt: "What are you shipping this week? Drop it on the board with the receipt." Spectator → co-author — this is the retention engine, not Arc content.'
      : "Day-5 fallback nudge — ONLY if the member has still posted no ship-log. One light follow-up, then stop (no spirals).";
  return {
    subject: `Onboarding ship-log nudge (${day}) → member ${memberId}`,
    description: [
      `New member: ${memberId}. ${prompt}`,
      "",
      "Post the nudge in the paid room (welcoming, specific, one ask). If they have already",
      "shipped, close completed with 'already shipped — no nudge needed'.",
      `  arc skills run --name whop -- post-chat --content "<markdown>"`,
    ].join("\n"),
    skills: JSON.stringify(["whop", "arc-brand-voice"]),
    priority: 4,
    model: "sonnet",
    scheduled_for: scheduledFor,
    source: `quest:gtm:recurring:onboarding-nudge:${memberId}:${day}`,
  };
}

// ---- Artifact ---------------------------------------------------------------

const ARTIFACT_RETENTION = 50; // keep the newest N tick artifacts (disk hygiene)

function writeArtifact(summary: LaneSummary): string | null {
  try {
    const dir = "db/whop-sales-artifacts";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = `${dir}/${summary.ran_at.replace(/[:.]/g, "-")}.json`;
    writeFileSync(path, JSON.stringify(summary, null, 2) + "\n", "utf8");
    // Retention: timestamped filenames sort lexicographically by age — drop the oldest
    // beyond ARTIFACT_RETENTION so the dir doesn't grow unbounded (council P9: lumen #2).
    const kept = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - ARTIFACT_RETENTION))) {
      try { unlinkSync(join(dir, old)); } catch { /* best-effort */ }
    }
    return path;
  } catch (error) {
    log(`artifact write skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ---- The lane (testable: every dep is injectable) ---------------------------

export interface LaneDeps {
  // (The interval gate lives in the default-export sensor wrapper; tick-acquisition
  // and the verify bypass it simply by calling runAcquisitionLane directly — the
  // same way the whop lane's tick-* commands call poll* directly. No `force` flag.)
  now?: Date;
  relationships?: RelationshipStore;
  /** Inject a forum fetcher (fixtures); default fetches the live free forum. */
  leadFetcher?: ForumFetcher;
  /** Skip the free-forum lead refresh (e.g. a fixture exercising only the gate). */
  skipLeadRefresh?: boolean;
  memberIds?: Set<string>;
  activations?: Activation[];
  ledgerPath?: string;
  dryRun?: boolean;
  /** Inject to capture queued tasks in the verify; default dedups by source into the DB. */
  queue?: (task: InsertTask) => number | null;
  writeArtifact?: boolean;
}

export async function runAcquisitionLane(deps: LaneDeps = {}): Promise<LaneSummary> {
  const now = deps.now ?? new Date();
  const dryRun = deps.dryRun ?? WHOP_SALES_DRY_RUN;
  const ledgerPath = deps.ledgerPath ?? DEFAULT_OUTREACH_PATH;
  // Refresh the free-forum lead store before surfacing (read-only — safe in
  // DRY_RUN). Skipped when a fixture injects `relationships`. Best-effort: a
  // missing key / fetch failure leaves the store intact and the lane runs on the
  // leads already known.
  if (!deps.relationships && !deps.skipLeadRefresh) {
    const apiKey = (await getCredential("whop", "company_api_key")) || null;
    const refreshResult = await refreshLeads({ apiKey, fetcher: deps.leadFetcher, log });
    log(`lead refresh: fetched=${refreshResult.fetched_posts} touched=${refreshResult.touched} total=${refreshResult.total_leads}`);
  }
  const store = deps.relationships ?? defaultLeadSource(); // NOT the paid-room store — see defaultLeadSource
  const memberIds = deps.memberIds ?? readActiveMemberIds();
  const activations = deps.activations ?? readRecentActivations(now);
  const queue = deps.queue ?? ((t: InsertTask) => insertTaskIfNew(t.source!, t));
  const ledger: OutreachLedger = loadOutreachLedger(ledgerPath);

  const summary: LaneSummary = {
    ran_at: now.toISOString(),
    dry_run: dryRun,
    cap: { daily_pitch_cap: DAILY_PITCH_CAP, dedup_window_days: DEDUP_WINDOW_DAYS, give_before_ask: GIVE_BEFORE_ASK },
    candidates_seen: 0,
    queued: [],
    blocked: [],
    nudges_queued: [],
    arc_auto_count: 0,
    operator_manual_count: 0,
    artifact_path: null,
  };

  // 1. Pitch pass.
  const candidates = surfaceLeads(store, memberIds);
  summary.candidates_seen = candidates.length;
  for (const c of candidates) {
    const channel = c.channel; // set per lead-source venue (forum today; x in P10)
    const pitch = composePitch({ cls: c.cls, signal: c.signal, name: c.username ?? undefined, channel });
    if (!pitch.ok) {
      summary.blocked.push({ lead_id: c.lead_id, username: c.username, reasons: [`compose-error: ${pitch.error}`] });
      continue;
    }
    const gate = enforceAcquisitionGate(
      {
        lead_id: c.lead_id,
        username: c.username,
        value_touches: c.value_touches,
        claim_shaped: pitch.proof_required, // claim-shaped w/o proof (lane composes proof-less)
        has_proof: false,
      },
      ledger,
      now,
    );
    const reasons = [...gate.blocks];
    if (!pitch.never_say_clean) reasons.push(`never-say: ${pitch.never_say_hits.join(", ")}`);
    if (reasons.length > 0) {
      summary.blocked.push({ lead_id: c.lead_id, username: c.username, reasons });
      continue;
    }

    // Eligible → queue (live) or compose-only (dry-run). Unlike the whop reactive
    // lane (which always queues a [DRY-RUN] task), this lane DELIBERATELY does not
    // queue in dry-run: it composes into the artifact/ledger for review and spends
    // ZERO dispatch sessions before traffic (instrument-before-traffic; the cap +
    // posting turn on together in P10/P11 with operator confirm).
    const task = buildPitchTask(c, channel, pitch.composed_pitch.body, pitch.composed_pitch.first_reply);
    // Live auto-post is gated to the warmest, consent-clearest leads: Class A
    // (replied to Arc >=2x) on the arc-auto route. B/C and operator-manual leads
    // are composed for review but NEVER auto-queued at strangers — even after the
    // DRY_RUN flip — until Class A's reply/sentiment signal proves the shape.
    // (Dev-council lumen #1/#2: a thin "just posted" signal, or someone else's
    // AMA-commenter, is the slop/forum-farming risk this audience punishes.)
    const autoPostEligible = c.route === "arc-auto" && c.cls === "A";
    const taskId = !dryRun && autoPostEligible ? queue(task) : null;
    recordPitch(ledger, {
      lead_id: c.lead_id,
      username: c.username,
      pitched_at: now.toISOString(),
      channel,
      route: c.route,
      source: task.source!,
      proof: null,
      task_id: taskId,
      dry_run: dryRun,
    });
    summary.queued.push({
      lead_id: c.lead_id,
      username: c.username,
      cls: c.cls,
      channel,
      route: c.route,
      element: pitch.pitch_element_used,
      task_id: taskId,
      body: pitch.composed_pitch.body,
      first_reply: pitch.composed_pitch.first_reply,
    });
    if (c.route === "arc-auto") summary.arc_auto_count++;
    else summary.operator_manual_count++;
  }

  // 2. Onboarding-nudge pass (P5 rev C). Day-1 / day-5 ship-log nudge per new member.
  for (const act of activations) {
    const base = Date.parse(act.activated_at);
    for (const day of ["d1", "d5"] as const) {
      if (nudgeExists(ledger, act.member_id, day)) continue;
      const offsetMs = (day === "d1" ? 1 : 5) * 24 * 60 * 60 * 1000;
      const scheduledMs = (Number.isNaN(base) ? now.getTime() : base) + offsetMs;
      // Don't fire a STALE onboarding nudge: the 7-day activation lookback can
      // surface a member whose d1 (or d5) offset already passed — a back-dated
      // "what are you shipping this week?" would dispatch immediately. Skip it; the
      // onboarding window for that day is gone. (council P9: correctness — cairn #1.)
      if (scheduledMs <= now.getTime()) continue;
      const scheduledFor = new Date(scheduledMs).toISOString();
      const task = buildNudgeTask(act.member_id, day, scheduledFor);
      const taskId = dryRun ? null : queue(task);
      recordNudge(ledger, {
        member_id: act.member_id,
        day,
        queued_at: now.toISOString(),
        source: task.source!,
        task_id: taskId,
        dry_run: dryRun,
      });
      summary.nudges_queued.push({ member_id: act.member_id, day, scheduled_for: scheduledFor, task_id: taskId });
    }
  }

  saveOutreachLedger(ledger, ledgerPath);
  if (deps.writeArtifact ?? true) summary.artifact_path = writeArtifact(summary);

  log(
    `tick: candidates=${summary.candidates_seen} queued=${summary.queued.length} ` +
      `(arc-auto=${summary.arc_auto_count} operator=${summary.operator_manual_count}) ` +
      `blocked=${summary.blocked.length} nudges=${summary.nudges_queued.length} dry_run=${dryRun}`,
  );
  return summary;
}

// ---- Default export: the self-gated sensor ----------------------------------

export default async function whopSalesAcquisitionSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";
  await runAcquisitionLane();
  return "ok";
}
