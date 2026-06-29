// Agent Council DSL grammar v1 — validator + tally
// Dependency-light: no Bun/Node-specific APIs. Copy this file to port to another agent.

export type Modality = 'MUST' | 'MUST-NOT' | 'SHOULD' | 'SHOULD-NOT' | 'MAY'
export type Verb =
  | 'PROPOSE' | 'CLAIM' | 'REQUIRE' | 'RANK' | 'CRITIQUE'
  | 'REVISE' | 'VOTE' | 'ABSTAIN' | 'SYNTH'
export type PhaseId = 'propose' | 'rank' | 'critique' | 'revise' | 'vote' | 'synth'

const MODALITIES: ReadonlySet<string> = new Set(['MUST', 'MUST-NOT', 'SHOULD', 'SHOULD-NOT', 'MAY'])
const VERBS: ReadonlySet<string> = new Set([
  'PROPOSE', 'CLAIM', 'REQUIRE', 'RANK', 'CRITIQUE',
  'REVISE', 'VOTE', 'ABSTAIN', 'SYNTH',
])
const PHASES: ReadonlySet<string> = new Set(['propose', 'rank', 'critique', 'revise', 'vote', 'synth'])

export interface Move {
  lineNum: number
  raw: string
  phase: PhaseId
  speaker: string
  verb: Verb
  modality?: Modality
  target?: string
  args: string[]
  fields: Record<string, string>
  note?: string
}

export interface Drop {
  lineNum: number
  raw: string
  reason: string
}

export interface ValidationResult {
  valid: boolean
  moves: Move[]
  errors: string[]
  warnings: string[]
  drops: Drop[]
}

export interface TallyResult {
  proposals: string[]
  scores: Record<string, number>
  ranking: string[]
  blocked: string[]
  details: string[]
}

// ─── tokenizer ───────────────────────────────────────────────────────────────

function tokenize(line: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === ' ' || line[i] === '\t') { i++; continue }
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') j++
      tokens.push(line.slice(i, j + 1))
      i = j + 1
    } else {
      let j = i
      while (j < line.length && line[j] !== ' ' && line[j] !== '\t') j++
      tokens.push(line.slice(i, j))
      i = j
    }
  }
  return tokens
}

