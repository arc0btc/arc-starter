#!/usr/bin/env bun
// arc-weekly-presentation/cli.ts
//
// Generates a week-over-week HTML slide deck from live Arc data.
// Usage:
//   arc skills run --name arc-weekly-presentation -- generate [--week YYYY-MM-DD]
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

// ---- Data collection ----

interface WeekData {
  weekEnd: string;       // YYYY-MM-DD
  weekStart: string;     // YYYY-MM-DD
  newSkills: Array<{ name: string; description: string }>;
  newSensors: Array<{ name: string; description: string }>;
  taskStats: { completed: number; failed: number; total: number };
  totalSkills: number;
  totalSensors: number;
  costSummary: { totalCost: number; totalTasks: number; avgPerTask: number };
  newAgents: Array<{ name: string; btcPrefix: string }>;
  blogPosts: string[];
  highlights: string[];
}

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
        btcPrefix: c.btc_address ? c.btc_address.slice(0, 8) + "..." : "",
      }));
  } catch {
    return [];
  }
}

function getBlogPosts(startDate: string, endDate: string): string[] {
  const db = getDatabase();
  const rows = db.query(`
    SELECT subject FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND skills LIKE '%blog-publishing%'
      AND status = 'completed'
      AND subject LIKE '%blog post%'
    ORDER BY created_at DESC
    LIMIT 10
  `).all(startDate, endDate) as Array<{ subject: string }>;

  return rows.map(r => r.subject);
}

function getHighlights(startDate: string, endDate: string): string[] {
  const db = getDatabase();
  const rows = db.query(`
    SELECT subject FROM tasks
    WHERE date(created_at) BETWEEN ? AND ?
      AND status = 'completed'
      AND priority <= 4
    ORDER BY priority ASC, created_at DESC
    LIMIT 8
  `).all(startDate, endDate) as Array<{ subject: string }>;

  return rows.map(r => r.subject);
}

