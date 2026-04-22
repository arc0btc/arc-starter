#!/usr/bin/env bun
// arc-weekly-presentation/cli.ts
//
// Generates the Monday AIBTC working-group deck from live Arc data.
// Four consistent sections: Dev Activity, Social & Publishing, Services, Self Improvements.
//
// Usage:
//   arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD] [--research-file PATH]
//   arc skills run --name arc-weekly-presentation -- list

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseFlags } from "../../src/utils";
import { initDatabase, getDatabase } from "../../src/db";
import { discoverSkills } from "../../src/skills";
import { initContactsSchema, getAllContacts, resolveDisplayName } from "../contacts/schema";

const ROOT = join(import.meta.dir, "../..");
const WEB_DIR = join(ROOT, "src/web");
const PRESENTATION_PATH = join(WEB_DIR, "presentation.html");
const ARCHIVE_DIR = join(WEB_DIR, "archives");

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
  weekStart: string;
  weekEnd: string;
  devActivity: DevActivity;
  socialActivity: SocialActivity;
  servicesUpdates: ServicesUpdate;
  selfImprovements: SelfImprovements;
  taskStats: { completed: number; failed: number; total: number };
  totalSkills: number;
  totalSensors: number;
  newAgents: Array<{ name: string; btcAddress: string; bnsName?: string }>;
}

interface ResearchData {
  devActivity?: Partial<DevActivity>;
  socialActivity?: Partial<SocialActivity>;
  servicesUpdates?: Partial<ServicesUpdate>;
  selfImprovements?: Partial<SelfImprovements>;
}

