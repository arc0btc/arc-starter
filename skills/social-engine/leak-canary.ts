/**
 * skills/social-engine/leak-canary.ts
 *
 * Outbound leak canary — defense-in-depth against SKILL.md/AGENT.md black-box
 * extraction (arXiv 2604.21829: plain-prompt extraction hits ~48% exact recovery,
 * CoT ~72%). Dispatch loads SKILL.md into the same orchestrator context that
 * generates outward replies to untrusted input (src/dispatch.ts:245-253), so an
 * extraction prompt embedded in a reply target is a plausible interface.
 *
 * Scope: catches VERBATIM / near-verbatim recovery only (the plain/CoT
 * exact-match class). Does NOT catch paraphrase/translation leakage — the
 * paper's own hard case survives every verbatim-copy defense the authors
 * tried. This is a cheap tripwire, not a semantic-leakage solution.
 *
 * See memory/shared/entries/skillmd-black-box-extraction-exposure.md.
 */

import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = process.env.ARC_SKILLS_DIR ?? path.join(import.meta.dir, "..");
const MIN_SHINGLE_WORDS = 8;

export interface LeakScanResult {
  leaked: boolean;
  matchedShingle?: string;
  sourceFile?: string;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

interface CorpusDoc {
  file: string;
  normalized: string;
}

let corpusCache: CorpusDoc[] | null = null;

function loadCorpus(): CorpusDoc[] {
  if (corpusCache) return corpusCache;
  const docs: CorpusDoc[] = [];
  let skillDirs: string[] = [];
  try {
    skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    corpusCache = docs;
    return docs;
  }
  for (const name of skillDirs) {
    for (const fname of ["SKILL.md", "AGENT.md"]) {
      const p = path.join(SKILLS_DIR, name, fname);
      try {
        const content = fs.readFileSync(p, "utf8");
        docs.push({ file: `${name}/${fname}`, normalized: normalize(content) });
      } catch {
        /* file doesn't exist for this skill — skip */
      }
    }
  }
  corpusCache = docs;
  return docs;
}

/**
 * Scan candidate outbound text for verbatim/near-verbatim substrings of any
 * SKILL.md or AGENT.md in the skill tree. Flags on any contiguous run of
 * MIN_SHINGLE_WORDS+ words (after whitespace/case normalization) that also
 * appears in a skill doc — short enough phrases are too common to be signal,
 * an 8-word verbatim match in a <=280-char reply is not coincidental.
 */
export function scanForSkillLeak(text: string): LeakScanResult {
  const normalized = normalize(text);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < MIN_SHINGLE_WORDS) return { leaked: false };

  const corpus = loadCorpus();
  if (corpus.length === 0) return { leaked: false };

  for (let i = 0; i <= words.length - MIN_SHINGLE_WORDS; i++) {
    const shingle = words.slice(i, i + MIN_SHINGLE_WORDS).join(" ");
    for (const doc of corpus) {
      if (doc.normalized.includes(shingle)) {
        return { leaked: true, matchedShingle: shingle, sourceFile: doc.file };
      }
    }
  }
  return { leaked: false };
}