function collectWeekData(weekEndDate: string): WeekData {
  const { start, end } = getWeekRange(weekEndDate);
  const allSkills = discoverSkills();
  const totalSensors = allSkills.filter(s => s.hasSensor).length;

  return {
    weekEnd: end,
    weekStart: start,
    newSkills: getNewSkillsFromGit(start),
    newSensors: getNewSensorsFromGit(start),
    taskStats: getTaskStats(start, end),
    totalSkills: allSkills.length,
    totalSensors,
    costSummary: getCostSummary(start, end),
    newAgents: getNewAgents(start),
    blogPosts: getBlogPosts(start, end),
    highlights: getHighlights(start, end),
  };
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

function renderSkillCards(skills: Array<{ name: string; description: string }>, label: string): string {
  if (skills.length === 0) return "";
  const displayed = skills.slice(0, 4);
  const remaining = skills.length - displayed.length;

  let html = displayed.map(s => `
    <div class="skill-card">
      <span class="skill-new">${escapeHtml(label)}</span>
      <span class="skill-name">${escapeHtml(s.name)}</span>
      <span class="skill-desc">${escapeHtml(s.description)}</span>
    </div>`).join("\n");

  if (remaining > 0) {
    html += `\n  <p style="color: var(--text-muted); margin-top: 24px; font-size: 1.05rem; grid-column: 1 / -1;">
    +${remaining} more &mdash; total: <span class="highlight">${skills.length}</span> new this week
  </p>`;
  }
  return html;
}

function renderAgentCards(agents: WeekData["newAgents"]): string {
  if (agents.length === 0) return "";
  const icons = ["&#x26A1;", "&#x1F52E;", "&#x2728;", "&#x1F98E;", "&#x1F30A;", "&#x1F985;", "&#x1F525;", "&#x1F680;", "&#x2B50;"];
  return agents.slice(0, 6).map((a, i) => `
    <div class="agent-card">
      <div class="agent-face">${icons[i % icons.length]}</div>
      <div class="agent-name">${escapeHtml(a.name)}</div>
      <div class="agent-btc">${escapeHtml(a.btcPrefix)} &bull; Bitcoin agent</div>
    </div>`).join("\n");
}

function renderPresentation(data: WeekData): string {
  const dateRange = formatDateRange(data.weekStart, data.weekEnd);
  const slides: string[] = [];
  let slideNum = 0;

  function addSlide(content: string): void {
    slideNum++;
    slides.push(content);
  }

  // Slide 1: Title + Stats
  addSlide(`
  <div class="arc-logo">ARC</div>
  <h1>Arc <span class="highlight">Weekly</span></h1>
  <p class="subtitle">AIBTC Community &mdash; ${dateRange}</p>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-number highlight">${data.taskStats.completed.toLocaleString()}</div>
      <div class="stat-label">Tasks Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-number green">${data.totalSkills}</div>
      <div class="stat-label">Skills Active</div>
    </div>
    <div class="stat-card">
      <div class="stat-number stacks">${data.totalSensors}</div>
      <div class="stat-label">Sensors Running</div>
    </div>
    <div class="stat-card">
      <div class="stat-number blue">${data.newSkills.length}</div>
      <div class="stat-label">New Skills This Week</div>
    </div>
    <div class="stat-card">
      <div class="stat-number purple">${data.newAgents.length}</div>
      <div class="stat-label">New Agents Welcomed</div>
    </div>
    <div class="stat-card">
      <div class="stat-number highlight">$${data.costSummary.totalCost.toFixed(0)}</div>
      <div class="stat-label">Weekly Cost</div>
    </div>
  </div>`);

  // Slide 2: Week Highlights
  if (data.highlights.length > 0) {
    const items = data.highlights.slice(0, 8).map(h =>
      `<li>${escapeHtml(h.length > 80 ? h.slice(0, 77) + "..." : h)}</li>`
    ).join("\n        ");
    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>This Week&rsquo;s <span class="highlight">Highlights</span></h2>
  <div class="col" style="max-width: 900px; width: 100%;">
    <h3 class="green">Top Priority Work Completed</h3>
    <ul>
        ${items}
    </ul>
  </div>`);
  }

  // Slide 3: New Skills
  if (data.newSkills.length > 0) {
    const cards = renderSkillCards(data.newSkills, "New this week");
    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>New <span class="highlight">Skills</span> Learned This Week</h2>
  <div class="skills-grid">
    ${cards}
  </div>`);
  }

  // Slide 4: New Sensors/Automation
  if (data.newSensors.length > 0) {
    const cards = renderSkillCards(data.newSensors, "New sensor");
    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>New <span class="highlight">Automation</span> This Week</h2>
  <div class="skills-grid">
    ${cards}
  </div>
  <p style="color: var(--text-muted); margin-top: 24px; font-size: 1.05rem;">
    Sensors total: <span class="highlight">${data.totalSensors}</span> &mdash; all autonomous, all parallel, all running 24/7
  </p>`);
  }

  // Slide 5: New Agents
  if (data.newAgents.length > 0) {
    const cards = renderAgentCards(data.newAgents);
    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>New Agents <span class="highlight">Welcomed</span></h2>
  <p class="subtitle" style="margin-bottom: 24px;">${data.newAgents.length} new Bitcoin agent${data.newAgents.length !== 1 ? "s" : ""} joined the ecosystem</p>
  <div class="agent-grid">
    ${cards}
  </div>
  <p style="color: var(--text-muted); margin-top: 20px; font-size: 1rem;">
    Sensor detects new members &rarr; files welcome &rarr; logs to memory &mdash; no human needed
  </p>`);
  }

  // Slide 6: Published This Week
  if (data.blogPosts.length > 0) {
    const blogItems = data.blogPosts.slice(0, 5).map(p =>
      `<li>${escapeHtml(p.length > 70 ? p.slice(0, 67) + "..." : p)}</li>`
    ).join("\n        ");
    addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>Published <span class="highlight">This Week</span></h2>
  <div class="content-cols">
    <div class="col">
      <h3 class="highlight">Blog &mdash; arc0btc.com</h3>
      <ul>
        ${blogItems}
      </ul>
      <p style="margin-top: 16px; font-size: 1rem; color: var(--text-muted);">All posts signed by Arc &mdash; verifiable on-chain</p>
    </div>
    <div class="col">
      <h3 class="blue">Operational Stats</h3>
      <ul>
        <li><span class="highlight">${data.taskStats.completed}</span> tasks completed</li>
        <li><span class="red">${data.taskStats.failed}</span> tasks failed</li>
        <li>$${data.costSummary.avgPerTask.toFixed(2)} avg cost per task</li>
        <li>$${data.costSummary.totalCost.toFixed(2)} total weekly spend</li>
      </ul>
    </div>
  </div>`);
  }

  // Slide N: Closing
  addSlide(`
  <div class="arc-logo">ARC</div>
  <h2>What&rsquo;s <span class="highlight">Next</span></h2>
  <div class="cta-box">
    <p style="font-size: 1.3rem; margin-bottom: 24px;">
      Week of ${dateRange}
    </p>
    <ul style="text-align: left; max-width: 700px; margin: 0 auto 32px;">
      <li><span class="highlight">${data.totalSkills} skills</span> active, <span class="green">${data.newSkills.length} new</span> this week</li>
      <li><span class="stacks">${data.totalSensors} sensors</span> running 24/7</li>
      <li><span class="blue">${data.taskStats.completed} tasks</span> completed</li>
      <li><span class="purple">${data.newAgents.length}</span> new agents welcomed</li>
    </ul>
    <p style="font-size: 1.3rem; margin-top: 8px;">
      <span class="highlight">arc-starter</span> is open source
    </p>
    <p style="color: var(--text-muted); margin-top: 10px; font-size: 1rem;">
      github.com/aibtcdev/arc-starter &bull; @arc0btc &bull; arc0btc.com/blog
    </p>
  </div>`);

  // Assemble full HTML
  const totalSlides = slides.length;
  const slideHtml = slides.map((content, i) => {
    const num = i + 1;
    const active = i === 0 ? ' class="slide active"' : ' class="slide"';
    return `<!-- Slide ${num} -->
<div${active} id="slide-${num}">
  ${content.trim()}
  <div class="slide-number">${num} / ${totalSlides}</div>
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

// ---- Main ----

async function main(): Promise<void> {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === "help") {
    process.stdout.write(`arc-weekly-presentation

Commands:
  generate [--week YYYY-MM-DD]  Generate weekly presentation (default: today)
  list                          List archived presentations
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

    process.stdout.write(`Collecting data for week ending ${weekEnd}...\n`);
    const data = collectWeekData(weekEnd);

    process.stdout.write(`  New skills: ${data.newSkills.length}\n`);
    process.stdout.write(`  New sensors: ${data.newSensors.length}\n`);
    process.stdout.write(`  Tasks completed: ${data.taskStats.completed}\n`);
    process.stdout.write(`  New agents: ${data.newAgents.length}\n`);
    process.stdout.write(`  Blog posts: ${data.blogPosts.length}\n`);
    process.stdout.write(`  Weekly cost: $${data.costSummary.totalCost.toFixed(2)}\n`);

    // Archive previous before overwriting
    archiveCurrentPresentation(weekEnd);

    const html = renderPresentation(data);
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
