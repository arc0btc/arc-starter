#!/usr/bin/env bun
// arc-weekly-presentation/cli.ts
//
// Generates a week-over-week HTML slide deck from live Arc data.
// Four consistent sections every week:
//   1. Dev Activity — PRs merged, commits
//   2. Social — blog posts, X posts, news beats
//   3. Services — arc0btc.com stats + updates
//   4. Self Improvements — new/updated skills, sensors, memory changes
//
// Usage:
//   arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD] [--research-file PATH]
//   arc skills run --name arc-weekly-presentation -- list

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { parseFlags } from "../../src/utils";
import { initDatabase, getDatabase } from "../../src/db";
import { discoverSkills } from "../../src/skills";
import { initContactsSchema, getAllContacts, resolveDisplayName } from "../contacts/schema";

const ROOT = join(import.meta.dir, "../..");
const WEB_DIR = join(ROOT, "src/web");
const PRESENTATION_PATH = join(WEB_DIR, "presentation.html");
const ARCHIVE_DIR = join(WEB_DIR, "presentations");

// ---- Types ----

interface DevActivity {
  prs: Array<{ title: string; repo: string; url?: string }>;
  commits: number;
  contributors: string[];
}

interface SocialActivity {
  blogPosts: Array<{ title: string; url?: string }>;
  xPosts: Array<{ text: string; url?: string }>;
  newsBeats: string[];
}

interface ServicesUpdate {
  items: Array<{ title: string; detail?: string }>;
  siteUrl: string;
}

interface SelfImprovements {
  newSkills: Array<{ name: string; description: string }>;
  updatedSkills: Array<{ name: string; description: string }>;
  newSensors: Array<{ name: string; description: string }>;
  memoryChanges: string[];
}

interface WeekData {
  weekEnd: string;       // YYYY-MM-DD
  weekStart: string;     // YYYY-MM-DD
  devActivity: DevActivity;
  socialActivity: SocialActivity;
  servicesUpdates: ServicesUpdate;
  selfImprovements: SelfImprovements;
  taskStats: { completed: number; failed: number; total: number };
  totalSkills: number;
  totalSensors: number;
  costSummary: { totalCost: number; totalTasks: number; avgPerTask: number };
  newsSignals: number;
  newAgents: Array<{ name: string; btcAddress: string; bnsName?: string }>;
}

/** Supplementary research data from Sonnet subagents */
interface ResearchData {
  devActivity?: Partial<DevActivity>;
  socialActivity?: Partial<SocialActivity>;
  servicesUpdates?: Partial<ServicesUpdate>;
  selfImprovements?: Partial<SelfImprovements>;
}

// ---- Data collection ----

function getWeekRange(weekEnd: string): { start: string; end: string } {
  const end = new Date(weekEnd + "T23:59:59Z");
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: weekEnd,
  };
}

function getNewSkillsFromGit(since: string): Array<{ name: string; description: string }> {
  const result = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline", "--diff-filter=A", "--name-only", "--", "skills/*/SKILL.md"],
    cwd: ROOT,
  });
  const output = result.stdout.toString().trim();
  if (!output) return [];

  const skillPaths = output.split("\n").filter(l => l.startsWith("skills/") && l.endsWith("SKILL.md"));
  const seen = new Set<string>();
  const results: Array<{ name: string; description: string }> = [];

  for (const p of skillPaths) {
    const name = p.split("/")[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const fullPath = join(ROOT, p);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf-8");
    const descMatch = content.match(/^description:\s*(.+)$/m);
    results.push({
      name,
      description: descMatch ? descMatch[1].trim() : "",
    });
  }

  return results;
}

function getUpdatedSkillsFromGit(since: string, newSkillNames: Set<string>): Array<{ name: string; description: string }> {
  const result = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline", "--diff-filter=M", "--name-only", "--", "skills/*/SKILL.md", "skills/*/cli.ts", "skills/*/sensor.ts"],
    cwd: ROOT,
  });
  const output = result.stdout.toString().trim();
  if (!output) return [];

  const paths = output.split("\n").filter(l => l.startsWith("skills/"));
  const seen = new Set<string>();
  const results: Array<{ name: string; description: string }> = [];

  for (const p of paths) {
    const name = p.split("/")[1];
    if (seen.has(name) || newSkillNames.has(name)) continue;
    seen.add(name);

    const skillMd = join(ROOT, "skills", name, "SKILL.md");
    let description = "";
    if (existsSync(skillMd)) {
      const content = readFileSync(skillMd, "utf-8");
      const descMatch = content.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim();
    }
    results.push({ name, description });
  }

  return results;
}

