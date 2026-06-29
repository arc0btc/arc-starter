/**
 * Task-type classifier for automatic model selection.
 *
 * Applies the eligibility rules from the open-weight routing policy
 * (memory/shared/entries/openrouter-open-weight-routing.md) using pure
 * text heuristics — no LLM, no network. Used by `arc tasks add --model auto`.
 *
 * Classification tiers and their recommended models:
 *   bounded-code     → openrouter:devstral (~$0.003/task)
 *   bounded-code-glm → openrouter:glm      (~$0.01/task)
 *   operational      → haiku               (~$0.05/task)
 *   content          → sonnet
 *   research         → sonnet
 *   infrastructure   → opus
 *   unknown          → sonnet (safe default)
 */

export type TaskType =
  | "bounded-code"
  | "bounded-code-glm"
  | "operational"
  | "content"
  | "research"
  | "infrastructure"
  | "unknown";

export interface TaskClassification {
  type: TaskType;
  recommended_model: string;
  confidence: "high" | "low";
  reason: string;
}

const MODEL_FOR_TYPE: Record<TaskType, string> = {
  "bounded-code":     "openrouter:devstral",
  "bounded-code-glm": "openrouter:glm",
  "operational":      "haiku",
  "content":          "sonnet",
  "research":         "sonnet",
  "infrastructure":   "opus",
  "unknown":          "sonnet",
};

// ---- INELIGIBLE signals (any match → not open-weight) ----

const INELIGIBLE_SUBJECT: RegExp[] = [
  // PR / code review
  /\bpr\s+review\b/i,
  /\breview\s+(?:a\s+)?pr\b/i,
  /\bcode\s+review\b/i,
  /\breview\s+(?:the\s+)?diff\b/i,
  // Signal filing pipeline
  /\bsignal\s+filing\b/i,
  /\bfile\s+signal\b/i,
  /\barc-signal\b/i,
  // Content generation requiring voice/judgment
  /\bnostr\b/i,
  /\bx\s+post\b/i,
  /\bwhop\b/i,
  /\bblog\s+post\b/i,
  /\btweet\b/i,
  /\bcontent\s+calendar\b/i,
  /\bthread\b/i,
  // Research / synthesis / judgment
  /\bresearch\b/i,
  /\bsynthesize\b/i,
  /\bevaluate\b/i,
  /\bdesign\b/i,
  /\baudit\b/i,
  /\binvestigate\b/i,
  /\banalyze\b/i,
  /\bproposal\b/i,
  /\bspec\b/i,
  /\bdraft\b/i,
  // Sensor modifications
  /\bsensor\b/i,
  // Dispatch/scheduler internals
  /\bdispatch\b/i,
  /\bescalation\b/i,
  // Email / external comms
  /\bsend\s+email\b/i,
  /\bsend\s+reply\b/i,
  /\breply\s+to\b/i,
  // Multi-step onboarding / welcome
  /\bwelcome\b/i,
  /\bonboard\b/i,
];

const INELIGIBLE_DESCRIPTION: RegExp[] = [
  /\bcross-repo\b/i,
  /\bmulti-repo\b/i,
  /\b(?:STX|sBTC)\b/,
  /\bcredential\b/i,
  /\btest\s+suite\b/i,
  /\bbun\s+test\b/i,
  /\bgh\s+pr\b/i,
  /\bgit\s+push\b/i,
  /\bsignal\s+filing\b/i,
];

// Core infra files — high blast radius, stay on sonnet/opus
const CORE_INFRA_PATTERNS: RegExp[] = [
  /\bsrc\/dispatch\.ts\b/i,
  /\bsrc\/sensors\.ts\b/i,
  /\bsrc\/db\.ts\b/i,
  /\bdispatch\.ts\b/i,
  /\bsensors\.ts\b/i,
  /\bdb\.ts\b/i,
];

// ---- BOUNDED-CODE signals (positive match → open-weight eligible) ----

// Devstral: single-file, purely mechanical
// A positive file reference (.ts/.js) in the subject is a strong signal.
// Combined with an action verb, it's a bounded-code task.
const FILE_REF_PATTERN = /\S+\.(?:ts|js|json)\b/i;

const DEVSTRAL_ACTION_VERBS: RegExp[] = [
  /\badd\b/i,
  /\bupdate\b/i,
  /\brename\b/i,
  /\bpatch\b/i,
  /\bfix\b/i,
  /\bexport\b/i,
  /\bgenerate\b/i,
  /\bremove\b/i,
  /\bdelete\b/i,
];

