// skills/whop/lib/artifacts.ts
//
// ISO8601-dated tick artifacts. Each sensor tick that does any work writes
// one JSON file at skills/whop/artifacts/<lane>/YYYY-MM-DDTHHMMSSZ.json so
// the audit-and-tune surface for whyReply/synthesis is on disk, not just in
// dispatch logs. Read these during Phase 0 dry-run audit.
//
// Design rationale: skills/whop/POLLING-DESIGN.md → "ISO8601 artifacts".

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { isoBasic } from "../../../src/iso8601.ts";

const ARTIFACT_ROOT = resolve(import.meta.dir, "../artifacts");

export type Lane = "replies" | "synthesis" | "free-forum";

/** ISO8601 basic-form basename with trailing Z (2026-06-12T201500Z). */
export const artifactBasename = isoBasic;

export function writeArtifact(lane: Lane, payload: unknown): string {
  const dir = resolve(ARTIFACT_ROOT, lane);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${artifactBasename()}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return path;
}
