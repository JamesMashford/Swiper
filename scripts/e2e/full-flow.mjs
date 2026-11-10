// Full-stack end-to-end test for Swiper: two real people (two browser contexts) against
// the LIVE Supabase project, driven only through the real UI. Rerunnable: every run
// creates fresh accounts `swiper.test.<tag>.<random>@example.com` (Supabase has no
// delete-from-client, so the accounts stay behind; they are listed at the end).
//
// What it checks (one PASS/FAIL line each):
//   preflight   suggest_names exists on the project (else exit 2 with an explanation)
//   A, B        sign up through the UI, A creates a nursery, B joins with the code
//   deck        the first 10 cards each person sees are starter names
//   match       A likes a few names, B likes the same ones: A and B both get the match
//               overlay, and the Matches list on both sides shows the names
//   shortlist   both rank (reorder + saved), both do head-to-head duels, the Couple's
//               ranking lists exactly the matched names
//   privacy     B (via the REST API with B's own token) cannot read A's swipes, rankings
//               or duels, and shortlist_scores() exposes no partner columns
//
// Usage (serve the real build first: `cd app && npx vite build --outDir /tmp/dist &&
// npx vite preview --outDir /tmp/dist --port 4190`):
//   NODE_PATH=$(npm root -g) node scripts/e2e/full-flow.mjs
//   env: BASE_URL (default http://localhost:4190), SUPABASE_URL / SUPABASE_ANON_KEY
//        (default: read from app/.env.local), HEADED=1 to watch, MOCK=1 to run against the
//        in-memory fake (scripts/e2e/mock-supabase.mjs) instead of the live project: a dry
//        run of this script itself, it proves nothing about the database.
// Exit code: 0 all passed, 1 a step failed, 2 database update not applied (nothing tested).
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createMock } from './mock-supabase.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = dirname(fileURLToPath(import.meta.url))

const BASE = process.env.BASE_URL || 'http://localhost:4190'
const MOCK = process.env.MOCK === '1'

function envFromFile() {
  try {
    const txt = readFileSync(join(here, '../../app/.env.local'), 'utf8')
    return Object.fromEntries(txt.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]))
  } catch {
    return {}
  }
}
const fileEnv = envFromFile()
const SB_URL = (process.env.SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const SB_KEY = process.env.SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''
if (!SB_URL || !SB_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (and app/.env.local not readable).')
  process.exit(1)
}

function proxyOpt() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy
  if (!p) return undefined
  const u = new URL(p)
  return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), bypass: 'localhost,127.0.0.1' }
}

const run = Math.random().toString(36).slice(2, 8)
const PW = `Swiper-test-${Math.random().toString(36).slice(2, 10)}`
const SURNAME = 'Zzflow'
const emails = []
let failures = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pass(name, detail = '') { console.log(`PASS ${name}${detail ? ' :: ' + detail : ''}`) }
function fail(name, detail = '') { failures++; console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
async function step(name, fn) {
  try {
    const detail = await fn()
    pass(name, typeof detail === 'string' ? detail : '')
    return true
  } catch (e) {
    fail(name, String(e.message).split('\n')[0])
    return false
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg) }

const browser = await chromium.launch({ proxy: proxyOpt(), headless: process.env.HEADED !== '1' })
const mock = MOCK ? createMock({ origin: SB_URL }) : null

async function newPerson(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
  if (mock) {
    await mock.install(ctx)
    await ctx.routeWebSocket(/realtime/, (ws) => ws.close())
  }
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|net::ERR|Failed to load resource/i.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  return { label, ctx, page, errors, email: `swiper.test.${label.toLowerCase()}.${run}@example.com` }
}

// ---- helpers working through the page (so they use the browser's proxy/mocks) ----
const apiFetch = (page, path, { token, method = 'GET', body } = {}) =>
  page.evaluate(
    async ({ url, key, token, method, body }) => {
      const r = await fetch(url, { method, headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      const t = await r.text()
      let j = null
      try { j = t ? JSON.parse(t) : null } catch { j = t }
      return { status: r.status, json: j }
    },
    { url: SB_URL + path, key: SB_KEY, token, method, body },
  )
const sessionOf = (page) =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /auth-token/.test(x))
    return k ? JSON.parse(localStorage.getItem(k)) : null
  })
