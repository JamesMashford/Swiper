import { useCallback, useEffect, useState } from 'react'
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
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // RLS only returns the nursery this user belongs to.
    const { data: n, error: nErr } = await supabase.from('nurseries').select('*').maybeSingle()
    if (nErr) {
      setError(nErr.message)
      setLoading(false)
      return
    }
    setNursery(n)
    if (n) {
      const { data: m } = await supabase.from('nursery_members').select('user_id')
      const ids = (m ?? []).map((row) => row.user_id)
      const { data: p } = await supabase.from('profiles').select('id, display_name').in('id', ids)
      setMembers(
        ids.map((id) => ({
          user_id: id,
          display_name: p?.find((x) => x.id === id)?.display_name || 'Partner',
        })),
      )
    } else {
      setMembers([])
    }
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    // Pick up a partner joining when the app comes back to the foreground.
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, userId])

  const create = useCallback(
    async (surname: string): Promise<string | null> => {
      const { error: e } = await supabase.rpc('create_nursery', { p_surname: surname })
      if (e) return e.message
      await refresh()
      return null
    },
    [refresh],
  )

  const join = useCallback(
    async (code: string): Promise<string | null> => {
      const { error: e } = await supabase.rpc('join_nursery', { p_code: code })
      if (e) return e.message
      await refresh()
      return null
    },
    [refresh],
  )

  const updateSurname = useCallback(
    async (surname: string): Promise<string | null> => {
      if (!nursery) return 'No nursery'
      const { error: e } = await supabase.from('nurseries').update({ surname }).eq('id', nursery.id)
      if (e) return e.message
      await refresh()
      return null
    },
    [nursery, refresh],
  )

  return { nursery, members, loading, error, refresh, create, join, updateSurname }
}