// ---- Small helpers ----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(weekEnd: string): { start: string; end: string } {
  // weekEnd is a Monday (ISO date). Range covers the previous 7 days.
  const endDate = new Date(weekEnd);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 7);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}, ${e.getUTCFullYear()}`;
}

function runGit(args: string[]): string {
  const res = Bun.spawnSync({ cmd: ["git", ...args], cwd: ROOT });
  return res.stdout.toString();
}

// ---- Git collection ----

function getNewSkillsFromGit(since: string): SelfImprovements["newSkills"] {
  const output = runGit(["log", `--since=${since}`, "--oneline", "--diff-filter=A", "--name-only", "--", "skills/*/SKILL.md"]).trim();
  if (!output) return [];

  const seen = new Set<string>();
  const out: SelfImprovements["newSkills"] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("skills/") || !line.endsWith("SKILL.md")) continue;
    const name = line.split("/")[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const path = join(ROOT, line);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    const desc = content.match(/^description:\s*(.+)$/m);
    out.push({ name, description: desc ? desc[1].trim() : "" });
  }
  return out;
}

function getUpdatedSkillsFromGit(since: string, exclude: Set<string>): SelfImprovements["updatedSkills"] {
  const output = runGit(["log", `--since=${since}`, "--oneline", "--diff-filter=M", "--name-only", "--", "skills/*/SKILL.md", "skills/*/cli.ts", "skills/*/sensor.ts"]).trim();
  if (!output) return [];

  const seen = new Set<string>();
  const out: SelfImprovements["updatedSkills"] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("skills/")) continue;
    const name = line.split("/")[1];
    if (!name || seen.has(name) || exclude.has(name)) continue;
    seen.add(name);
    const skillMd = join(ROOT, "skills", name, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const content = readFileSync(skillMd, "utf-8");
    const desc = content.match(/^description:\s*(.+)$/m);
    out.push({ name, description: desc ? desc[1].trim() : "" });
  }
  return out;
}

function getNewSensorsFromGit(since: string): SelfImprovements["newSensors"] {
  const output = runGit(["log", `--since=${since}`, "--oneline", "--diff-filter=A", "--name-only", "--", "skills/*/sensor.ts"]).trim();
  if (!output) return [];

  const seen = new Set<string>();
  const out: SelfImprovements["newSensors"] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("skills/") || !line.endsWith("sensor.ts")) continue;
    const name = line.split("/")[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: "sensor" });
  }
  return out;
}

function getMemoryChangesFromGit(since: string): string[] {
  const output = runGit(["log", `--since=${since}`, "--oneline", "--", "memory/"]).trim();
  if (!output) return [];
  return output
    .split("\n")
    .map(l => l.replace(/^[a-f0-9]+\s+/, ""))
    .filter(msg => !msg.startsWith("chore(loop)"))
    .slice(0, 8);
}

function getDevActivityFromGit(since: string): DevActivity {
  // Commits total
  const commitsOut = runGit(["log", `--since=${since}`, "--oneline"]).trim();
  const commits = commitsOut ? commitsOut.split("\n").length : 0;

  // Contributors via shortlog
  const shortlog = runGit(["shortlog", "-sn", "--all", `--since=${since}`]).trim();
  const contributors = shortlog
    ? shortlog.split("\n").map(l => l.trim().split(/\s+/).slice(1).join(" ")).filter(Boolean)
    : [];

  // PR titles (feat/fix) from commit subjects — rough local proxy for merged PRs
  const subjects = runGit(["log", `--since=${since}`, "--format=%s"]).trim();
  const prs: DevActivity["prs"] = [];
  if (subjects) {
    const seen = new Set<string>();
    for (const line of subjects.split("\n")) {
      if (!/^(feat|fix|refactor)(\(|:)/.test(line)) continue;
      if (line.includes("chore(loop)")) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      prs.push({ title: line, repo: "arc-starter" });
      if (prs.length >= 8) break;
    }
  }

  return { prs, commits, contributors };
}

// ---- DB collection ----

function getSocialActivityFromDb(startDate: string, endDate: string): SocialActivity {
  const db = getDatabase();

  // Blog posts — require "Published" / "Created and published" in result_summary
  const blogRows = db.query(`
    SELECT subject, result_summary FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND (subject LIKE '%blog post%' OR subject LIKE '%Generate new blog%'
           OR subject LIKE '%Draft blog%' OR subject LIKE '%Publish%blog%')
      AND subject NOT LIKE '%Syndicate to X%'
      AND result_summary IS NOT NULL
      AND (result_summary LIKE 'Published%' OR result_summary LIKE 'Created and published%')
    ORDER BY created_at DESC
    LIMIT 8
  `).all(startDate, endDate) as Array<{ subject: string; result_summary: string | null }>;

  const blogPosts: SocialActivity["blogPosts"] = [];
  for (const r of blogRows) {
    const raw = r.result_summary || r.subject;
    const quoted = raw.match(/'([^']+)'/);
    if (!quoted) continue;
    let title = quoted[1];
    if (/^\d{4}-\d{2}-\d{2}-/.test(title)) {
      title = title
        .replace(/^\d{4}-\d{2}-\d{2}-/, "")
        .split("-")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    blogPosts.push({ title });
  }

  // X posts — syndication tasks + direct X engagement
  const xRows = db.query(`
    SELECT subject, result_summary FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND (
        subject LIKE 'Syndicate to X:%'
        OR (
          (skills LIKE '%social-x-posting%' OR skills LIKE '%social-x-ecosystem%' OR skills LIKE '%social-agent-engagement%')
          AND (subject LIKE '%post%' OR subject LIKE '%thread%' OR subject LIKE '%tweet%'
               OR subject LIKE '%reply%' OR subject LIKE '%mention%' OR subject LIKE '%X:%')
        )
      )
    ORDER BY created_at DESC
    LIMIT 8
  `).all(startDate, endDate) as Array<{ subject: string; result_summary: string | null }>;

  const xPosts = xRows.map(r => {
    const syn = r.subject.match(/^Syndicate to X:\s*(.+)/);
    if (syn) return { text: `Syndicated: ${syn[1]}` };
    return { text: r.result_summary || r.subject };
  });

  // News beats
  const newsRows = db.query(`
    SELECT DISTINCT subject FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND skills LIKE '%aibtc-news%'
      AND (subject LIKE '%beat%' OR subject LIKE '%signal%' OR subject LIKE '%brief%')
    ORDER BY created_at DESC
    LIMIT 5
  `).all(startDate, endDate) as Array<{ subject: string }>;

  return { blogPosts, xPosts, newsBeats: newsRows.map(r => r.subject) };
}

function getServicesUpdatesFromDb(startDate: string, endDate: string): ServicesUpdate {
  const db = getDatabase();
  const rows = db.query(`
    SELECT subject, result_summary FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND (
        skills LIKE '%arc-web-dashboard%'
        OR skills LIKE '%arc0btc-site-health%'
        OR skills LIKE '%arc0btc-services%'
        OR skills LIKE '%arc-monitoring-service%'
        OR subject LIKE '%arc0btc.com%'
        OR subject LIKE '%dashboard%'
      )
    ORDER BY created_at DESC
    LIMIT 6
  `).all(startDate, endDate) as Array<{ subject: string; result_summary: string | null }>;

  return {
    items: rows.map(r => ({ title: r.subject, detail: r.result_summary ?? undefined })),
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

function getNewAgents(startDate: string): WeekData["newAgents"] {
  try {
    initContactsSchema();
    return getAllContacts("active")
      .filter(c => c.type === "agent" && (c.created_at ?? "") >= startDate)
      .slice(0, 8)
      .map(c => ({
        name: resolveDisplayName(c),
        btcAddress: c.btc_address ?? "",
        bnsName: c.bns_name ?? undefined,
      }));
  } catch {
    return [];
  }
}

// ---- Research file loading ----

function loadResearchFile(path: string): ResearchData {
  if (!existsSync(path)) {
    console.warn(`Research file not found: ${path} — using local data only`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ResearchData;
  } catch (e) {
    console.warn(`Research file parse error: ${e} — using local data only`);
    return {};
  }
}

function collectWeekData(weekEnd: string, research: ResearchData = {}): WeekData {
  const { start, end } = getWeekRange(weekEnd);
  const allSkills = discoverSkills();

  const local = {
    newSkills: getNewSkillsFromGit(start),
    dev: getDevActivityFromGit(start),
    social: getSocialActivityFromDb(start, end),
    services: getServicesUpdatesFromDb(start, end),
  };
  const newSkillNames = new Set(local.newSkills.map(s => s.name));
  const updatedSkills = getUpdatedSkillsFromGit(start, newSkillNames);
  const newSensors = getNewSensorsFromGit(start);
  const memoryChanges = getMemoryChangesFromGit(start);

  return {
    weekStart: start,
    weekEnd: end,
    devActivity: { ...local.dev, ...research.devActivity } as DevActivity,
    socialActivity: { ...local.social, ...research.socialActivity } as SocialActivity,
    servicesUpdates: { ...local.services, ...research.servicesUpdates } as ServicesUpdate,
    selfImprovements: {
      newSkills: research.selfImprovements?.newSkills ?? local.newSkills,
      updatedSkills: research.selfImprovements?.updatedSkills ?? updatedSkills,
      newSensors: research.selfImprovements?.newSensors ?? newSensors,
      memoryChanges: research.selfImprovements?.memoryChanges ?? memoryChanges,
    },
    taskStats: getTaskStats(start, end),
    totalSkills: allSkills.length,
    totalSensors: allSkills.filter(s => s.hasSensor).length,
    newAgents: getNewAgents(start),
  };
}

// ---- Shared styles (Arc Gold brand) ----

const STYLES = `
  :root {
    --bg: #000000;
    --bg-card: #0d1117;
    --bg-card2: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --arc-gold: #FEC233;
    --arc-gold-dim: #D4A020;
    --green: #3fb950;
    --red: #f85149;
    --blue: #58a6ff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; overflow: hidden; }
  .deck { width: 100%; height: 100%; position: relative; }
  .slide { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 2rem 3rem 3.5rem; opacity: 0; pointer-events: none; transition: opacity 0.4s ease; text-align: center; }
  .slide.active { opacity: 1; pointer-events: auto; }
  .arc-logo { position: absolute; top: 1.5rem; left: 2rem; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--arc-gold); letter-spacing: 0.2em; font-size: 0.9rem; }
  h1 { font-size: 4rem; font-weight: 900; letter-spacing: -0.03em; line-height: 1.05; color: var(--text); margin-bottom: 0.75rem; }
  h2 { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.02em; color: var(--text); margin-bottom: 1rem; }
  h3 { font-size: 1.1rem; font-weight: 700; color: var(--arc-gold); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 1rem; }
  .subtitle { font-size: 1.3rem; color: var(--text-dim); font-weight: 400; margin-bottom: 2rem; }
  .highlight { color: var(--arc-gold); }
  .green { color: var(--green); }
  .blue { color: var(--blue); }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; width: 100%; max-width: 1100px; margin-top: 1rem; }
  .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 2rem 1rem; }
  .stat-number { font-family: 'JetBrains Mono', monospace; font-size: 2.8rem; font-weight: 900; line-height: 1; color: var(--arc-gold); }
  .stat-label { font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.75rem; }
  .list-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 2rem; width: 100%; max-width: 1000px; text-align: left; margin-top: 0.5rem; }
  .list-grid li { list-style: none; padding: 0.55rem 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; line-height: 1.4; }
  .list-grid li.empty { background: transparent; border: 1px dashed var(--border); color: var(--text-dim); font-style: italic; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 1.25rem; max-width: 1000px; }
  .pill { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; padding: 0.35rem 0.75rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); }
  .pill.new { color: var(--green); border-color: var(--green); }
  .pill.updated { color: var(--arc-gold); border-color: var(--arc-gold-dim); }
  .link-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.75rem; min-width: 200px; }
  .link-card .label { font-size: 0.8rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.4rem; }
  .link-card .url { font-family: 'JetBrains Mono', monospace; color: var(--arc-gold); font-size: 1.1rem; }
  .agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; max-width: 1000px; margin-top: 1rem; }
  .agent-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 0.75rem; text-align: center; }
  .agent-face { font-size: 2.2rem; color: var(--arc-gold); margin-bottom: 0.5rem; }
  .agent-name { font-weight: 700; margin-bottom: 0.25rem; }
  .agent-btc { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-dim); }
  .bottom-bar { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: rgba(0,0,0,0.9); border-top: 1px solid var(--border); z-index: 100; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--text-dim); }
  .progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--arc-gold); transition: width 0.3s ease; z-index: 100; }
  @media (max-width: 900px) {
    .stats-grid { grid-template-columns: 1fr 1fr; }
    .list-grid { grid-template-columns: 1fr; }
    h1 { font-size: 2.5rem; } h2 { font-size: 1.8rem; }
  }
