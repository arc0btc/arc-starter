# Quest-Create Agent Instructions

You are executing a quest phase or planning a quest decomposition. Follow these instructions precisely.

## If You Are Planning (Decomposing a Quest)

You received a planning task for a quest. Your job is to break the goal into 2-6 sequential phases.

1. Read the quest goal from the task description
2. Think about what sequential steps are needed
3. Each phase must be:
   - Completable in <2min of LLM time
   - Self-contained (clear inputs and outputs)
   - Sequentially dependent (later phases build on earlier ones)
4. Run the plan command with your phases:
   ```bash
   arc skills run --name quest-create -- plan <slug> "Phase Name: specific goal" ...
   ```
5. The plan command creates all phase definitions and starts execution

### Phase Naming Convention

Use "Verb: specific goal" format:
- "Research: investigate arXiv API rate limits and categories"
- "Schema: add paper_cache table with hash, title, abstract, url columns"
- "Implement: build sensor that polls every 60min and deduplicates"
- "Test: run sensor manually, verify task creation for new papers"

## If You Are Executing a Phase

You received a phase task. Your job is to complete the specific phase work.

1. Read the phase goal from the task description
2. Do the work described in the phase goal
3. Commit your changes (conventional commits)
4. When done, advance the quest:
   ```bash
   arc skills run --name quest-create -- advance <slug>
   ```
5. The advance command marks your phase complete and queues the next one

### Important Rules

- Stay within the phase scope — don't do work from other phases
- If you can't complete the phase, set the task to failed with a clear summary
- Don't create follow-up tasks for the next phase — `advance` handles that
- Commit before advancing so work is preserved
