import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { knownMeaning, type ShortlistRow } from '../lib/types'
import { describeError } from './errors'
import { fullName } from './names'
import { EmptyState, focusRing } from './ui'

type Pair = [number, number]
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Prefer the pair shown least, then names shown least; never repeat the last pair. */
function pickPair(
  ids: number[],
  pairCounts: Map<string, number>,
  nameCounts: Map<number, number>,
  last: Pair | null,
): Pair | null {
  let best: { pair: Pair; score: number }[] = []
  let bestScore = Infinity
  const lastKey = last ? key(last[0], last[1]) : null
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const k = key(ids[i], ids[j])
      if (ids.length > 2 && k === lastKey) continue
      const score =
        (pairCounts.get(k) ?? 0) * 1000 + (nameCounts.get(ids[i]) ?? 0) + (nameCounts.get(ids[j]) ?? 0)
      if (score < bestScore) {
        bestScore = score
        best = []
      }
      if (score === bestScore) best.push({ pair: [ids[i], ids[j]], score })
    }
  }
  if (!best.length) return null
  const pick = best[Math.floor(Math.random() * best.length)].pair
  return Math.random() < 0.5 ? pick : [pick[1], pick[0]]
}

export default function DuelTab({
  rows,
  surname,
  nurseryId,
  reload,
}: {
  rows: ShortlistRow[]
  surname: string
  nurseryId: string
  reload: () => Promise<void>
}) {
  const [counts, setCounts] = useState({
    pairs: new Map<string, number>(),
    names: new Map<number, number>(),
  })
  const ids = rows.map((r) => r.name_id)
  const [pair, setPair] = useState<Pair | null>(() => pickPair(ids, new Map(), new Map(), null))
  const [duels, setDuels] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (rows.length < 2) {
    return (
      <EmptyState title="Head to head needs two names">
        You need at least two matches to start a duel. Keep swiping.
      </EmptyState>
    )
  }

  const byId = new Map(rows.map((r) => [r.name_id, r]))
  const shown = pair && byId.has(pair[0]) && byId.has(pair[1]) ? pair : null

  const advance = (from: Pair) => {
    const pairs = new Map(counts.pairs)
    const names = new Map(counts.names)
    const k = key(from[0], from[1])
    pairs.set(k, (pairs.get(k) ?? 0) + 1)
    for (const id of from) names.set(id, (names.get(id) ?? 0) + 1)
    setCounts({ pairs, names })
    setPair(pickPair(ids, pairs, names, from))
  }

  const choose = async (winner: number, loser: number) => {
    if (busy || !shown) return
    setBusy(true)
    setError(null)
    const res = await supabase
      .from('duels')
      .insert({ nursery_id: nurseryId, winner_name_id: winner, loser_name_id: loser })
    const err = describeError(res)
    if (err) {
      setError(err)
      setBusy(false)
      return
    }
    setDuels((d) => d + 1)
    advance(shown)
    await reload()
    setBusy(false)
  }

  if (!shown) {
    return (
      <button type="button" onClick={() => setPair(pickPair(ids, counts.pairs, counts.names, null))} className={`min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium ${focusRing}`}>
        Next pair
      </button>
    )
  }

  const top3 = [...rows].sort((a, b) => b.my_elo - a.my_elo).slice(0, 3)
  const card = (id: number, other: number) => {
    const r = byId.get(id)!
    return (
      <button
        key={id}
        type="button"
        disabled={busy}
        onClick={() => choose(id, other)}
        className={`flex min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-neutral-200 bg-white p-4 text-center shadow-sm transition active:scale-95 hover:border-rose-600 disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100 ${focusRing}`}
      >
        <span className="text-xl font-semibold leading-tight text-neutral-900">{fullName(r.name, surname)}</span>
        {knownMeaning(r.meaning) && <span className="text-sm text-neutral-600">{knownMeaning(r.meaning)}</span>}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">Tap the name you like more.</p>
      <div className="flex gap-3" role="group" aria-label="Choose your favourite">
        {card(shown[0], shown[1])}
        {card(shown[1], shown[0])}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}. Tap a name to try again.
        </p>
      )}
      <div className="flex items-center justify-between">
        <p aria-live="polite" className="text-sm text-neutral-600">
          {duels} {duels === 1 ? 'duel' : 'duels'} this session
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => advance(shown)}
          className={`min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-800 disabled:opacity-60 ${focusRing}`}
        >
          Skip
        </button>
      </div>
      <section aria-label="Your top 3" className="rounded-2xl bg-neutral-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-900">Your top 3 right now</h3>
        <ol className="flex flex-col gap-1 text-sm text-neutral-800">
          {top3.map((r, i) => (
            <li key={r.name_id}>
              <span className="mr-2 font-semibold text-rose-600">{i + 1}</span>
              {fullName(r.name, surname)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