function getNewSensorsFromGit(since: string): Array<{ name: string; description: string }> {
  const result = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline", "--diff-filter=A", "--name-only", "--", "skills/*/sensor.ts"],
    cwd: ROOT,
  });
  const output = result.stdout.toString().trim();
  if (!output) return [];

  const sensorPaths = output.split("\n").filter(l => l.startsWith("skills/") && l.endsWith("sensor.ts"));
  const seen = new Set<string>();
  const results: Array<{ name: string; description: string }> = [];

  for (const p of sensorPaths) {
    const name = p.split("/")[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const skillMd = join(ROOT, "skills", name, "SKILL.md");
    let description = "";
    if (existsSync(skillMd)) {
      const content = readFileSync(skillMd, "utf-8");
      const descMatch = content.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim();
    }
    results.push({ name, description });
  }

  return results;
}

function getMemoryChangesFromGit(since: string): string[] {
  const result = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline", "--", "memory/"],
    cwd: ROOT,
  });
  const output = result.stdout.toString().trim();
  if (!output) return [];

  // Extract commit subjects (skip hash), filter out auto-commit noise
  return output.split("\n")
    .map(line => line.replace(/^[a-f0-9]+ /, "").trim())
    .filter(line => Boolean(line) && !line.startsWith("chore(loop)") && !line.startsWith("chore(housekeeping)"))
    .slice(0, 10);
}

function getDevActivityFromGit(since: string): DevActivity {
  // Count commits in the date range
  const commitResult = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline"],
    cwd: ROOT,
  });
  const commitLines = commitResult.stdout.toString().trim().split("\n").filter(Boolean);
  const commits = commitLines.length;

  // Get unique authors
  const authorResult = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--format=%aN"],
    cwd: ROOT,
  });
  const authors = [...new Set(authorResult.stdout.toString().trim().split("\n").filter(Boolean))];

  // Get merged PRs from git log (merge commits or PR-related commits)
  const prResult = Bun.spawnSync({
    cmd: ["git", "log", `--since=${since}`, "--oneline", "--grep=Merge pull request", "--grep=feat(", "--grep=fix(", "--grep=refactor("],
    cwd: ROOT,
  });
  const prLines = prResult.stdout.toString().trim().split("\n").filter(Boolean);
  const prs = prLines.slice(0, 12).map(line => ({
    title: line.replace(/^[a-f0-9]+ /, "").trim(),
    repo: "arc-starter",
  }));

  return { prs, commits, contributors: authors };
}

function getSocialActivityFromDb(startDate: string, endDate: string): SocialActivity {
  const db = getDatabase();

  // Blog posts — actual published posts (Generate/Draft/Publish tasks, NOT "Syndicate to X")
  // Must have result_summary starting with "Published" or "Created and published" (actual publication)
  const blogRows = db.query(`
    SELECT subject, result_summary FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND (subject LIKE '%blog post%' OR subject LIKE '%Generate new blog%' OR subject LIKE '%Draft blog%' OR subject LIKE '%Publish%blog%')
      AND subject NOT LIKE '%Syndicate to X%'
      AND result_summary IS NOT NULL
      AND (result_summary LIKE 'Published%' OR result_summary LIKE 'Created and published%')
    ORDER BY created_at DESC
    LIMIT 10
  `).all(startDate, endDate) as Array<{ subject: string; result_summary: string | null }>;

  const blogPosts: Array<{ title: string; url?: string }> = [];
  for (const r of blogRows) {
    const raw = r.result_summary || r.subject;
    // Extract quoted title: "Published 'Title Here'" or "Published new post: 'slug': description"
    const quotedMatch = raw.match(/'([^']+)'/);
    if (quotedMatch) {
      const title = quotedMatch[1];
      if (/^\d{4}-\d{2}-\d{2}/.test(title)) {
        // Slug-style: "2026-03-16-three-models-one-queue" → "Three Models One Queue"
        const slug = title.replace(/^\d{4}-\d{2}-\d{2}-/, "");
        blogPosts.push({ title: slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") });
      } else {
        blogPosts.push({ title });
      }
    }
    // If no quoted title found, skip — it's not a clean blog title
  }

  // X posts — syndication tasks have actual post content; also include direct X engagement
  const xRows = db.query(`
    SELECT subject, result_summary FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND (
        (subject LIKE 'Syndicate to X:%')
        OR (
          (skills LIKE '%x-engagement%' OR skills LIKE '%x-thread%' OR skills LIKE '%x-posting%'
           OR skills LIKE '%social-x-posting%' OR skills LIKE '%social-x-ecosystem%')
          AND (subject LIKE '%post%' OR subject LIKE '%thread%' OR subject LIKE '%tweet%'
               OR subject LIKE '%reply%' OR subject LIKE '%mention%' OR subject LIKE '%X:%')
          AND subject NOT LIKE 'Syndicate to X:%'
        )
      )
    ORDER BY created_at DESC
    LIMIT 10
  `).all(startDate, endDate) as Array<{ subject: string; result_summary: string | null }>;

  const xPosts = xRows.map(r => {
    // For syndication tasks, extract the blog title from subject "Syndicate to X: <title>"
    const synMatch = r.subject.match(/^Syndicate to X:\s*(.+)/);
    if (synMatch) return { text: `Syndicated: ${synMatch[1]}`, url: undefined as string | undefined };
    return { text: r.result_summary || r.subject, url: undefined as string | undefined };
  });

  // News beats — tasks with aibtc-news skill
  const newsRows = db.query(`
    SELECT subject FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND (skills LIKE '%aibtc-news%' OR skills LIKE '%news%')
      AND status = 'completed'
      AND subject LIKE '%beat%'
    ORDER BY created_at DESC
    LIMIT 5
  `).all(startDate, endDate) as Array<{ subject: string }>;

  const newsBeats = newsRows.map(r => r.subject);

  return { blogPosts, xPosts, newsBeats };
}

function getNewsSignalsCount(startDate: string, endDate: string): number {
  const db = getDatabase();
  const row = db.query(`
    SELECT COUNT(*) as taskCount FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND (skills LIKE '%aibtc-news%' OR skills LIKE '%news%')
      AND status = 'completed'
  `).get(startDate, endDate) as { taskCount: number } | null;
  return row?.taskCount ?? 0;
}

function getServicesUpdatesFromDb(startDate: string, _endDate: string): ServicesUpdate {
  const items: Array<{ title: string; detail?: string }> = [];

  // 1. Service status from systemctl
  const serviceNames = ["arc-web", "arc-dispatch", "arc-sensors", "arc-mcp", "arc-observatory"];
  for (const svc of serviceNames) {
    const result = Bun.spawnSync({
      cmd: ["systemctl", "--user", "is-active", `${svc}.service`],
    });
    const status = result.stdout.toString().trim();
    const label = svc.replace("arc-", "");
    items.push({
      title: `${label}: ${status === "active" ? "running" : status}`,
      detail: status === "active" ? "healthy" : undefined,
    });
  }

  // 2. Recent web deployments from git
  const gitResult = Bun.spawnSync({
    cmd: ["git", "log", `--since=${startDate}`, "--oneline", "--no-merges",
      "--grep=feat\\|fix\\|refactor", "--", "src/web.ts", "src/web/"],
    cwd: ROOT,
  });
  const gitLines = gitResult.stdout.toString().trim().split("\n").filter(Boolean);
  for (const line of gitLines.slice(0, 5)) {
    // Strip commit hash prefix
    const commitMessage = line.replace(/^[a-f0-9]+\s+/, "");
    items.push({ title: commitMessage, detail: "deployment" });
  }

  // 3. If no deployments found, note it
  if (gitLines.length === 0) {
    items.push({ title: "No web deployments this week" });
  }

  return {
    items,
    siteUrl: "arc0btc.com",
  };
}

function getTaskStats(startDate: string, endDate: string): WeekData["taskStats"] {
  const db = getDatabase();
  const row = db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) as total
    FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
  `).get(startDate, endDate) as { completed: number; failed: number; total: number } | null;

  return row ?? { completed: 0, failed: 0, total: 0 };
}

function getCostSummary(startDate: string, endDate: string): WeekData["costSummary"] {
  const db = getDatabase();
  const row = db.query(`
    SELECT
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COUNT(*) as total_tasks
    FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
  `).get(startDate, endDate) as { total_cost: number; total_tasks: number } | null;

  const totalCost = row?.total_cost ?? 0;
  const totalTasks = row?.total_tasks ?? 0;
  return {
    totalCost,
    totalTasks,
    avgPerTask: totalTasks > 0 ? totalCost / totalTasks : 0,
  };
}

function getNewAgents(startDate: string): WeekData["newAgents"] {
  try {
    initContactsSchema();
    const all = getAllContacts("active");
    return all
      .filter(c => c.type === "agent" && c.created_at >= startDate)
      .map(c => ({
        name: resolveDisplayName(c),
        btcAddress: c.btc_address ?? "",
        bnsName: c.bns_name ?? undefined,
      }));
  } catch {
    return [];
  }
}

function collectWeekData(weekEndDate: string, research?: ResearchData): WeekData {
  const { start, end } = getWeekRange(weekEndDate);
  const allSkills = discoverSkills();
  const totalSensors = allSkills.filter(s => s.hasSensor).length;

  // Local data collection
  const newSkills = getNewSkillsFromGit(start);
  const newSkillNames = new Set(newSkills.map(s => s.name));
  const updatedSkills = getUpdatedSkillsFromGit(start, newSkillNames);
  const newSensors = getNewSensorsFromGit(start);
  const memoryChanges = getMemoryChangesFromGit(start);
  const devActivity = getDevActivityFromGit(start);
  const socialActivity = getSocialActivityFromDb(start, end);
  const servicesUpdates = getServicesUpdatesFromDb(start, end);

  // Merge research data (subagent findings override/supplement local data)
  const data: WeekData = {
    weekEnd: end,
    weekStart: start,
    devActivity: {
      prs: research?.devActivity?.prs ?? devActivity.prs,
      commits: research?.devActivity?.commits ?? devActivity.commits,
      contributors: research?.devActivity?.contributors ?? devActivity.contributors,
    },
    socialActivity: {
      blogPosts: research?.socialActivity?.blogPosts ?? socialActivity.blogPosts,
      xPosts: research?.socialActivity?.xPosts ?? socialActivity.xPosts,
      newsBeats: research?.socialActivity?.newsBeats ?? socialActivity.newsBeats,
    },
    servicesUpdates: {
      items: research?.servicesUpdates?.items ?? servicesUpdates.items,
      siteUrl: research?.servicesUpdates?.siteUrl ?? servicesUpdates.siteUrl,
    },
    selfImprovements: {
      newSkills: research?.selfImprovements?.newSkills ?? newSkills,
      updatedSkills: research?.selfImprovements?.updatedSkills ?? updatedSkills,
      newSensors: research?.selfImprovements?.newSensors ?? newSensors,
      memoryChanges: research?.selfImprovements?.memoryChanges ?? memoryChanges,
    },
    taskStats: getTaskStats(start, end),
    totalSkills: allSkills.length,
    totalSensors,
    costSummary: getCostSummary(start, end),
    newsSignals: getNewsSignalsCount(start, end),
    newAgents: getNewAgents(start),
  };

  return data;
}

// ---- HTML rendering ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return `${months[s.getUTCMonth()]} ${s.getUTCDate()}&ndash;${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  }
  return `${months[s.getUTCMonth()]} ${s.getUTCDate()} &ndash; ${months[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

async function fetchBitcoinFaceUrl(name: string, btcAddress: string): Promise<string> {
  // Prefer BNS name, fall back to BTC address for bitcoinfaces.xyz API
  const query = name.endsWith(".btc") ? name.replace(/\.btc$/, "") : btcAddress;
  if (!query) return "";
  return `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(query)}`;
}

async function renderPresentation(data: WeekData): Promise<string> {
  const dateRange = formatDateRange(data.weekStart, data.weekEnd);
  const slides: string[] = [];

  function addSlide(content: string): void {
    slides.push(content);
  }

  /** Consistent number formatting — all stats use locale string for readability */
  function fmtNum(n: number): string {
    return n.toLocaleString();
  }

  const { devActivity, socialActivity, servicesUpdates, selfImprovements } = data;

  // Shared stats used by both Slide 1 and closing slide (Issue #8: must match exactly)
  const totalPosts = socialActivity.blogPosts.length + socialActivity.xPosts.length;

  // ──────────────────────────────────────────────
  // Slide 1: Title + Stats Overview
  // Issue #1: consistent formatting (all use fmtNum)
  // Issue #2: replace weekly cost with news signals, next to blog posts
  // ──────────────────────────────────────────────
  addSlide(`
  <div class="arc-logo">ARC</div>
  <h1>Arc <span class="highlight">Weekly</span></h1>
  <p class="subtitle">AIBTC Community &mdash; ${dateRange}</p>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-number highlight">${fmtNum(data.taskStats.completed)}</div>
      <div class="stat-label">Tasks Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-number green">${fmtNum(data.totalSkills)}</div>
      <div class="stat-label">Skills Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-number stacks">${fmtNum(data.totalSensors)}</div>
      <div class="stat-label">Sensors Running</div>
    </div>
    <div class="stat-card">
      <div class="stat-number blue">${fmtNum(devActivity.commits)}</div>
      <div class="stat-label">Commits This Week</div>
    </div>
    <div class="stat-card">
      <div class="stat-number purple">${fmtNum(totalPosts)}</div>
      <div class="stat-label">Posts Published</div>
    </div>
    <div class="stat-card">
      <div class="stat-number highlight">${fmtNum(data.newsSignals)}</div>
      <div class="stat-label">News Signals</div>
    </div>
  </div>`);

  // ──────────────────────────────────────────────
  // Slide 2: Dev Activity (always shown)
  // Issue #3: include whoabuddy's commits, frame as 100% AI
  // ──────────────────────────────────────────────
  const prItems = devActivity.prs.length > 0
    ? devActivity.prs.slice(0, 8).map(pr => {
        const repoTag = pr.repo !== "arc-starter" ? ` <span class="text-muted">(${escapeHtml(pr.repo)})</span>` : "";
        return `<li>${escapeHtml(truncate(pr.title, 75))}${repoTag}</li>`;
      }).join("\n        ")
    : `<li class="empty-state">No PRs merged this week</li>`;

  // Format contributors with AI framing
  const contribLabels = devActivity.contributors.map(c => {
    const name = escapeHtml(c);
    if (c.toLowerCase().includes("arc") || c.toLowerCase() === "arc0btc") return `${name} <span class="text-muted">(autonomous)</span>`;
    return `${name} <span class="text-muted">(interactive)</span>`;
  });
  const contribList = contribLabels.length > 0 ? contribLabels.join(", ") : "No contributors";

  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2><span class="highlight">Dev</span> Activity</h2>
  <p class="subtitle">${fmtNum(devActivity.commits)} commits &bull; ${fmtNum(devActivity.prs.length)} PRs &bull; 100% AI-generated code</p>
  <div class="content-cols">
    <div class="col">
      <h3 class="green">PRs &amp; Key Commits</h3>
      <ul>
        ${prItems}
      </ul>
    </div>
    <div class="col">
      <h3 class="blue">Contributors &amp; Stats</h3>
      <ul>
        <li>Contributors: ${contribList}</li>
        <li><span class="highlight">${fmtNum(data.taskStats.completed)}</span> tasks completed</li>
        <li><span class="red">${fmtNum(data.taskStats.failed)}</span> tasks failed</li>
        <li>${fmtNum(data.taskStats.total)} total tasks created</li>
        <li>$${data.costSummary.avgPerTask.toFixed(2)} avg cost per task</li>
      </ul>
    </div>
  </div>`);

  // ──────────────────────────────────────────────
  // Slide 3: Social Activity (always shown)
  // Issue #4: actual blog titles (improved query), actual X posts from skill data
  // ──────────────────────────────────────────────
  const blogItems = socialActivity.blogPosts.length > 0
    ? socialActivity.blogPosts.slice(0, 5).map(p => {
        const link = p.url ? ` <a href="${escapeHtml(p.url)}" class="highlight" style="text-decoration:none;">&rarr;</a>` : "";
        return `<li>${escapeHtml(truncate(p.title, 65))}${link}</li>`;
      }).join("\n        ")
    : `<li class="empty-state">No blog posts this week</li>`;

  const xItems = socialActivity.xPosts.length > 0
    ? socialActivity.xPosts.slice(0, 5).map(p => {
        const link = p.url ? ` <a href="${escapeHtml(p.url)}" class="highlight" style="text-decoration:none;">&rarr;</a>` : "";
        return `<li>${escapeHtml(truncate(p.text, 65))}${link}</li>`;
      }).join("\n        ")
    : `<li class="empty-state">No X posts this week</li>`;

  const newsItems = socialActivity.newsBeats.length > 0
    ? socialActivity.newsBeats.slice(0, 3).map(n =>
        `<li>${escapeHtml(truncate(n, 65))}</li>`
      ).join("\n        ")
    : "";

  const newsSection = newsItems
    ? `<h3 class="stacks" style="margin-top: 20px;">News Beats</h3>
      <ul>${newsItems}</ul>`
    : "";

  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2><span class="highlight">Social</span> &amp; Publishing</h2>
  <p class="subtitle">aibtc.news &bull; arc0btc.com/blog &bull; @arc0btc</p>
  <div class="content-cols">
    <div class="col">
      <h3 class="highlight">Blog Posts</h3>
      <ul>
        ${blogItems}
      </ul>
      ${newsSection}
    </div>
    <div class="col">
      <h3 class="blue">X Posts &amp; Threads</h3>
      <ul>
        ${xItems}
      </ul>
      <p style="margin-top: 16px; font-size: 1rem; color: var(--text-muted);">All posts signed by Arc &mdash; verifiable on-chain</p>
    </div>
  </div>`);

  // ──────────────────────────────────────────────
  // Slide 4: Services — arc0btc.com (always shown)
  // Issue #5: split into clean sections — site health, dashboard, blog
  // ──────────────────────────────────────────────
  // Categorize service updates: service status vs deployments
  const serviceStatusItems: string[] = [];
  const deploymentItems: string[] = [];

  for (const item of servicesUpdates.items) {
    const detail = item.detail ? ` <span class="text-muted">&mdash; ${escapeHtml(item.detail)}</span>` : "";
    const html = `<li>${escapeHtml(truncate(item.title, 70))}${detail}</li>`;

    if (item.detail === "deployment") {
      deploymentItems.push(html);
    } else {
      serviceStatusItems.push(html);
    }
  }

  const siteHealthHtml = serviceStatusItems.length > 0
    ? serviceStatusItems.join("\n        ")
    : `<li class="empty-state">All services nominal</li>`;
  const deploymentsHtml = deploymentItems.length > 0
    ? deploymentItems.join("\n        ")
    : `<li class="empty-state">No deployments this week</li>`;

  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2><span class="highlight">Services</span> &mdash; ${escapeHtml(servicesUpdates.siteUrl)}</h2>
  <p class="subtitle">Service health &amp; recent deployments</p>
  <div class="content-cols">
    <div class="col">
      <h3 class="green">Service Status</h3>
      <ul>
        ${siteHealthHtml}
      </ul>
    </div>
    <div class="col">
      <h3 class="blue">Recent Deployments</h3>
      <ul>
        ${deploymentsHtml}
      </ul>
      <p style="margin-top: 20px; font-size: 1rem; color: var(--text-muted);">
        Visit <span class="highlight">${escapeHtml(servicesUpdates.siteUrl)}</span> for live agent profiles, blog, and services
      </p>
    </div>
  </div>`);

  // ──────────────────────────────────────────────
  // Slide 5: Self Improvements (always shown)
  // Issue #6: restore v3 format — skills-grid cards for skills/sensors,
  //           meaningful memory commits (chore(loop) already filtered)
  // ──────────────────────────────────────────────
  const allSkillChanges = [
    ...selfImprovements.newSkills.slice(0, 4).map(s => ({ ...s, tag: "NEW" as const })),
    ...selfImprovements.updatedSkills.slice(0, 4).map(s => ({ ...s, tag: "UPDATED" as const })),
  ];
  const allSensorChanges = selfImprovements.newSensors.slice(0, 4);

  // Skills/sensors as card grid (v3 format)
  const skillCards = allSkillChanges.length > 0
    ? allSkillChanges.slice(0, 4).map(s => {
        const tagClass = s.tag === "NEW" ? "skill-new" : "skill-upgraded";
        const tagLabel = s.tag === "NEW" ? "New this week" : "Updated";
        return `<div class="skill-card">
      <span class="${tagClass}">${tagLabel}</span>
      <span class="skill-name">${escapeHtml(s.name)}</span>
      <span class="skill-desc">${escapeHtml(truncate(s.description || "skill", 60))}</span>
    </div>`;
      }).join("\n    ")
    : "";

  const sensorCards = allSensorChanges.length > 0
    ? allSensorChanges.slice(0, 2).map(s =>
        `<div class="skill-card">
      <span class="skill-new">New sensor</span>
      <span class="skill-name">${escapeHtml(s.name)}</span>
      <span class="skill-desc">${escapeHtml(truncate(s.description || "sensor", 60))}</span>
    </div>`
      ).join("\n    ")
    : "";

  const hasCards = skillCards || sensorCards;
  const cardsHtml = hasCards
    ? `<div class="skills-grid">
    ${skillCards}${skillCards && sensorCards ? "\n    " : ""}${sensorCards}
  </div>`
    : `<div class="col" style="max-width: 900px; width: 100%;">
    <p class="empty-state" style="color: var(--text-muted); font-style: italic;">No skill or sensor changes this week</p>
  </div>`;

  // Memory section — filtered commits (no chore(loop))
  const memItems = selfImprovements.memoryChanges.length > 0
    ? selfImprovements.memoryChanges.slice(0, 5).map(m =>
        `<li>${escapeHtml(truncate(m, 65))}</li>`
      ).join("\n      ")
    : `<li class="empty-state">No memory updates this week</li>`;

  const totalImprovements = selfImprovements.newSkills.length
    + selfImprovements.updatedSkills.length
    + selfImprovements.newSensors.length;

  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>Self <span class="highlight">Improvements</span></h2>
  <p class="subtitle">${fmtNum(totalImprovements)} skill/sensor changes &bull; ${fmtNum(selfImprovements.memoryChanges.length)} memory updates</p>
  ${cardsHtml}
  <div class="col" style="max-width: 900px; width: 100%; margin-top: 20px;">
    <h3 class="stacks">Memory Updates</h3>
    <ul>
      ${memItems}
    </ul>
  </div>`);

  // ──────────────────────────────────────────────
  // Slide 6: New Agents (conditional — only if agents joined)
  // Issue #7: restore bitcoin faces, fix BTC address lookup
  // ──────────────────────────────────────────────
  if (data.newAgents.length > 0) {
    // Fetch real Bitcoin Face image URLs for each agent
    const agentFaceUrls = await Promise.all(
      data.newAgents.slice(0, 6).map(a =>
        fetchBitcoinFaceUrl(a.bnsName ?? "", a.btcAddress)
      )
    );
    const agentCards = data.newAgents.slice(0, 6).map((a, i) => {
      const btcDisplay = a.btcAddress
        ? a.btcAddress.slice(0, 12) + "&hellip;"
        : "Bitcoin agent";
      const faceUrl = agentFaceUrls[i];
      const faceHtml = faceUrl
        ? `<img src="${faceUrl}" alt="${escapeHtml(a.name)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='&#x20BF;'">`
        : "&#x20BF;";
      return `
    <div class="agent-card">
      <div class="agent-face">${faceHtml}</div>
      <div class="agent-name">${escapeHtml(a.name)}</div>
      <div class="agent-btc">${btcDisplay}</div>
    </div>`;
    }).join("\n");

    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>New Agents <span class="highlight">Welcomed</span></h2>
  <p class="subtitle">${fmtNum(data.newAgents.length)} new Bitcoin agent${data.newAgents.length !== 1 ? "s" : ""} joined the ecosystem</p>
  <div class="agent-grid">
    ${agentCards}
  </div>`);
  }

  // ──────────────────────────────────────────────
  // Slide N: Closing / What's Next
  // Issue #8: stats must match slide 1 exactly — reuse same variables
  // ──────────────────────────────────────────────
  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>What&rsquo;s <span class="highlight">Next</span></h2>
  <div class="cta-box">
    <p style="font-size: 1.3rem; margin-bottom: 24px;">
      Week of ${dateRange}
    </p>
    <ul style="text-align: left; max-width: 700px; margin: 0 auto 32px;">
      <li><span class="highlight">${fmtNum(data.taskStats.completed)}</span> tasks completed</li>
      <li><span class="green">${fmtNum(data.totalSkills)} skills</span> active, <span class="green">${fmtNum(selfImprovements.newSkills.length)} new</span> this week</li>
      <li><span class="stacks">${fmtNum(data.totalSensors)} sensors</span> running 24/7</li>
      <li><span class="blue">${fmtNum(devActivity.commits)}</span> commits, <span class="purple">${fmtNum(totalPosts)}</span> posts published</li>
      <li><span class="highlight">${fmtNum(data.newsSignals)}</span> news signals filed</li>
    </ul>
    <p style="font-size: 1.3rem; margin-top: 8px;">
      <span class="highlight">arc-starter</span> is open source
    </p>
    <p style="color: var(--text-muted); margin-top: 10px; font-size: 1rem;">
      github.com/aibtcdev/arc-starter &bull; @arc0btc &bull; arc0btc.com &bull; aibtc.news
    </p>
  </div>`);

  // ──────────────────────────────────────────────
  // Assemble full HTML
  // ──────────────────────────────────────────────
  const totalSlides = slides.length;
  const slideHtml = slides.map((content, i) => {
    const slideNumber = i + 1;
    const active = i === 0 ? ' class="slide active"' : ' class="slide"';
    return `<!-- Slide ${slideNumber} -->
<div${active} id="slide-${slideNumber}">
  ${content.trim()}
  <div class="slide-number">${slideNumber} / ${totalSlides}</div>
</div>`;
  }).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arc Weekly &mdash; AIBTC Presentation ${data.weekEnd}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;600;700;900&display=swap');

  :root {
    --bg: #000000;
    --bg-card: #0d1117;
    --bg-card2: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --arc-gold: #FEC233;
    --arc-gold-dark: #D4A020;
    --stacks: #5546ff;
    --green: #3fb950;
    --red: #f85149;
    --blue: #58a6ff;
    --purple: #bc8cff;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', system-ui, sans-serif;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }

  .slides-container {
    position: relative;
    height: 100vh;
    width: 100vw;
  }

  .slide {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100vh;
    width: 100vw;
    padding: 60px 80px;
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.35s ease, visibility 0.35s ease;
  }

  .slide.active {
    opacity: 1;
    visibility: visible;
  }

  .slide-number {
    position: absolute;
    bottom: 24px;
    right: 40px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    color: var(--text-muted);
  }

  .arc-logo {
    position: absolute;
    top: 24px;
    left: 40px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-gold);
    letter-spacing: 3px;
  }

  h1 {
    font-size: 4rem;
    font-weight: 900;
    line-height: 1.1;
    margin-bottom: 20px;
    text-align: center;
  }

  h2 {
    font-size: 2.6rem;
    font-weight: 700;
    margin-bottom: 32px;
    text-align: center;
  }

  h3 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 14px;
    color: var(--blue);
  }

  .subtitle {
    font-size: 1.4rem;
    color: var(--text-muted);
    text-align: center;
    margin-bottom: 36px;
  }

  .highlight { color: var(--arc-gold); }
  .stacks { color: var(--stacks); }
  .green { color: var(--green); }
  .red { color: var(--red); }
  .blue { color: var(--blue); }
  .purple { color: var(--purple); }
  .text-muted { color: var(--text-muted); font-size: 0.9em; }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    width: 100%;
    max-width: 1000px;
  }

  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 20px;
    text-align: center;
  }

  .stat-number {
    font-size: 3rem;
    font-weight: 900;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1;
    margin-bottom: 10px;
  }

  .stat-label {
    font-size: 1rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .content-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    width: 100%;
    max-width: 1100px;
  }

  .col {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 32px;
  }

  ul {
    list-style: none;
    padding: 0;
  }

  ul li {
    padding: 9px 0;
    padding-left: 24px;
    position: relative;
    font-size: 1.2rem;
    line-height: 1.5;
  }

  ul li::before {
    content: '\\25B8';
    position: absolute;
    left: 0;
    color: var(--arc-gold);
    font-weight: 700;
  }

  ul li.empty-state {
    color: var(--text-muted);
    font-style: italic;
  }

  ul li.empty-state::before {
    content: '\\2014';
    color: var(--text-muted);
  }

  .skills-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
    width: 100%;
    max-width: 1000px;
  }

  .skill-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .skill-new {
    font-size: 0.8rem;
    color: var(--green);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 700;
  }

  .skill-upgraded {
    font-size: 0.8rem;
    color: var(--arc-gold);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 700;
  }

  .skill-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--arc-gold);
  }

  .skill-desc {
    font-size: 1.05rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .agent-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    width: 100%;
    max-width: 1000px;
  }

  .agent-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .agent-face { font-size: 2.8rem; }
  .agent-name { font-size: 1.15rem; font-weight: 700; color: var(--arc-gold); }
  .agent-btc { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--text-muted); }

  .cta-box {
    background: linear-gradient(135deg, rgba(254,194,51,0.07), rgba(85,70,255,0.07));
    border: 1px solid var(--arc-gold);
    border-radius: 16px;
    padding: 44px 48px;
    text-align: center;
    width: 100%;
    max-width: 900px;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
    background: var(--border);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--arc-gold), var(--stacks));
    transition: width 0.35s ease;
  }

  .nav-hint {
    position: fixed;
    bottom: 24px;
    left: 40px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.35;
  }
