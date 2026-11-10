// Live-project browser test of the parts that do NOT need the 20261110 migration:
// sign-up, wrong password, duplicate sign-up, hostile names (<img onerror>, quotes, 200
// chars), nursery create/join from a second browser context, surname / filter / display
// name edits persisting across reload, sign-out and sign-in as someone else without stale
// data, the "database needs the latest update" states, and real Supabase Realtime delivery
// of a match to an open page (matches are created through the REST API with the two
// users' own tokens, using the ZZTest rows that exist in `names`).
//
//   NODE_PATH=$(npm root -g) node scripts/e2e/live-auth-nursery.mjs     (BASE_URL default http://localhost:4190)
// Creates accounts swiper.test.<tag>.<random>@example.com and prints them. Exit 0 = all passed.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE_URL || 'http://localhost:4190'
const env = Object.fromEntries(
  readFileSync(join(here, '../../app/.env.local'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]),
)
const SB = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const KEY = env.VITE_SUPABASE_ANON_KEY
const run = Math.random().toString(36).slice(2, 8)
const PW = `Swiper-test-${Math.random().toString(36).slice(2, 10)}`
const emails = []
let failures = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pass = (n, d = '') => console.log(`PASS ${n}${d ? ' :: ' + d : ''}`)
const fail = (n, d = '') => { failures++; console.log(`FAIL ${n}${d ? ' :: ' + d : ''}`) }
async function step(name, fn) {
  try { const d = await fn(); pass(name, typeof d === 'string' ? d : '') } catch (e) { fail(name, String(e.message).split('\n')[0]) }
}
const expect = (c, m) => { if (!c) throw new Error(m) }

function proxyOpt() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy
  if (!p) return undefined
  const u = new URL(p)
  return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), bypass: 'localhost,127.0.0.1' }
}
const browser = await chromium.launch({ proxy: proxyOpt() })
async function person(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  const sockets = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('websocket', (ws) => { const s = { url: ws.url().replace(/apikey=[^&]+/, 'apikey=…'), frames: 0, closed: false }; sockets.push(s); ws.on('framereceived', () => s.frames++); ws.on('close', () => (s.closed = true)) })
  return { label, ctx, page, errors, sockets, email: `swiper.test.${label}.${run}@example.com` }
}
const tab = (p, l) => p.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: l })
const noHScroll = (p) => p.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
const api = (p, path, { token, method = 'GET', body } = {}) =>
  p.page.evaluate(async ({ url, key, token, method, body }) => {
    const r = await fetch(url, { method, headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null } catch { j = t }
    return { status: r.status, json: j }
  }, { url: SB + path, key: KEY, token, method, body })
const session = (p) => p.page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return k ? JSON.parse(localStorage.getItem(k)) : null })

const HOSTILE = `<img src=x onerror="window.__xss=1">"'` + 'W'.repeat(180)
const SURNAME = `<b>X</b>"q"'` + 'S'.repeat(150)

async function signUpUI(p, displayName) {
  await p.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await p.page.getByRole('button', { name: /Create an account/ }).click()
  await p.page.getByPlaceholder('Your name').fill(displayName)
  await p.page.getByPlaceholder('Email').fill(p.email)
  await p.page.getByPlaceholder('Password').fill(PW)
  await p.page.getByRole('button', { name: 'Create account' }).click()
  await p.page.getByRole('heading', { name: 'Set up your nursery' }).waitFor({ timeout: 20000 })
  emails.push(p.email)
}

const A = await person('uia')
const B = await person('uib')
let code = ''

await step('A signs up with a hostile 200-char display name', () => signUpUI(A, HOSTILE))
await step('nursery screen: no horizontal scroll, nothing executed', async () => {
  expect(await noHScroll(A), 'horizontal scroll')
  expect((await A.page.evaluate(() => window.__xss)) === undefined, 'XSS executed')
})
await step('A creates a nursery with a hostile 160-char surname', async () => {
  await A.page.getByPlaceholder('Surname (for previews)').fill(SURNAME)
  await A.page.getByRole('button', { name: 'Create nursery' }).click()
  await tab(A, 'Swipe').waitFor({ timeout: 20000 })
})
await step('Swipe tab on the live project (database not updated) shows the friendly message, not a crash', async () => {
  await A.page.getByRole('button', { name: /Retry|Open Settings/ }).first().waitFor({ timeout: 15000 })
  const txt = await A.page.locator('body').innerText()
  expect(/database needs the latest update|Could not load names|You have seen every name/.test(txt), 'unexpected swipe state: ' + txt.replace(/\s+/g, ' ').slice(0, 120))
  return txt.replace(/\s+/g, ' ').slice(0, 70)
})
await step('Settings: hostile surname/name shown as text, no horizontal scroll', async () => {
  await sleep(3000) // let the member/profile fetch finish: opening Settings earlier can leave the name field empty (known race, see report)
  await tab(A, 'Settings').click()
  code = (await A.page.getByTestId('invite-code').innerText()).trim()
  expect(/^BABY-[A-Z0-9]{4}$/.test(code), 'code ' + code)
  expect((await A.page.locator('#surname').inputValue()) === SURNAME, 'surname not stored verbatim')
  expect((await A.page.locator('#display-name').inputValue()) === HOSTILE, 'display name not stored verbatim')
  expect(await noHScroll(A), 'horizontal scroll in Settings')
  expect((await A.page.evaluate(() => window.__xss)) === undefined, 'XSS executed')
  expect((await A.page.locator('img[src="x"]').count()) === 0, 'injected <img> element exists')
})
await step('Matches tab (live) shows the empty state', async () => {
  await tab(A, 'Matches').click()
  await A.page.getByText('No matches yet').first().waitFor({ timeout: 10000 })
})
await step('Shortlist tab (live, migration missing) shows a friendly error with Retry, not a crash', async () => {
  await tab(A, 'Shortlist').click()
  await A.page.getByRole('alert').waitFor({ timeout: 10000 })
  const t = await A.page.getByRole('alert').innerText()
  expect(/latest update|could not find/i.test(t), t)
  expect((await A.page.getByRole('button', { name: 'Retry' }).count()) > 0, 'no Retry button')
  return t.replace(/\s+/g, ' ').slice(0, 60)
})

