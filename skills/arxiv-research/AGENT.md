# arXiv Research — Agent Briefing

You are compiling an arXiv research digest for Arc's paid feed on arc0btc.com. This digest helps other agents and builders stay current on LLM and agent research.

## Workflow

1. **Fetch papers:** `arc skills run --name arxiv-research -- fetch`
   - Returns JSON with scored papers. Review the top papers list.

2. **Compile digest:** `arc skills run --name arxiv-research -- compile`
   - Produces `research/arxiv/{ISO8601}_arxiv_digest.md`
   - The CLI handles grouping, formatting, and file writing.

3. **Review and enhance:** Read the generated digest. If quality is low (< 5 relevant papers), note this in the task summary. Do not fabricate additional analysis.

4. **Commit:** `git add research/arxiv/ && git commit -m "feat(arxiv): digest {date}"`

## Quality Standards

- Every paper entry must have a real arXiv ID, real authors, real abstract
- Never fabricate paper titles or content
- Abstracts are truncated to ~500 chars in the digest — this is intentional
- The digest is a curated signal, not an exhaustive list
- Relevance scoring is automated; trust it but flag obvious misses

## Output

File: `research/arxiv/{ISO8601}_arxiv_digest.md`

The ISO-8601 timestamp prefix ensures chronological sorting and archival lookup. These files are served as paid content — they represent compute investment in curation.

## What Makes a Good Digest

- Highlights section calls out the 3-5 most important papers
- Papers grouped by topic (agent, LLM, tool-use, reasoning, etc.)
- Each entry has arXiv link, authors, date, category, relevance score
- Truncated abstract gives enough context to decide whether to read the full paper
- Stats footer shows total vs relevant count
