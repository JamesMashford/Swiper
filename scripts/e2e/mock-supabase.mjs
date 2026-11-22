// In-memory fake of the parts of Supabase the Swiper UI talks to, installed with
// Playwright's `context.route()`. Used by ui-shell.mjs. Not a faithful Postgres: it
// implements just enough PostgREST filtering (eq., in.(...), order) for the app.
//
//   const mock = createMock({ origin: 'https://xyz.supabase.co' })
//   await mock.install(context)
//   mock.addUser('a@x.test', 'password1', 'Alice')
//   mock.latency = 300            // ms added to every REST call
//   mock.fail = (req) => boolean  // return true to answer 500 for that request
//   mock.rpcDelay.fn = ms         // extra delay for one rpc
//   mock.tableDelay.profiles = ms // extra delay for GETs on one table
//   mock.log                      // [{method, path, status}] of every call

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub, email) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })}.sig`

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
}

export function makeNames(count = 40) {
  const out = []
  for (let i = 1; i <= count; i++) {
    out.push({
      id: i,
      name: `Name${i}`,
      gender: ['boy', 'girl', 'neutral'][i % 3],
      origins: [['English', 'Irish', 'Greek'][i % 3]],
      meaning: i % 7 === 0 ? 'Meaning uncertain' : `Meaning of ${i}.`,
      style_tags: ['classic', 'soft', 'nature'].slice(0, 1 + (i % 3)),
      syllables: 1 + (i % 3),
      popularity: 50,
      blurb: `Blurb ${i}`,
      is_starter: i <= 30,
    })
  }
  out[2].name = `Zoë<script>window.__xss=1</script>"'<img src=x onerror="window.__xss=2">`
  out[3].name = 'Supercalifragilisticexpialidocious'.repeat(2)
  return out
}