await step('B (second browser context) signs up and joins with the code in lower case with spaces', async () => {
  await signUpUI(B, 'Beta Tester')
  await B.page.getByPlaceholder('BABY-7K2Q').fill(`  ${code.toLowerCase()} `)
  await B.page.getByRole('button', { name: 'Join nursery' }).click()
  await tab(B, 'Swipe').waitFor({ timeout: 20000 })
})
await step('B sees the hostile partner name as text and the page does not scroll sideways', async () => {
  await tab(B, 'Settings').click()
  await B.page.getByText(/^Linked with /).waitFor()
  expect(await noHScroll(B), 'horizontal scroll')
  expect((await B.page.evaluate(() => window.__xss)) === undefined, 'XSS executed')
  const box = await B.page.getByText(/^Linked with /).boundingBox()
  expect(box.x + box.width <= 391, `"Linked with ..." line overflows the viewport (right edge ${Math.round(box.x + box.width)}px of 390)`)
})
await step('A reload: surname edit persists, B sees it after reload', async () => {
  await tab(A, 'Settings').click()
  await A.page.locator('#surname').fill("O'Neil-Ñandú")
  await A.page.getByRole('button', { name: 'Save' }).first().click()
  await A.page.getByText('Saved', { exact: true }).first().waitFor()
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await tab(A, 'Settings').waitFor()
  expect((await A.page.locator('#surname').inputValue()) === "O'Neil-Ñandú", 'A lost the surname')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await tab(B, 'Settings').waitFor()
  expect((await B.page.locator('#surname').inputValue()) === "O'Neil-Ñandú", 'B does not see the new surname')
})
await step('A filters (girl only, Irish) persist after reload and are visible to B', async () => {
  await tab(A, 'Settings').click()
  await A.page.getByRole('button', { name: 'boy', exact: true }).click()
  await A.page.getByRole('button', { name: 'neutral', exact: true }).click()
  await A.page.getByRole('button', { name: 'Irish', exact: true }).click()
  await A.page.getByRole('button', { name: 'Save filters' }).click()
  await A.page.getByText(/new filters apply/i).waitFor()
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await tab(A, 'Settings').waitFor()
  const st = async (p, n) => (await p.page.getByRole('button', { name: n, exact: true }).getAttribute('aria-pressed'))
  expect((await st(A, 'girl')) === 'true' && (await st(A, 'boy')) === 'false' && (await st(A, 'Irish')) === 'true', 'A filters not persisted')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await tab(B, 'Settings').waitFor()
  expect((await st(B, 'girl')) === 'true' && (await st(B, 'boy')) === 'false' && (await st(B, 'Irish')) === 'true', 'B does not see A\'s filters')
})
await step('display name edit persists and shows in B\'s "Linked with"', async () => {
  await A.page.locator('#display-name').fill('Alpha Renamed')
  await A.page.getByRole('button', { name: 'Save' }).nth(1).click()
  await A.page.getByText('Saved', { exact: true }).first().waitFor()
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await tab(B, 'Settings').waitFor()
  await B.page.getByText('Linked with Alpha Renamed').waitFor({ timeout: 8000 })
})

