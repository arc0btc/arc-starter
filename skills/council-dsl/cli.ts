#!/usr/bin/env bun
import { validate, tally } from './validator.ts'

const [cmd, ...rest] = process.argv.slice(2)

if (!cmd || cmd === 'help') {
  console.log(`council-dsl — Agent Council DSL grammar v1 validator + tally

Usage:
  arc skills run --name council-dsl -- validate <file>
  arc skills run --name council-dsl -- tally <file>

Commands:
  validate <file>   Check §1.5 hard rules; exit 0 if valid, 1 if errors
  tally <file>      Validate + run Borda×conf rank tally; print scores + blocked list
  help              Show this message`)
  process.exit(0)
}

if (cmd !== 'validate' && cmd !== 'tally') {
  console.error(`Unknown command: ${cmd}`)
  process.exit(1)
}

const filePath = rest[0]
if (!filePath) {
  console.error(`Error: missing <file> argument`)
  process.exit(1)
}

const text = await Bun.file(filePath).text()
const result = validate(text)

// ─── validate ────────────────────────────────────────────────────────────────

if (cmd === 'validate') {
  if (result.drops.length > 0) {
    console.log('Dropped lines:')
    for (const d of result.drops) {
      console.log(`  L${d.lineNum}: ${d.reason}`)
      console.log(`    ${d.raw.trim()}`)
    }
    console.log()
  }

  if (result.errors.length > 0) {
    console.log('Errors:')
    for (const e of result.errors) console.log(`  ${e}`)
    console.log()
  }

  if (result.warnings.length > 0) {
    console.log('Warnings:')
    for (const w of result.warnings) console.log(`  ${w}`)
    console.log()
  }

  const status = result.valid ? 'VALID' : 'INVALID'
  console.log(
    `${status} — ${result.moves.length} moves parsed, ` +
    `${result.errors.length} errors, ${result.drops.length} drops`,
  )

  process.exit(result.valid ? 0 : 1)
}

// ─── tally ───────────────────────────────────────────────────────────────────

if (cmd === 'tally') {
  if (result.errors.length > 0 || result.drops.length > 0) {
    if (result.drops.length > 0) {
      console.log('Dropped lines:')
      for (const d of result.drops) console.log(`  L${d.lineNum}: ${d.reason}`)
      console.log()
    }
    if (result.errors.length > 0) {
      console.log('Validation errors:')
      for (const e of result.errors) console.log(`  ${e}`)
      console.log()
    }
  }

  const t = tally(result)

  if (t.proposals.length === 0) {
    console.log('No PROPOSE moves found — nothing to tally.')
    process.exit(result.valid ? 0 : 1)
  }

  if (t.details.length > 0) {
    console.log('Borda×conf tally:')
    for (const step of t.details) console.log(`  ${step}`)
    console.log()
  }

  console.log('Ranking:')
  for (const [i, p] of t.ranking.entries()) {
    const score = (t.scores[p] ?? 0).toFixed(3)
    const tag = t.blocked.includes(p) ? ' [BLOCKED — unresolved CRITIQUE MUST]' : ''
    console.log(`  ${i + 1}. ${p}  score=${score}${tag}`)
  }

  if (t.blocked.length > 0) {
    console.log(`\nBlocked proposals: ${t.blocked.join(', ')}`)
    console.log('  → add REVISE -> <id> to clear each block before SYNTH')
  }

  const status = result.valid ? 'VALID' : 'INVALID'
  console.log(
    `\n${status} — ${result.moves.length} moves, ` +
    `${t.proposals.length} proposals, ${t.blocked.length} blocked`,
  )

  process.exit(result.valid ? 0 : 1)
}
