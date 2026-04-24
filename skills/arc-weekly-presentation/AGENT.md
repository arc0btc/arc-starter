# arc-weekly-presentation — Subagent Briefing

You are generating Arc's weekly AIBTC working-group deck. The CLI (`generate`) collects local data from git and the task database, but some areas are thin and need real research via Sonnet subagents.

## Workflow

### Step 0: Read last week's deck

Before collecting data, read the most recent archive under `src/web/archives/` matching `*-aibtc-weekly.html` or `*-aibtc-tuesday.html`. Use it as context for what's *new* this week vs. carried over. Don't copy content — just frame.

### Step 1: Spawn Sonnet research subagents in parallel

Launch the three subagents below concurrently. Each writes findings to its section of a JSON research file at `/tmp/arc-presentation-research.json`.

**Subagent A — Dev Activity:**
- `gh pr list --state merged --search "merged:>=YYYY-MM-DD" --repo aibtcdev/arc-starter --json title,url,author` for real PR titles
- Same for `aibtcdev/ai-agent-crew`, `aibtcdev/skills`, `aibtcdev/agent-news` — whatever repos Arc was active in this week
- `git shortlog -sn --since=YYYY-MM-DD` for commit counts per contributor
- Output:
  ```json
  { "prs": [{"title": "...", "repo": "...", "url": "..."}], "commits": 123, "contributors": ["whoabuddy", "arc0btc"] }
  ```

**Subagent B — Social & Publishing:**
- Tasks completed this week with `blog-publishing` skill → blog post titles
- If accessible, fetch `arc0btc.com/blog` for canonical published titles
- Tasks with `social-x-posting`, `social-x-ecosystem`, or `social-agent-engagement` skills → X post subjects
- Tasks with `aibtc-news-editor` / `aibtc-news-editorial` / `aibtc-news-classifieds` / `aibtc-news-deal-flow` → news beats touched and signal counts
- Output:
  ```json
  { "blogPosts": [{"title": "...", "url": "..."}], "xPosts": [{"text": "...", "url": "..."}], "newsBeats": ["aibtc-network", "bitcoin-macro", "quantum"] }
  ```

**Subagent C — Services Updates:**
- Tasks completed this week with `arc-web-dashboard` skill
- Any arc0btc.com feature additions, bug fixes, UI changes (grep task subjects for "arc0btc.com" / "dashboard" / "site-health")
- New paid services launched (monitoring, PR review, security audit) — check `arc0btc-*` skills
- Output:
  ```json
  { "items": [{"title": "...", "detail": "..."}], "siteUrl": "arc0btc.com" }
  ```

### Step 2: Assemble research file

Combine subagent outputs into `/tmp/arc-presentation-research.json`:

```json
{
  "devActivity": { /* Subagent A */ },
  "socialActivity": { /* Subagent B */ },
  "servicesUpdates": { /* Subagent C */ }
}
```

### Step 3: Generate

```bash
arc skills run --name arc-weekly-presentation -- generate --week YYYY-MM-DD --research-file /tmp/arc-presentation-research.json
```

### Step 4: Verify

Read `src/web/presentation.html` and confirm:
- All four consistent sections present (Dev Activity, Social, Services, Self Improvements)
- Data is real, not placeholder
- arc0btc.com + aibtc.news appear in closing links
- Slide count is 6–10 (title + 4 sections + closing + optional agents/highlight)
- Archive exists at `src/web/archives/YYYYMMDD-aibtc-weekly.html` for the *previous* week

## Research file schema

```typescript
interface ResearchData {
  devActivity?: {
    prs?: Array<{ title: string; repo: string; url?: string; author?: string }>;
    commits?: number;
    contributors?: string[];
  };
  socialActivity?: {
    blogPosts?: Array<{ title: string; url?: string }>;
    xPosts?: Array<{ text: string; url?: string }>;
    newsBeats?: string[];
  };
  servicesUpdates?: {
    items?: Array<{ title: string; detail?: string }>;
    siteUrl?: string;
  };
  selfImprovements?: {
    newSkills?: Array<{ name: string; description: string }>;
    updatedSkills?: Array<{ name: string; description: string }>;
    newSensors?: Array<{ name: string; description: string }>;
    memoryChanges?: string[];
  };
}
```

Research data **overrides** local data where provided. Omitted fields fall back to local collection (git log, task DB). Subagents only need to research areas where local data is thin — don't duplicate work the CLI already does.

## Key principles

- **Real data, never placeholders.** If a subagent can't find real PR titles, return an empty array. The deck renders "No X this week" gracefully.
- **Tighten, don't expand.** Target 8 slides. If you have more material, one slide with a `grid-3` beats three thin slides.
- **Anchor to last week.** Reference the previous archived deck for framing — what's *new*, what's *continuing*, what *shipped*.
- **Trust the CLI defaults.** Don't pass research data for areas where git/DB is already authoritative (sensor additions, memory commits, skill versions).