</style>
</head>
<body>

<div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
<div class="nav-hint">&larr; &rarr; or click to navigate</div>

<div class="slides-container">

${slideHtml}

</div>

<script>
  const slides = document.querySelectorAll('.slide');
  const progress = document.getElementById('progress');
  let current = 0;

  function showSlide(n) {
    if (n < 0 || n >= slides.length) return;
    slides[current].classList.remove('active');
    current = n;
    slides[current].classList.add('active');
    progress.style.width = ((current + 1) / slides.length * 100) + '%';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      showSlide(current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      showSlide(current - 1);
    } else if (e.key === 'Home') { showSlide(0); }
    else if (e.key === 'End') { showSlide(slides.length - 1); }
  });

  document.addEventListener('click', (e) => {
    if (e.clientX > window.innerWidth / 2) showSlide(current + 1);
    else showSlide(current - 1);
  });

  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
  document.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) showSlide(current + (diff > 0 ? 1 : -1));
  });

  progress.style.width = (1 / slides.length * 100) + '%';
</script>
</body>
</html>`;
}

// ---- Archive management ----

function archiveCurrentPresentation(weekEnd: string): void {
  if (!existsSync(PRESENTATION_PATH)) return;

  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const archiveName = `presentation-${weekEnd}.html`;
  const archivePath = join(ARCHIVE_DIR, archiveName);

  // Don't overwrite existing archive
  if (existsSync(archivePath)) return;

  copyFileSync(PRESENTATION_PATH, archivePath);
  process.stdout.write(`Archived previous presentation to ${archiveName}\n`);
}

function listArchives(): void {
  if (!existsSync(ARCHIVE_DIR)) {
    process.stdout.write("No archived presentations found.\n");
    return;
  }

  const files = readdirSync(ARCHIVE_DIR)
    .filter(f => f.startsWith("presentation-") && f.endsWith(".html"))
    .sort()
    .reverse();

  if (files.length === 0) {
    process.stdout.write("No archived presentations found.\n");
    return;
  }

  process.stdout.write(`Archived presentations (${files.length}):\n`);
  for (const f of files) {
    process.stdout.write(`  ${f}\n`);
  }
}

// ---- Research file loader ----

function loadResearchFile(path: string): ResearchData {
  if (!existsSync(path)) {
    process.stderr.write(`Warning: research file not found: ${path}\n`);
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as ResearchData;
  } catch (error) {
    process.stderr.write(`Warning: failed to parse research file: ${(error as Error).message}\n`);
    return {};
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === "help") {
    process.stdout.write(`arc-weekly-presentation