const DEVSTRAL_PATTERNS: RegExp[] = [
  /\badd\s+\w[\w()]+\s+(?:helper\s+)?(?:to|in)\s+\S+\.(?:ts|js)\b/i,  // add func() to file.ts
  /\badd\s+\w+\s+(?:function|method|field|type|constant|helper)\b/i,   // add X function/method
  /\bupdate\s+(?:pricing|config|constant|table|alias|map)\b/i,         // update config/table
  /\brename\s+\w+\s+(?:to|field|in)\b/i,                               // rename field to X
  /\badd\s+(?:--)?[\w-]+\s+(?:cli\s+)?flag\b/i,                        // add --flag
  /\bgenerate\s+(?:a\s+)?template\b/i,                                 // generate template
  /\bfix\s+typo\b/i,                                                   // fix typo
  /\bupdate\s+\w+\s+in\s+\S+\.(?:ts|js)\b/i,                         // update X in file.ts
  /\badd\s+\w+\s+to\s+\S+\.(?:ts|js)\b/i,                            // add X to file.ts
  /\bexport\s+(?:const|function|type)\b/i,                             // export const/function/type
  /\bupdate\s+model\s+(?:id|alias|pricing)\b/i,                        // update model ids
  /\badd\s+openrouter\s+alias\b/i,                                     // add openrouter alias
  /\bpatch\s+\S+\.(?:ts|js)\b/i,                                       // patch specific file
];

// GLM: bounded but benefits from extra tool iterations (multi-file ≤3)
const GLM_PATTERNS: RegExp[] = [
  /\brefactor\s+\w+\s+in\s+(?:≤?\s*[23]\s+files?|\S+\.ts)\b/i, // refactor in ≤3 files
  /\bextend\s+(?:existing|the)\s+\w+\b/i,                    // extend existing X
  /\bwire\s+up\s+\w+\b/i,                                    // wire up X
  /\bintegrate\s+\w+\s+into\s+\S+\.ts\b/i,                  // integrate X into file.ts
];

// ---- OPERATIONAL signals ----

const OPERATIONAL_PATTERNS: RegExp[] = [
  /\bhousekeeping\b/i,
  /\bhealth\s+check\b/i,
  /\bprune\s+\w+\b/i,
  /\bclean\s+up\b/i,
  /\barchive\s+\w+\b/i,
  /\bconsolidate\s+memory\b/i,
  /\bclose\s+stale\b/i,
  /\brequeue\b/i,
  /\brun\s+sensors?\b/i,
  /\bcheck\s+\w+\s+status\b/i,
  /\bdaily\s+(?:eval|report|summary)\b/i,
];

// ---- RESEARCH signals ----

const RESEARCH_PATTERNS: RegExp[] = [
  /\bresearch\b/i,
  /\binvestigate\b/i,
  /\banalyze\b/i,
  /\bstudy\b/i,
  /\bsurvey\b/i,
  /\bexplore\b/i,
  /\bproposal\b/i,
  /\bspec\b/i,
  /\bdraft\b/i,
  /\bdesign\b/i,
  /\bsynthesize\b/i,
  /\bevaluate\b/i,
  /\bauditing\b/i,
];

// ---- CONTENT signals ----

const CONTENT_PATTERNS: RegExp[] = [
  /\bwrite\s+(?:a\s+)?(?:post|note|message|article|blog|thread)\b/i,
  /\bcompose\b/i,
  /\bpost\s+(?:to|on)\b/i,
  /\bnostr\b/i,
  /\btweet\b/i,
  /\bwhop\b/i,
  /\bx\.com\b/i,
  /\bpublish\b/i,
  /\bseed\s+(?:the\s+)?(?:chat|feed|channel)\b/i,
];

// ---- INFRASTRUCTURE signals ----

