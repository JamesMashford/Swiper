import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { NameCard } from '../lib/types'

export type DeckStatus = 'loading' | 'ready' | 'empty' | 'error' | 'missing'

const BATCH = 10
const PREFETCH_AT = 3

type RpcError = { code?: string; message: string; status?: number } | null

function isMissingRpc(e: RpcError, status?: number): boolean {
  return e?.code === 'PGRST202' || status === 404 || e?.status === 404
}

export function useDeck(userId: string) {
  const [queue, setQueue] = useState<NameCard[]>([])
  const [status, setStatus] = useState<DeckStatus>('loading')
  const [done, setDone] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [swipeError, setSwipeError] = useState<string | null>(null)

  const seen = useRef<Set<number>>(new Set())
  const fetching = useRef(false)
  const exhausted = useRef(false)
  // Bumped on reload so a slow response from an older request is ignored.
  const generation = useRef(0)

  const fetchBatch = useCallback(async () => {
    if (fetching.current || exhausted.current) return
    fetching.current = true
    const gen = generation.current
    try {
      // A batch can be all repeats if swipes are still being saved; try a few times.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error, status: httpStatus } = await supabase.rpc('suggest_names', {
          p_n: BATCH,
        })
        if (gen !== generation.current) return
        if (error) {
          if (isMissingRpc(error, httpStatus)) setStatus('missing')
          else {
            setLoadError(error.message)
            setStatus('error')
          }
          return
        }
        const rows = (data ?? []) as NameCard[]
        if (rows.length === 0) break
        const fresh = rows.filter((r) => !seen.current.has(r.id))
        fresh.forEach((r) => seen.current.add(r.id))
        if (fresh.length > 0) {
          setQueue((q) => [...q, ...fresh])
          setLoadError(null)
          setStatus('ready')
          return
        }
      }
      exhausted.current = true
      setDone(true)
    } finally {
      if (gen === generation.current) fetching.current = false
    }
  }, [])

  const reload = useCallback(() => {
    generation.current += 1
    fetching.current = false
    seen.current = new Set()
    exhausted.current = false
    setDone(false)
    setQueue([])
    setLoadError(null)
    setStatus('loading')
    void fetchBatch()
  }, [fetchBatch])

  // First load (state starts as 'loading'); the screen is remounted per user.
  useEffect(() => {
    const t = window.setTimeout(() => void fetchBatch(), 0)
    return () => window.clearTimeout(t)
  }, [fetchBatch, userId])

  // Prefetch when few cards are left.
  const queueLength = queue.length
  useEffect(() => {
    if (status !== 'ready' || queueLength > PREFETCH_AT) return
    const t = window.setTimeout(() => void fetchBatch(), 0)
    return () => window.clearTimeout(t)
  }, [status, queueLength, fetchBatch])

  const swipe = useCallback(async (card: NameCard, liked: boolean) => {
    setSwipeError(null)
    setQueue((q) => q.filter((c) => c.id !== card.id))
    const { error } = await supabase
      .from('swipes')
      .upsert({ name_id: card.id, liked }, { onConflict: 'user_id,name_id' })
    if (error) {
      setQueue((q) => (q.some((c) => c.id === card.id) ? q : [card, ...q]))
      setStatus('ready')
      setSwipeError(`Could not save that swipe: ${error.message}`)
    }
  }, [])

  // Nothing left and nothing more coming.
  const effective: DeckStatus =
    done && queue.length === 0 && (status === 'loading' || status === 'ready') ? 'empty' : status

  return {
    queue,
    status: effective,
    loadError,
    swipeError,
    dismissSwipeError: () => setSwipeError(null),
    swipe,
    reload,
  }
}
