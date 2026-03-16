// web.ts — Arc dashboard API server
//
// Read-only SQLite connection. Serves JSON API endpoints and static files from src/web/.
// Run: bun src/web.ts (or via arc skills run --name dashboard -- start)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { initDatabase, getDatabase, insertTask, markTaskFailed, markTaskCompleted, getEmailThreads, getEmailMessagesByFromAddress, type EmailMessage } from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { IDENTITY } from "./identity.ts";
import { dispatchCodex } from "./codex.ts";
import {
  initHubSchema,
  getAllHubAgents,
  getHubAgent,
  upsertHubAgent,
  getHubCapabilities,
  replaceAgentCapabilities,
  findAgentForSkill,
  getFleetHealth,
  getRoutingStats,
  insertTaskRoute,
} from "../skills/agent-hub/schema.ts";
import type { InsertHubCapability } from "../skills/agent-hub/schema.ts";

// ---- Database ----

// Initialize singleton database on startup
initDatabase();
initHubSchema();
const db = getDatabase();
const dbWrite = getDatabase();

// ---- Constants ----

const PORT = parseInt(process.env.ARC_WEB_PORT || "3000");
const STATIC_DIR = join(import.meta.dir, "web");
const HOOK_STATE_DIR = join(import.meta.dir, "../db/hook-state");
const SKILLS_DIR = join(import.meta.dir, "../skills");

const MAX_SSE_CLIENTS = 50;
const SSE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseCleanups = new WeakMap<ReadableStreamDefaultController<Uint8Array>, () => void>();

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---- Helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ---- Ask Arc: Tiered pricing & rate limiting ----

interface AskTier {
  model: string;
  priority: number;
  cost_sats: number;
}

const ASK_TIERS: Record<string, AskTier> = {
  haiku:  { model: "haiku",  priority: 8, cost_sats: 250 },
  sonnet: { model: "sonnet", priority: 5, cost_sats: 2500 },
  opus:   { model: "opus",   priority: 3, cost_sats: 10000 },
};

const ASK_DAILY_LIMIT = 20;
let askDayKey = "";
let askDayCount = 0;

function getAskDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkAskRateLimit(): boolean {
  const today = getAskDayKey();
  if (today !== askDayKey) {
    askDayKey = today;
    askDayCount = 0;
  }
  return askDayCount < ASK_DAILY_LIMIT;
}

function incrementAskCount(): void {
  const today = getAskDayKey();
  if (today !== askDayKey) {
    askDayKey = today;
    askDayCount = 0;
  }
  askDayCount++;
}