const INFRA_PATTERNS: RegExp[] = [
  /\bdispatch\b/i,
  /\bsensor\b/i,
  /\bsafe-commit\b/i,
  /\bworktree\b/i,
  /\bescalation\s+ladder\b/i,
  /\bfleet\b/i,
  /\bsystemd\b/i,
  /\blaunchd\b/i,
  /\bservice\s+install\b/i,
  /\bcore\s+infra\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Classify a task into a type and recommend a model.
 * Purely deterministic — no LLM, no I/O.
 */
export function classifyTask(
  subject: string,
  description?: string,
): TaskClassification {
  const text = [subject, description ?? ""].join(" ");
  const subjectLower = subject.toLowerCase();

  // 1. Check core infra files → infrastructure (opus)
  const infraFile = matchesAny(text, CORE_INFRA_PATTERNS);
  if (infraFile) {
    return {
      type: "infrastructure",
      recommended_model: MODEL_FOR_TYPE["infrastructure"],
      confidence: "high",
      reason: `touches core infrastructure file (${infraFile})`,
    };
  }

  // 2. Check ineligible subject patterns → route to safer model
  const ineligSubject = matchesAny(subject, INELIGIBLE_SUBJECT);
  if (ineligSubject) {
    // Still try to distinguish content vs research vs operational
    const contentMatch = matchesAny(subject, CONTENT_PATTERNS);
    if (contentMatch) {
      return {
        type: "content",
        recommended_model: MODEL_FOR_TYPE["content"],
        confidence: "high",
        reason: `content task (${contentMatch})`,
      };
    }

    const researchMatch = matchesAny(subject, RESEARCH_PATTERNS);
    if (researchMatch) {
      return {
        type: "research",
        recommended_model: MODEL_FOR_TYPE["research"],
        confidence: "high",
        reason: `research/synthesis task (${researchMatch})`,
      };
    }

    const infraMatch = matchesAny(subject, INFRA_PATTERNS);
    if (infraMatch) {
      return {
        type: "infrastructure",
        recommended_model: MODEL_FOR_TYPE["infrastructure"],
        confidence: "low",
        reason: `infrastructure task (${infraMatch}) — consider opus if complex`,
      };
    }

    return {
      type: "unknown",
      recommended_model: MODEL_FOR_TYPE["unknown"],
      confidence: "low",
      reason: `ineligible pattern in subject (${ineligSubject})`,
    };
  }

  // 3. Check ineligible description patterns
  if (description) {
    const ineligDesc = matchesAny(description, INELIGIBLE_DESCRIPTION);
    if (ineligDesc) {
      return {
        type: "unknown",
        recommended_model: MODEL_FOR_TYPE["unknown"],
        confidence: "low",
        reason: `ineligible pattern in description (${ineligDesc})`,
      };
    }
  }

  // 4. Check operational patterns → haiku
  const opMatch = matchesAny(subject, OPERATIONAL_PATTERNS);
  if (opMatch) {
    return {
      type: "operational",
      recommended_model: MODEL_FOR_TYPE["operational"],
      confidence: "high",
      reason: `operational task (${opMatch})`,
    };
  }

  // 5. Check devstral patterns → bounded-code (cheapest)
  const devstralMatch = matchesAny(text, DEVSTRAL_PATTERNS);
  if (devstralMatch) {
    return {
      type: "bounded-code",
      recommended_model: MODEL_FOR_TYPE["bounded-code"],
      confidence: "high",
      reason: `single-file mechanical change (${devstralMatch})`,
    };
  }

  // 5b. File ref + action verb combo → bounded-code (catches "Add X helper to file.ts" variants)
  if (FILE_REF_PATTERN.test(text)) {
    const verbMatch = matchesAny(subject, DEVSTRAL_ACTION_VERBS);
    if (verbMatch) {
      return {
        type: "bounded-code",
        recommended_model: MODEL_FOR_TYPE["bounded-code"],
        confidence: "low",
        reason: `action verb (${verbMatch}) + file reference in subject`,
      };
    }
  }

  // 6. Check GLM patterns → bounded-code-glm
  const glmMatch = matchesAny(text, GLM_PATTERNS);
  if (glmMatch) {
    return {
      type: "bounded-code-glm",
      recommended_model: MODEL_FOR_TYPE["bounded-code-glm"],
      confidence: "high",
      reason: `bounded multi-file change (${glmMatch})`,
    };
  }

  // 7. Check research patterns → sonnet
  const researchMatch = matchesAny(text, RESEARCH_PATTERNS);
  if (researchMatch) {
    return {
      type: "research",
      recommended_model: MODEL_FOR_TYPE["research"],
      confidence: "high",
      reason: `research task (${researchMatch})`,
    };
  }

  // 8. Check content patterns → sonnet
  const contentMatch = matchesAny(text, CONTENT_PATTERNS);
  if (contentMatch) {
    return {
      type: "content",
      recommended_model: MODEL_FOR_TYPE["content"],
      confidence: "high",
      reason: `content task (${contentMatch})`,
    };
  }

  // 9. Check infra patterns → opus
  const infraMatch = matchesAny(text, INFRA_PATTERNS);
  if (infraMatch) {
    return {
      type: "infrastructure",
      recommended_model: MODEL_FOR_TYPE["infrastructure"],
      confidence: "low",
      reason: `infrastructure-adjacent (${infraMatch}) — consider opus if complex`,
    };
  }

  // 10. Default: unknown → sonnet (safe default)
  return {
    type: "unknown",
    recommended_model: MODEL_FOR_TYPE["unknown"],
    confidence: "low",
    reason: "no matching pattern — defaulting to sonnet",
  };
}
