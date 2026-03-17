# arc-weekly-presentation — Subagent Briefing

You are generating Arc's weekly presentation. The CLI (`generate`) collects local data from git and the task database, but some data is thin and needs real research via Sonnet subagents.

## Workflow

### Step 1: Spawn Sonnet research subagents

Launch these subagents **in parallel** to collect real data. Each writes findings to a section of a JSON research file.

**Subagent A — Dev Activity:**
- Query `gh pr list --state merged --search "merged:>=YYYY-MM-DD" --repo aibtcdev/arc-starter --json title,url` for actual PR titles
- Query `gh pr list --state merged --search "merged:>=YYYY-MM-DD" --repo aibtcdev/ai-agent-crew --json title,url` for AIBTC PRs
- Get real commit counts per contributor from `git shortlog -sn --since=YYYY-MM-DD`
- Output: `{ "prs": [{"title": "...", "repo": "...", "url": "..."}], "commits": N, "contributors": ["whoabuddy", "arc0btc"] }`

**Subagent B — Social Activity:**
- Check recent completed tasks with `blog-publishing` skill for actual blog post titles
- Check arc0btc.com/blog for published post titles (if accessible)
- Check tasks with `x-engagement`/`x-thread` skills for X post subjects
- Check tasks with `aibtc-news` skill for news beat titles
- Output: `{ "blogPosts": [{"title": "...", "url": "..."}], "xPosts": [{"text": "...", "url": "..."}], "newsBeats": ["..."] }`

**Subagent C — Services Updates:**
- Check tasks with `arc-web-dashboard` skill completed this week
- Check if arc0btc.com had any feature additions, bug fixes, or UI changes
- Check tasks mentioning "arc0btc.com" or "web dashboard"
- Output: `{ "items": [{"title": "...", "detail": "..."}], "siteUrl": "arc0btc.com" }`

### Step 2: Assemble research file

Combine subagent outputs into a single JSON file:

```json
{
  "devActivity": { ... from Subagent A ... },
  "socialActivity": { ... from Subagent B ... },
  "servicesUpdates": { ... from Subagent C ... }
}
```

Write to `/tmp/arc-presentation-research.json`.

### Step 3: Generate presentation

```bash
arc skills run --name arc-weekly-presentation -- generate --week YYYY-MM-DD --research-file /tmp/arc-presentation-research.json
```

### Step 4: Verify

Open/read `src/web/presentation.html` and verify:
- All 4 consistent sections are present (Dev Activity, Social, Services, Self Improvements)
- Data is real, not placeholder
- arc0btc.com appears in links
- Slide count is 6-7 (title + 4 sections + optional agents + closing)

## Research File Schema

```typescript
interface ResearchData {
  devActivity?: {
    prs?: Array<{ title: string; repo: string; url?: string }>;
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

Research data **overrides** local data when provided. Omitted fields fall back to local collection (git log, task DB). This means subagents only need to research areas where local data is thin.

## Key Principle

**Pull real data, not placeholders.** If a subagent can't find real PR titles, blog titles, or X posts — return an empty array rather than fabricating content. The presentation renders "No X posts this week" gracefully for empty sections.

## Using Last Week as Anchor

Read the most recent archived presentation (`arc skills run --name arc-weekly-presentation -- list`) to see what was covered last week. Use it as context for what's new this week vs. carried over.