const tab = (page, label) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: label })
const topLabel = (page) => page.getByTestId('top-card').getAttribute('aria-label', { timeout: 10000 })
const nameOf = (label) => label.replace(new RegExp(` ${SURNAME}$`), '')

async function signUp(p) {
  await p.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await p.page.getByRole('button', { name: /Create an account/ }).click()
  await p.page.getByPlaceholder('Your name').fill(`Test ${p.label}`)
  await p.page.getByPlaceholder('Email').fill(p.email)
  await p.page.getByPlaceholder('Password').fill(PW)
  await p.page.getByRole('button', { name: 'Create account' }).click()
  await p.page.getByRole('heading', { name: 'Set up your nursery' }).waitFor({ timeout: 15000 })
  emails.push(p.email)
}

async function dismissDialog(page) {
  // Several matches can queue several overlays; close them all. Returns the first text seen.
  let first = null
  for (let i = 0; i < 12; i++) {
    const dlg = page.getByRole('dialog')
    if (!(await dlg.count())) break
    const text = await dlg.innerText().catch(() => '')
    first ??= text
    await page.getByRole('button', { name: 'Keep swiping' }).click({ timeout: 3000 }).catch(() => {})
    await sleep(350)
  }
  return first
}

/** Swipe one card; returns the card's name. Dismisses a match overlay first if one is open. */
async function swipeOne(p, decide) {
  const dialogText = await dismissDialog(p.page)
  if (dialogText) p.dialogs.push(dialogText)
  const label = await topLabel(p.page)
  const name = nameOf(label)
  const liked = decide(name)
  await p.page.getByRole('button', { name: liked ? 'Like' : 'Dislike', exact: true }).click()
  await p.page.waitForFunction((prev) => {
    const el = document.querySelector('[data-testid=top-card]')
    return !el || el.getAttribute('aria-label') !== prev || !!document.querySelector('[role=dialog]')
  }, label, { timeout: 10000 })
  await sleep(120)
  return { name, liked }
}

// ============================================================================
const A = await newPerson('A')
const B = await newPerson('B')
A.dialogs = []
B.dialogs = []

// ---- preflight ----
{
  const probe = await newPerson('Probe')
  await probe.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const su = await apiFetch(probe.page, '/auth/v1/signup', { method: 'POST', body: { email: probe.email, password: PW, data: { full_name: 'Probe' } } })
  emails.push(probe.email)
  const token = su.json?.access_token
  if (!token) {
    console.log(`FAIL preflight: could not create the probe account (HTTP ${su.status}: ${JSON.stringify(su.json).slice(0, 160)})`)
    console.log('Emails created:', emails.join(', '))
    process.exit(1)
  }
  const rpc = await apiFetch(probe.page, '/rest/v1/rpc/suggest_names', { token, method: 'POST', body: { p_n: 1 } })
  await probe.ctx.close()
  if (rpc.status === 404 || rpc.json?.code === 'PGRST202') {
    console.log('BLOCKED preflight: public.suggest_names does not exist on this project (PGRST202).')
    console.log('The migration 20261110000000_v1_features.sql and supabase/seed/names_starter.sql have not been applied,')
    console.log('so the swipe deck, rankings and shortlist cannot be tested end to end. Nothing was run.')
    console.log('Emails created:', emails.join(', '))
    await browser.close()
    process.exit(2)
  }
  pass('preflight: suggest_names exists', `HTTP ${rpc.status}`)
  if (rpc.status === 200 && Array.isArray(rpc.json) && rpc.json.length === 0) {
    // The probe has no nursery, so an empty set is expected; check the seed through names instead.
    const nm = await (async () => {
      const p2 = await newPerson('Probe2')
      await p2.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      const r = await apiFetch(p2.page, '/rest/v1/names?select=id&is_starter=eq.true&limit=40', { token })
      await p2.ctx.close()
      return r
    })()
    if (!Array.isArray(nm.json) || nm.json.length < 10) {
      console.log(`BLOCKED preflight: only ${Array.isArray(nm.json) ? nm.json.length : '?'} starter names in the database (seed not applied).`)
      console.log('Emails created:', emails.join(', '))
      await browser.close()
      process.exit(2)
    }
    pass('preflight: starter names are seeded', `${nm.json.length} starters`)
  }
}

