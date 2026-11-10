import { MotionConfig } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ScreenProps, ShortlistRow } from '../lib/types'
import CoupleTab from '../shortlist/CoupleTab'
import DuelTab from '../shortlist/DuelTab'
import RankTab from '../shortlist/RankTab'
import { describeError, settled } from '../shortlist/errors'
import { ErrorBox, SkeletonList, focusRing } from '../shortlist/ui'

type SubTab = 'rank' | 'duel' | 'couple'
const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'rank', label: 'Rank' },
  { id: 'duel', label: 'Head to head' },
  { id: 'couple', label: "Couple's ranking" },
]

export default function ShortlistScreen({ nursery }: ScreenProps) {
  const [tab, setTab] = useState<SubTab>('rank')
  const [rows, setRows] = useState<ShortlistRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const fetchRows = useCallback(async () => {
    const mine = ++seq.current
    await new Promise((r) => setTimeout(r, 0)) // let a leaving tab queue its save
    await settled() // then let pending ranking saves land first
    const res = await supabase.rpc('shortlist_scores')
    if (mine !== seq.current) return
    const err = describeError(res)
    if (err) {
      setError(err)
      setRows(null)
    } else {
      setError(null)
      setRows((res.data ?? []) as ShortlistRow[])
    }
  }, [])

  /** Silent refetch that keeps the current tab mounted. */
  const reload = useCallback(async () => {
    await fetchRows()
  }, [fetchRows])

  const select = (next: SubTab) => {
    setTab(next)
    setRows(null)
    setError(null)
    void fetchRows()
  }

  useEffect(() => {
    const first = window.setTimeout(() => void fetchRows(), 0)
    return () => window.clearTimeout(first)
  }, [fetchRows])

  return (
    <MotionConfig reducedMotion="user">
      <section className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Shortlist</h1>
        <div role="tablist" aria-label="Shortlist views" className="grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1">
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => select(t.id)}
              className={`min-h-11 rounded-lg px-1 text-sm leading-tight ${focusRing} ${
                tab === t.id ? 'bg-white font-semibold text-rose-600 shadow-sm' : 'text-neutral-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {error && <ErrorBox message={error} onRetry={() => select(tab)} />}
          {!error && !rows && <SkeletonList />}
          {!error && rows && tab === 'rank' && <RankTab rows={rows} surname={nursery.surname} />}
          {!error && rows && tab === 'duel' && (
            <DuelTab rows={rows} surname={nursery.surname} nurseryId={nursery.id} reload={reload} />
          )}
          {!error && rows && tab === 'couple' && <CoupleTab rows={rows} surname={nursery.surname} />}
        </div>
      </section>
    </MotionConfig>
  )
}