Commands:
  generate [--week YYYY-MM-DD] [--research-file PATH]  Generate weekly presentation (default: today)
  list                                                   List archived presentations

Options:
  --week           Week ending date (default: today)
  --research-file  JSON file with supplementary research data from subagents
`);
    return;
  }

  if (command === "list") {
    listArchives();
    return;
  }

  if (command === "generate") {
    initDatabase();
    const weekEnd = flags["week"] ?? new Date().toISOString().slice(0, 10);

    // Load research data if provided
    let research: ResearchData | undefined;
    const researchPath = flags["research-file"];
    if (researchPath) {
      process.stdout.write(`Loading research data from ${researchPath}...\n`);
      research = loadResearchFile(researchPath);
    }

    process.stdout.write(`Collecting data for week ending ${weekEnd}...\n`);
    const data = collectWeekData(weekEnd, research);

    process.stdout.write(`  Dev: ${data.devActivity.commits} commits, ${data.devActivity.prs.length} PRs\n`);
    process.stdout.write(`  Social: ${data.socialActivity.blogPosts.length} blog posts, ${data.socialActivity.xPosts.length} X posts\n`);
    process.stdout.write(`  Services: ${data.servicesUpdates.items.length} updates\n`);
    process.stdout.write(`  Self: ${data.selfImprovements.newSkills.length} new skills, ${data.selfImprovements.updatedSkills.length} updated, ${data.selfImprovements.newSensors.length} new sensors\n`);
    process.stdout.write(`  Tasks completed: ${data.taskStats.completed}\n`);
    process.stdout.write(`  New agents: ${data.newAgents.length}\n`);
    process.stdout.write(`  News signals: ${data.newsSignals}\n`);
    process.stdout.write(`  Weekly cost: $${data.costSummary.totalCost.toFixed(2)}\n`);

    // Archive previous before overwriting
    archiveCurrentPresentation(weekEnd);

    const html = await renderPresentation(data);
    writeFileSync(PRESENTATION_PATH, html);
    process.stdout.write(`\nPresentation written to src/web/presentation.html\n`);
    process.stdout.write(`${slides_count(html)} slides generated.\n`);
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.exit(1);
}

function slides_count(html: string): number {
  return (html.match(/id="slide-/g) || []).length;
}

main().catch(error => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
});
