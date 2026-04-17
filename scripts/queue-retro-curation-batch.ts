#!/usr/bin/env bun
// scripts/queue-retro-curation-batch.ts
// Queues ONE 5-signal review task for a retro curation pass on Apr 5/6/7.
// Mirrors the original aibtc-news-editorial sensor design (BATCH_SIZE=10),
// just smaller batches and pulling from a backlog pool instead of the live
// `submitted` queue.
//
// State lives in db/payouts/track-b-curation-state-{date}.json:
//   { date, started_at, reviewed_ids[], batches_queued, completed }
// Each dispatched task is responsible for appending its 5 IDs to reviewed_ids
// after it finishes the batch.
//
// Usage:
//   bun run scripts/queue-retro-curation-batch.ts --date 2026-04-06
//   bun run scripts/queue-retro-curation-batch.ts --date 2026-04-06 --dry-run
//
// The script exits 0 (no-op) when the candidate pool for the date is exhausted,
// printing `complete` so a continuation task can detect "stop here".

import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const API_BASE = "https://aibtc.news/api";
const VOID_LOG = resolve(ROOT, "db/payouts/1a-void-execute-2026-04-14.log");
const STATE_DIR = resolve(ROOT, "db/payouts");
const BATCH_SIZE = 5;
const TASK_PRIORITY = 4;
const TASK_SKILLS = "aibtc-signal-review,aibtc-news-classifieds,bitcoin-wallet";
const DAILY_APPROVAL_CAP = 30;

// ---- Args ----

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

const flags = parseFlags(process.argv.slice(2));
const date = flags.date;
const dryRun = flags["dry-run"] === "true";

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: bun run scripts/queue-retro-curation-batch.ts --date YYYY-MM-DD [--dry-run]");
  process.exit(1);
}

// ---- State ----

interface CurationState {
  date: string;
  started_at: string;
  reviewed_ids: string[];
  batches_queued: number;
  completed: boolean;
}

function stateFile(d: string): string {
  return join(STATE_DIR, `track-b-curation-state-${d}.json`);
}

async function readState(d: string): Promise<CurationState> {
  const path = stateFile(d);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {
      date: d,
      started_at: new Date().toISOString(),
      reviewed_ids: [],
      batches_queued: 0,
      completed: false,
    };
  }
  return (await file.json()) as CurationState;
}

async function writeState(state: CurationState): Promise<void> {
  await Bun.write(stateFile(state.date), JSON.stringify(state, null, 2));
}

// ---- Candidate pool ----

interface Candidate {
  id: string;
  beat: string;
  beatSlug: string;
  displayName: string | null;
  headline: string;
  status: string;
  source: "void-log" | "orphan-approved";
}

interface ApiSignal {
  id: string;
  beat: string;
  beatSlug: string;
  displayName: string | null;
  headline: string | null;
  status: string;
}

async function fetchSignals(d: string, status: string): Promise<ApiSignal[]> {
  const url = `${API_BASE}/signals?date=${d}&status=${status}&limit=200`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`API ${url} returned ${resp.status}`);
  const body = (await resp.json()) as { signals?: ApiSignal[] };
  return body.signals ?? [];
}

interface VoidLogEntry {
  id: string;
  label: string;
}

async function parseVoidLogForDate(d: string): Promise<VoidLogEntry[]> {
  const text = await Bun.file(VOID_LOG).text();
  const lines = text.split("\n");
  const out: VoidLogEntry[] = [];
  let inDate = false;
  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i].match(/^--- Brief (\d{4}-\d{2}-\d{2}) ---$/);
    if (dateMatch) {
      inDate = dateMatch[1] === d;
      continue;
    }
    if (!inDate) continue;
    const idMatch = lines[i].match(/^\s*\[OK\] Rejected signal ([a-f0-9-]{36})\s*$/);
    if (idMatch) {
      const labelLine = lines[i + 1] ?? "";
      out.push({ id: idMatch[1], label: labelLine.trim() });
    }
  }
  return out;
}

async function buildCandidatePool(d: string): Promise<Candidate[]> {
  // Pool = (void-log originally-rejected) ∪ (currently-approved orphans).
  // We deliberately exclude:
  //   - status=rejected NOT in void log → legitimate historical rejections, leave alone
  //   - status=replaced → historical sensor displacements, already-decided
  //   - status=brief_included → frozen by inscription guard / prior compile
  const [voided, approved, rejected] = await Promise.all([
    parseVoidLogForDate(d),
    fetchSignals(d, "approved"),
    fetchSignals(d, "rejected"),
  ]);

  const voidedIdSet = new Set(voided.map((v) => v.id));
  const candidates: Candidate[] = [];

  for (const v of voided) {
    const live = rejected.find((r) => r.id === v.id) ?? approved.find((a) => a.id === v.id);
    candidates.push({
      id: v.id,
      beat: live?.beat ?? "(unknown)",
      beatSlug: live?.beatSlug ?? "(unknown)",
      displayName: live?.displayName ?? null,
      headline: live?.headline ?? v.label,
      status: live?.status ?? "rejected",
      source: "void-log",
    });
  }
  for (const a of approved) {
    if (voidedIdSet.has(a.id)) continue;
    candidates.push({
      id: a.id,
      beat: a.beat,
      beatSlug: a.beatSlug,
      displayName: a.displayName,
      headline: a.headline ?? "(no headline)",
      status: a.status,
      source: "orphan-approved",
    });
  }
  return candidates;
}

