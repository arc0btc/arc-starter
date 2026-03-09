// web.ts — Arc dashboard API server
//
// Read-only SQLite connection. Serves JSON API endpoints and static files from src/web/.
// Run: bun src/web.ts (or via arc skills run --name dashboard -- start)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { initDatabase, getDatabase, insertTask, markTaskFailed } from "./db.ts";
import { discoverSkills } from "./skills.ts";
import { IDENTITY } from "./identity.ts";
import { dispatchCodex } from "./codex.ts";

// ---- Database ----

// Initialize singleton database on startup
initDatabase();
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

function handleReputation(): Response {
  try {
    // Check if reviews table exists (created by arc-reputation skill on first use)
    const tableExists = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='reviews'"
    ).get() as { name: string } | null;

    if (!tableExists) {
      return json({
        submitted: { count: 0, recent: [] },
        received: { count: 0, avg_rating: null, recent: [] },
        btc_address: IDENTITY.btc,
        stx_address: IDENTITY.stx,
      });
    }

    const arc_btc = IDENTITY.btc;

    const submittedCount = db.query(
      "SELECT COUNT(*) as count FROM reviews WHERE reviewer_address = ?"
    ).get(arc_btc) as { count: number };

    const submittedRecent = db.query(
      "SELECT id, subject, reviewee_address, rating, comment, tags, created_at FROM reviews WHERE reviewer_address = ? ORDER BY created_at DESC LIMIT 5"
    ).all(arc_btc) as Array<{ id: number; subject: string; reviewee_address: string; rating: number; comment: string; tags: string; created_at: string }>;

    const receivedCount = db.query(
      "SELECT COUNT(*) as count FROM reviews WHERE reviewee_address = ?"
    ).get(arc_btc) as { count: number };

    const receivedRecent = db.query(
      "SELECT id, subject, reviewer_address, rating, comment, tags, created_at FROM reviews WHERE reviewee_address = ? ORDER BY created_at DESC LIMIT 5"
    ).all(arc_btc) as Array<{ id: number; subject: string; reviewer_address: string; rating: number; comment: string; tags: string; created_at: string }>;

    const receivedAvg = db.query(
      "SELECT AVG(rating) as avg FROM reviews WHERE reviewee_address = ?"
    ).get(arc_btc) as { avg: number | null };

    return json({
      submitted: {
        count: submittedCount.count,
        recent: submittedRecent.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
      },
      received: {
        count: receivedCount.count,
        avg_rating: receivedAvg.avg !== null ? Math.round(receivedAvg.avg * 100) / 100 : null,
        recent: receivedRecent.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
      },
      btc_address: IDENTITY.btc,
      stx_address: IDENTITY.stx,
    });
  } catch {
    return json({
      submitted: { count: 0, recent: [] },
      received: { count: 0, avg_rating: null, recent: [] },
      btc_address: IDENTITY.btc,
      stx_address: IDENTITY.stx,
    });
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
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

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

  // API routes
  if (path === "/api/status") return handleStatus();
  if (path === "/api/tasks") return handleTasks(url);
  if (path === "/api/cycles") return handleCycles(url);
  if (path === "/api/sensors") return handleSensors();
  if (path === "/api/skills") return handleSkills();
  if (path === "/api/costs") return handleCosts(url);
  if (path === "/api/identity") return handleIdentity();
  if (path === "/api/face") return handleFace();
  if (path === "/api/reputation") return handleReputation();
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
  if (path === "/sensors" || path === "/skills") {
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