// Returns a Move on success, or { drop: reason } on parse failure.
function parseLine(
  lineNum: number,
  raw: string,
  phase: PhaseId,
): Move | { drop: string } {
  const tokens = tokenize(raw.trim())
  if (tokens.length < 2) return { drop: 'too few tokens' }

  const speakerMatch = tokens[0].match(/^\[([A-Za-z]+)\]$/)
  if (!speakerMatch) return { drop: 'invalid speaker format (expected [LABEL])' }
  const speaker = speakerMatch[1]

  if (!VERBS.has(tokens[1])) return { drop: `unknown verb "${tokens[1]}"` }
  const verb = tokens[1] as Verb

  let idx = 2
  let modality: Modality | undefined
  let target: string | undefined
  const args: string[] = []
  const fields: Record<string, string> = {}
  let note: string | undefined

  // Modality can appear before OR after target (spec grammar vs worked examples differ).
  // Accept either ordering.
  if (idx < tokens.length && MODALITIES.has(tokens[idx])) {
    modality = tokens[idx] as Modality
    idx++
  }

  if (idx < tokens.length && tokens[idx] === '->') {
    idx++
    if (idx < tokens.length) { target = tokens[idx]; idx++ }
    // modality after target: "[B] CRITIQUE -> p2 MUST ..."
    if (!modality && idx < tokens.length && MODALITIES.has(tokens[idx])) {
      modality = tokens[idx] as Modality
      idx++
    }
  }

  while (idx < tokens.length) {
    const tok = tokens[idx]
    if (tok.startsWith('"')) {
      // strip surrounding quotes
      note = tok.endsWith('"') ? tok.slice(1, -1) : tok.slice(1)
    } else if (/^[a-z_]+=/.test(tok)) {
      const eq = tok.indexOf('=')
      fields[tok.slice(0, eq)] = tok.slice(eq + 1)
    } else {
      args.push(tok)
    }
    idx++
  }

  return { lineNum, raw, phase, speaker, verb, modality, target, args, fields, note }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Parse "[item1,item2]" or "[]" → string[]
function parseListValue(val: string): string[] {
  const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return []
  return inner.split(',').map(s => s.trim()).filter(Boolean)
}

// Parse "p1>p2>p3" or "p1=p2>p3" → groups best→worst
function parseRankOrder(expr: string): string[][] {
  return expr.split('>').map(g => g.split('=').filter(Boolean))
}

// Valid label in RANK order or CRITIQUE target: A-G, p\d+, #kebab-slug
function isAnonymizedRef(ref: string): boolean {
  return /^[A-G]$/.test(ref) || /^p\d+$/.test(ref) || /^#[a-z0-9-]+$/.test(ref)
}

function stripHash(ref: string): string {
  return ref.startsWith('#') ? ref.slice(1) : ref
}

// ─── validate ────────────────────────────────────────────────────────────────

export function validate(input: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const drops: Drop[] = []
  const moves: Move[] = []
  let phase: PhaseId | null = null

  for (const [idx, raw] of input.split('\n').entries()) {
    const lineNum = idx + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (trimmed.startsWith('@phase')) {
      const pid = trimmed.slice(6).trim()
      if (!PHASES.has(pid)) {
        drops.push({ lineNum, raw, reason: `unknown phase "${pid}"` })
      } else {
        phase = pid as PhaseId
      }
      continue
    }

    if (!trimmed.startsWith('[')) {
      drops.push({ lineNum, raw, reason: 'not a move or @phase line' })
      continue
    }

    if (!phase) {
      drops.push({ lineNum, raw, reason: 'move before any @phase declaration' })
      continue
    }

    const parsed = parseLine(lineNum, raw, phase)
    if ('drop' in parsed) {
      drops.push({ lineNum, raw, reason: parsed.drop })
      continue
    }

    const m = parsed

    // Hard rule 5: REQUIRE MAY is rejected
    if (m.verb === 'REQUIRE' && m.modality === 'MAY') {
      errors.push(`L${lineNum}: REQUIRE MAY rejected — use MUST, MUST-NOT, or SHOULD (§1.5 rule 5)`)
      drops.push({ lineNum, raw, reason: 'REQUIRE MAY is invalid (§1.5 rule 5)' })
      continue
    }

    // Hard rule 2: CLAIM missing ev= → silent drop
    if (m.verb === 'CLAIM' && !m.fields['ev']) {
      drops.push({ lineNum, raw, reason: 'CLAIM missing ev= — dropped by aggregator (§1.5 rule 2)' })
      continue
    }

    // Hard rule 2 + §4 decision: REQUIRE missing ev= → escalate as error (not silent drop)
    // Rationale: a policy claim with no evidence source is worth flagging; silent drop could
    // hide a critical constraint that wasn't properly documented.
    if (m.verb === 'REQUIRE' && !m.fields['ev']) {
      errors.push(
        `L${lineNum}: REQUIRE without ev= — escalated (§4 decision: uncited REQUIRE is flagged, not silently dropped)`,
      )
      drops.push({ lineNum, raw, reason: 'REQUIRE missing ev= — escalated per §4 decision' })
      continue
    }

    // Hard rule 1: RANK/CRITIQUE reference only anonymized labels
    if (m.verb === 'RANK' && m.args[0]) {
      const refs = parseRankOrder(m.args[0]).flat()
      for (const ref of refs) {
        if (!isAnonymizedRef(ref)) {
          errors.push(`L${lineNum}: RANK references non-anonymized label "${ref}" (§1.5 rule 1)`)
        }
      }
    }

    if (m.verb === 'CRITIQUE' && m.target) {
      if (!isAnonymizedRef(m.target)) {
        errors.push(`L${lineNum}: CRITIQUE references non-anonymized label "${m.target}" (§1.5 rule 1)`)
      }
    }

    moves.push(m)
  }

  // Post-parse: hard rules 3 and 4 (SYNTH-level)
  const mustCritiques = moves.filter(
    m => m.verb === 'CRITIQUE' && (m.modality === 'MUST' || m.modality === 'MUST-NOT'),
  )
  const reviseTargets = new Set(
    moves
      .filter(m => m.verb === 'REVISE' && m.target)
      .map(m => stripHash(m.target!)),
  )

  for (const synth of moves.filter(m => m.verb === 'SYNTH')) {
    // Hard rule 3: blocked proposals in from=
    const fromIds = (synth.fields['from'] ?? '')
      .split('+')
      .map(s => s.trim())
      .filter(Boolean)

    for (const propId of fromIds) {
      const isBlocked = mustCritiques.some(c => {
        const ct = stripHash(c.target ?? '')
        return ct === propId && !reviseTargets.has(ct)
      })
      if (isBlocked) {
        errors.push(
          `L${synth.lineNum}: SYNTH includes "${propId}" with unresolved CRITIQUE MUST — blocked until REVISE (§1.5 rule 3)`,
        )
      }
    }

    // Hard rule 4: non-empty open= blocks close
    const openField = synth.fields['open']
    if (openField) {
      const openItems = parseListValue(openField)
      if (openItems.length > 0) {
        errors.push(
          `L${synth.lineNum}: SYNTH open=[${openItems.join(',')}] — council cannot close (§1.5 rule 4)`,
        )
      }
    }
  }

  return { valid: errors.length === 0, moves, errors, warnings, drops }
}

// ─── tally ───────────────────────────────────────────────────────────────────

export function tally(result: ValidationResult): TallyResult {
  const proposals = result.moves
    .filter(m => m.verb === 'PROPOSE' && m.args[0])
    .map(m => m.args[0])

  const scores: Record<string, number> = {}
  for (const p of proposals) scores[p] = 0

  const details: string[] = []
  const N = proposals.length

  for (const rank of result.moves.filter(m => m.verb === 'RANK' && m.args[0])) {
    const conf = parseFloat(rank.fields['conf'] ?? '1.0')
    const order = parseRankOrder(rank.args[0])
    details.push(`[${rank.speaker}] RANK ${rank.args[0]} conf=${conf}`)

    let pos = N - 1
    for (const group of order) {
      const size = group.length
      // tied items share the average of their Borda positions
      let total = 0
      for (let k = 0; k < size; k++) total += pos - k
      const avg = size > 0 ? total / size : 0
      for (const label of group) {
        if (label in scores) {
          const pts = avg * conf
          scores[label] = (scores[label] ?? 0) + pts
          details.push(`  ${label}: +${pts.toFixed(3)} (${avg} Borda × ${conf} conf)`)
        }
      }
      pos -= size
    }
  }

  // Determine blocked proposals (CRITIQUE MUST without REVISE)
  const mustCritiques = result.moves.filter(
    m => m.verb === 'CRITIQUE' && (m.modality === 'MUST' || m.modality === 'MUST-NOT'),
  )
  const reviseTargets = new Set(
    result.moves
      .filter(m => m.verb === 'REVISE' && m.target)
      .map(m => stripHash(m.target!)),
  )

  const blocked: string[] = []
  for (const crit of mustCritiques) {
    const ct = stripHash(crit.target ?? '')
    if (ct && !reviseTargets.has(ct) && !blocked.includes(ct)) {
      blocked.push(ct)
    }
  }

  const ranking = [...proposals].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))

  return { proposals, scores, ranking, blocked, details }
}