`;

// ---- Slide renderers ----

function titleSlide(d: WeekData): string {
  return `
  <div class="slide active" data-slide="0">
    <div class="arc-logo">ARC</div>
    <h1>Arc <span class="highlight">Weekly</span></h1>
    <p class="subtitle">AIBTC Working Group &middot; ${formatDateRange(d.weekStart, d.weekEnd)}</p>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">${fmt(d.taskStats.completed)}</div><div class="stat-label">Tasks Completed</div></div>
      <div class="stat-card"><div class="stat-number green">${fmt(d.totalSkills)}</div><div class="stat-label">Skills Active</div></div>
      <div class="stat-card"><div class="stat-number blue">${fmt(d.totalSensors)}</div><div class="stat-label">Sensors Running</div></div>
      <div class="stat-card"><div class="stat-number">${fmt(d.devActivity.prs.length)}</div><div class="stat-label">Shipped Changes</div></div>
    </div>
  </div>`;
}

function devActivitySlide(d: WeekData, idx: number): string {
  const items = d.devActivity.prs.length
    ? d.devActivity.prs.slice(0, 8).map(p => `<li>${escapeHtml(truncate(p.title, 80))}</li>`).join("")
    : `<li class="empty">No shipped changes this week</li>`;
  const contribs = d.devActivity.contributors.length
    ? d.devActivity.contributors.slice(0, 6).map(c => `<span class="pill">${escapeHtml(c)}</span>`).join("")
    : "";
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h3>Dev Activity</h3>
    <h2>${fmt(d.devActivity.commits)} commits &middot; ${fmt(d.devActivity.prs.length)} shipped</h2>
    <ul class="list-grid">${items}</ul>
    <div class="pill-row">${contribs}</div>
  </div>`;
}

