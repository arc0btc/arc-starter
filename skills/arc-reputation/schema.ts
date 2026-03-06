// skills/arc-reputation/schema.ts
// Signed peer review storage schema.
// Reviews are BIP-137-signed JSON documents stored locally in SQLite.

import { Database } from "bun:sqlite";
import { initDatabase } from "../../src/db";

// ---- Types ----

/** The canonical review payload that gets signed. */
export interface ReviewPayload {
  version: 1;
  subject: string;
  reviewer_address: string;
  reviewee_address: string;
  rating: number;
  comment: string;
  tags: string[];
  created_at: string;
}

/** A stored review with signature and metadata. */
export interface Review {
  id: number;
  subject: string;
  reviewer_address: string;
  reviewee_address: string;
  rating: number;
  comment: string;
  tags: string;
  signature: string;
  message_hash: string;
  created_at: string;
}

export interface InsertReview {
  subject: string;
  reviewer_address: string;
  reviewee_address: string;
  rating: number;
  comment: string;
  tags: string[];
  signature: string;
  message_hash: string;
}

// ---- Schema initialization ----

let _initialized = false;

export function initReputationSchema(db?: Database): Database {
  const d = db ?? initDatabase();
  if (_initialized) return d;

  d.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      subject TEXT NOT NULL,
      reviewer_address TEXT NOT NULL,
      reviewee_address TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      signature TEXT NOT NULL,
      message_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run("CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_address)");
  d.run("CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_address)");
  d.run("CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating)");

  _initialized = true;
  return d;
}

// ---- Canonical message format ----

/** Build the canonical JSON string that gets BIP-137-signed. */
export function buildSignableMessage(payload: ReviewPayload): string {
  return JSON.stringify({
    version: payload.version,
    subject: payload.subject,
    reviewer_address: payload.reviewer_address,
    reviewee_address: payload.reviewee_address,
    rating: payload.rating,
    comment: payload.comment,
    tags: payload.tags,
    created_at: payload.created_at,
  });
}

// ---- Queries ----

export function insertReview(fields: InsertReview): number {
  const db = initReputationSchema();
  const result = db.query(`
    INSERT INTO reviews (subject, reviewer_address, reviewee_address, rating, comment, tags, signature, message_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.subject,
    fields.reviewer_address,
    fields.reviewee_address,
    fields.rating,
    fields.comment,
    JSON.stringify(fields.tags),
    fields.signature,
    fields.message_hash,
  );
  return Number(result.lastInsertRowid);
}

export function getReviewById(id: number): Review | null {
  const db = initReputationSchema();
  return db.query("SELECT * FROM reviews WHERE id = ?").get(id) as Review | null;
}

export function getReviewsByReviewee(address: string): Review[] {
  const db = initReputationSchema();
  return db.query(
    "SELECT * FROM reviews WHERE reviewee_address = ? ORDER BY created_at DESC"
  ).all(address) as Review[];
}

export function getReviewsByReviewer(address: string): Review[] {
  const db = initReputationSchema();
  return db.query(
    "SELECT * FROM reviews WHERE reviewer_address = ? ORDER BY created_at DESC"
  ).all(address) as Review[];
}

export function getAllReviews(limit: number = 50): Review[] {
  const db = initReputationSchema();
  return db.query(
    "SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Review[];
}

export function getReputationSummary(address: string): {
  total_reviews: number;
  average_rating: number;
  min_rating: number;
  max_rating: number;
} | null {
  const db = initReputationSchema();
  const row = db.query(`
    SELECT
      COUNT(*) AS total_reviews,
      AVG(rating) AS average_rating,
      MIN(rating) AS min_rating,
      MAX(rating) AS max_rating
    FROM reviews
    WHERE reviewee_address = ?
  `).get(address) as { total_reviews: number; average_rating: number | null; min_rating: number | null; max_rating: number | null } | null;

  if (!row || row.total_reviews === 0) return null;

  return {
    total_reviews: row.total_reviews,
    average_rating: Math.round((row.average_rating ?? 0) * 100) / 100,
    min_rating: row.min_rating ?? 0,
    max_rating: row.max_rating ?? 0,
  };
}
