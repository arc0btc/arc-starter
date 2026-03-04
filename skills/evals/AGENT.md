# Evals — Subagent Briefing

You are running an eval analysis task for Arc's dispatch system. This document gives you the detailed methodology.

## Error Analysis Protocol

**Goal:** Build a catalog of how dispatch fails by reading real task traces.

### Step 1: Collect Traces
```
arc skills run --name evals -- error-analysis --limit 100
```
This auto-categorizes traces using pattern matching. Review the output, then manually inspect uncategorized traces.

### Step 2: Read & Annotate
For each uncategorized or interesting trace, read the full task:
```
arc tasks --status completed --limit 20
arc tasks --status failed --limit 20
```
Focus on the **first failure** in each trace. Write observations, not explanations.
- Good: "SQL query returned empty result set"
- Bad: "Model didn't understand the schema"

### Step 3: Group into Categories
After 30-50 traces, start grouping. Categories should be:
- **Distinct** — each describes a different failure mode
- **Observable** — you can point to evidence in the trace
- **Actionable** — there's something you could fix or evaluate
- Aim for 5-10 categories

### Step 4: Label Traces
For each failure category, label tasks as pass/fail:
```
arc skills run --name evals -- label --task-id 42 --fail --category crash-recovery --notes "dispatch died mid-task"
arc skills run --name evals -- label --task-id 43 --pass --category crash-recovery
```
Target: 40+ labels per category, balanced ~50/50 pass/fail.

### Step 5: Compute Failure Rates
```
arc skills run --name evals -- summary
```
Sort categories by frequency. Most frequent = highest priority to fix.

### Step 6: Decide per Category
For each failure, ask:
1. Is there an obvious code fix? → Fix it first
2. Is an LLM judge worth the cost? → Only if failure recurs and is subjective
3. Can a code-based check handle it? → Prefer code over LLM judges

## Write-Judge-Prompt Protocol

**Prerequisites:**
- Error analysis complete for this failure mode
- 20+ Pass and 20+ Fail human-labeled examples
- Code-based check cannot handle it

### Judge Prompt Structure

Four required components:

1. **Task and Evaluation Criterion** — What exactly the judge evaluates. One failure mode per judge.
2. **Binary Pass/Fail Definitions** — Concrete definitions grounded in your error analysis.
3. **Few-Shot Examples** — 2-4 labeled examples from training split only. Include at least one clear Pass, one clear Fail, and one borderline case.
4. **Structured Output** — JSON with `critique` (detailed) then `result` ("Pass" or "Fail").

Example judge prompt skeleton:
```
You are evaluating whether an Arc dispatch task completed its stated objective.

## Criterion: {category_name}
{description of what constitutes pass vs fail}

## PASS means:
{concrete pass definition}

## FAIL means:
{concrete fail definition}

## Examples

### Example 1 (PASS)
Task: {subject}
Result: {result_summary}
Critique: {why this passes}
Verdict: Pass

### Example 2 (FAIL)
Task: {subject}
Result: {result_summary}
Critique: {why this fails}
Verdict: Fail

## Your Task
Evaluate the following task. Output JSON:
{"critique": "...", "result": "Pass" or "Fail"}

Task Subject: {subject}
Task Description: {description}
Task Result: {result_summary}
```

Save the prompt to a file, then:
```
arc skills run --name evals -- judge --category {name} --create --prompt-file path/to/prompt.md
```

### Anti-Patterns
- Vague criteria ("is this helpful?")
- Multiple dimensions in one judge
- No few-shot examples
- Likert scales (use binary only)
- Skipping validation

## Validate-Evaluator Protocol

### Data Splits
- **Train** (15%): Source of few-shot examples. Only clear-cut cases.
- **Dev** (45%): Iterative refinement. Run judge, measure, improve.
- **Test** (40%): Final measurement. Use exactly once.

### Metrics
- **TPR** (True Positive Rate): When human says Pass, judge says Pass
- **TNR** (True Negative Rate): When human says Fail, judge says Fail
- Target: both > 90%. Minimum acceptable: both > 80%.

### Iteration
1. Run judge on dev set
2. Inspect every disagreement (false pass, false fail)
3. Adjust judge prompt (clarify definitions, swap examples)
4. Re-run on dev set
5. Repeat until TPR > 90% AND TNR > 90%
6. Run once on test set for final numbers

### Bias Correction (Rogan-Gladen)
For aggregate production metrics:
```
θ_hat = (p_obs + TNR - 1) / (TPR + TNR - 1)
```
Where p_obs = fraction judge scored as Pass on unlabeled data.

## Key Rules
- Error analysis comes BEFORE building judges
- Fix obvious bugs before building evaluators
- One judge per failure mode (not holistic)
- Binary pass/fail only (no scales)
- Never use test set examples in judge prompt
- Pin exact model versions for judges
- Re-validate after prompt changes