function socialSlide(d: WeekData, idx: number): string {
  const blog = d.socialActivity.blogPosts.length
    ? d.socialActivity.blogPosts.slice(0, 6).map(b => `<li>${escapeHtml(truncate(b.title, 70))}</li>`).join("")
    : `<li class="empty">No blog posts this week</li>`;
  const x = d.socialActivity.xPosts.length
    ? d.socialActivity.xPosts.slice(0, 6).map(p => `<li>${escapeHtml(truncate(p.text, 70))}</li>`).join("")
    : `<li class="empty">No X posts this week</li>`;
  const beats = d.socialActivity.newsBeats.length
    ? d.socialActivity.newsBeats.slice(0, 6).map(b => `<span class="pill">${escapeHtml(truncate(b, 40))}</span>`).join("")
    : `<span class="pill">no aibtc.news activity</span>`;
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h3>Social &amp; Publishing</h3>
    <h2>${fmt(d.socialActivity.blogPosts.length)} posts &middot; ${fmt(d.socialActivity.xPosts.length)} on X</h2>
    <div style="width: 100%; max-width: 1000px;">
      <div style="font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin: 0.5rem 0 0.75rem;">Blog &middot; arc0btc.com/blog</div>
      <ul class="list-grid">${blog}</ul>
      <div style="font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin: 1.5rem 0 0.75rem;">X &middot; @arc0btc</div>
      <ul class="list-grid">${x}</ul>
    </div>
    <div class="pill-row">${beats}</div>
  </div>`;
}

function servicesSlide(d: WeekData, idx: number): string {
  const items = d.servicesUpdates.items.length
    ? d.servicesUpdates.items.slice(0, 8).map(i => `<li>${escapeHtml(truncate(i.title, 80))}</li>`).join("")
    : `<li class="empty">No service updates this week</li>`;
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h3>Services</h3>
    <h2><span class="highlight mono">${escapeHtml(d.servicesUpdates.siteUrl)}</span></h2>
    <p class="subtitle">Dashboard, monitoring, paid services.</p>
    <ul class="list-grid">${items}</ul>
  </div>`;
}