// ---- accounts + nursery ----
let code = ''
await step('A signs up through the UI and lands on nursery setup', () => signUp(A))
await step('A creates a nursery and reaches the Swipe tab', async () => {
  await A.page.getByPlaceholder('Surname (for previews)').fill(SURNAME)
  await A.page.getByRole('button', { name: 'Create nursery' }).click()
  await tab(A.page, 'Swipe').waitFor({ timeout: 15000 })
  await tab(A.page, 'Settings').click()
  code = (await A.page.getByTestId('invite-code').innerText()).trim()
  expect(/^BABY-[A-Z0-9]{4}$/.test(code), `unexpected invite code "${code}"`)
  await tab(A.page, 'Swipe').click()
  return code
})
await step('B signs up and joins with the code', async () => {
  await signUp(B)
  await B.page.getByPlaceholder('BABY-7K2Q').fill(code.toLowerCase())
  await B.page.getByRole('button', { name: 'Join nursery' }).click()
  await tab(B.page, 'Swipe').waitFor({ timeout: 15000 })
})
await step('B sees "Linked with Test A" in Settings', async () => {
  await tab(B.page, 'Settings').click()
  await B.page.getByText('Linked with Test A').waitFor({ timeout: 8000 })
  await tab(B.page, 'Swipe').click()
})

// ---- deck: starters ----
const sessA = await sessionOf(A.page)
const sessB = await sessionOf(B.page)
let starters = new Set()
await step('starter names can be listed (names.is_starter)', async () => {
  const r = await apiFetch(A.page, '/rest/v1/names?select=name&is_starter=eq.true', { token: sessA.access_token })
  expect(r.status === 200 && Array.isArray(r.json) && r.json.length >= 10, `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`)
  starters = new Set(r.json.map((x) => x.name))
  return `${starters.size} starters`
})

const aLiked = new Set()
const aSeen = []
await step('A: the first 10 cards are all starter names', async () => {
  await A.page.getByTestId('top-card').waitFor({ timeout: 15000 })
  for (let i = 0; i < 10; i++) {
    const { name, liked } = await swipeOne(A, () => aSeen.length < 4) // like the first 4, dislike the rest
    aSeen.push(name)
    if (liked) aLiked.add(name)
  }
  const bad = aSeen.filter((n) => !starters.has(n))
  expect(bad.length === 0, `non-starter cards served in first batch: ${bad.join(', ')}`)
  expect(new Set(aSeen).size === aSeen.length, 'duplicate card in first batch')
  return `liked: ${[...aLiked].join(', ')}`
})

// ---- B swipes through its deck, liking A's names -> matches ----
const bSeen = []
await step('B: first 10 cards are starters, and B likes the names A liked (mutual likes)', async () => {
  await B.page.getByTestId('top-card').waitFor({ timeout: 15000 })
  const bLiked = new Set()
  for (let i = 0; i < 60 && bLiked.size < aLiked.size; i++) {
    const { name, liked } = await swipeOne(B, (n) => aLiked.has(n))
    bSeen.push(name)
    if (liked) bLiked.add(name)
    if (await B.page.getByText('You have seen every name').count()) break
  }
  const bad = bSeen.slice(0, 10).filter((n) => !starters.has(n))
  expect(bad.length === 0, `non-starter cards in B's first 10: ${bad.join(', ')}`)
  expect(bLiked.size === aLiked.size, `B only found ${bLiked.size} of A's ${aLiked.size} liked names within ${bSeen.length} swipes`)
  return `${bSeen.length} swipes, ${bLiked.size} mutual`
})

