#!/usr/bin/env node
// Aggregate US SSA baby-name files (yobYYYY.txt, lines like "Mary,F,7065") into a seed file.
//
// Usage: node scripts/import-ssa.mjs <dir-with-yob-files> [--min 20000] [--out data/names.seed.json]
//
// - Sums counts across every yob*.txt in the directory.
// - Names above --min total births are kept (default 20000, per PLAN.md).
// - A name given to both sexes with the minority share >= 30% becomes "neutral";
//   otherwise it takes the majority gender ("boy" / "girl").
// Tagging (origin, meaning, style) and embeddings are later pipeline steps.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

const NEUTRAL_SHARE = 0.3

export function aggregate(lines) {
  const totals = new Map() // name -> { M, F }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const [name, sex, count] = line.split(',')
    const n = Number.parseInt(count, 10)
    if (!name || (sex !== 'M' && sex !== 'F') || !Number.isFinite(n)) continue
    const entry = totals.get(name) ?? { M: 0, F: 0 }
    entry[sex] += n
    totals.set(name, entry)
  }
  return totals
}

export function toSeed(totals, min) {
  const rows = []
  for (const [name, { M, F }] of totals) {
    const total = M + F
    if (total < min) continue
    const minority = Math.min(M, F) / total
    const gender = minority >= NEUTRAL_SHARE ? 'neutral' : M > F ? 'boy' : 'girl'
    rows.push({ name, gender, popularity: total })
  }
  return rows.sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name))
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      min: { type: 'string', default: '20000' },
      out: { type: 'string', default: 'data/names.seed.json' },
    },
  })
  const dir = positionals[0]
  if (!dir) {
    console.error('Usage: node scripts/import-ssa.mjs <dir-with-yob-files> [--min N] [--out file]')
    process.exit(1)
  }
  const files = readdirSync(dir).filter((f) => /^yob\d{4}\.txt$/.test(f))
  if (files.length === 0) {
    console.error(`No yobYYYY.txt files found in ${dir}`)
    process.exit(1)
  }
  const lines = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
  const rows = toSeed(aggregate(lines), Number.parseInt(values.min, 10))
  mkdirSync(dirname(values.out), { recursive: true })
  writeFileSync(values.out, JSON.stringify(rows, null, 2) + '\n')
  console.log(`Read ${files.length} files, wrote ${rows.length} names to ${values.out}`)
}

import { fileURLToPath } from 'node:url'
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
