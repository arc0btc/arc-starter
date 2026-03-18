/**
 * Project scratchpad — a shared context buffer for multi-subtask work.
 *
 * Lives at db/projects/<root_task_id>.md as a working buffer that accumulates
 * findings across a task family (parent + all descendants). Clears when the
 * root parent task closes.
 *
 * Not persistent memory — a temporary workspace scoped to a task tree.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTaskById } from "./db.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PROJECTS_DIR = join(ROOT, "db", "projects");

/** Walk up the parent chain to find the root task ID for a task family. */
export function resolveRootTaskId(taskId: number): number {
  let currentId = taskId;
  let depth = 0;

  while (depth < 10) {
    const task = getTaskById(currentId);
    if (!task || !task.parent_id) return currentId;
    currentId = task.parent_id;
    depth++;
  }

  return currentId;
}

function scratchpadPath(rootTaskId: number): string {
  return join(PROJECTS_DIR, `${rootTaskId}.md`);
}

function ensureProjectsDir(): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
}

/** Read the scratchpad for a task family. Returns empty string if none exists. */
export function readScratchpad(taskId: number): string {
  const rootId = resolveRootTaskId(taskId);
  const path = scratchpadPath(rootId);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

/** Overwrite the scratchpad for a task family. */
export function writeScratchpad(taskId: number, content: string): void {
  const rootId = resolveRootTaskId(taskId);
  ensureProjectsDir();
  writeFileSync(scratchpadPath(rootId), content);
}

/** Append to the scratchpad for a task family. Adds a separator between entries. */
export function appendScratchpad(taskId: number, entry: string): void {
  const rootId = resolveRootTaskId(taskId);
  ensureProjectsDir();
  const path = scratchpadPath(rootId);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";

  const separator = existing.trim() ? "\n\n---\n\n" : "";
  writeFileSync(path, existing + separator + entry);
}

/** Delete the scratchpad for a task family. */
export function clearScratchpad(taskId: number): void {
  const rootId = resolveRootTaskId(taskId);
  const path = scratchpadPath(rootId);
  try {
    unlinkSync(path);
  } catch {
    // file may not exist — that's fine
  }
}

/** Check if a scratchpad exists for a task family. */
export function hasScratchpad(taskId: number): boolean {
  const rootId = resolveRootTaskId(taskId);
  return existsSync(scratchpadPath(rootId));
}

/**
 * Resolve scratchpad context for injection into dispatch prompt.
 * Returns formatted content string or empty string if no scratchpad exists.
 */
export function resolveScratchpadContext(taskId: number): string {
  const content = readScratchpad(taskId);
  if (!content.trim()) return "";

  const rootId = resolveRootTaskId(taskId);
  return `# Project Scratchpad (task family #${rootId})\n` +
    `*Working buffer shared across subtasks. Append findings with: arc scratchpad append --task ${taskId} --content "..."*\n\n` +
    content;
}