// ---- alerts (realtime or the 20s poll fallback) ----
await step('A gets the "It\'s a match" overlay (Realtime or polling), naming a matched name', async () => {
  const dlg = A.page.getByRole('dialog')
  const deadline = Date.now() + 45000
  while (Date.now() < deadline && !(await dlg.count()) && !A.dialogs.length) await sleep(500)
  const text = (await dlg.count()) ? await dlg.innerText() : A.dialogs[0]
  expect(text && /match/i.test(text), 'no match overlay appeared for A within 45s')
  expect([...aLiked].some((n) => text.includes(n)), `overlay text "${text.replace(/\s+/g, ' ')}" names none of ${[...aLiked].join(', ')}`)
  return text.replace(/\s+/g, ' ').slice(0, 60)
})
await step('B also got a match overlay or badge', async () => {
  const got = B.dialogs.length > 0 || (await B.page.getByRole('dialog').count()) > 0 || (await tab(B.page, 'Matches').locator('span').count()) > 0
  const deadline = Date.now() + 30000
  let ok = got
  while (!ok && Date.now() < deadline) {
    await sleep(500)
    ok = (await B.page.getByRole('dialog').count()) > 0 || (await tab(B.page, 'Matches').locator('span').count()) > 0
  }
  expect(ok, 'no overlay/badge for B')
})
await step('A: dialog "See matches" opens the Matches tab', async () => {
  const dlg = A.page.getByRole('dialog')
  if (await dlg.count()) await A.page.getByRole('button', { name: 'See matches' }).click()
  await dismissDialog(A.page)
  await tab(A.page, 'Matches').click()
  await A.page.getByRole('heading', { name: 'Matches' }).waitFor()
})

async function matchNames(p) {
  await dismissDialog(p.page)
  await tab(p.page, 'Matches').click()
  await p.page.getByRole('heading', { name: 'Matches' }).waitFor()
  await p.page.getByRole('button', { name: 'Refresh' }).click()
  await sleep(1500)
  await dismissDialog(p.page)
  const hs = await p.page.locator('ul > li h2').allInnerTexts()
  return hs.map((t) => nameOf(t.trim()))
}
await step('Matches list (A) shows exactly the mutual names', async () => {
  const got = (await matchNames(A)).sort()
  expect(JSON.stringify(got) === JSON.stringify([...aLiked].sort()), `A sees [${got.join(', ')}], expected [${[...aLiked].sort().join(', ')}]`)
  return got.join(', ')
})
await step('Matches list (B) shows the same names', async () => {
  const got = (await matchNames(B)).sort()
  expect(JSON.stringify(got) === JSON.stringify([...aLiked].sort()), `B sees [${got.join(', ')}]`)
})