// ---- real Realtime delivery ----
await step('REAL Realtime: a match created server-side reaches an open page quickly (before the 20s poll)', async () => {
  const sa = await session(A), sb = await session(B)
  const names = await api(A, '/rest/v1/names?select=id,name&order=id&limit=2', { token: sa.access_token })
  expect(Array.isArray(names.json) && names.json.length >= 1, 'no rows in names to swipe on')
  await tab(A, 'Swipe').click()
  await tab(B, 'Swipe').click()
  await sleep(4000) // let the websockets join
  const ws = A.sockets.filter((s) => /realtime/.test(s.url))
  const t0 = Date.now()
  for (const who of [sa, sb]) {
    const r = await api(A, '/rest/v1/swipes?on_conflict=user_id,name_id', { token: who.access_token, method: 'POST', body: { name_id: names.json[0].id, liked: true } })
    expect(r.status < 300, `swipe insert failed: ${r.status} ${JSON.stringify(r.json)}`)
  }
  await A.page.getByRole('dialog').waitFor({ timeout: 40000 })
  const dt = Date.now() - t0
  expect(true, '')
  const recv = A.sockets.filter((s) => /realtime/.test(s.url)).map((s) => `${s.frames} frames${s.closed ? ' (closed)' : ''}`).join('; ')
  if (dt > 12000) throw new Error(`overlay arrived after ${dt}ms: only the 20s polling fallback worked; websocket: ${recv || 'none opened'}`)
  return `overlay after ${dt}ms; websocket frames: ${recv}`
})

await step('sign out, wrong password, then sign in as the other person: no stale data', async () => {
  await A.page.getByRole('button', { name: 'Keep swiping' }).click().catch(() => {})
  await tab(A, 'Settings').click()
  await A.page.getByRole('button', { name: 'Sign out' }).click()
  await A.page.getByRole('heading', { name: 'Swiper' }).waitFor()
  await A.page.getByPlaceholder('Email').fill(A.email)
  await A.page.getByPlaceholder('Password').fill('definitely-wrong-1')
  await A.page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const al = A.page.getByRole('alert')
  await al.waitFor()
  expect(/invalid login credentials/i.test(await al.innerText()), await al.innerText())
  await A.page.getByPlaceholder('Email').fill(B.email)
  await A.page.getByPlaceholder('Password').fill(PW)
  await A.page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await tab(A, 'Settings').click()
  await A.page.getByText('Signed in as').waitFor()
  const t = await A.page.locator('body').innerText()
  expect(t.includes(B.email) && !t.includes(A.email), 'wrong account shown')
  expect(!t.includes('Alpha Renamed') || /Linked with Alpha Renamed/.test(t), 'unexpected stale text')
  expect(!t.includes('Beta Tester') || !/Linked with Beta Tester/.test(t), 'shows self as partner')
})
await step('duplicate sign-up with an existing email is rejected with a readable message', async () => {
  await A.page.getByRole('button', { name: 'Sign out' }).click()
  await A.page.getByRole('button', { name: /Create an account/ }).click()
  await A.page.getByPlaceholder('Your name').fill('Dup')
  await A.page.getByPlaceholder('Email').fill(B.email)
  await A.page.getByPlaceholder('Password').fill(PW)
  await A.page.getByRole('button', { name: 'Create account' }).click()
  await A.page.getByRole('alert').waitFor({ timeout: 15000 })
  const t = await A.page.getByRole('alert').innerText()
  return t
})

// ---- API-level auth abuse ----
await step('API: 7-char password policy (UI enforces 8)', async () => {
  const e = `swiper.test.pw7.${run}@example.com`
  const r = await api(A, '/auth/v1/signup', { method: 'POST', body: { email: e, password: 'abc1234' } })
  if (r.status === 200) emails.push(e)
  return `server answered HTTP ${r.status}${r.status === 200 ? ' (7-char password ACCEPTED by the server; only the UI enforces 8)' : ''}`
})
await step('API: 20,000-char display name in signup metadata', async () => {
  const e = `swiper.test.long.${run}@example.com`
  const r = await api(A, '/auth/v1/signup', { method: 'POST', body: { email: e, password: PW, data: { full_name: 'N'.repeat(20000) } } })
  if (r.status === 200) emails.push(e)
  const tok = r.json?.access_token
  let len = null
  if (tok) {
    const p = await api(A, '/rest/v1/profiles?select=display_name', { token: tok })
    len = p.json?.[0]?.display_name?.length
  }
  return `HTTP ${r.status}; stored display_name length = ${len}`
})
await step('API: nursery surname length is not limited (100,000 chars via RPC)', async () => {
  const e = `swiper.test.bigs.${run}@example.com`
  const r = await api(A, '/auth/v1/signup', { method: 'POST', body: { email: e, password: PW } })
  if (r.status === 200) emails.push(e)
  const c = await api(A, '/rest/v1/rpc/create_nursery', { token: r.json.access_token, method: 'POST', body: { p_surname: 'S'.repeat(100000) } })
  return `HTTP ${c.status}; stored surname length = ${c.json?.surname?.length}`
})

const errs = [...A.errors, ...B.errors].filter((e) => !/Failed to load resource: the server responded with a status of (400|422|404)/.test(e))
await step('console errors on live pages', async () => {
  expect(errs.length === 0, errs.slice(0, 3).join(' | '))
})
console.log(`\nEmails created (${emails.length}): ${emails.join(', ')}`)
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
process.exit(failures ? 1 : 0)