// ---- Roster snapshot ----

interface RosterEntry {
  id: string;
  beat: string;
  displayName: string | null;
  headline: string;
}

async function fetchRoster(d: string): Promise<{ count: number; entries: RosterEntry[]; brief_included: number }> {
  const [approved, briefIncluded] = await Promise.all([
    fetchSignals(d, "approved"),
    fetchSignals(d, "brief_included"),
  ]);
  const entries = approved.map((s) => ({
    id: s.id,
    beat: s.beat,
    displayName: s.displayName,
    headline: (s.headline ?? "(no headline)").slice(0, 80),
  }));
  return {
    count: approved.length + briefIncluded.length,
    entries,
    brief_included: briefIncluded.length,
  };
}

// ---- Task queueing ----

function queueTask(args: {
  subject: string;
  description: string;
  batchNumber: number;
}): { id: string | null; output: string } {
  const proc = Bun.spawnSync(
    [
      "bash", "bin/arc", "tasks", "add",
      "--subject", args.subject,
      "--description", args.description,
      "--priority", String(TASK_PRIORITY),
      "--skills", TASK_SKILLS,
      "--source", `script:retro-curation:${date}:batch-${args.batchNumber}`,
    ],
    { cwd: ROOT }
  );
  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  if (proc.exitCode !== 0) {
    throw new Error(`arc tasks add failed (exit ${proc.exitCode}): ${stderr || stdout}`);
  }
  if (/^Skipped:/m.test(stdout) || /^Skipped:/m.test(stderr)) {
    throw new Error(`arc tasks add silently skipped (dedup hit): ${stdout || stderr}`);
  }
  const idMatch = stdout.match(/#(\d+)/);
  if (!idMatch) {
    throw new Error(`arc tasks add produced no task id: ${stdout || stderr}`);
  }
  return { id: idMatch[1], output: stdout || stderr };
}

// ---- Main ----

async function main(): Promise<void> {
  const state = await readState(date);
  if (state.completed) {
    console.log(JSON.stringify({ status: "complete", date, message: "state file marked complete" }));
    return;
  }

  const candidates = await buildCandidatePool(date);
  const reviewedSet = new Set(state.reviewed_ids);
  const remaining = candidates.filter((c) => !reviewedSet.has(c.id));

  if (remaining.length === 0) {
    console.log(JSON.stringify({
      status: "complete",
      date,
      total_candidates: candidates.length,
      reviewed: state.reviewed_ids.length,
      batches_queued: state.batches_queued,
      message: "candidate pool exhausted — mark state.completed=true and proceed to compile",
    }));
    return;
  }

  const batch = remaining.slice(0, BATCH_SIZE);
  const roster = await fetchRoster(date);
  const rosterFull = roster.count >= DAILY_APPROVAL_CAP;
  const remainingSlots = Math.max(0, DAILY_APPROVAL_CAP - roster.count);
  const batchNumber = state.batches_queued + 1;
  const totalBatchesEst = Math.ceil(candidates.length / BATCH_SIZE);

  // Group displacement candidates by beat for the subagent's reference
  const rosterByBeat: Record<string, string[]> = {};
  for (const r of roster.entries) {
    rosterByBeat[r.beat] = rosterByBeat[r.beat] ?? [];
    rosterByBeat[r.beat].push(`    - ${r.id} | ${r.displayName ?? "(unknown)"} | ${r.headline}`);
  }
  const rosterSummary = Object.entries(rosterByBeat)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([beat, lines]) => `  ${beat} (${lines.length}):\n${lines.join("\n")}`)
    .join("\n\n");

  const batchList = batch
    .map((c, i) => `${i + 1}. ${c.id}\n   beat: ${c.beat}  | correspondent: ${c.displayName ?? "(unknown)"}  | source: ${c.source}  | current status: ${c.status}\n   headline: ${c.headline}`)
    .join("\n\n");

  const reviewMode = rosterFull
    ? `**ROSTER FULL — DISPLACEMENT MODE.** Cap is ${roster.count}/${DAILY_APPROVAL_CAP}. To approve any signal in this batch, you MUST pass --displace <weaker-roster-signal-id> in the same review-signal call. The displaced signal moves to status=replaced (non-punitive). Pick the weakest current roster entry for the same beat (or any beat if quality is clearly lower). Decent-but-not-exceptional new signals should be set to status=replaced (NOT rejected — they were editorially OK, just outranked).`
    : `**Roster has ${remainingSlots} slot(s) open** before displacement mode. Approve signals that meet editorial standards (use the 8-gate Publisher Review Flowchart from memory/topics/publishing.md). When the roster fills mid-batch, switch to displacement mode for any further approvals.`;

  const description = [
    `Retro curation batch ${batchNumber}/~${totalBatchesEst} for date ${date}.`,
    ``,
    `Pool: ${candidates.length} total candidates (originally-voided rejected + currently-approved orphans). This batch: ${batch.length}. Remaining after this batch: ${remaining.length - batch.length}.`,
    ``,
    `Current roster: ${roster.count}/${DAILY_APPROVAL_CAP} approved+brief_included for ${date} (brief_included locked: ${roster.brief_included}).`,
    ``,
    `${reviewMode}`,
    ``,
    `## Batch (${batch.length} signals)`,
    ``,
    batchList,
    ``,
    `## Current roster (${roster.entries.length} approved, by beat)`,
    ``,
    rosterSummary || "  (roster empty)",
    ``,
    `## Workflow`,
    ``,
    `For each signal in the batch:`,
    `1. Fetch full content: \`arc skills run --name aibtc-news-classifieds -- get-signal --id <id>\``,
    `2. Apply the 8-gate Publisher Review Flowchart (memory/topics/publishing.md)`,
    `3. Decision:`,
    `   - **Approve** (passes all gates, roster has room): \`arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status approved --no-notify\``,
    `   - **Approve via displacement** (passes gates but roster full): pick weakest roster entry, then \`arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status approved --displace <displaced-id> --no-notify\``,
    `   - **Replaced** (passes gates but outranked, not currently on roster): \`arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status replaced --no-notify\``,
    `   - **Rejected** (fails a gate — quality/relevance/structure): \`arc skills run --name aibtc-news-classifieds -- review-signal --id <id> --status rejected --feedback "<specific reason>" --no-notify\``,
    ``,
    `**ALWAYS pass --no-notify** — this is a retro for past dates; correspondents do not need new x402 messages about decisions on old signals.`,
    ``,
    `## After the batch`,
    ``,
    `1. Read state file: \`db/payouts/track-b-curation-state-${date}.json\``,
    `2. Append the 5 reviewed IDs to \`reviewed_ids\` array (do NOT increment batches_queued — the next queue script does that for you). Write back atomically (Bun.write with full JSON).`,
    `3. Queue the next batch: \`bun run scripts/queue-retro-curation-batch.ts --date ${date}\``,
    `   - If the script prints \`{"status":"complete",...}\`, set \`state.completed=true\` in the state file and DO NOT queue another batch.`,
    `   - If the script throws ("silently skipped" / "no task id" / "failed"), report it in your summary and STOP — do not silently succeed.`,
    `4. Exit with a one-line summary: \`Batch ${batchNumber} done — N approved, M displaced, K rejected, P replaced. Next: queued #<task-id> | complete.\``,
    ``,
    `## Hard rules`,
    ``,
    `- Never set status=submitted or in_review (those are pre-review states; not valid here).`,
    `- Never set status=brief_included (backend-only, set by compile).`,
    `- Never call review-signal WITHOUT --no-notify in this retro.`,
    `- Roster cap is global per UTC day (PR #500 buckets by created_at). Stay at or under 30 approved+brief_included for ${date} at all times.`,
    `- If you hit a 429 rate limit on the review endpoint, stop, note remaining IDs in the state file (NOT in reviewed_ids), and create a follow-up task with --scheduled-for set to the retry-after time.`,
  ].join("\n");

  const subject = `Retro curate ${date} batch ${batchNumber} [${roster.count}/${DAILY_APPROVAL_CAP}${rosterFull ? " DISPLACEMENT" : ` ${remainingSlots} open`}]`;

  if (dryRun) {
    console.log("--- DRY RUN ---");
    console.log("Subject:", subject);
    console.log("---");
    console.log(description);
    return;
  }

  const result = queueTask({ subject, description, batchNumber });
  state.batches_queued = batchNumber;
  await writeState(state);

  console.log(JSON.stringify({
    status: "queued",
    date,
    batch_number: batchNumber,
    task: result.output,
    pool_size: candidates.length,
    remaining_after: remaining.length - batch.length,
    roster_count: roster.count,
    roster_full: rosterFull,
  }, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