export function createMock({ origin, names = makeNames() }) {
  const s = {
    users: new Map(), // email -> {id,email,password,display}
    tokens: new Map(), // access token -> user
    nurseries: [],
    members: [], // {nursery_id,user_id}
    swipes: [], // {user_id,name_id,liked}
    matches: [], // {nursery_id,name_id,created_at}
    rankings: [], // {nursery_id,user_id,name_id,position}
    duels: [],
    seq: 1,
  }
  const mock = {
    state: s,
    names,
    latency: 0,
    offline: false, // true: every request fails like a lost connection
    fail: null,
    log: [],
    rpcDelay: {},
    tableDelay: {},
    joinFailures: new Map(), // user id -> failed join attempts (lockout after 10)
    rotateCalls: 0,
    leaveCalls: 0,
    addUser(email, password, display = '') {
      const id = `00000000-0000-4000-8000-${String(s.seq++).padStart(12, '0')}`
      const u = { id, email, password, display: display || email.split('@')[0] }
      s.users.set(email, u)
      return u
    },
    addNursery(ownerId, code = 'BABY-AAAAAAAA', surname = '') {
      const id = `11111111-0000-4000-8000-${String(s.seq++).padStart(12, '0')}`
      s.nurseries.push({ id, invite_code: code, surname, genders: ['boy', 'girl', 'neutral'], origins: [], created_by: ownerId })
      s.members.push({ nursery_id: id, user_id: ownerId })
      return id
    },
    addMember(nurseryId, userId) {
      s.members.push({ nursery_id: nurseryId, user_id: userId })
    },
    addMatch(nurseryId, nameId) {
      if (!s.matches.some((m) => m.nursery_id === nurseryId && m.name_id === nameId))
        s.matches.push({ nursery_id: nurseryId, name_id: nameId, created_at: new Date(Date.now() + s.seq++).toISOString() })
    },
    userByEmail: (e) => s.users.get(e),
    async install(context) {
      await context.route(`${origin}/**`, (route) => handle(route))
    },
  }

  const sessionFor = (u) => {
    const access = jwt(u.id, u.email) + '.' + s.seq++
    s.tokens.set(access, u)
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'r-' + u.id,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { full_name: u.display }, created_at: new Date().toISOString() },
    }
  }
  const nurseryOf = (uid) => {
    const m = s.members.find((x) => x.user_id === uid)
    return m ? s.nurseries.find((n) => n.id === m.nursery_id) : null
  }

  function parseFilters(url) {
    const f = []
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue
      if (v.startsWith('eq.')) f.push((r) => String(r[k]) === v.slice(3))
      else if (v.startsWith('in.(')) {
        const set = new Set(v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')))
        f.push((r) => set.has(String(r[k])))
      }
    }
    return (r) => f.every((p) => p(r))
  }

  function userFrom(headers) {
    const a = headers['authorization'] || ''
    const t = a.replace(/^Bearer\s+/i, '')
    return s.tokens.get(t) || null
  }

  const json = (route, status, body, extra = {}) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) })

  async function handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const path = url.pathname
    if (mock.offline) return route.abort('internetdisconnected')
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (mock.latency) await new Promise((r) => setTimeout(r, mock.latency))
    const rec = (status) => mock.log.push({ method, path: path + (url.search.includes('grant_type') ? url.search : ''), status })
    if (mock.fail && mock.fail({ method, path, url })) {
      rec(500)
      return json(route, 500, { message: 'Injected failure', code: 'XX000' })
    }
    const body = (() => {
      try { return req.postData() ? JSON.parse(req.postData()) : null } catch { return null }
    })()

    // ---------- auth ----------
    if (path === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const u = s.users.get(body?.email)
        if (!u || u.password !== body.password) {
          rec(400)
          return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        }
        rec(200)
        return json(route, 200, sessionFor(u))
      }
      if (grant === 'refresh_token') {
        const u = [...s.users.values()].find((x) => 'r-' + x.id === body?.refresh_token)
        if (!u) return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
        return json(route, 200, sessionFor(u))
      }
    }
    if (path === '/auth/v1/signup') {
      if (s.users.has(body.email)) {
        // Supabase returns an obfuscated user (no session) when the email exists and confirmation is on;
        // with confirmation off it returns 422 user_already_exists.
        rec(422)
        return json(route, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' })
      }
      if ((body.password || '').length < 8) {
        rec(422)
        return json(route, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 8 characters.' })
      }
      const u = mock.addUser(body.email, body.password, body.data?.full_name ?? '')
      rec(200)
      return json(route, 200, sessionFor(u))
    }
    if (path === '/auth/v1/user') {
      const u = userFrom(req.headers())
      if (!u) return json(route, 401, { code: 401, msg: 'invalid JWT' })
      return json(route, 200, sessionFor(u).user)
    }
    if (path === '/auth/v1/logout') {
      rec(204)
      return route.fulfill({ status: 204, headers: CORS })
    }

    // ---------- rest ----------
    const me = userFrom(req.headers())
    if (!path.startsWith('/rest/v1/')) {
      rec(404)
      return json(route, 404, { message: 'not mocked' })
    }
    if (!me) {
      rec(401)
      return json(route, 401, { code: 'PGRST301', message: 'JWT required' })
    }
    const table = path.replace('/rest/v1/', '')
    const my = nurseryOf(me.id)
    const filt = parseFilters(url)

    if (table.startsWith('rpc/')) {
      const fn = table.slice(4)
      if (mock.rpcDelay[fn]) await new Promise((r) => setTimeout(r, mock.rpcDelay[fn]))
      const code8 = () => 'BABY-' + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X')
      if (fn === 'create_nursery') {
        if (my) { rec(400); return json(route, 400, { code: 'P0001', message: 'You are already in a nursery' }) }
        const id = mock.addNursery(me.id, code8(), body.p_surname ?? '')
        rec(200)
        return json(route, 200, s.nurseries.find((n) => n.id === id))
      }
      if (fn === 'join_nursery') {
        // Like the real function: wrong code, full nursery and lockout all answer 200 {ok:false,message}.
        const fails = mock.joinFailures.get(me.id) ?? 0
        const bad = (message) => { mock.joinFailures.set(me.id, fails + 1); rec(200); return json(route, 200, { ok: false, message }) }
        if (fails >= 10) { rec(200); return json(route, 200, { ok: false, message: 'Too many attempts. Try again in a few minutes.' }) }
        const n = s.nurseries.find((x) => x.invite_code === String(body.p_code).trim().toUpperCase())
        if (!n || s.members.filter((m) => m.nursery_id === n.id).length >= 2) return bad('That invite code did not work. Check it, or ask your partner for a new one.')
        s.members.push({ nursery_id: n.id, user_id: me.id })
        rec(200)
        return json(route, 200, { ok: true, nursery_id: n.id })
      }
      if (fn === 'rotate_invite_code') {
        if (!my) { rec(400); return json(route, 400, { code: 'P0001', message: 'You are not in a nursery' }) }
        mock.rotateCalls++
        my.invite_code = code8()
        rec(200)
        return json(route, 200, my.invite_code)
      }
      if (fn === 'leave_nursery') {
        mock.leaveCalls++
        if (my) {
          s.members = s.members.filter((m) => !(m.nursery_id === my.id && m.user_id === me.id))
          s.matches = s.matches.filter((m) => m.nursery_id !== my.id)
          s.rankings = s.rankings.filter((r) => r.nursery_id !== my.id)
          s.duels = s.duels.filter((d) => d.nursery_id !== my.id)
          if (!s.members.some((m) => m.nursery_id === my.id)) s.nurseries = s.nurseries.filter((n) => n.id !== my.id)
        }
        rec(204)
        return route.fulfill({ status: 204, headers: CORS })
      }
      if (fn === 'suggest_names') {
        if (mock.missingRpc) { rec(404); return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.suggest_names(p_n) in the schema cache' }) }
        const swiped = new Set(s.swipes.filter((x) => x.user_id === me.id).map((x) => x.name_id))
        const out = names
          .filter((n) => !swiped.has(n.id))
          .filter((n) => !my || (my.genders.includes(n.gender) && (my.origins.length === 0 || n.origins.some((o) => my.origins.includes(o)))))
          .slice(0, body.p_n ?? 10)
        rec(200)
        return json(route, 200, out)
      }
      if (fn === 'save_ranking') {
        s.rankings = s.rankings.filter((r) => !(r.user_id === me.id))
        body.p_name_ids.forEach((id, i) => s.rankings.push({ nursery_id: my.id, user_id: me.id, name_id: id, position: i }))
        rec(204)
        return route.fulfill({ status: 204, headers: CORS })
      }
      if (fn === 'shortlist_scores') {
        if (!my) return json(route, 200, [])
        const ms = s.matches.filter((m) => m.nursery_id === my.id)
        const rows = ms.map((m) => {
          const nm = names.find((n) => n.id === m.name_id)
          const mine = s.rankings.find((r) => r.user_id === me.id && r.name_id === m.name_id)
          const wins = s.duels.filter((d) => d.user_id === me.id && d.winner_name_id === m.name_id).length
          const losses = s.duels.filter((d) => d.user_id === me.id && d.loser_name_id === m.name_id).length
          const score = 1000 + 16 * (wins - losses) - (mine ? mine.position : 5) // internal only: the real function returns no score
          return { name_id: nm.id, name: nm.name, gender: nm.gender, meaning: nm.meaning, my_position: mine ? mine.position : null, my_elo: 1000 + 16 * (wins - losses), _score: score }
        })
        rows.sort((a, b) => b._score - a._score)
        rows.forEach((r, i) => ((r.combined_rank = i + 1), delete r._score))
        rec(200)
        return json(route, 200, rows)
      }
      rec(404)
      return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' })
    }

    const own = (r) => {
      if (table === 'nurseries') return my && r.id === my.id
      if (table === 'nursery_members') return my && r.nursery_id === my.id
      if (table === 'profiles') return r.id === me.id || s.members.some((m) => m.user_id === r.id && my && m.nursery_id === my.id)
      if (table === 'matches') return my && r.nursery_id === my.id
      if (['swipes', 'rankings', 'duels'].includes(table)) return r.user_id === me.id
      return true
    }
    const rowsOf = () => {
      if (table === 'profiles') return [...s.users.values()].map((u) => ({ id: u.id, display_name: u.display }))
      if (table === 'names') return names
      if (table === 'nursery_members') return s.members
      return s[table] || []
    }
    if (method === 'GET') {
      if (mock.tableDelay[table]) await new Promise((r) => setTimeout(r, mock.tableDelay[table]))
      let rows = rowsOf().filter(own).filter(filt)
      const ord = url.searchParams.get('order')
      if (ord) {
        const [col, dir] = ord.split('.')
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1))
      }
      rec(200)
      return json(route, 200, rows)
    }
    if (method === 'POST') {
      if (table === 'swipes') {
        const rows = Array.isArray(body) ? body : [body]
        for (const r of rows) {
          const ex = s.swipes.find((x) => x.user_id === me.id && x.name_id === r.name_id)
          if (ex) ex.liked = r.liked
          else s.swipes.push({ user_id: me.id, name_id: r.name_id, liked: r.liked })
          if (r.liked && my) {
            const other = s.members.find((m) => m.nursery_id === my.id && m.user_id !== me.id)
            if (other && s.swipes.some((x) => x.user_id === other.user_id && x.name_id === r.name_id && x.liked)) mock.addMatch(my.id, r.name_id)
          }
        }
        rec(201)
        return route.fulfill({ status: 201, headers: CORS })
      }
      if (table === 'duels') {
        s.duels.push({ ...body, user_id: me.id, id: s.seq++ })
        rec(201)
        return route.fulfill({ status: 201, headers: CORS })
      }
    }
    if (method === 'PATCH') {
      const rows = rowsOf().filter(own).filter(filt)
      if (table === 'profiles') rows.forEach((r) => { const u = [...s.users.values()].find((x) => x.id === r.id); if (u && body.display_name !== undefined) u.display = body.display_name })
      else rows.forEach((r) => Object.assign(r, body))
      rec(204)
      return route.fulfill({ status: 204, headers: CORS })
    }
    rec(405)
    return json(route, 405, { message: 'not mocked' })
  }

  return mock
}