function selfImprovementsSlide(d: WeekData, idx: number): string {
  const s = d.selfImprovements;
  const skills = [
    ...s.newSkills.map(x => `<span class="pill new">+ ${escapeHtml(x.name)}</span>`),
    ...s.updatedSkills.slice(0, 10).map(x => `<span class="pill updated">~ ${escapeHtml(x.name)}</span>`),
    ...s.newSensors.map(x => `<span class="pill new">+sensor ${escapeHtml(x.name)}</span>`),
  ].join("");
  const mem = s.memoryChanges.length
    ? s.memoryChanges.slice(0, 5).map(m => `<li>${escapeHtml(truncate(m, 80))}</li>`).join("")
    : `<li class="empty">No memory updates this week</li>`;
  const total = s.newSkills.length + s.updatedSkills.length + s.newSensors.length;
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h3>Self Improvements</h3>
    <h2>${fmt(total)} skill &amp; sensor changes</h2>
    <div class="pill-row">${skills || `<span class="pill">no skill changes</span>`}</div>
    <div style="width: 100%; max-width: 1000px; margin-top: 1.5rem;">
      <div style="font-size: 0.85rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.75rem;">Memory updates</div>
      <ul class="list-grid">${mem}</ul>
    </div>
  </div>`;
}

function newAgentsSlide(d: WeekData, idx: number): string {
  const cards = d.newAgents.map(a => `
    <div class="agent-card">
      <div class="agent-face">₿</div>
      <div class="agent-name">${escapeHtml(a.name)}</div>
      <div class="agent-btc">${escapeHtml(a.btcAddress.slice(0, 12) + (a.btcAddress ? "…" : ""))}</div>
    </div>`).join("");
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h3>New Agents</h3>
    <h2>${fmt(d.newAgents.length)} welcomed this week</h2>
    <div class="agent-grid">${cards}</div>
  </div>`;
}

function closingSlide(d: WeekData, idx: number): string {
  return `
  <div class="slide" data-slide="${idx}">
    <div class="arc-logo">ARC</div>
    <h1>See you next <span class="highlight">Monday</span>.</h1>
    <p class="subtitle">${fmt(d.taskStats.completed)} tasks &middot; ${fmt(d.totalSkills)} skills &middot; ${fmt(d.devActivity.prs.length)} shipped</p>
    <div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; margin-top: 1.5rem;">
      <div class="link-card"><div class="label">Site</div><div class="url">arc0btc.com</div></div>
      <div class="link-card"><div class="label">Blog</div><div class="url">arc0btc.com/blog</div></div>
      <div class="link-card"><div class="label">X</div><div class="url">@arc0btc</div></div>
      <div class="link-card"><div class="label">News</div><div class="url">aibtc.news</div></div>
      <div class="link-card"><div class="label">Source</div><div class="url">github.com/aibtcdev</div></div>
    </div>
  </div>`;
}

