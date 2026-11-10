import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { knownMeaning, type Gender, type ScreenProps } from '../lib/types'
import { describeError } from '../shortlist/errors'
import { fullName } from '../shortlist/names'
import { EmptyState, ErrorBox, GenderChip, SkeletonList, focusRing } from '../shortlist/ui'

type MatchedName = {
  id: number
  name: string
  gender: Gender
  origins: string[]
  meaning: string | null
  blurb: string | null
}

export default function MatchesScreen({ nursery }: ScreenProps) {
  const [items, setItems] = useState<MatchedName[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const nurseryId = nursery.id

  const load = useCallback(async (manual?: boolean) => {
    if (manual === true) setRefreshing(true)
    const m = await supabase
      .from('matches')
      .select('name_id, created_at')
      .eq('nursery_id', nurseryId)
      .order('created_at', { ascending: false })
    const mErr = describeError(m)
    if (mErr) {
      setError(mErr)
      setRefreshing(false)
      return
    }
    const ids = (m.data ?? []).map((r) => r.name_id as number)
    let list: MatchedName[] = []
    if (ids.length) {
      const n = await supabase
        .from('names')
        .select('id, name, gender, origins, meaning, blurb')
        .in('id', ids)
      const nErr = describeError(n)
      if (nErr) {
        setError(nErr)
        setRefreshing(false)
        return
      }
      const byId = new Map((n.data as MatchedName[]).map((r) => [r.id, r]))
      list = ids.flatMap((id) => byId.get(id) ?? [])
    }
    setItems(list)
    setError(null)
    setRefreshing(false)
  }, [nurseryId])

  useEffect(() => {
    const first = window.setTimeout(() => load(), 0)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => load(), 30_000)
    return () => {
      window.clearTimeout(first)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [load])

  return (
    <section className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Matches</h1>
          {items && items.length > 0 && (
            <p className="text-sm text-neutral-600">
              {items.length} {items.length === 1 ? 'name' : 'names'} you both like
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing}
          className={`min-h-11 rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-800 disabled:opacity-60 ${focusRing}`}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <ErrorBox message={error} onRetry={() => load(true)} />}
      {!items && !error && <SkeletonList />}
      {items && items.length === 0 && !error && (
        <EmptyState title="No matches yet">
          No matches yet. Keep swiping, a name appears here when you both like it.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-neutral-900">{fullName(n.name, nursery.surname)}</h2>
                <GenderChip gender={n.gender} />
              </div>
              {n.origins.length > 0 && <p className="mt-1 text-xs text-neutral-500">{n.origins.join(', ')}</p>}
              {knownMeaning(n.meaning) && <p className="mt-2 text-sm text-neutral-800">{knownMeaning(n.meaning)}</p>}
              {n.blurb && <p className="mt-1 text-sm text-neutral-600">{n.blurb}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
