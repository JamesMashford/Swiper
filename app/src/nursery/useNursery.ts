import { useCallback, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'

export type Nursery = {
  id: string
  invite_code: string
  surname: string
  genders: string[]
  origins: string[]
}

export type Member = { user_id: string; display_name: string }

export function useNursery(userId: string) {
  const [nursery, setNursery] = useState<Nursery | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  // True once any load has succeeded. Before that an error is fatal; after it, only a banner.
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      // RLS only returns the nursery this user belongs to.
      const { data: n, error: nErr } = await supabase.from('nurseries').select('*').maybeSingle()
      if (nErr) throw nErr
      let list: Member[] = []
      if (n) {
        const { data: m, error: mErr } = await supabase.from('nursery_members').select('user_id')
        if (mErr) throw mErr
        const ids = (m ?? []).map((row) => row.user_id)
        const { data: p, error: pErr } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', ids)
        if (pErr) throw pErr
        list = ids.map((id) => ({
          user_id: id,
          // My own name stays empty until it is known; only a partner falls back to "Partner".
          display_name: p?.find((x) => x.id === id)?.display_name || (id === userId ? '' : 'Partner'),
        }))
      }
      // Nursery and members land together, so screens never see one without the other.
      setNursery(n)
      setMembers(list)
      setError(null)
      setLoaded(true)
    } catch (e) {
      setError(friendlyError(e))
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    refresh()
    // Pick up a partner joining (and recover from a failed load) when the app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  /** Retry from the first-load error screen. */
  const retry = useCallback(() => {
    setLoading(true)
    return refresh()
  }, [refresh])

  const dismissError = useCallback(() => setError(null), [])

  const create = useCallback(
    async (surname: string): Promise<string | null> => {
      const { error: e } = await supabase.rpc('create_nursery', { p_surname: surname })
      if (e) return friendlyError(e.message)
      await refresh()
      return null
    },
    [refresh],
  )

  const join = useCallback(
    async (code: string): Promise<string | null> => {
      const { data, error: e } = await supabase.rpc('join_nursery', { p_code: code })
      if (e) return friendlyError(e.message)
      // The function answers {ok:false, message} for a wrong code, a full nursery and a lockout.
      const res = data as { ok?: boolean; message?: string } | null
      if (res && typeof res === 'object' && res.ok === false) {
        return res.message || 'That invite code did not work. Check it, or ask your partner for a new one.'
      }
      await refresh()
      return null
    },
    [refresh],
  )

  const updateSurname = useCallback(
    async (surname: string): Promise<string | null> => {
      if (!nursery) return 'No nursery'
      const { error: e } = await supabase.from('nurseries').update({ surname }).eq('id', nursery.id)
      if (e) return friendlyError(e.message)
      await refresh()
      return null
    },
    [nursery, refresh],
  )

  return {
    nursery,
    members,
    loading,
    loaded,
    error,
    refresh,
    retry,
    dismissError,
    create,
    join,
    updateSurname,
  }
}
