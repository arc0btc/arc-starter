// Source-artifact pool — the substrate for context-aware Arc conversations.
//
// Producers (arxiv-distill, council-distill, watch-interior-distill) write
// short distilled "nuggets" as ISO8601-stamped JSON files. The index
// (distilled_artifacts table) makes "newest N of type X not yet consumed by
// channel Y" a single fast query for consumer sensors (blog draft, paid-room
// synthesis, reactive replies, X cadence beats).
//
// The on-disk file under artifacts/distilled/<type>/<basename>.json is the
// source of truth; the index is a queryable view. Vacuum sweeps both.
//
// This is intentionally NOT consolidated with skills/whop/lib/artifacts.ts,
// which writes audit-of-output JSON (different concern). Only the basename
// helper (isoBasic) is shared via src/iso8601.ts.

import {
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";

import { getDatabase } from "./db.ts";
import { isoBasic } from "./iso8601.ts";

/** Top-level cross-skill resource directory. */
const ARTIFACT_ROOT = resolve(import.meta.dir, "../artifacts/distilled");

// ----- Types ----------------------------------------------------------------

/** Source types we distill. Producers add to this list; consumers exhaustively switch. */
export const ARTIFACT_TYPES = ["arxiv", "council", "watch-interior"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/**
 * Channel slugs aligned with skills/arc-brand-voice/CHANNELS.md voice cards,
 * plus "reactive" as a routing-only tag (no separate voice card — reactive
 * replies inherit whop-chat voice). The canonical list for routing only;
 * voice composition still defers to CHANNELS.md.
 */
export const ARTIFACT_CHANNELS = [
  "blog",
  "whop-chat",
  "whop-forum",
  "public-forum",
  "x",
  "nostr",
  "reactive",
] as const;
export type ArtifactChannel = (typeof ARTIFACT_CHANNELS)[number];

export interface DistilledArtifact {
  /** Basename minus .json — e.g. "2026-06-12T201500Z__agent-coordination". */
  id: string;
  type: ArtifactType;
  /** ISO8601 with colons (isoSeconds form). */
  produced_at: string;
  /** Path to the upstream source — e.g. "research/arxiv/2026-06-12T020713Z_arxiv_digest.md". */
  source_path: string;
  /** Slug, e.g. "agent-coordination" / "quantum-pqc" / "cost-surprise". */
  topic: string;
  title: string;
  /** ≤ 1200 chars — the distilled claim with direct quote + framing. */
  nugget: string;
  /** arxiv ID, council pattern name, watch-report timestamp, etc. */
  citation: string;
  suggested_channels: readonly ArtifactChannel[];
}

/** TTL constants live in code so a policy change applies to all rows immediately. */
export const TTL_DAYS_BY_TYPE = {
  arxiv: 14,
  council: 90,
  "watch-interior": 7,
} as const satisfies Record<ArtifactType, number>;

/** Hard-delete grace period after soft-delete (deleted_at set). */
const SOFT_DELETE_GRACE_DAYS = 14;

/** Orphan files older than this with no DB row get swept on vacuum. */
const ORPHAN_FILE_MAX_AGE_HOURS = 24;

// ----- Helpers --------------------------------------------------------------

interface DistilledRow {
  id: string;
  type: string;
  topic: string;
  produced_at: string;
  path: string;
  title: string;
  citation: string;
  suggested_channels: string;
  deleted_at: string | null;
}

/** Topic slug regex — lowercase ASCII + hyphens. Producers slugify before writing. */
function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Compose a basename from produced_at + topic, with optional collision suffix. */
function makeBasename(producedAt: Date, topic: string, suffix?: number): string {
  const slug = slugifyTopic(topic);
  const suff = suffix !== undefined ? `__${String(suffix).padStart(2, "0")}` : "";
  return `${isoBasic(producedAt)}__${slug}${suff}`;
}

/** Hydrate a DB row into the public type; throws on invalid JSON in suggested_channels. */
function rowToArtifact(row: DistilledRow): DistilledArtifact {
  const channels = JSON.parse(row.suggested_channels);
  if (!Array.isArray(channels)) {
    throw new Error(`distilled row ${row.id}: suggested_channels not an array`);
  }
  // We trust the channels are valid (producers go through writeDistilled which validates).
  return {
    id: row.id,
    type: row.type as ArtifactType,
    produced_at: row.produced_at,
    source_path: row.path,
    topic: row.topic,
    title: row.title,
    nugget: "",        // hydrated from disk on demand below
    citation: row.citation,
    suggested_channels: channels as readonly ArtifactChannel[],
  };
}

// ----- Public API -----------------------------------------------------------

/**
 * Write a distilled artifact to disk + index. Returns the assigned id.
 *
 * Crash-safety: writes to `<final>.tmp` then `renameSync` then INSERT OR IGNORE.
 * If two artifacts collide on (type, slugified topic, same second), a __NN
 * suffix is probed up to 99 before throwing.
 */
export function writeDistilled(input: Omit<DistilledArtifact, "id">): string {
  // Validate the input shape lightly — caller is producer code we control,
  // so this is shape-check not user-input sanitization.
  if (!ARTIFACT_TYPES.includes(input.type)) {
    throw new Error(`writeDistilled: invalid type ${input.type}`);
  }
  if (input.nugget.length > 1200) {
    throw new Error(`writeDistilled: nugget exceeds 1200 chars (${input.nugget.length})`);
  }
  for (const ch of input.suggested_channels) {
    if (!ARTIFACT_CHANNELS.includes(ch)) {
      throw new Error(`writeDistilled: invalid channel ${ch}`);
    }
  }
  if (!input.topic) throw new Error("writeDistilled: topic required");
  if (!input.citation) throw new Error("writeDistilled: citation required");

  const producedAtDate = new Date(input.produced_at);
  if (isNaN(producedAtDate.getTime())) {
    throw new Error(`writeDistilled: invalid produced_at ${input.produced_at}`);
  }

  const db = getDatabase();
  const typeDir = resolve(ARTIFACT_ROOT, input.type);
  mkdirSync(typeDir, { recursive: true });

  // Probe basename for collision in DB. Composite PK is (type, id) so we
  // only need to check our own type.
  let basename = makeBasename(producedAtDate, input.topic);
  let suffix: number | undefined;
  for (let probe = 0; probe < 100; probe++) {
    const candidate = probe === 0 ? basename : makeBasename(producedAtDate, input.topic, probe);
    const exists = db
      .query("SELECT 1 FROM distilled_artifacts WHERE type = ? AND id = ? LIMIT 1")
      .get(input.type, candidate);
    if (!exists) {
      basename = candidate;
      suffix = probe === 0 ? undefined : probe;
      break;
    }
    if (probe === 99) {
      throw new Error(`writeDistilled: cannot find free basename for ${input.type}/${input.topic}`);
    }
  }

  const path = join(typeDir, `${basename}.json`);
  const tmpPath = `${path}.tmp`;

  const onDisk: DistilledArtifact = { ...input, id: basename };
  writeFileSync(tmpPath, JSON.stringify(onDisk, null, 2) + "\n", "utf8");
  renameSync(tmpPath, path);

  db.query(
    `INSERT OR IGNORE INTO distilled_artifacts
       (id, type, topic, produced_at, path, title, citation, suggested_channels)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    basename,
    input.type,
    input.topic,
    input.produced_at,
    path,
    input.title,
    input.citation,
    JSON.stringify(input.suggested_channels),
  );

  return basename;
}

/**
 * Query the pool. `type` is required; everything else optional.
 *
 *   recentArtifacts("arxiv", { channel: "whop-chat", sinceHours: 24, limit: 2 })
 *
 * `channel` filter uses an anti-join against distilled_consumption — returns
 * only artifacts NOT yet consumed by that channel. Index-friendly via
 * idx_consumption_channel.
 *
 * Soft-deleted rows are excluded.
 *
 * Each row is hydrated from disk to recover the `nugget` text; corrupted JSON
 * files are logged and skipped (function returns the next valid row up to limit).
 */
export function recentArtifacts(
  type: ArtifactType,
  opts: {
    topic?: string;
    channel?: ArtifactChannel;
    sinceHours?: number;
    limit?: number;
  } = {},
): DistilledArtifact[] {
  const db = getDatabase();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);

  const where: string[] = ["a.type = ?", "a.deleted_at IS NULL"];
  const params: (string | number)[] = [type];

  if (opts.topic) {
    where.push("a.topic = ?");
    params.push(opts.topic);
  }
  if (opts.sinceHours !== undefined) {
    where.push(`a.produced_at >= datetime('now', '-' || ? || ' hours')`);
    params.push(opts.sinceHours);
  }

  let sql: string;
  if (opts.channel) {
    // Two filters on the channel:
    //   (a) anti-join — exclude rows already consumed by this channel
    //   (b) suggested_channels must include this channel (asymmetry guarantee:
    //       a watch-interior nugget tagged [whop-chat, reactive] never leaks
    //       into a blog or public-forum query). Quoted-LIKE is index-unfriendly
    //       at this scale but the row volume is ≤ 15/day so it's fine; revisit
    //       if the pool grows beyond ~1000 rows.
    sql = `
      SELECT a.*
      FROM distilled_artifacts a
      LEFT JOIN distilled_consumption c
        ON c.artifact_id = a.id AND c.channel = ?
      WHERE c.artifact_id IS NULL
        AND a.suggested_channels LIKE ?
        AND ${where.join(" AND ")}
      ORDER BY a.produced_at DESC
      LIMIT ?
    `;
    params.unshift(opts.channel, `%"${opts.channel}"%`);
  } else {
    sql = `
      SELECT a.*
      FROM distilled_artifacts a
      WHERE ${where.join(" AND ")}
      ORDER BY a.produced_at DESC
      LIMIT ?
    `;
  }
  params.push(limit);

  const rows = db.query(sql).all(...params) as DistilledRow[];

  // Hydrate each row from disk to recover the nugget text.
  const out: DistilledArtifact[] = [];
  for (const row of rows) {
    let hydrated: DistilledArtifact;
    try {
      hydrated = rowToArtifact(row);
    } catch (e) {
      console.error(`[artifacts] row ${row.id} index corrupt: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    try {
      if (!existsSync(row.path)) {
        console.error(`[artifacts] file missing for row ${row.id}: ${row.path}`);
        continue;
      }
      const json = readFileSync(row.path, "utf8");
      const parsed = JSON.parse(json) as { nugget?: unknown };
      if (typeof parsed?.nugget !== "string") {
        console.error(`[artifacts] file ${row.path}: missing or invalid nugget`);
        continue;
      }
      hydrated.nugget = parsed.nugget;
      out.push(hydrated);
    } catch (e) {
      console.error(`[artifacts] file ${row.path} corrupt: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
  }

  return out;
}

/**
 * Claim an artifact for a channel + task. Returns true if newly claimed,
 * false if (artifact_id, channel) was already recorded. Race-safe via PK.
 */
export function markConsumed(
  artifactId: string,
  artifactType: ArtifactType,
  channel: ArtifactChannel,
  taskId: number,
): boolean {
  const db = getDatabase();
  const result = db
    .query(
      `INSERT OR IGNORE INTO distilled_consumption
         (artifact_id, artifact_type, channel, task_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(artifactId, artifactType, channel, taskId);
  return result.changes > 0;
}

/**
 * Vacuum pass — soft-delete TTL'd rows, hard-delete rows past grace, sweep
 * orphan files. Safe to call repeatedly; each pass is independently idempotent.
 */
export function vacuumExpired(): { soft: number; hard: number; orphanFiles: number } {
  const db = getDatabase();
  let soft = 0;
  let hard = 0;
  let orphanFiles = 0;

  // 1. Soft-delete: mark rows older than TTL.
  for (const type of ARTIFACT_TYPES) {
    const ttl = TTL_DAYS_BY_TYPE[type];
    const result = db
      .query(
        `UPDATE distilled_artifacts
           SET deleted_at = datetime('now')
         WHERE type = ?
           AND deleted_at IS NULL
           AND produced_at < datetime('now', '-' || ? || ' days')`,
      )
      .run(type, ttl);
    soft += result.changes;
  }

  // 2. Hard-delete: rows past grace window. Get paths first so we can rm files.
  const toHardDelete = db
    .query(
      `SELECT type, id, path FROM distilled_artifacts
       WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', '-' || ? || ' days')`,
    )
    .all(SOFT_DELETE_GRACE_DAYS) as Pick<DistilledRow, "type" | "id" | "path">[];

  for (const row of toHardDelete) {
    try {
      if (existsSync(row.path)) rmSync(row.path);
    } catch (e) {
      console.error(`[artifacts] vacuum: failed to rm ${row.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    db.query("DELETE FROM distilled_artifacts WHERE type = ? AND id = ?").run(row.type, row.id);
    db.query("DELETE FROM distilled_consumption WHERE artifact_id = ?").run(row.id);
    hard++;
  }

  // 3. Orphan sweep: files on disk older than 24h with no row.
  const orphanCutoffMs = Date.now() - ORPHAN_FILE_MAX_AGE_HOURS * 60 * 60 * 1000;
  for (const type of ARTIFACT_TYPES) {
    const typeDir = resolve(ARTIFACT_ROOT, type);
    if (!existsSync(typeDir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(typeDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json") && !entry.endsWith(".json.tmp")) continue;
      const full = join(typeDir, entry);
      let mtimeMs: number;
      try {
        mtimeMs = statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (mtimeMs > orphanCutoffMs) continue; // too recent — might be mid-write
      // Strip .tmp if present, then strip .json to recover the candidate id.
      const candidate = entry.replace(/\.tmp$/, "").replace(/\.json$/, "");
      const row = db
        .query("SELECT 1 FROM distilled_artifacts WHERE type = ? AND id = ? LIMIT 1")
        .get(type, candidate);
      if (row) continue;
      try {
        rmSync(full);
        orphanFiles++;
      } catch (e) {
        console.error(`[artifacts] vacuum: failed to rm orphan ${full}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { soft, hard, orphanFiles };
}

/**
 * Render a set of artifacts as inline markdown for a task description, with a
 * hard byte cap. Throws if the rendered string would exceed `maxBytes` — caller
 * is responsible for picking a smaller subset.
 *
 * Format (one per artifact):
 *
 *   ### <title>
 *   _<topic> · <citation> · produced <produced_at>_
 *
 *   <nugget>
 */
export function renderInline(artifacts: readonly DistilledArtifact[], maxBytes: number): string {
  if (artifacts.length === 0) return "";
  const parts: string[] = [];
  for (const a of artifacts) {
    parts.push(
      `### ${a.title}\n_${a.topic} · ${a.citation} · produced ${a.produced_at}_\n\n${a.nugget}`,
    );
  }
  const text = parts.join("\n\n---\n\n");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new Error(
      `renderInline: ${bytes} bytes exceeds maxBytes ${maxBytes} (${artifacts.length} artifacts; trim caller-side)`,
    );
  }
  return text;
}

/** Total artifact count by type since N hours ago. For audit CLI / watch report. */
export function countByType(sinceHours: number): Record<ArtifactType, number> {
  const db = getDatabase();
  const counts = {} as Record<ArtifactType, number>;
  for (const type of ARTIFACT_TYPES) {
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM distilled_artifacts
         WHERE type = ?
           AND deleted_at IS NULL
           AND produced_at >= datetime('now', '-' || ? || ' hours')`,
      )
      .get(type, sinceHours) as { n: number };
    counts[type] = row?.n ?? 0;
  }
  return counts;
}

/** Consumed count per channel since N hours ago. */
export function countConsumedByChannel(sinceHours: number): Record<ArtifactChannel, number> {
  const db = getDatabase();
  const counts = {} as Record<ArtifactChannel, number>;
  for (const ch of ARTIFACT_CHANNELS) {
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM distilled_consumption
         WHERE channel = ?
           AND consumed_at >= datetime('now', '-' || ? || ' hours')`,
      )
      .get(ch, sinceHours) as { n: number };
    counts[ch] = row?.n ?? 0;
  }
  return counts;
}
