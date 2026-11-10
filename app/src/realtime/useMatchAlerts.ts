import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type MatchAlert = { nameId: number; name: string }

const POLL_MS = 20_000

/**
 * Watches the nursery's matches and reports new ones once each.
 * Realtime is the fast path; polling (every 20s and when the tab becomes visible)
 * is the fallback in case the websocket never connects. Matches that exist when
 * the hook starts are treated as already known and never alert.
 */
export function useMatchAlerts(nurseryId: string) {
  // Every match that arrived since the overlay was last closed; they show together as one overlay.
  const [queue, setQueue] = useState<MatchAlert[]>([])
  const [unseen, setUnseen] = useState(false)

  useEffect(() => {
    const known = new Set<number>()
    const pending: number[] = []
    let baseline = false
    let stopped = false

    async function announce(ids: number[]) {
      const fresh = ids.filter((id) => !known.has(id))
      if (fresh.length === 0) return
      fresh.forEach((id) => known.add(id)) // before any await, so concurrent callers dedupe
      const { data } = await supabase.from('names').select('id, name').in('id', fresh)
      if (stopped) return
      const alerts = fresh.map((id) => ({
        nameId: id,
        name: data?.find((n) => n.id === id)?.name ?? 'a new name',
      }))
      setQueue((q) => [...q, ...alerts])
      setUnseen(true)
    }

    async function poll() {
      const { data, error } = await supabase
        .from('matches')
        .select('name_id')
        .eq('nursery_id', nurseryId)
      if (stopped || error || !data) return
      const ids = data.map((r) => r.name_id as number)
      if (!baseline) {
        ids.forEach((id) => known.add(id))
        baseline = true
        if (pending.length) await announce(pending.splice(0))
        return
      }
      await announce(ids)
    }

    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void poll()
    document.addEventListener('visibilitychange', onVisible)

    const channel = supabase
      .channel(`matches-${nurseryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'matches', filter: `nursery_id=eq.${nurseryId}` },
        (payload) => {
          const id = (payload.new as { name_id?: number }).name_id
          if (typeof id !== 'number') return
          if (baseline) void announce([id])
          else pending.push(id)
        },
      )
      .subscribe()

    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [nurseryId])

  /** Closes the overlay for every match that is waiting, not just the first. */
  const dismiss = useCallback(() => setQueue([]), [])
  const markSeen = useCallback(() => setUnseen(false), [])

  return { alerts: queue, unseen, dismiss, markSeen }
}