async function handleAsk(req: Request): Promise<Response> {
  // Rate limit check
  if (!checkAskRateLimit()) {
    return json({
      error: "Daily question limit reached",
      code: "RATE_LIMITED",
      limit: ASK_DAILY_LIMIT,
      resets: getAskDayKey() + "T00:00:00Z (next day)",
    }, 429);
  }

  let body: { question?: string; tier?: string; context?: string };
  try {
    body = await req.json() as { question?: string; tier?: string; context?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return errorResponse("'question' is required", 400);
  if (question.length > 1000) return errorResponse("Question too long (max 1000 chars)", 400);

  const tierName = (typeof body.tier === "string" ? body.tier.toLowerCase() : "haiku");
  const tier = ASK_TIERS[tierName];
  if (!tier) {
    return errorResponse(`Invalid tier '${tierName}'. Valid: haiku, sonnet, opus`, 400);
  }

  const context = typeof body.context === "string" ? body.context.trim() : "";
  if (context.length > 1000) return errorResponse("Context too long (max 1000 chars)", 400);

  // Build task description
  const description = [
    `**Ask Arc query (${tierName} tier)**`,
    "",
    `**Question:** ${question}`,
    context ? `\n**Context:** ${context}` : "",
    "",
    "Respond directly to the question using your knowledge, skills, and memory.",
    "Keep the answer concise and factual. Output your answer as plain text.",
  ].filter(Boolean).join("\n");

  const taskId = insertTask({
    subject: `[ask-arc] ${question.slice(0, 80)}${question.length > 80 ? "..." : ""}`,
    description,
    skills: JSON.stringify(["arc0btc-ask-service"]),
    priority: tier.priority,
    model: tier.model,
    source: "api:ask-arc",
  });

  incrementAskCount();

  return json({
    task_id: taskId,
    tier: tierName,
    model: tier.model,
    cost_sats: tier.cost_sats,
    status: "pending",
    poll_url: `/api/tasks/${taskId}`,
    daily_remaining: ASK_DAILY_LIMIT - askDayCount,
  }, 201);
}

// ---- PR Review Service: x402 paid review with rate limiting ----

interface PrReviewTier {
  priority: number;
  cost_sats: number;
  label: string;
}

const PR_REVIEW_TIERS: Record<string, PrReviewTier> = {
  standard: { priority: 5, cost_sats: 15000, label: "Standard (Sonnet)" },
  express:  { priority: 3, cost_sats: 30000, label: "Express (Opus)" },
};

const PR_REVIEW_DAILY_LIMIT = 5;
let prReviewDayKey = "";
let prReviewDayCount = 0;

function getPrReviewDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkPrReviewRateLimit(): boolean {
  const today = getPrReviewDayKey();
  if (today !== prReviewDayKey) {
    prReviewDayKey = today;
    prReviewDayCount = 0;
  }
  return prReviewDayCount < PR_REVIEW_DAILY_LIMIT;
}

function incrementPrReviewCount(): void {
  const today = getPrReviewDayKey();
  if (today !== prReviewDayKey) {
    prReviewDayKey = today;
    prReviewDayCount = 0;
  }
  prReviewDayCount++;
}

/** Validate GitHub PR URL and extract owner/repo/number */
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  // Match: https://github.com/owner/repo/pull/123
  const match = url.match(/^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)\/?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

async function handlePrReview(req: Request): Promise<Response> {
  // Rate limit check
  if (!checkPrReviewRateLimit()) {
    return json({
      error: "Daily PR review limit reached",
      code: "RATE_LIMITED",
      limit: PR_REVIEW_DAILY_LIMIT,
      resets: getPrReviewDayKey() + "T00:00:00Z (next day)",
    }, 429);
  }

  let body: { pr_url?: string; tier?: string; notes?: string };
  try {
    body = await req.json() as { pr_url?: string; tier?: string; notes?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const prUrl = typeof body.pr_url === "string" ? body.pr_url.trim() : "";
  if (!prUrl) return errorResponse("'pr_url' is required", 400);

  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    return errorResponse("Invalid PR URL. Expected: https://github.com/owner/repo/pull/123", 400);
  }

  const tierName = (typeof body.tier === "string" ? body.tier.toLowerCase() : "standard");
  const tier = PR_REVIEW_TIERS[tierName];
  if (!tier) {
    return errorResponse(`Invalid tier '${tierName}'. Valid: standard, express`, 400);
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 1000) return errorResponse("Notes too long (max 1000 chars)", 400);

  // Check for duplicate pending review of same PR
  const existingTask = db.query(
    "SELECT id FROM tasks WHERE source = ? AND status IN ('pending', 'active')"
  ).get(`paid:pr-review:${parsed.owner}/${parsed.repo}#${parsed.number}`);

  if (existingTask) {
    const existing = existingTask as { id: number };
    return json({
      error: "A review for this PR is already queued or in progress",
      code: "DUPLICATE",
      existing_task_id: existing.id,
      poll_url: `/api/tasks/${existing.id}`,
    }, 409);
  }

  // Build task description
  const description = [
    `**Paid PR Review (${tier.label})**`,
    "",
    `**PR:** ${prUrl}`,
    `**Repo:** ${parsed.owner}/${parsed.repo}`,
    `**PR Number:** #${parsed.number}`,
    notes ? `\n**Reviewer notes:** ${notes}` : "",
    "",
    "Review this PR using the aibtc-repo-maintenance review workflow:",
    "1. Fetch PR diff via `gh pr diff`",
    "2. Analyze changes for correctness, security, and code quality",
    "3. Write structured review with severity labels ([blocking]/[suggestion]/[nit]/[question])",
    "4. Post review as GitHub comment via `gh pr review`",
    "5. Store the review result in result_detail for API delivery",
  ].filter(Boolean).join("\n");

  const model = tierName === "express" ? "opus" : "sonnet";

  const taskId = insertTask({
    subject: `[pr-review] ${parsed.owner}/${parsed.repo}#${parsed.number}`,
    description,
    skills: JSON.stringify(["aibtc-repo-maintenance"]),
    priority: tier.priority,
    model,
    source: `paid:pr-review:${parsed.owner}/${parsed.repo}#${parsed.number}`,
  });

  incrementPrReviewCount();

  return json({
    task_id: taskId,
    tier: tierName,
    model,
    cost_sats: tier.cost_sats,
    pr: {
      owner: parsed.owner,
      repo: parsed.repo,
      number: parsed.number,
      url: prUrl,
    },
    status: "pending",
    poll_url: `/api/tasks/${taskId}`,
    daily_remaining: PR_REVIEW_DAILY_LIMIT - prReviewDayCount,
  }, 201);
}

// ---- Roundtable ----

async function handleRoundtableRespond(req: Request): Promise<Response> {
  let body: { discussion_id?: number; prompt?: string };
  try {
    body = await req.json() as { discussion_id?: number; prompt?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const discussionId = typeof body.discussion_id === "number" ? body.discussion_id : 0;
  if (!discussionId) return errorResponse("'discussion_id' is required (number)", 400);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return errorResponse("'prompt' is required", 400);
  if (prompt.length > 5000) return errorResponse("Prompt too long (max 5000 chars)", 400);

  // Check for existing pending/active task for this discussion
  const source = `roundtable:${discussionId}`;
  const existing = db.query(
    "SELECT id FROM tasks WHERE source = ? AND status IN ('pending', 'active') LIMIT 1"
  ).get(source);
  if (existing) {
    const ex = existing as { id: number };
    return json({ error: "Already processing this discussion", task_id: ex.id }, 409);
  }

  const taskId = insertTask({
    subject: `[roundtable] Respond to discussion #${discussionId}`,
    description: [
      `**Roundtable Discussion #${discussionId}**`,
      "",
      prompt,
      "",
      "Respond thoughtfully to this discussion prompt. Post your response back using:",
      `\`arc skills run --name arc-roundtable -- respond --id ${discussionId} --text "YOUR RESPONSE"\``,
    ].join("\n"),
    skills: JSON.stringify(["arc-roundtable"]),
    priority: 5,
    model: "sonnet",
    source,
  });

  return json({ task_id: taskId, discussion_id: discussionId, status: "pending" }, 201);
}

// ---- Roundtable Receive (agents POST their response back here) ----

async function handleRoundtableReceive(req: Request): Promise<Response> {
  let body: { discussion_id?: number; agent_name?: string; text?: string };
  try {
    body = await req.json() as { discussion_id?: number; agent_name?: string; text?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const discussionId = body.discussion_id;
  const agentName = body.agent_name;
  const text = body.text;

  if (!discussionId || !agentName || !text) {
    return errorResponse("'discussion_id', 'agent_name', and 'text' are required", 400);
  }

  const db = getDatabase();

  // Update existing response row
  const result = db.query(
    `UPDATE roundtable_responses
     SET response = ?, status = 'responded', responded_at = datetime('now')
     WHERE discussion_id = ? AND agent_name = ?`
  ).run(text, discussionId, agentName);

  if (result.changes === 0) {
    // Insert if no row exists
    db.query(
      `INSERT INTO roundtable_responses (discussion_id, agent_name, response, status, responded_at)
       VALUES (?, ?, ?, 'responded', datetime('now'))`
    ).run(discussionId, agentName, text);
  }

  return json({ ok: true, discussion_id: discussionId, agent_name: agentName }, 200);
}

// ---- Consensus Vote ----

async function handleConsensusVote(req: Request): Promise<Response> {
  let body: { proposal_id?: number; topic?: string; description?: string };
  try {
    body = await req.json() as { proposal_id?: number; topic?: string; description?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const proposalId = typeof body.proposal_id === "number" ? body.proposal_id : 0;
  if (!proposalId) return errorResponse("'proposal_id' is required (number)", 400);

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return errorResponse("'topic' is required", 400);

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return errorResponse("'description' is required", 400);
  if (description.length > 5000) return errorResponse("Description too long (max 5000 chars)", 400);

  // Dedup: check for existing pending/active task for this proposal
  const source = `consensus:${proposalId}`;
  const existing = db.query(
    "SELECT id FROM tasks WHERE source = ? AND status IN ('pending', 'active') LIMIT 1"
  ).get(source);
  if (existing) {
    const ex = existing as { id: number };
    return json({ error: "Already processing this proposal", task_id: ex.id }, 409);
  }

  const taskId = insertTask({
    subject: `[consensus] Vote on proposal #${proposalId}: ${topic}`,
    description: [
      `**Fleet Consensus Proposal #${proposalId}**`,
      "",
      `**Topic:** ${topic}`,
      "",
      description,
      "",
      "Evaluate this proposal and cast your vote. Consider: risk, reversibility, alignment with fleet goals.",
      "",
      "Cast your vote using:",
      `\`arc skills run --name fleet-consensus -- vote --id ${proposalId} --vote approve|reject|abstain --reason "YOUR REASONING"\``,
    ].join("\n"),
    skills: JSON.stringify(["fleet-consensus"]),
    priority: 4,
    model: "opus",
    source,
  });

  return json({ task_id: taskId, proposal_id: proposalId, status: "pending" }, 201);
}

// ---- Fleet Messages ----

async function handlePostFleetMessage(req: Request): Promise<Response> {
  let body: { from_agent?: string; from_bns?: string; message_type?: string; content?: string };
  try {
    body = await req.json() as { from_agent?: string; from_bns?: string; message_type?: string; content?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const fromAgent = typeof body.from_agent === "string" ? body.from_agent.trim() : "";
  if (!fromAgent) return errorResponse("'from_agent' is required", 400);
  if (fromAgent.length > 50) return errorResponse("'from_agent' too long (max 50)", 400);

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return errorResponse("'content' is required", 400);
  if (content.length > 2000) return errorResponse("'content' too long (max 2000 chars)", 400);

  const validTypes = new Set(["status", "question", "alert"]);
  const messageType = typeof body.message_type === "string" && validTypes.has(body.message_type) ? body.message_type : "status";
  const fromBns = typeof body.from_bns === "string" ? body.from_bns.trim() : null;

  const result = dbWrite.query(
    "INSERT INTO fleet_messages (from_agent, from_bns, message_type, content) VALUES (?, ?, ?, ?)"
  ).run(fromAgent, fromBns, messageType, content);

  const id = Number(result.lastInsertRowid);
  const msg = db.query("SELECT * FROM fleet_messages WHERE id = ?").get(id);
  return json(msg, 201);
}

function handleGetFleetMessages(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const since = url.searchParams.get("since"); // ISO datetime for incremental polling

  let rows;
  if (since) {
    rows = db.query(
      "SELECT * FROM fleet_messages WHERE created_at > ? ORDER BY created_at DESC LIMIT ?"
    ).all(since, limit);
  } else {
    rows = db.query(
      "SELECT * FROM fleet_messages ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }
  return json({ messages: rows });
}

// ---- Arena: Dual-model comparison ----

interface ArenaResult {
  model: string;
  output: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  cost_usd: number;
  error: string | null;
}

interface ArenaRun {
  id: string;
  prompt: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  claude: ArenaResult | null;
  codex: ArenaResult | null;
}

const arenaRuns = new Map<string, ArenaRun>();
let arenaCounter = 0;
const ARENA_MAX_HISTORY = 50;
const ARENA_PROMPT_MAX_LENGTH = 10000;
const ARENA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per model

/** Estimate tokens from text length (~4 chars per token). */
function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Run Claude CLI with --print and capture output. */
async function runClaudeForArena(prompt: string): Promise<ArenaResult> {
  const start = Date.now();
  try {
    const args = ["claude", "--print", "--model", "claude-sonnet-4-6", "--output-format", "text", "--no-session-persistence"];
    const proc = Bun.spawn(args, {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, ARENA_TIMEOUT_MS);

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    if (timedOut) throw new Error("Timed out after 5 minutes");
    if (exitCode !== 0) throw new Error(`Exit code ${exitCode}: ${stderr.trim().slice(0, 300)}`);

    const output = stdout.trim();
    const tokensIn = estimateTokensFromText(prompt);
    const tokensOut = estimateTokensFromText(output);
    // Sonnet pricing: $3/MTok in, $15/MTok out
    const cost = (tokensIn / 1_000_000) * 3 + (tokensOut / 1_000_000) * 15;

    return {
      model: "claude-sonnet-4-6",
      output,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: Date.now() - start,
      cost_usd: Math.round(cost * 10000) / 10000,
      error: null,
    };
  } catch (err) {
    return {
      model: "claude-sonnet-4-6",
      output: "",
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: Date.now() - start,
      cost_usd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run Codex CLI and capture output. */
async function runCodexForArena(prompt: string): Promise<ArenaResult> {
  const start = Date.now();
  try {
    const result = await dispatchCodex(prompt);
    return {
      model: "o4-mini",
      output: result.result,
      tokens_in: result.input_tokens,
      tokens_out: result.output_tokens,
      duration_ms: Date.now() - start,
      cost_usd: Math.round(result.api_cost_usd * 10000) / 10000,
      error: null,
    };
  } catch (err) {
    return {
      model: "o4-mini",
      output: "",
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: Date.now() - start,
      cost_usd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleArenaRun(req: Request): Promise<Response> {
  let body: { prompt?: string };
  try {
    body = await req.json() as { prompt?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return errorResponse("'prompt' is required", 400);
  if (prompt.length > ARENA_PROMPT_MAX_LENGTH) {
    return errorResponse(`Prompt too long (max ${ARENA_PROMPT_MAX_LENGTH} chars)`, 400);
  }

  // Limit concurrent runs
  const activeRuns = [...arenaRuns.values()].filter(r => r.status === "running");
  if (activeRuns.length >= 3) {
    return errorResponse("Too many concurrent arena runs (max 3)", 429);
  }

  arenaCounter++;
  const id = `arena-${arenaCounter}-${Date.now()}`;
  const run: ArenaRun = {
    id,
    prompt,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "running",
    claude: null,
    codex: null,
  };
  arenaRuns.set(id, run);

  // Evict old runs beyond history limit
  if (arenaRuns.size > ARENA_MAX_HISTORY) {
    const keys = [...arenaRuns.keys()];
    for (let i = 0; i < keys.length - ARENA_MAX_HISTORY; i++) {
      arenaRuns.delete(keys[i]);
    }
  }

  // Run both models in parallel (fire-and-forget, results stored in the run object)
  Promise.allSettled([
    runClaudeForArena(prompt).then(r => { run.claude = r; }),
    runCodexForArena(prompt).then(r => { run.codex = r; }),
  ]).then(() => {
    run.status = (run.claude?.error && run.codex?.error) ? "failed" : "completed";
    run.completed_at = new Date().toISOString();
  });

  return json({ id, status: "running", poll_url: `/api/arena/runs/${id}` }, 202);
}

function handleArenaRunById(id: string): Response {
  const run = arenaRuns.get(id);
  if (!run) return errorResponse("Arena run not found", 404);
  return json(run);
}

function handleArenaHistory(): Response {
  const runs = [...arenaRuns.values()]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 20)
    .map(r => ({
      id: r.id,
      prompt: r.prompt.slice(0, 100) + (r.prompt.length > 100 ? "..." : ""),
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
    }));
  return json({ runs });
}

// ---- Email thread helpers ----

function normalizeSubjectForThreading(subject: string | null): string {
  if (!subject) return "(no subject)";
  return subject.replace(/^(?:re|fwd?|fw)\s*:\s*/gi, "").trim().toLowerCase() || "(no subject)";
}

interface EmailThread {
  thread_key: string;
  from_address: string;
  from_name: string | null;
  normalized_subject: string;
  latest_subject: string | null;
  message_count: number;
  unread_count: number;
  last_received: string;
  over_threshold: boolean;
}

function buildThreads(rows: EmailMessage[]): EmailThread[] {
  const threadMap = new Map<string, EmailThread & { messages: EmailMessage[] }>();
  for (const msg of rows) {
    const normSubj = normalizeSubjectForThreading(msg.subject);
    const key = `${msg.from_address}:${normSubj}`;
    if (!threadMap.has(key)) {
      threadMap.set(key, {
        thread_key: key,
        from_address: msg.from_address,
        from_name: msg.from_name,
        normalized_subject: normSubj,
        latest_subject: msg.subject,
        message_count: 0,
        unread_count: 0,
        last_received: msg.received_at,
        over_threshold: false,
        messages: [],
      });
    }
    const thread = threadMap.get(key)!;
    thread.message_count++;
    if (msg.is_read === 0 && msg.folder === "inbox") thread.unread_count++;
    if (msg.received_at > thread.last_received) {
      thread.last_received = msg.received_at;
      thread.latest_subject = msg.subject;
      thread.from_name = msg.from_name ?? thread.from_name;
    }
    thread.messages.push(msg);
  }
  return [...threadMap.values()]
    .map(({ messages: _m, ...t }) => ({ ...t, over_threshold: t.message_count >= 15 }))
    .sort((a, b) => b.last_received.localeCompare(a.last_received));
}

function handleEmailThreads(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 2000);
  const rows = getEmailThreads(limit);
  const threads = buildThreads(rows);
  return json({ threads, total: threads.length });
}

function handleEmailThread(encodedKey: string): Response {
  const key = decodeURIComponent(encodedKey);
  const colonIdx = key.indexOf(":");
  if (colonIdx === -1) return errorResponse("Invalid thread key", 400);
  const fromAddress = key.slice(0, colonIdx);
  const normalizedSubject = key.slice(colonIdx + 1);
  const rows = getEmailMessagesByFromAddress(fromAddress);
  const messages = rows.filter(m => normalizeSubjectForThreading(m.subject) === normalizedSubject);
  return json({ thread_key: key, from_address: fromAddress, normalized_subject: normalizedSubject, message_count: messages.length, over_threshold: messages.length >= 15, messages });
}

// ---- API Handlers ----

function handleStatus(): Response {
  const pending = db.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'").get() as { count: number };
  const active = db.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'active'").get() as { count: number };
  const completedToday = db.query(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND date(completed_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { count: number };
  const failedToday = db.query(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND date(completed_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { count: number };

  const costs = db.query(
    "SELECT COALESCE(SUM(cost_usd), 0) as cost_today_usd, COALESCE(SUM(api_cost_usd), 0) as api_cost_today_usd FROM tasks WHERE date(created_at, '-7 hours') = date('now', '-7 hours')"
  ).get() as { cost_today_usd: number; api_cost_today_usd: number };

  const lastCycleRow = db.query(
    "SELECT started_at, task_id, duration_ms FROM cycle_log ORDER BY started_at DESC LIMIT 1"
  ).get() as { started_at: string; task_id: number | null; duration_ms: number | null } | null;

  const lastCycle = lastCycleRow
    ? { started_at: lastCycleRow.started_at, task_id: lastCycleRow.task_id, duration_ms: lastCycleRow.duration_ms }
    : null;

  // Uptime: hours since earliest pending/active task or first cycle today
  const firstCycleToday = db.query(
    "SELECT started_at FROM cycle_log WHERE date(started_at, '-7 hours') = date('now', '-7 hours') ORDER BY started_at ASC LIMIT 1"
  ).get() as { started_at: string } | null;

  let uptimeHours = 0;
  if (firstCycleToday) {
    const firstTime = new Date(firstCycleToday.started_at + "Z").getTime();
    uptimeHours = Math.round(((Date.now() - firstTime) / 3600000) * 10) / 10;
  }

  return json({
    pending: pending.count,
    active: active.count,
    completed_today: completedToday.count,
    failed_today: failedToday.count,
    cost_today_usd: Math.round(costs.cost_today_usd * 100) / 100,
    api_cost_today_usd: Math.round(costs.api_cost_today_usd * 100) / 100,
    last_cycle: lastCycle,
    uptime_hours: uptimeHours,
  });
}

function handleTasks(url: URL): Response {
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  let rows;
  if (status && q) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE status = ? AND subject LIKE ? ORDER BY priority ASC, id DESC LIMIT ?"
    ).all(status, `%${q}%`, limit);
  } else if (status) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE status = ? ORDER BY priority ASC, id DESC LIMIT ?"
    ).all(status, limit);
  } else if (q) {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks WHERE subject LIKE ? ORDER BY id DESC LIMIT ?"
    ).all(`%${q}%`, limit);
  } else {
    rows = db.query(
      "SELECT id, subject, priority, status, source, skills, model, created_at, cost_usd FROM tasks ORDER BY id DESC LIMIT ?"
    ).all(limit);
  }

  return json({ tasks: rows });
}

function handleTaskById(id: string): Response {
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return errorResponse("Invalid task ID", 400);

  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return errorResponse("Task not found", 404);

  return json(task);
}

async function handleKillTask(req: Request, id: string): Promise<Response> {
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return errorResponse("Invalid task ID", 400);

  let body: { reason?: string };
  try {
    body = await req.json() as { reason?: string };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return errorResponse("'reason' is required", 400);

  const task = db.query("SELECT id, status FROM tasks WHERE id = ?").get(taskId) as { id: number; status: string } | null;
  if (!task) return errorResponse("Task not found", 404);
  if (task.status !== "active" && task.status !== "pending") {
    return errorResponse(`Task is not active or pending (current status: ${task.status})`, 409);
  }

  markTaskFailed(taskId, reason);

  const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return json(updated);
}

function handleCycles(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 100);
  const cycles = db.query(
    "SELECT id, task_id, started_at, completed_at, duration_ms, cost_usd, api_cost_usd, tokens_in, tokens_out, skills_loaded FROM cycle_log ORDER BY started_at DESC LIMIT ?"
  ).all(limit);
  return json({ cycles });
}

function handleSensors(): Response {
  const sensors: Array<{
    name: string;
    description: string;
    interval_minutes: number | null;
    last_ran: string | null;
    last_result: string | null;
    version: number | null;
    consecutive_failures: number | null;
  }> = [];

  // Get skill metadata for sensor descriptions
  const skills = discoverSkills();
  const skillMap = new Map(skills.filter(s => s.hasSensor).map(s => [s.name, s]));

  // Read hook-state JSON files (skip orphaned entries with no matching skill)
  if (existsSync(HOOK_STATE_DIR)) {
    const files = readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const name = file.replace(".json", "");
      const skill = skillMap.get(name);
      if (!skill) continue; // skip stale hook-state from renamed/removed sensors

      try {
        const content = readFileSync(join(HOOK_STATE_DIR, file), "utf-8");
        const state = JSON.parse(content) as {
          last_ran: string;
          last_result: string;
          version: number;
          consecutive_failures: number;
        };

        // Try to parse interval from sensor.ts (INTERVAL_MINUTES constant)
        let interval: number | null = null;
        const sensorPath = join(skill.path, "sensor.ts");
        if (existsSync(sensorPath)) {
          const sensorContent = readFileSync(sensorPath, "utf-8");
          const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
          if (match) interval = parseInt(match[1], 10);
        }

        sensors.push({
          name,
          description: skill.description,
          interval_minutes: interval,
          last_ran: state.last_ran,
          last_result: state.last_result,
          version: state.version,
          consecutive_failures: state.consecutive_failures,
        });
      } catch {
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: null,
          last_ran: null,
          last_result: "error",
          version: null,
          consecutive_failures: null,
        });
      }
    }
  }

  // Also include sensors with a skill but no hook-state yet (never ran)
  for (const [name, skill] of skillMap) {
    if (!sensors.some(s => s.name === name)) {
      let interval: number | null = null;
      const sensorPath = join(skill.path, "sensor.ts");
      if (existsSync(sensorPath)) {
        const sensorContent = readFileSync(sensorPath, "utf-8");
        const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
        if (match) interval = parseInt(match[1], 10);
      }
      sensors.push({
        name,
        description: skill.description,
        interval_minutes: interval,
        last_ran: null,
        last_result: null,
        version: null,
        consecutive_failures: null,
      });
    }
  }

  sensors.sort((a, b) => a.name.localeCompare(b.name));
  return json({ sensors });
}

function handleSensorSchedule(): Response {
  // Get base sensor data (reuse handleSensors logic)
  const sensors: Array<{
    name: string;
    description: string;
    interval_minutes: number | null;
    last_ran: string | null;
    last_result: string | null;
    version: number | null;
    consecutive_failures: number | null;
    next_expected: string | null;
    task_count_24h: number;
    task_count_total: number;
    task_types: string[];
    hourly_activity: number[];
  }> = [];

  const skills = discoverSkills();
  const skillMap = new Map(skills.filter(s => s.hasSensor).map(s => [s.name, s]));

  // Query task counts per sensor source (last 24h and total)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const taskCounts24h = db.query(
    "SELECT source, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' AND created_at >= ? GROUP BY source"
  ).all(yesterday) as Array<{ source: string; cnt: number }>;

  const taskCountsTotal = db.query(
    "SELECT source, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' GROUP BY source"
  ).all() as Array<{ source: string; cnt: number }>;

  // Query hourly activity for last 24h (tasks created per hour per sensor)
  const hourlyRows = db.query(
    "SELECT source, strftime('%H', created_at) as hour, COUNT(*) as cnt FROM tasks WHERE source LIKE 'sensor:%' AND created_at >= ? GROUP BY source, hour"
  ).all(yesterday) as Array<{ source: string; hour: string; cnt: number }>;

  // Query distinct task subjects per sensor source (for task types)
  const taskTypeRows = db.query(
    "SELECT source, subject FROM tasks WHERE source LIKE 'sensor:%' GROUP BY source, subject"
  ).all() as Array<{ source: string; subject: string }>;

  // Build lookup maps: sensor name -> aggregated data
  // Sources can be "sensor:name" or "sensor:name:subsource"
  function sensorNameFromSource(source: string): string {
    const parts = source.replace("sensor:", "").split(":");
    return parts[0];
  }

  const count24hMap = new Map<string, number>();
  for (const row of taskCounts24h) {
    const name = sensorNameFromSource(row.source);
    count24hMap.set(name, (count24hMap.get(name) || 0) + row.cnt);
  }

  const countTotalMap = new Map<string, number>();
  for (const row of taskCountsTotal) {
    const name = sensorNameFromSource(row.source);
    countTotalMap.set(name, (countTotalMap.get(name) || 0) + row.cnt);
  }

  const hourlyMap = new Map<string, number[]>();
  for (const row of hourlyRows) {
    const name = sensorNameFromSource(row.source);
    if (!hourlyMap.has(name)) hourlyMap.set(name, new Array(24).fill(0));
    const hours = hourlyMap.get(name)!;
    hours[parseInt(row.hour, 10)] += row.cnt;
  }

  const typeMap = new Map<string, Set<string>>();
  for (const row of taskTypeRows) {
    const name = sensorNameFromSource(row.source);
    if (!typeMap.has(name)) typeMap.set(name, new Set());
    typeMap.get(name)!.add(row.subject);
  }

  // Build sensor entries from hook-state files
  if (existsSync(HOOK_STATE_DIR)) {
    const files = readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const name = file.replace(".json", "");
      const skill = skillMap.get(name);
      if (!skill) continue;

      try {
        const content = readFileSync(join(HOOK_STATE_DIR, file), "utf-8");
        const state = JSON.parse(content) as {
          last_ran: string;
          last_result: string;
          version: number;
          consecutive_failures: number;
        };

        let interval: number | null = null;
        const sensorPath = join(skill.path, "sensor.ts");
        if (existsSync(sensorPath)) {
          const sensorContent = readFileSync(sensorPath, "utf-8");
          const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
          if (match) interval = parseInt(match[1], 10);
        }

        let nextExpected: string | null = null;
        if (state.last_ran && interval) {
          const lastRan = new Date(state.last_ran.endsWith("Z") ? state.last_ran : state.last_ran + "Z");
          nextExpected = new Date(lastRan.getTime() + interval * 60000).toISOString();
        }

        const types = typeMap.get(name);
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: interval,
          last_ran: state.last_ran,
          last_result: state.last_result,
          version: state.version,
          consecutive_failures: state.consecutive_failures,
          next_expected: nextExpected,
          task_count_24h: count24hMap.get(name) || 0,
          task_count_total: countTotalMap.get(name) || 0,
          task_types: types ? Array.from(types).slice(0, 5) : [],
          hourly_activity: hourlyMap.get(name) || new Array(24).fill(0),
        });
      } catch {
        sensors.push({
          name,
          description: skill.description,
          interval_minutes: null,
          last_ran: null,
          last_result: "error",
          version: null,
          consecutive_failures: null,
          next_expected: null,
          task_count_24h: count24hMap.get(name) || 0,
          task_count_total: countTotalMap.get(name) || 0,
          task_types: [],
          hourly_activity: new Array(24).fill(0),
        });
      }
    }
  }

  // Include sensors with no hook-state yet
  for (const [name, skill] of skillMap) {
    if (!sensors.some(s => s.name === name)) {
      let interval: number | null = null;
      const sensorPath = join(skill.path, "sensor.ts");
      if (existsSync(sensorPath)) {
        const sensorContent = readFileSync(sensorPath, "utf-8");
        const match = sensorContent.match(/INTERVAL_MINUTES\s*=\s*(\d+)/);
        if (match) interval = parseInt(match[1], 10);
      }
      sensors.push({
        name,
        description: skill.description,
        interval_minutes: interval,
        last_ran: null,
        last_result: null,
        version: null,
        consecutive_failures: null,
        next_expected: null,
        task_count_24h: 0,
        task_count_total: 0,
        task_types: [],
        hourly_activity: new Array(24).fill(0),
      });
    }
  }

  sensors.sort((a, b) => a.name.localeCompare(b.name));
  return json({ sensors, generated_at: now.toISOString() });
}

function handleSkills(): Response {
  const skills = discoverSkills();

  // Count how often each skill is referenced in tasks (skills JSON array)
  const usageRows = db.query(
    "SELECT skills FROM tasks WHERE skills IS NOT NULL AND skills != '[]' AND skills != ''"
  ).all() as Array<{ skills: string }>;

  const usageMap = new Map<string, number>();
  for (const row of usageRows) {
    try {
      const arr = JSON.parse(row.skills) as string[];
      for (const name of arr) {
        usageMap.set(name, (usageMap.get(name) || 0) + 1);
      }
    } catch { /* skip malformed */ }
  }

  const result = skills.map(s => ({
    name: s.name,
    description: s.description,
    tags: s.tags,
    has_sensor: s.hasSensor,
    has_cli: s.hasCli,
    has_agent: s.hasAgent,
    usage_count: usageMap.get(s.name) || 0,
  }));
  return json({ skills: result });
}

function handleCosts(url: URL): Response {
  const range = url.searchParams.get("range") || "day";

  let rows;
  if (range === "week") {
    rows = db.query(`
      SELECT
        strftime('%Y-%m-%d %H:00', started_at, '-7 hours') as hour,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COALESCE(SUM(api_cost_usd), 0) as api_cost_usd,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out,
        COUNT(*) as cycles
      FROM cycle_log
      WHERE datetime(started_at) >= datetime('now', '-7 days')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();
  } else {
    rows = db.query(`
      SELECT
        strftime('%Y-%m-%d %H:00', started_at, '-7 hours') as hour,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COALESCE(SUM(api_cost_usd), 0) as api_cost_usd,
        COALESCE(SUM(tokens_in), 0) as tokens_in,
        COALESCE(SUM(tokens_out), 0) as tokens_out,
        COUNT(*) as cycles
      FROM cycle_log
      WHERE date(started_at, '-7 hours') = date('now', '-7 hours')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();
  }

  return json({ range, costs: rows });
}

function handleIdentity(): Response {
  return json(IDENTITY);
}

// ---- Bitcoin Face Avatar ----

const FACE_CACHE_DIR = join(import.meta.dir, "../db");

async function handleFace(): Promise<Response> {
  const bnsPrefix = IDENTITY.bns.replace(/\.btc$/, "");
  // Check for cached face in either format
  const svgPath = join(FACE_CACHE_DIR, `face-${bnsPrefix}.svg`);
  const pngPath = join(FACE_CACHE_DIR, `face-${bnsPrefix}.png`);

  // Serve cached SVG first, then PNG
  if (existsSync(svgPath)) {
    return new Response(readFileSync(svgPath), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (existsSync(pngPath)) {
    const content = readFileSync(pngPath);
    // Detect if the "png" file is actually SVG (legacy cache)
    const isSvg = content.length > 4 && content.slice(0, 100).toString().includes("<svg");
    return new Response(content, {
      headers: {
        "Content-Type": isSvg ? "image/svg+xml" : "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Fetch and cache from bitcoinfaces.xyz
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://bitcoinfaces.xyz/api/get-image?name=${bnsPrefix}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return errorResponse("Face not found", 404);

    const contentType = res.headers.get("content-type") || "image/png";
    const isSvg = contentType.includes("svg");
    const ext = isSvg ? "svg" : "png";
    const buf = await res.arrayBuffer();
    writeFileSync(join(FACE_CACHE_DIR, `face-${bnsPrefix}.${ext}`), Buffer.from(buf));

    return new Response(Buffer.from(buf), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return errorResponse("Failed to fetch face", 502);
  }
}

function handleReputation(url: URL): Response {
  type ReviewRow = { id: number; subject: string; reviewer_address: string; reviewee_address: string; rating: number; comment: string; tags: string; created_at: string; direction: string };

  const emptyResponse = {
    reviews: [] as Array<ReviewRow & { tags: string[] }>,
    total: 0,
    submitted_total: 0,
    received_total: 0,
    avg_rating: null as number | null,
    btc_address: IDENTITY.btc,
    stx_address: IDENTITY.stx,
  };

  try {
    // Check if reviews table exists (created by arc-reputation skill on first use)
    const tableExists = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='reviews'"
    ).get() as { name: string } | null;

    if (!tableExists) return json(emptyResponse);

    // Query params: type=submitted|received|all, limit=N, offset=N, agent=address
    const typeFilter = url.searchParams.get("type") || "all";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "10") || 10, 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0") || 0, 0);
    const agentFilter = url.searchParams.get("agent") || "";

    const arc_btc = IDENTITY.btc;

    // Build unified query with direction labels
    const parts: string[] = [];
    const countParts: string[] = [];
    const queryParams: (string | number)[] = [];
    const countParams: string[] = [];

    if (typeFilter === "all" || typeFilter === "submitted") {
      const agentCond = agentFilter ? " AND reviewee_address = ?" : "";
      parts.push(`SELECT id, subject, reviewer_address, reviewee_address, rating, comment, tags, created_at, 'submitted' as direction FROM reviews WHERE reviewer_address = ?${agentCond}`);
      countParts.push(`SELECT COUNT(*) as c FROM reviews WHERE reviewer_address = ?${agentCond}`);
      queryParams.push(arc_btc);
      countParams.push(arc_btc);
      if (agentFilter) { queryParams.push(agentFilter); countParams.push(agentFilter); }
    }

    if (typeFilter === "all" || typeFilter === "received") {
      const agentCond = agentFilter ? " AND reviewer_address = ?" : "";
      parts.push(`SELECT id, subject, reviewer_address, reviewee_address, rating, comment, tags, created_at, 'received' as direction FROM reviews WHERE reviewee_address = ?${agentCond}`);
      countParts.push(`SELECT COUNT(*) as c FROM reviews WHERE reviewee_address = ?${agentCond}`);
      queryParams.push(arc_btc);
      countParams.push(arc_btc);
      if (agentFilter) { queryParams.push(agentFilter); countParams.push(agentFilter); }
    }

    if (parts.length === 0) return json(emptyResponse);

    // Paginated unified query
    const unionSql = parts.join(" UNION ALL ") + " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const reviews = db.query(unionSql).all(...queryParams, limit, offset) as ReviewRow[];

    // Totals per direction (for metrics + pagination)
    let total = 0;
    let submittedTotal = 0;
    let receivedTotal = 0;
    for (let i = 0; i < countParts.length; i++) {
      // Each countPart corresponds to either submitted or received
      const paramSlice = agentFilter
        ? countParams.slice(i * 2, i * 2 + 2)
        : [countParams[i]];
      const c = (db.query(countParts[i]).get(...paramSlice) as { c: number }).c;
      total += c;
      if (countParts[i].includes("reviewer_address = ?") && !countParts[i].includes("reviewee_address = ?")) {
        submittedTotal = c;
      } else {
        receivedTotal = c;
      }
    }

    // Avg rating for received reviews
    let receivedAvg: number | null = null;
    if (typeFilter === "all" || typeFilter === "received") {
      const avgWhere = agentFilter
        ? "WHERE reviewee_address = ? AND reviewer_address = ?"
        : "WHERE reviewee_address = ?";
      const avgParams = agentFilter ? [arc_btc, agentFilter] : [arc_btc];
      const avgResult = db.query(
        `SELECT AVG(rating) as avg FROM reviews ${avgWhere}`
      ).get(...avgParams) as { avg: number | null };
      receivedAvg = avgResult.avg !== null ? Math.round(avgResult.avg * 100) / 100 : null;
    }

    return json({
      reviews: reviews.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
      total,
      submitted_total: submittedTotal,
      received_total: receivedTotal,
      avg_rating: receivedAvg,
      btc_address: IDENTITY.btc,
      stx_address: IDENTITY.stx,
    });
  } catch {
    return json(emptyResponse);
  }
}

// ---- POST /api/tasks: Agent-to-agent task creation ----

const TASK_API_DAILY_LIMIT = 50;
const taskApiDayCounts = new Map<string, { day: string; count: number }>();

function checkTaskApiRateLimit(sourceIp: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = taskApiDayCounts.get(sourceIp);
  if (!entry || entry.day !== today) {
    taskApiDayCounts.set(sourceIp, { day: today, count: 0 });
    return true;
  }
  return entry.count < TASK_API_DAILY_LIMIT;
}

function incrementTaskApiCount(sourceIp: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const entry = taskApiDayCounts.get(sourceIp);
  if (!entry || entry.day !== today) {
    taskApiDayCounts.set(sourceIp, { day: today, count: 1 });
  } else {
    entry.count++;
  }
}

async function handlePostTask(req: Request): Promise<Response> {
  const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  if (!checkTaskApiRateLimit(sourceIp)) {
    return json({
      error: "Daily task creation limit reached",
      code: "RATE_LIMITED",
      limit: TASK_API_DAILY_LIMIT,
    }, 429);
  }

  let body: {
    subject?: string;
    priority?: number;
    description?: string;
    skills?: string[];
    source?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // Validate subject
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return errorResponse("'subject' is required", 400);
  if (subject.length > 500) return errorResponse("Subject too long (max 500 chars)", 400);

  // Validate source (required for agent-to-agent)
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) return errorResponse("'source' is required (e.g. 'agent:spark', 'agent:iris')", 400);
  if (source.length > 200) return errorResponse("Source too long (max 200 chars)", 400);

  // Validate priority
  let priority = 5;
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 1 || body.priority > 10) {
      return errorResponse("'priority' must be an integer 1-10", 400);
    }
    priority = body.priority;
  }

  // Validate description
  let description: string | undefined;
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return errorResponse("'description' must be a string", 400);
    if (body.description.length > 5000) return errorResponse("Description too long (max 5000 chars)", 400);
    description = body.description.trim() || undefined;
  }

  // Validate skills
  let skills: string | undefined;
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || !body.skills.every((s): s is string => typeof s === "string")) {
      return errorResponse("'skills' must be an array of strings", 400);
    }
    if (body.skills.length > 10) return errorResponse("Too many skills (max 10)", 400);
    skills = JSON.stringify(body.skills);
  }

  const taskId = insertTask({
    subject,
    description,
    skills,
    priority,
    source,
  });

  incrementTaskApiCount(sourceIp);

  const task = db.query(
    "SELECT id, subject, description, skills, priority, status, source, created_at FROM tasks WHERE id = ?"
  ).get(taskId);

  return json(task, 201);
}

async function handlePostMessage(req: Request): Promise<Response> {
  let body: { message?: string; priority?: number; parent_id?: number };
  try {
    body = await req.json() as { message?: string; priority?: number; parent_id?: number };
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return errorResponse("Message is required", 400);
  if (message.length > 1000) return errorResponse("Message too long (max 1000 chars)", 400);

  const parentId = typeof body.parent_id === "number" && Number.isInteger(body.parent_id) && body.parent_id > 0
    ? body.parent_id
    : undefined;

  if (parentId !== undefined) {
    const parent = db.query("SELECT id FROM tasks WHERE id = ?").get(parentId);
    if (!parent) return errorResponse("Parent task not found", 404);
  }

  const taskId = insertTask({
    subject: message,
    source: parentId ? `human:web:re:${parentId}` : "human:web",
    parent_id: parentId,
    priority: 1,
  });

  const task = db.query("SELECT id, subject, priority, status, source, parent_id, created_at FROM tasks WHERE id = ?").get(taskId);
  return json(task, 201);
}

// ---- SSE ----

function handleEvents(): Response {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    console.log(`[SSE] Connection rejected: limit reached (${sseClients.size}/${MAX_SSE_CLIENTS})`);
    return new Response("Too many connections", { status: 503 });
  }

  let lastTaskId = (db.query("SELECT MAX(id) as max_id FROM tasks").get() as { max_id: number | null })?.max_id ?? 0;
  let lastCycleId = (db.query("SELECT MAX(id) as max_id FROM cycle_log").get() as { max_id: number | null })?.max_id ?? 0;

  // Track sensor hook-state mtimes for sensor:ran events
  const sensorMtimes = new Map<string, number>();
  if (existsSync(HOOK_STATE_DIR)) {
    for (const file of readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"))) {
      try {
        const mtime = statSync(join(HOOK_STATE_DIR, file)).mtimeMs;
        sensorMtimes.set(file, mtime);
      } catch { /* skip */ }
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      sseClients.add(controller);
      console.log(`[SSE] Client connected (${sseClients.size}/${MAX_SSE_CLIENTS} active)`);

      const encoder = new TextEncoder();

      const send = (event: string, data: unknown): boolean => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          // Controller closed — client disconnected; trigger cleanup
          const fn = sseCleanups.get(controller);
          fn?.();
          return false;
        }
      };

      // Send initial heartbeat
      send("heartbeat", { time: new Date().toISOString() });

      const refs = {
        interval: null as ReturnType<typeof setInterval> | null,
        timeout: null as ReturnType<typeof setTimeout> | null,
      };

      refs.interval = setInterval(() => {
        try {
          // Heartbeat — also detects dead connections early
          if (!send("heartbeat", { time: new Date().toISOString() })) return;

          // Check for new tasks and status changes (single query to avoid double-sends)
          const newTasks = db.query(
            "SELECT id, subject, status, priority, source, created_at FROM tasks WHERE id > ? ORDER BY id ASC"
          ).all(lastTaskId) as Array<{ id: number; subject: string; status: string; priority: number; source: string | null; created_at: string }>;

          for (const task of newTasks) {
            if (task.status === "completed") {
              send("task:completed", task);
            } else if (task.status === "failed") {
              send("task:failed", task);
            } else {
              send("task:created", task);
            }
            lastTaskId = task.id;
          }

          // Check for new cycles
          const newCycles = db.query(
            "SELECT id, task_id, started_at, completed_at, duration_ms, cost_usd FROM cycle_log WHERE id > ? ORDER BY id ASC"
          ).all(lastCycleId) as Array<{ id: number; task_id: number | null; started_at: string; completed_at: string | null; duration_ms: number | null; cost_usd: number }>;

          for (const cycle of newCycles) {
            send(cycle.completed_at ? "cycle:completed" : "cycle:started", cycle);
            lastCycleId = cycle.id;
          }

          // Check for sensor activity (hook-state file mtime changes)
          if (existsSync(HOOK_STATE_DIR)) {
            for (const file of readdirSync(HOOK_STATE_DIR).filter(f => f.endsWith(".json"))) {
              try {
                const filePath = join(HOOK_STATE_DIR, file);
                const mtime = statSync(filePath).mtimeMs;
                const prev = sensorMtimes.get(file);
                if (prev !== undefined && mtime > prev) {
                  const name = file.replace(".json", "");
                  const state = JSON.parse(readFileSync(filePath, "utf-8")) as { last_ran: string; last_result: string };
                  send("sensor:ran", { name, last_ran: state.last_ran, last_result: state.last_result });
                }
                sensorMtimes.set(file, mtime);
              } catch { /* skip */ }
            }
          }
        } catch {
          // DB might be busy, skip this tick
        }
      }, 5000);

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (refs.interval) clearInterval(refs.interval);
        if (refs.timeout) clearTimeout(refs.timeout);
        sseClients.delete(controller);
        console.log(`[SSE] Client disconnected (${sseClients.size}/${MAX_SSE_CLIENTS} active)`);
      };

      sseCleanups.set(controller, cleanup);

      refs.timeout = setTimeout(() => {
        send("timeout", { time: new Date().toISOString() });
        try { controller.close(); } catch { /* already closed */ }
        cleanup();
      }, SSE_TIMEOUT_MS);
    },
    cancel(controller) {
      const cleanup = sseCleanups.get(controller);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ---- Static file serving ----

function serveStatic(pathname: string): Response | null {
  // Default to index.html
  const filePath = pathname === "/" ? join(STATIC_DIR, "index.html") : join(STATIC_DIR, pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const file = Bun.file(filePath);

  const cacheHeader = [".html", ".js", ".css"].includes(ext)
    ? "no-cache"
    : "public, max-age=3600";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheHeader,
    },
  });
}

// ---- Fleet Task API: Authenticated cross-agent endpoints ----

const FLEET_SECRET = process.env.ARC_FLEET_SECRET || "";
const KNOWN_AGENTS = new Set(["arc", "spark", "iris", "loom", "forge"]);

function authenticateFleet(req: Request): string | null {
  if (!FLEET_SECRET) return "ARC_FLEET_SECRET not configured";
  const auth = req.headers.get("authorization");
  if (!auth) return "Missing Authorization header";
  const [scheme, token] = auth.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || token !== FLEET_SECRET) {
    return "Invalid fleet credentials";
  }
  return null;
}

function fleetAuthError(message: string): Response {
  return json({ error: message }, 401);
}

async function handleFleetCreateTask(req: Request): Promise<Response> {
  const authErr = authenticateFleet(req);
  if (authErr) return fleetAuthError(authErr);

  let body: {
    subject?: string;
    priority?: number;
    description?: string;
    skills?: string[];
    source?: string;
    assigned_to?: string;
    parent_id?: number;
    model?: string;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return errorResponse("'subject' is required", 400);
  if (subject.length > 500) return errorResponse("Subject too long (max 500 chars)", 400);

  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) return errorResponse("'source' is required (e.g. 'agent:spark')", 400);

  let priority = 5;
  if (body.priority !== undefined) {
    if (typeof body.priority !== "number" || !Number.isInteger(body.priority) || body.priority < 1 || body.priority > 10) {
      return errorResponse("'priority' must be an integer 1-10", 400);
    }
    priority = body.priority;
  }

  let description: string | undefined;
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return errorResponse("'description' must be a string", 400);
    if (body.description.length > 5000) return errorResponse("Description too long (max 5000 chars)", 400);
    description = body.description.trim() || undefined;
  }

  let skills: string | undefined;
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || !body.skills.every((s): s is string => typeof s === "string")) {
      return errorResponse("'skills' must be an array of strings", 400);
    }
    if (body.skills.length > 10) return errorResponse("Too many skills (max 10)", 400);
    skills = JSON.stringify(body.skills);
  }

  let assignedTo: string | undefined;
  if (body.assigned_to !== undefined) {
    if (typeof body.assigned_to !== "string") return errorResponse("'assigned_to' must be a string", 400);
    assignedTo = body.assigned_to.trim().toLowerCase();
    if (!KNOWN_AGENTS.has(assignedTo)) {
      return errorResponse(`Unknown agent '${assignedTo}'. Known: ${[...KNOWN_AGENTS].join(", ")}`, 400);
    }
  }

  let parentId: number | undefined;
  if (body.parent_id !== undefined) {
    if (typeof body.parent_id !== "number" || !Number.isInteger(body.parent_id) || body.parent_id < 1) {
      return errorResponse("'parent_id' must be a positive integer", 400);
    }
    parentId = body.parent_id;
  }

  let model: string | undefined;
  if (body.model !== undefined) {
    if (typeof body.model !== "string") return errorResponse("'model' must be a string", 400);
    model = body.model.trim() || undefined;
  }

  const taskId = insertTask({
    subject,
    description,
    skills,
    priority,
    source,
    assigned_to: assignedTo,
    parent_id: parentId,
    model,
  });

  const task = db.query(
    "SELECT id, subject, description, skills, priority, status, source, assigned_to, model, created_at FROM tasks WHERE id = ?"
  ).get(taskId);

  return json(task, 201);
}

function handleFleetGetTasks(url: URL, req: Request): Response {
  const authErr = authenticateFleet(req);
  if (authErr) return fleetAuthError(authErr);

  const agent = url.searchParams.get("agent")?.trim().toLowerCase();
  const status = url.searchParams.get("status") || "pending";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let rows;
  if (agent) {
    rows = db.query(
      `SELECT id, subject, description, skills, priority, status, source, assigned_to, model, created_at
       FROM tasks WHERE assigned_to = ? AND status = ? ORDER BY priority ASC, id ASC LIMIT ?`
    ).all(agent, status, limit);
  } else {
    rows = db.query(
      `SELECT id, subject, description, skills, priority, status, source, assigned_to, model, created_at
       FROM tasks WHERE assigned_to IS NOT NULL AND status = ? ORDER BY priority ASC, id ASC LIMIT ?`
    ).all(status, limit);
  }

  return json({ tasks: rows, count: (rows as unknown[]).length });
}

async function handleFleetCompleteTask(req: Request, id: string): Promise<Response> {
  const authErr = authenticateFleet(req);
  if (authErr) return fleetAuthError(authErr);

  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return errorResponse("Invalid task ID", 400);

  let body: {
    status?: string;
    summary?: string;
    detail?: string;
    cost_usd?: number;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const task = db.query("SELECT id, status, assigned_to FROM tasks WHERE id = ?").get(taskId) as {
    id: number; status: string; assigned_to: string | null;
  } | null;

  if (!task) return errorResponse("Task not found", 404);
  if (task.status !== "pending" && task.status !== "active") {
    return errorResponse(`Task is not pending or active (current: ${task.status})`, 409);
  }

  const finalStatus = body.status === "failed" ? "failed" : "completed";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) return errorResponse("'summary' is required", 400);
  if (summary.length > 1000) return errorResponse("Summary too long (max 1000 chars)", 400);

  const detail = typeof body.detail === "string" ? body.detail.trim() : undefined;

  if (finalStatus === "completed") {
    markTaskCompleted(taskId, summary, detail);
  } else {
    markTaskFailed(taskId, summary);
  }

  // Update cost if provided
  if (typeof body.cost_usd === "number" && body.cost_usd >= 0) {
    dbWrite.query("UPDATE tasks SET cost_usd = ? WHERE id = ?").run(body.cost_usd, taskId);
  }

  const updated = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return json(updated);
}

// ---- Agent Hub API ----

function handleHubListAgents(): Response {
  const agents = getAllHubAgents();
  return json({ agents, count: agents.length });
}

function handleHubGetAgent(name: string): Response {
  const agent = getHubAgent(name);
  if (!agent) return errorResponse("Agent not found", 404);
  const capabilities = getHubCapabilities(name);
  return json({ agent, capabilities });
}

async function handleHubRegisterAgent(req: Request): Promise<Response> {
  const authErr = authenticateFleet(req);
  if (authErr) return fleetAuthError(authErr);

  let body: {
    agent_name?: string;
    ip_address?: string;
    display_name?: string;
    stx_address?: string;
    btc_address?: string;
    bns_name?: string;
    status?: string;
    version?: string;
    skill_count?: number;
    sensor_count?: number;
    pending_tasks?: number;
    active_tasks?: number;
    cost_today_usd?: number;
    capabilities?: Array<{
      skill_name: string;
      has_sensor?: boolean;
      has_cli?: boolean;
      has_agent_md?: boolean;
      tags?: string[];
    }>;
  };

  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.agent_name || !body.ip_address) {
    return errorResponse("'agent_name' and 'ip_address' are required", 400);
  }

  upsertHubAgent({
    agent_name: body.agent_name,
    ip_address: body.ip_address,
    display_name: body.display_name,
    stx_address: body.stx_address,
    btc_address: body.btc_address,
    bns_name: body.bns_name,
    status: body.status,
    version: body.version,
    skill_count: body.skill_count,
    sensor_count: body.sensor_count,
    pending_tasks: body.pending_tasks,
    active_tasks: body.active_tasks,
    cost_today_usd: body.cost_today_usd,
  });

  // Update capabilities if provided
  if (body.capabilities && Array.isArray(body.capabilities)) {
    const caps: InsertHubCapability[] = body.capabilities.map((c) => ({
      agent_name: body.agent_name!,
      skill_name: c.skill_name,
      has_sensor: c.has_sensor ? 1 : 0,
      has_cli: c.has_cli ? 1 : 0,
      has_agent_md: c.has_agent_md ? 1 : 0,
      tags: c.tags && c.tags.length > 0 ? JSON.stringify(c.tags) : null,
    }));
    replaceAgentCapabilities(body.agent_name, caps);
  }

  const agent = getHubAgent(body.agent_name);
  return json(agent, 201);
}

function handleHubCapabilities(url: URL): Response {
  const skill = url.searchParams.get("skill")?.trim();
  if (skill) {
    const matches = findAgentForSkill(skill);
    return json({ skill, agents: matches });
  }
  // No filter: return all agents with their capability counts
  const agents = getAllHubAgents();
  const summary = agents.map((a) => ({
    agent_name: a.agent_name,
    skill_count: a.skill_count,
    sensor_count: a.sensor_count,
    status: a.status,
  }));
  return json({ capabilities: summary });
}

function handleHubHealth(): Response {
  const health = getFleetHealth();
  const agents = getAllHubAgents();
  const agentDetails = agents.map((a) => ({
    agent_name: a.agent_name,
    status: a.status,
    ip_address: a.ip_address,
    pending_tasks: a.pending_tasks,
    active_tasks: a.active_tasks,
    cost_today_usd: a.cost_today_usd,
    last_heartbeat: a.last_heartbeat,
  }));
  return json({ ...health, agents: agentDetails });
}

async function handleHubRoute(req: Request): Promise<Response> {
  const authErr = authenticateFleet(req);
  if (authErr) return fleetAuthError(authErr);

  let body: {
    task_id?: number;
    skill?: string;
    from_agent?: string;
  };

  try {
    body = await req.json() as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.skill) return errorResponse("'skill' is required", 400);

  const matches = findAgentForSkill(body.skill);
  if (matches.length === 0) {
    return json({ routed: false, reason: `No online agent has skill '${body.skill}'` });
  }

  const bestAgent = matches[0].agent_name;
  let routeId: number | null = null;

  if (body.task_id) {
    routeId = insertTaskRoute(
      body.task_id,
      body.from_agent || "arc",
      bestAgent,
      body.skill,
      "capability-match",
    );
  }

  return json({
    routed: true,
    to_agent: bestAgent,
    skill_match: body.skill,
    route_id: routeId,
    alternatives: matches.slice(1).map((m) => m.agent_name),
  });
}

// ---- Router ----

function route(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // Fleet task API (authenticated)
  if (method === "POST" && path === "/api/fleet/tasks") return handleFleetCreateTask(req);
  if (method === "GET" && path === "/api/fleet/tasks") return handleFleetGetTasks(url, req);
  const fleetCompleteMatch = path.match(/^\/api\/fleet\/tasks\/(\d+)\/complete$/);
  if (method === "POST" && fleetCompleteMatch) return handleFleetCompleteTask(req, fleetCompleteMatch[1]);

  // Agent Hub API
  if (method === "GET" && path === "/api/hub/agents") return handleHubListAgents();
  if (method === "POST" && path === "/api/hub/agents") return handleHubRegisterAgent(req);
  if (method === "GET" && path === "/api/hub/capabilities") return handleHubCapabilities(url);
  if (method === "GET" && path === "/api/hub/health") return handleHubHealth();
  if (method === "POST" && path === "/api/hub/route") return handleHubRoute(req);
  const hubAgentMatch = path.match(/^\/api\/hub\/agents\/([a-z0-9-]+)$/);
  if (method === "GET" && hubAgentMatch) return handleHubGetAgent(hubAgentMatch[1]);

  // POST routes
  if (method === "POST" && path === "/api/tasks") return handlePostTask(req);
  if (method === "POST" && path === "/api/messages/fleet") return handlePostFleetMessage(req);
  if (method === "POST" && path === "/api/messages") return handlePostMessage(req);
  if (method === "POST" && path === "/api/ask") return handleAsk(req);
  if (method === "POST" && path === "/api/services/pr-review") return handlePrReview(req);
  if (method === "POST" && path === "/api/roundtable/respond") return handleRoundtableRespond(req);
  if (method === "POST" && path === "/api/roundtable/receive") return handleRoundtableReceive(req);
  if (method === "POST" && path === "/api/consensus/vote") return handleConsensusVote(req);
  if (method === "POST" && path === "/api/arena/run") return handleArenaRun(req);

  // GET: Ask Arc pricing and rate limit info
  if (method === "GET" && path === "/api/ask") {
    const today = getAskDayKey();
    if (today !== askDayKey) { askDayKey = today; askDayCount = 0; }
    return json({
      service: "ask-arc",
      description: "Pay-per-question endpoint. Ask Arc anything.",
      tiers: Object.fromEntries(
        Object.entries(ASK_TIERS).map(([name, t]) => [name, { model: t.model, cost_sats: t.cost_sats }])
      ),
      daily_limit: ASK_DAILY_LIMIT,
      daily_remaining: ASK_DAILY_LIMIT - askDayCount,
      usage: "POST /api/ask with { question, tier?, context? }",
    });
  }

  // GET: PR Review service pricing and rate limit info
  if (method === "GET" && path === "/api/services/pr-review") {
    const today = getPrReviewDayKey();
    if (today !== prReviewDayKey) { prReviewDayKey = today; prReviewDayCount = 0; }
    return json({
      service: "pr-review",
      description: "Paid PR code review. Submit a GitHub PR URL and receive Arc's informed review with severity labels, inline suggestions, and security analysis.",
      tiers: Object.fromEntries(
        Object.entries(PR_REVIEW_TIERS).map(([name, t]) => [name, { cost_sats: t.cost_sats, label: t.label }])
      ),
      daily_limit: PR_REVIEW_DAILY_LIMIT,
      daily_remaining: PR_REVIEW_DAILY_LIMIT - prReviewDayCount,
      usage: "POST /api/services/pr-review with { pr_url, tier?, notes? }",
    });
  }

  // Fleet messages
  if (path === "/api/messages/fleet") {
    if (method === "GET") return handleGetFleetMessages(url);
  }

  // Email thread API
  if (path === "/api/email/threads") return handleEmailThreads(url);
  const emailThreadMatch = path.match(/^\/api\/email\/threads\/(.+)$/);
  if (emailThreadMatch) return handleEmailThread(emailThreadMatch[1]);

  // API routes
  if (path === "/api/status") return handleStatus();
  if (path === "/api/tasks") return handleTasks(url);
  if (path === "/api/cycles") return handleCycles(url);
  if (path === "/api/sensors") return handleSensors();
  if (path === "/api/sensors/schedule") return handleSensorSchedule();
  if (path === "/api/skills") return handleSkills();
  if (path === "/api/costs") return handleCosts(url);
  if (path === "/api/identity") return handleIdentity();
  if (path === "/api/face") return handleFace();
  if (path === "/api/reputation") return handleReputation(url);
  if (path === "/api/events") return handleEvents();
  if (path === "/api/arena/history") return handleArenaHistory();

  // Arena run by ID: /api/arena/runs/:id
  const arenaMatch = path.match(/^\/api\/arena\/runs\/(.+)$/);
  if (arenaMatch) return handleArenaRunById(arenaMatch[1]);

  // Task kill: POST /api/tasks/:id/kill
  const killMatch = path.match(/^\/api\/tasks\/(\d+)\/kill$/);
  if (method === "POST" && killMatch) return handleKillTask(req, killMatch[1]);

  // Task by ID: /api/tasks/:id
  const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) return handleTaskById(taskMatch[1]);

  // Clean URL routing for multi-page app
  if (path === "/sensors" || path === "/sensors/schedule" || path === "/skills" || path === "/identity" || path === "/email") {
    const htmlPath = join(STATIC_DIR, path + ".html");
    if (existsSync(htmlPath)) {
      return new Response(Bun.file(htmlPath), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // Static files
  const staticResponse = serveStatic(path);
  if (staticResponse) return staticResponse;

  // 404
  return errorResponse("Not found", 404);
}

// ---- Server ----

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: route,
});

console.log(`Arc dashboard running on http://0.0.0.0:${server.port}`);