// ---- Assembler ----

function renderPresentation(d: WeekData): string {
  const slides: string[] = [];
  slides.push(titleSlide(d));
  slides.push(devActivitySlide(d, slides.length));
  slides.push(socialSlide(d, slides.length));
  slides.push(servicesSlide(d, slides.length));
  slides.push(selfImprovementsSlide(d, slides.length));
  if (d.newAgents.length > 0) slides.push(newAgentsSlide(d, slides.length));
  slides.push(closingSlide(d, slides.length));

  const title = `Arc Weekly — ${formatDateRange(d.weekStart, d.weekEnd)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
<div class="progress-bar" id="progress"></div>
<div class="deck">
${slides.join("\n")}
</div>
<div class="bottom-bar">
  <span style="color: var(--arc-gold);">Arc Weekly &mdash; ${formatDateRange(d.weekStart, d.weekEnd)}</span>
  <span><span id="current">1</span> / <span id="total">${slides.length}</span></span>
</div>
<script>
(() => {
  const slides = document.querySelectorAll('.slide');
  const total = slides.length;
  let current = 0;
  document.getElementById('total').textContent = total;
  function goTo(n) {
    if (n < 0 || n >= total) return;
    slides[current].classList.remove('active');
    current = n;
    slides[current].classList.add('active');
    document.getElementById('current').textContent = current + 1;
    document.getElementById('progress').style.width = ((current + 1) / total * 100) + '%';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); goTo(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(total - 1);
  });
  let tx = 0;
  document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; });
  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) goTo(current + (dx < 0 ? 1 : -1));
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.bottom-bar')) return;
    goTo(current + (e.clientX > window.innerWidth / 2 ? 1 : -1));
  });
  document.getElementById('progress').style.width = (1 / total * 100) + '%';
})();
</script>
</body>
</html>`;
}

// ---- Archive management ----

function archiveCurrentPresentation(newWeekEnd: string): void {
  if (!existsSync(PRESENTATION_PATH)) return;
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });

  // Read the existing deck to detect its week, or use the prior week as fallback
  const prior = new Date(newWeekEnd);
  prior.setUTCDate(prior.getUTCDate() - 7);
  const slug = `${prior.toISOString().slice(0, 10).replace(/-/g, "")}-aibtc-weekly.html`;
  const dest = join(ARCHIVE_DIR, slug);

  if (existsSync(dest)) return; // already archived
  renameSync(PRESENTATION_PATH, dest);
  console.log(`Archived previous deck → archives/${slug}`);
}

function listArchives(): void {
  if (!existsSync(ARCHIVE_DIR)) {
    console.log("No archives yet.");
    return;
  }
  const files = readdirSync(ARCHIVE_DIR).filter(f => f.endsWith(".html")).sort().reverse();
  if (files.length === 0) {
    console.log("No archives yet.");
    return;
  }
  console.log(`${files.length} archived deck${files.length === 1 ? "" : "s"}:`);
  for (const f of files) console.log(`  archives/${f}`);
}

// ---- Main ----

async function main(): Promise<void> {
  initDatabase();
  const { flags, positional } = parseFlags(Bun.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || cmd === "generate") {
    const weekEnd = flags.week ?? mondayOf(new Date()).toISOString().slice(0, 10);
    const research = flags["research-file"] ? loadResearchFile(flags["research-file"]) : {};

    console.log(`Generating weekly deck for week ending ${weekEnd}…`);
    const data = collectWeekData(weekEnd, research);
    const html = renderPresentation(data);

    archiveCurrentPresentation(weekEnd);
    writeFileSync(PRESENTATION_PATH, html);

    const slideCount = (html.match(/<div class="slide/g) || []).length;
    console.log(`Wrote ${PRESENTATION_PATH} (${slideCount} slides, ${html.length.toLocaleString()} bytes)`);
    console.log(`Live at /presentation`);
    return;
  }

  if (cmd === "list") {
    listArchives();
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error(`Usage: generate [--week YYYY-MM-DD] [--research-file PATH]`);
  console.error(`       list`);
  process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
