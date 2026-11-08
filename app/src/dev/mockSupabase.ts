// Demo mode (VITE_MOCK=1): fakes the few Supabase endpoints the app uses, in memory,
// so the screens can be tried without a Supabase project. Not loaded in normal builds.
//
// Try: sign up / sign in with any email and password, create a nursery, or join with
// BABY-DEMO (an existing nursery with one member). BABY-FULL is a full nursery.
// A nursery you create gets a demo partner ("Sam") about 8 seconds after you create it.
// State is kept in localStorage so a refresh keeps it; signing out resets it.

type Json = Record<string, unknown>
type Nursery = { id: string; invite_code: string; surname: string; genders: string[]; origins: string[] }

export function installMockSupabase(origin: string) {
  const me = { id: 'user-me', display_name: 'You' }
  const sam = { id: 'user-sam', display_name: 'Sam' }
  let email = 'you@example.com'
  const KEY = 'swiper-mock-state'
  type State = { nursery: Nursery | null; partnerJoinsAt: number | null; partnerFromStart: boolean }
  let state: State = { nursery: null, partnerJoinsAt: null, partnerFromStart: false }
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) state = JSON.parse(saved)
  } catch {
    // storage unavailable: state stays in memory
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // ignore
    }
  }
  const getMembers = () => {
    if (!state.nursery) return []
    const partnerHere =
      state.partnerFromStart || (state.partnerJoinsAt !== null && Date.now() >= state.partnerJoinsAt)
    return partnerHere ? [{ user_id: me.id }, { user_id: sam.id }] : [{ user_id: me.id }]
  }

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const sessionBody = () => ({
    access_token: 'mock.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh',
    user: {
      id: me.id,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  })

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== origin) return realFetch(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body: Json = init?.body ? JSON.parse(String(init.body)) : {}
    const path = url.pathname
    await new Promise((r) => setTimeout(r, 250)) // feel like a network

    if (path.endsWith('/auth/v1/token') || path.endsWith('/auth/v1/signup')) {
      if (typeof body.email === 'string') email = body.email
      return json(200, sessionBody())
    }
    if (path.endsWith('/auth/v1/logout')) {
      state = { nursery: null, partnerJoinsAt: null, partnerFromStart: false } // fresh start for the next demo run
      save()
      return json(204, null)
    }

    if (path.endsWith('/rpc/create_nursery')) {
      if (state.nursery) return json(400, { message: 'You are already in a nursery', code: 'P0001' })
      const created: Nursery = {
        id: 'nursery-1',
        invite_code: 'BABY-7K2Q',
        surname: String(body.p_surname ?? ''),
        genders: ['boy', 'girl', 'neutral'],
        origins: [],
      }
      state = { nursery: created, partnerJoinsAt: Date.now() + 8000, partnerFromStart: false }
      save()
      return json(200, created)
    }
    if (path.endsWith('/rpc/join_nursery')) {
      const code = String(body.p_code ?? '').trim().toUpperCase()
      if (code === 'BABY-FULL') return json(400, { message: 'This nursery already has two members', code: 'P0001' })
      if (code !== 'BABY-DEMO') return json(404, { message: 'Invite code not found', code: 'P0002' })
      const joined: Nursery = { id: 'nursery-2', invite_code: 'BABY-DEMO', surname: 'Demo', genders: ['boy', 'girl', 'neutral'], origins: [] }
      state = { nursery: joined, partnerJoinsAt: null, partnerFromStart: true }
      save()
      return json(200, joined)
    }

    if (path.endsWith('/rest/v1/nurseries')) {
      if (method === 'PATCH' && state.nursery) {
        state = { ...state, nursery: { ...state.nursery, surname: String(body.surname ?? state.nursery.surname) } }
        save()
        return json(204, null)
      }
      return json(200, state.nursery ? [state.nursery] : [])
    }
    if (path.endsWith('/rest/v1/nursery_members')) return json(200, getMembers())
    if (path.endsWith('/rest/v1/profiles')) return json(200, [me, sam])

    return json(200, {})
  }
}