// ---- shortlist ----
async function openShortlist(p, sub) {
  await dismissDialog(p.page)
  await tab(p.page, 'Shortlist').click()
  await p.page.getByRole('tab', { name: sub, exact: true }).click()
}
for (const [P, dir] of [[A, 'up'], [B, 'down']]) {
  await step(`${P.label}: Rank tab lists the matches, reordering saves`, async () => {
    await openShortlist(P, 'Rank')
    const handle = P.page.getByRole('button', { name: /Move .* down/ })
    await handle.first().waitFor({ timeout: 10000 })
    const n = await P.page.locator('[aria-label^="Drag "]').count()
    expect(n === aLiked.size, `Rank shows ${n} items, expected ${aLiked.size}`)
    const btn = dir === 'up' ? P.page.getByRole('button', { name: /Move .* up/ }).nth(1) : P.page.getByRole('button', { name: /Move .* down/ }).first()
    await btn.click()
    await P.page.getByText('Saved', { exact: true }).waitFor({ timeout: 8000 })
  })
}
for (const P of [A, B]) {
  await step(`${P.label}: head-to-head duels are recorded`, async () => {
    await openShortlist(P, 'Head to head')
    const group = P.page.getByRole('group', { name: 'Choose your favourite' })
    await group.waitFor({ timeout: 10000 })
    for (let i = 1; i <= 3; i++) {
      await group.getByRole('button').first().click()
      await P.page.waitForFunction((n) => new RegExp(`${n} duels? this session`).test(document.body.innerText), i, { timeout: 10000 })
    }
  })
}
for (const P of [A, B]) {
  await step(`${P.label}: Couple's ranking shows exactly the matched names`, async () => {
    await openShortlist(P, "Couple's ranking")
    await P.page.locator('ol > li').first().waitFor({ timeout: 10000 })
    const names = (await P.page.locator('ol > li p.font-semibold').allInnerTexts()).map((t) => nameOf(t.trim())).sort()
    expect(JSON.stringify(names) === JSON.stringify([...aLiked].sort()), `shows [${names.join(', ')}]`)
  })
}

// ---- privacy ----
await step('B cannot read A\'s swipes / rankings / duels through the API', async () => {
  for (const t of ['swipes', 'rankings', 'duels']) {
    const r = await apiFetch(B.page, `/rest/v1/${t}?select=*`, { token: sessB.access_token })
    expect(r.status === 200 && Array.isArray(r.json), `${t}: HTTP ${r.status}`)
    expect(r.json.every((x) => x.user_id === sessB.user.id), `${t}: rows belonging to someone else are visible`)
    const a = await apiFetch(B.page, `/rest/v1/${t}?select=*&user_id=eq.${sessA.user.id}`, { token: sessB.access_token })
    expect(Array.isArray(a.json) && a.json.length === 0, `${t}: filtering on A's id returned ${JSON.stringify(a.json).slice(0, 80)}`)
  }
  const mine = await apiFetch(B.page, '/rest/v1/swipes?select=name_id', { token: sessB.access_token })
  expect(mine.json.length === bSeen.length, `B has ${mine.json.length} swipe rows, expected ${bSeen.length}`)
})
await step('anonymous (no login) cannot read names, swipes or matches', async () => {
  for (const t of ['names', 'swipes', 'matches', 'profiles']) {
    const r = await apiFetch(B.page, `/rest/v1/${t}?select=*&limit=1`, {})
    expect(r.status === 401 || r.status === 403 || (Array.isArray(r.json) && r.json.length === 0), `${t}: anon got HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 60)}`)
  }
})
await step('shortlist_scores exposes only the caller\'s own numbers (no partner columns)', async () => {
  const r = await apiFetch(B.page, '/rest/v1/rpc/shortlist_scores', { token: sessB.access_token, method: 'POST', body: {} })
  expect(r.status === 200 && r.json.length === aLiked.size, `HTTP ${r.status}, ${r.json?.length} rows`)
  const keys = Object.keys(r.json[0]).sort().join(',')
  expect(keys === 'combined_rank,combined_score,gender,meaning,my_elo,my_position,name,name_id', `unexpected columns: ${keys}`)
})
await step('no console errors on either side', async () => {
  const e = [...A.errors, ...B.errors]
  expect(e.length === 0, e.slice(0, 2).join(' | '))
})

console.log(`\nEmails created (${emails.length}): ${emails.join(', ')}`)
console.log(failures ? `${failures} step(s) FAILED` : 'ALL STEPS PASSED')
await browser.close()
process.exit(failures ? 1 : 0)
