/**
 * Learnings
 *
 * CRUD operations for the learnings table with FTS5 full-text search.
 * Learnings are structured knowledge accumulated across cycles.
 * Subject to consolidation before insert (FTS5 near-duplicate check).
 *
 * Area taxonomy (from Agent Zero patterns):
 * - main:      general agent knowledge from cycles and interactions
 * - fragments: partial or incomplete information
 * - solutions: solved problems and their approaches
 */

import { getDb } from "./db";
import { randomUUID } from "crypto";

/**
 * Learning area taxonomy
 */
export type LearningArea = "main" | "fragments" | "solutions";

/**
 * Learning source
 */
export type LearningSource = "cycle" | "interaction" | "operator" | "knowledge";

/**
 * Input for inserting a learning
 */
export interface LearningInput {
  content: string;
  area?: LearningArea;
  source?: LearningSource;
  tags?: string[];
  importance?: number;
  cycleNum?: number;
  isKnowledgeSource?: boolean;
  sourceFile?: string;
  sourceChecksum?: string;
}

/**
 * A learning record
 */
export interface LearningRow {
  id: string;
  content: string;
  area: LearningArea;
  source: LearningSource;
  tags: string[];
  importance: number;
  isKnowledgeSource: boolean;
  sourceFile: string | null;
  sourceChecksum: string | null;
  createdAt: string;
  updatedAt: string;
  cycleNum: number | null;
  consolidatedFrom: string[] | null;
  consolidationAction: string | null;
}

/**
 * FTS5 search result with BM25 score
 */
export interface LearningSearchResult extends LearningRow {
  bm25Score: number;
}

/**
 * Insert a new learning into the database.
 * Returns the new learning's ID.
 */
export function insertLearning(input: LearningInput): string {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO learnings (
      id, content, area, source, tags, importance,
      is_knowledge_source, source_file, source_checksum,
      created_at, updated_at, cycle_num
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.content,
    input.area ?? "main",
    input.source ?? "cycle",
    input.tags ? JSON.stringify(input.tags) : null,
    input.importance ?? 0.5,
    input.isKnowledgeSource ? 1 : 0,
    input.sourceFile ?? null,
    input.sourceChecksum ?? null,
    now,
    now,
    input.cycleNum ?? null
  );

  return id;
}

/**
 * Full-text search over learnings using FTS5 BM25 ranking.
 * Lower BM25 score = more relevant (SQLite FTS5 convention).
 *
 * Query formatting: each word in the query becomes a separate FTS5 token.
 * Terms are joined with AND semantics (all terms must appear).
 * Special FTS5 characters are stripped to avoid query syntax errors.
 */
export function searchLearnings(
  query: string,
  area?: LearningArea,
  count: number = 10
): LearningSearchResult[] {
  const db = getDb();

  // Build a safe FTS5 query: split on whitespace, wrap each token in double quotes,
  // join with space (implicit AND in FTS5). This avoids column:term misinterpretation
  // and special character errors from punctuation in user queries.
  const ftsQuery = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" ");

  let sql: string;
  let params: unknown[];

  if (area) {
    sql = `
      SELECT l.id, l.content, l.area, l.source, l.tags, l.importance,
             l.is_knowledge_source, l.source_file, l.source_checksum,
             l.created_at, l.updated_at, l.cycle_num,
             l.consolidated_from, l.consolidation_action,
             rank AS bm25_score
      FROM learnings_fts
      JOIN learnings l ON learnings_fts.rowid = l.rowid
      WHERE learnings_fts MATCH ? AND l.area = ?
      ORDER BY bm25_score
      LIMIT ?
    `;
    params = [ftsQuery, area, count];
  } else {
    sql = `
      SELECT l.id, l.content, l.area, l.source, l.tags, l.importance,
             l.is_knowledge_source, l.source_file, l.source_checksum,
             l.created_at, l.updated_at, l.cycle_num,
             l.consolidated_from, l.consolidation_action,
             rank AS bm25_score
      FROM learnings_fts
      JOIN learnings l ON learnings_fts.rowid = l.rowid
      WHERE learnings_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `;
    params = [ftsQuery, count];
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(mapLearningSearchRow);
}

/**
 * Get learnings ordered by importance, most important first.
 */
export function queryLearningsByImportance(
  area?: LearningArea,
  count: number = 20
): LearningRow[] {
  const db = getDb();

  let sql: string;
  let params: unknown[];

  if (area) {
    sql = `
      SELECT id, content, area, source, tags, importance,
             is_knowledge_source, source_file, source_checksum,
             created_at, updated_at, cycle_num,
             consolidated_from, consolidation_action
      FROM learnings
      WHERE area = ?
      ORDER BY importance DESC
      LIMIT ?
    `;
    params = [area, count];
  } else {
    sql = `
      SELECT id, content, area, source, tags, importance,
             is_knowledge_source, source_file, source_checksum,
             created_at, updated_at, cycle_num,
             consolidated_from, consolidation_action
      FROM learnings
      ORDER BY importance DESC
      LIMIT ?
    `;
    params = [count];
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(mapLearningRow);
}

/**
 * Map a raw SQLite row to a LearningRow
 */
function mapLearningRow(row: Record<string, unknown>): LearningRow {
  return {
    id: row.id as string,
    content: row.content as string,
    area: row.area as LearningArea,
    source: row.source as LearningSource,
    tags: row.tags ? (JSON.parse(row.tags as string) as string[]) : [],
    importance: row.importance as number,
    isKnowledgeSource: row.is_knowledge_source === 1,
    sourceFile: (row.source_file as string) ?? null,
    sourceChecksum: (row.source_checksum as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    cycleNum: (row.cycle_num as number) ?? null,
    consolidatedFrom: row.consolidated_from
      ? (JSON.parse(row.consolidated_from as string) as string[])
      : null,
    consolidationAction: (row.consolidation_action as string) ?? null,
  };
}

/**
 * Map a raw FTS5 search row to a LearningSearchResult
 */
function mapLearningSearchRow(row: Record<string, unknown>): LearningSearchResult {
  return {
    ...mapLearningRow(row),
    bm25Score: row.bm25_score as number,
  };
}
