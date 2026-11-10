// UI shell tests for Swiper against a MOCKED Supabase (see mock-supabase.mjs).
// Runs the built app (default http://localhost:4190, e.g. `vite preview`) in headless
// Chromium at 390x844 and 360x640 and checks: auth, tab navigation + hash deep links +
// back button, keyboard, focus visibility, touch targets, horizontal scroll, XSS-as-text,
// touch swiping via CDP, reduced motion, offline/recover, sign-out/sign-in as another user.
//
//   NODE_PATH=$(npm root -g) node scripts/e2e/ui-shell.mjs
//   BASE_URL=http://localhost:4190 OUT=/tmp/ui-results.json node scripts/e2e/ui-shell.mjs
//
// Exit code 0 when every check passed, 1 otherwise. Prints one PASS/FAIL line per check.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { createMock } from './mock-supabase.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL || 'http://localhost:4190'
const ORIGIN = process.env.SUPABASE_ORIGIN || 'https://ugflrjkgsveufgjvavhz.supabase.co'
const OUT = process.env.OUT || ''

const results = []
function check(scope, name, ok, detail = '') {
  results.push({ scope, name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail ? ' :: ' + detail : ''}`)
}

function proxyOpt() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy
  if (!p) return undefined
  const u = new URL(p)
  return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), bypass: 'localhost,127.0.0.1' }
}

const browser = await chromium.launch({ proxy: proxyOpt() })

async function scenario(scope, { width, height, reducedMotion = 'no-preference', touch = true }, fn) {
  if (process.env.ONLY && !scope.includes(process.env.ONLY)) return
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    reducedMotion,
    serviceWorkers: 'block',
  })
  const mock = createMock({ origin: ORIGIN })
  await mock.install(ctx)
  await ctx.routeWebSocket(/realtime/, (ws) => ws.close())
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource|net::ERR/i.test(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  const c = (name, ok, detail) => check(scope, name, ok, detail)
  try {
    await fn({ ctx, page, mock, c, errors })
  } catch (e) {
    c('scenario completed without exception', false, String(e.message).split('\n')[0])
  }
  c('no console errors / page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ---------- helpers ----------
const goto = (page, hash = '') => page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
async function signIn(page, email, pw = 'password1') {
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(pw)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
async function seedCouple(mock, { surname = 'Smith', matches = [] } = {}) {
  const a = mock.addUser('a@x.test', 'password1', 'Alice')
  const b = mock.addUser('b@x.test', 'password1', 'Bob')
  const nid = mock.addNursery(a.id, 'BABY-TEST', surname)
  mock.addMember(nid, b.id)
  matches.forEach((m) => mock.addMatch(nid, m))
  return { a, b, nid }
}
const tab = (page, label) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: label })
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1)

async function smallTargets(page) {
  return page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=tab]')) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (r.height < 43.5 || r.width < 43.5) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 30)
        out.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    return out
  })
}

async function focusIndicatorGaps(page, max = 40) {
  // Tab through the page; report focused elements with no visible outline / ring / shadow.
  const gaps = []
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const hasShadow = cs.boxShadow !== 'none'
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 30)
      return { label, ok: hasOutline || hasShadow, tag: el.tagName }
    })
    if (info && !info.ok) gaps.push(`${info.tag}:${info.label}`)
  }
  return [...new Set(gaps)]
}

async function touchDrag(cdp, page, dx, { y, from } = {}) {
  const box = await page.getByTestId('top-card').boundingBox()
  const x0 = from ?? box.x + box.width / 2
  const y0 = y ?? box.y + box.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 }] })
    await page.waitForTimeout(12)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// Contrast ratio of an element's text colour against white (cards are white). Colours may be oklch(),
// so a 1x1 canvas converts them to sRGB first.
async function contrastOnWhite(locator) {
  return locator.evaluate((el) => {
    const px = (css) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1
      const g = cv.getContext('2d'); g.fillStyle = css; g.fillRect(0, 0, 1, 1)
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const a = lum(px(getComputedStyle(el).color)), b = lum([255, 255, 255])
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}
const headingLevels = (page) => page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getClientRects().length).map((h) => Number(h.tagName[1])))
const orderOk = (levels) => levels.length > 0 && levels[0] === 1 && levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1)
const unlabeledInputs = (page) => page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).map((i) => i.id || i.placeholder))

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]

for (const vp of VIEWPORTS) {
  const tag = `${vp.width}x${vp.height}`

  // ============ 1. Auth screen ============
  await scenario(`auth ${tag}`, vp, async ({ page, mock, c }) => {
    seedCouple(mock)
    await goto(page)
    await page.getByRole('heading', { name: 'Swiper' }).waitFor()
    c('sign-in page: no horizontal scroll', await noHScroll(page))
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll('input')].filter((i) => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).map((i) => i.placeholder),
    )
    c('every sign-in input has a programmatic label (not only a placeholder)', unlabeled.length === 0, unlabeled.length ? `placeholder-only: ${unlabeled.join(', ')}` : '')
    const small = await smallTargets(page)
    c('sign-in touch targets >= 44px', small.length === 0, small.join('; '))
    c('sign-in focus indicators visible on every control', (await focusIndicatorGaps(page, 8)).length === 0, (await focusIndicatorGaps(page, 8)).join('; '))

    const labelTexts = await page.evaluate(() => [...document.querySelectorAll('label')].map((l) => l.textContent.trim()))
    c('sign-in has visible labels Email and Password', labelTexts.includes('Email') && labelTexts.includes('Password'), labelTexts.join(','))
    const toggle = await page.getByRole('button', { name: /Create an account/ }).boundingBox()
    c('"New here? Create an account" toggle is at least 44px tall', toggle.height >= 43.5, `${Math.round(toggle.height)}px`)
    c('exactly one h1 on sign-in', (await headingLevels(page)).filter((l) => l === 1).length === 1)
    // I1: a network failure never shows library text
    mock.offline = true
    await page.getByPlaceholder('Email').fill('a@x.test')
    await page.getByPlaceholder('Password').fill('password1')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('alert').waitFor()
    const offlineMsg = await page.getByRole('alert').innerText()
    c('sign-in while offline shows a friendly message, not "Failed to fetch"', /can't reach the server/i.test(offlineMsg) && !/fetch|TypeError/i.test(offlineMsg), offlineMsg)
    mock.offline = false
    // wrong password
    await signIn(page, 'a@x.test', 'wrongpass1')
    const alert = page.getByRole('alert')
    await alert.waitFor()
    c('wrong password shows an alert', /invalid login credentials/i.test(await alert.innerText()), await alert.innerText())
    c('wrong password does not sign in', (await page.getByRole('navigation', { name: 'Main' }).count()) === 0)

    // short password in sign-up mode: native validation blocks the request
    await page.getByRole('button', { name: /Create an account/ }).click()
    c('sign-up form: every input labelled', (await unlabeledInputs(page)).length === 0, (await unlabeledInputs(page)).join(','))
    c('sign-up form: touch targets >= 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join('; '))
    c('sign-up name input has maxLength 60', (await page.locator('#auth-name').getAttribute('maxlength')) === '60')
    await page.getByPlaceholder('Your name').fill('X')
    await page.getByPlaceholder('Email').fill('new@x.test')
    await page.getByPlaceholder('Password').fill('short')
    const before = mock.log.length
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForTimeout(300)
    c('7-char password blocked client-side (no signup request)', !mock.log.slice(before).some((l) => l.path.includes('signup')))
    // duplicate email
    await page.getByPlaceholder('Email').fill('a@x.test')
    await page.getByPlaceholder('Password').fill('password1')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('alert').waitFor()
    c('duplicate sign-up shows an error', /already registered/i.test(await page.getByRole('alert').innerText()))
    // Enter key submits
    await page.getByRole('button', { name: /Already have an account/ }).click()
    await page.getByPlaceholder('Email').fill('a@x.test')
    await page.getByPlaceholder('Password').fill('password1')
    await page.getByPlaceholder('Password').press('Enter')
    await tab(page, 'Swipe').waitFor()
    c('Enter key signs in', true)
  })

  // ============ 2. nursery setup ============
  await scenario(`nursery setup ${tag}`, vp, async ({ page, mock, c }) => {
    mock.addUser('solo@x.test', 'password1', 'Solo')
    mock.addNursery(mock.addUser('owner@x.test', 'password1', 'Owner').id, 'BABY-FULL', 'Full')
    mock.addMember(mock.state.nurseries[0].id, mock.addUser('o2@x.test', 'password1', 'O2').id)
    await goto(page)
    await signIn(page, 'solo@x.test')
    await page.getByRole('heading', { name: 'Set up your nursery' }).waitFor()
    c('nursery setup: no horizontal scroll', await noHScroll(page))
    const small = await smallTargets(page)
    c('nursery setup touch targets >= 44px', small.length === 0, small.join('; '))
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => !i.labels?.length && !i.getAttribute('aria-label')).map((i) => i.placeholder))
    c('nursery setup inputs have labels', unlabeled.length === 0, unlabeled.join(', '))
    await page.getByPlaceholder('BABY-7K2Q9XMD').fill('baby-nope')
    await page.getByRole('button', { name: 'Join nursery' }).click()
    await page.getByRole('alert').waitFor()
    const wrongMsg = await page.getByRole('alert').innerText()
    c('unknown code (ok:false) shows the server message', /did not work/i.test(wrongMsg) && !/not found/i.test(wrongMsg), wrongMsg)
    await page.getByPlaceholder('BABY-7K2Q9XMD').fill('  baby-full ')
    await page.getByRole('button', { name: 'Join nursery' }).click()
    await page.waitForFunction(() => /did not work/i.test(document.querySelector('[role=alert]')?.textContent || ''))
    c('full nursery (ok:false) shows the same generic message', true)
    c('nursery setup: surname input maxLength 60', (await page.locator('#setup-surname').getAttribute('maxlength')) === '60')
    c('nursery setup: no hard-coded code length (maxLength absent on code input)', (await page.locator('#setup-code').getAttribute('maxlength')) === null)
    mock.offline = true
    await page.getByRole('button', { name: 'Join nursery' }).click()
    await page.waitForFunction(() => /can't reach the server/i.test(document.querySelector('[role=alert]')?.textContent || ''))
    c('join while offline shows a friendly message', !/fetch/i.test(await page.getByRole('alert').innerText()))
    mock.offline = false
    mock.joinFailures.set(mock.userByEmail('solo@x.test').id, 10)
    await page.getByRole('button', { name: 'Join nursery' }).click()
    await page.waitForFunction(() => /too many attempts/i.test(document.querySelector('[role=alert]')?.textContent || ''))
    c('lockout (ok:false) message is shown', true)
    mock.joinFailures.clear()
    mock.tableDelay.profiles = 1500 // F6: the profile arrives late
    await page.getByPlaceholder('Surname (for previews)').fill(`O'Brien <b>bold</b> "q"`)
    await page.getByRole('button', { name: 'Create nursery' }).click()
    await tab(page, 'Swipe').waitFor()
    c('create nursery enters the shell', true)
    await tab(page, 'Settings').click()
    c('F6: display name is filled in when Settings opens right after create (slow profile fetch)', (await page.locator('#display-name').inputValue()) === 'Solo', `"${await page.locator('#display-name').inputValue()}"`)
    c('F6: surname field shows the new surname', (await page.locator('#surname').inputValue()).startsWith("O'Brien"))
    await tab(page, 'Swipe').click()
    await page.getByTestId('top-card').waitFor()
    const label = await page.getByTestId('top-card').getAttribute('aria-label')
    c('surname with quotes/HTML is shown as text on the card', /O'Brien <b>bold<\/b> "q"/.test(label), label)
    c('no injected <b> element from surname', (await page.locator('article b').count()) === 0)
  })

  // ============ 3. shell, navigation, a11y ============
  await scenario(`shell ${tag}`, vp, async ({ page, mock, c }) => {
    const { nid } = await seedCouple(mock, { matches: [1, 2, 3, 5] })
    await goto(page)
    await signIn(page, 'a@x.test')
    await tab(page, 'Swipe').waitFor()
    await page.getByTestId('top-card').waitFor()

    c('single <main> landmark in the signed-in shell', (await page.locator('main').count()) === 1)
    c('swipe: exactly one h1 (visually hidden) and heading order is valid', orderOk(await headingLevels(page)) && (await page.locator('h1').count()) === 1, JSON.stringify(await headingLevels(page)))
    const surnameC = await contrastOnWhite(page.getByTestId('top-card').locator('h2 > span'))
    c('swipe card surname contrast >= 4.5:1', surnameC >= 4.5, surnameC.toFixed(2))
    const meaningLbl = page.getByTestId('top-card').getByText('Meaning', { exact: true })
    if (await meaningLbl.count()) { const mc = await contrastOnWhite(meaningLbl); c('swipe card "Meaning" label contrast >= 4.5:1', mc >= 4.5, mc.toFixed(2)) }
    c('swipe: no horizontal scroll', await noHScroll(page))
    const smallSwipe = await smallTargets(page)
    c('swipe touch targets >= 44px', smallSwipe.length === 0, smallSwipe.join('; '))
    const gapsSwipe = await focusIndicatorGaps(page, 8)
    c('swipe focus indicators visible', gapsSwipe.length === 0, gapsSwipe.join('; '))

    const names = ['Swipe', 'Matches', 'Shortlist', 'Settings']
    for (const n of names) {
      await tab(page, n).click()
      await page.waitForTimeout(250)
      c(`tab "${n}": hash updated`, (await page.evaluate(() => location.hash)) === '#' + n.toLowerCase())
      c(`tab "${n}": aria-current set`, (await tab(page, n).getAttribute('aria-current')) === 'page')
      c(`tab "${n}": no horizontal scroll`, await noHScroll(page))
      const lv = await headingLevels(page)
      c(`tab "${n}": one <main>, one h1, no skipped heading levels`, (await page.locator('main').count()) === 1 && (await page.locator('h1').count()) === 1 && orderOk(lv), JSON.stringify(lv))
      if (n === 'Settings') c('Settings: every input has a label', (await unlabeledInputs(page)).length === 0, (await unlabeledInputs(page)).join(','))
      const small = await smallTargets(page)
      c(`tab "${n}": touch targets >= 44px`, small.length === 0, small.join('; '))
      const gaps = await focusIndicatorGaps(page, 45)
      c(`tab "${n}": every focusable shows a focus indicator`, gaps.length === 0, gaps.join('; '))
    }

    // deep links + back button
    for (const h of ['matches', 'shortlist', 'settings']) {
      await goto(page, '#' + h)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await tab(page, 'Swipe').waitFor()
      c(`deep link #${h} opens that tab`, (await tab(page, h[0].toUpperCase() + h.slice(1)).getAttribute('aria-current')) === 'page')
    }
    await goto(page, '#bogus')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await tab(page, 'Swipe').waitFor()
    c('unknown hash falls back to Swipe', (await tab(page, 'Swipe').getAttribute('aria-current')) === 'page')
    await tab(page, 'Matches').click()
    await tab(page, 'Settings').click()
    await page.goBack()
    await page.waitForTimeout(200)
    c('browser Back returns to previous tab', (await tab(page, 'Matches').getAttribute('aria-current')) === 'page')
    await page.goForward()
    await page.waitForTimeout(200)
    c('browser Forward works', (await tab(page, 'Settings').getAttribute('aria-current')) === 'page')

    // Settings content
    await tab(page, 'Settings').click()
    c('Settings shows invite code', (await page.getByTestId('invite-code').innerText()) === 'BABY-TEST')
    c('Settings shows partner', await page.getByText('Linked with Bob').isVisible())
    c('Settings: surname and display name have maxLength 60', (await page.locator('#surname').getAttribute('maxlength')) === '60' && (await page.locator('#display-name').getAttribute('maxlength')) === '60')
    c('Settings: display name is filled in with the saved name', (await page.locator('#display-name').inputValue()) === 'Alice')
    await page.locator('#surname').focus()
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth} off ${cs.outlineOffset}` })
    c('Settings: focused input shows a 2px outline with offset (outline-none no longer cancels it)', /solid 2px off 2px/.test(ring), ring)
    // surname edit persists across reload
    await page.locator('#surname').fill('Jones-Ñandú')
    await page.getByRole('button', { name: 'Save' }).first().click()
    await page.getByText('Saved', { exact: true }).first().waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await tab(page, 'Settings').waitFor()
    c('surname edit persists after reload', (await page.locator('#surname').inputValue()) === 'Jones-Ñandú')
    // display-name XSS / long
    await page.locator('#display-name').fill(`<img src=x onerror=window.__xss=3>${'W'.repeat(200)}`)
    await page.getByRole('button', { name: 'Save' }).nth(1).click()
    await page.waitForTimeout(400)
    c('long/HTML display name: no horizontal scroll', await noHScroll(page))
    c('display name did not execute HTML', (await page.evaluate(() => window.__xss)) === undefined)
    // filters
    await page.getByRole('button', { name: 'boy', exact: true }).click()
    await page.getByRole('button', { name: 'neutral', exact: true }).click()
    await page.getByRole('button', { name: 'girl', exact: true }).click() // would leave none selected
    c('cannot deselect the last gender', /at least one gender/i.test(await page.getByRole('alert').innerText()))
    await page.getByRole('button', { name: 'Irish', exact: true }).click()
    await page.getByRole('button', { name: 'Save filters' }).click()
    await page.getByText(/new filters apply/i).waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await tab(page, 'Settings').waitFor()
    c('filters persist after reload', (await page.getByRole('button', { name: 'Irish', exact: true }).getAttribute('aria-pressed')) === 'true' && (await page.getByRole('button', { name: 'girl', exact: true }).getAttribute('aria-pressed')) === 'true' && (await page.getByRole('button', { name: 'boy', exact: true }).getAttribute('aria-pressed')) === 'false')
    await tab(page, 'Swipe').click()
    await page.getByTestId('top-card').waitFor()
    const first = await page.getByTestId('top-card').getAttribute('aria-label')
    c('swipe deck respects saved filters (girl + Irish only)', first.startsWith('Name1 '), first)
  })

  // ============ 4. swipe interactions ============
  await scenario(`swipe ${tag}`, vp, async ({ page, mock, ctx, c }) => {
    const { b, nid } = await seedCouple(mock, { surname: 'Lee' })
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByTestId('top-card').waitFor()
    const a = mock.userByEmail('a@x.test')
    const swipes = () => mock.state.swipes.filter((s) => s.user_id === a.id)
    const topLabel = () => page.getByTestId('top-card').getAttribute('aria-label')

    const waitSwipes = (n) => page.waitForFunction(() => true).then(async () => { for (let i = 0; i < 60 && swipes().length < n; i++) await page.waitForTimeout(100) })
    const idOfTop = async () => {
      const l = await topLabel()
      return l.startsWith('Name') ? Number(l.match(/^Name(\d+)/)[1]) : l.startsWith('Zo') ? 3 : l.startsWith('Super') ? 4 : -1
    }

    c('first card is Name1', (await topLabel()).startsWith('Name1 '))
    await page.keyboard.press('ArrowRight')
    await waitSwipes(1)
    c('ArrowRight likes (saved liked=true)', swipes().some((s) => s.name_id === 1 && s.liked === true))
    await page.keyboard.press('ArrowLeft')
    await waitSwipes(2)
    c('ArrowLeft dislikes (saved liked=false)', swipes().some((s) => s.name_id === 2 && s.liked === false))
    // XSS name is card #3
    await page.waitForTimeout(400)
    const l3 = await topLabel()
    c('XSS-laden name renders as text', l3.includes('<script>') && (await page.evaluate(() => window.__xss)) === undefined && (await page.locator('article script, article img').count()) === 0, l3.slice(0, 40))
    await page.getByRole('button', { name: 'Like', exact: true }).click()
    await waitSwipes(3)
    c('Like button works', swipes().some((s) => s.name_id === 3 && s.liked))
    await page.waitForTimeout(500)
    c('very long (68-char, no spaces) name: no horizontal scroll', await noHScroll(page))
    const card = await page.getByTestId('top-card').boundingBox()
    c('very long name card stays inside viewport', card.x >= -1 && card.x + card.width <= vp.width + 1, JSON.stringify(card))
    const n0 = swipes().length
    await page.getByRole('button', { name: 'Dislike', exact: true }).dblclick()
    await page.waitForTimeout(900)
    c('double-click on a button records exactly one swipe', swipes().length === n0 + 1, `${swipes().length - n0} new swipes`)
    // touch swipe right using CDP touch events
    const cdp = await ctx.newCDPSession(page)
    const cur = await idOfTop()
    await touchDrag(cdp, page, 160)
    await page.waitForTimeout(800)
    const after = await idOfTop()
    c('touch drag right (160px) likes the card', after !== cur && swipes().some((s) => s.name_id === cur && s.liked === true), `${cur} -> ${after}`)
    await touchDrag(cdp, page, -160)
    await page.waitForTimeout(800)
    c('touch drag left (-160px) dislikes the card', swipes().some((s) => s.name_id === after && s.liked === false))
    const cur3 = await idOfTop()
    await touchDrag(cdp, page, 40)
    await page.waitForTimeout(800)
    c('short touch drag (40px) snaps back without swiping', (await idOfTop()) === cur3 && !swipes().some((s) => s.name_id === cur3))
    // vertical scroll attempt should not swipe
    const top = await page.getByTestId('top-card').boundingBox()
    const cur4 = await idOfTop()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: top.x + top.width / 2, y: top.y + 100 }] })
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: top.x + top.width / 2 + 5, y: top.y + 100 - i * 15 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)
    c('vertical touch gesture does not swipe the card', (await idOfTop()) === cur4)
    // partner like -> match -> overlay (via visibility poll)
    mock.state.swipes.push({ user_id: b.id, name_id: 38, liked: true })
    await page.getByRole('button', { name: 'Like', exact: true }).click()
    await page.waitForTimeout(300)
    mock.addMatch(nid, 38) // simulate server-side match for a name the partner liked
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ timeout: 5000 })
    c('match alert dialog appears (poll path)', /Name38/.test(await dlg.innerText()))
    c('dialog moves focus to "See matches"', (await page.evaluate(() => document.activeElement?.textContent)) === 'See matches')
    const mainInert = await page.evaluate(() => document.querySelector('main').inert && document.querySelector('nav[aria-label=Main]').inert)
    c('F10: page behind the dialog (main + tab bar) is inert while it is open', mainInert === true)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    c('F10: Shift+Tab wraps inside the dialog', await page.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)))
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const escaped = await page.evaluate(() => !document.querySelector('[role=dialog]')?.contains(document.activeElement))
    c('focus stays trapped inside the open modal dialog after 3x Tab', !escaped, escaped ? 'focus left the dialog (no focus trap)' : '')
    await page.keyboard.press('Escape')
    await dlg.waitFor({ state: 'detached' })
    c('Escape closes the match dialog', true)
    c('focus returns somewhere sensible after closing dialog (not <body>)', (await page.evaluate(() => document.activeElement?.tagName)) !== 'BODY', await page.evaluate(() => document.activeElement?.tagName))
    c('F10: focus is restored to the element focused before the dialog (Like button)', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Like', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60)))
    c('F10: page is no longer inert after closing', (await page.evaluate(() => document.querySelector('main').inert)) === false)
    c('Matches tab shows unseen badge', (await tab(page, 'Matches').locator('span').count()) > 0)
    c('F12: unseen badge has an accessible name ("new match" in the Matches button label)', (await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /Matches.*new match/i }).count()) === 1)
    c('F12: no aria-label="new" on an empty span', (await page.locator('span[aria-label="new"]').count()) === 0)
    await tab(page, 'Matches').click()
    await page.getByText('Name38').waitFor()
    c('Matches lists the new match', true)
    await tab(page, 'Swipe').click()
    c('badge cleared after visiting Matches', (await tab(page, 'Matches').locator('span').count()) === 0)
  })

  // ============ 5. deck end + slow prefetch ============
  await scenario(`deck-end ${tag}`, vp, async ({ page, mock, c }) => {
    await seedCouple(mock)
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByTestId('top-card').waitFor()
    // Slow responses: reproduce the premature "seen every name" message while a prefetch is in flight.
    mock.rpcDelay.suggest_names = 2500
    let sawPremature = false
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(330)
      if (await page.getByText('You have seen every name').isVisible().catch(() => false)) sawPremature = true
    }
    c('no false "seen every name" empty state while next batch is still loading (slow network)', !sawPremature, sawPremature ? 'empty-state flashed although 10 names were still to come' : '')
    mock.rpcDelay.suggest_names = 0
    await page.waitForTimeout(3000)
    // Run to the real end
    for (let i = 0; i < 60; i++) {
      if (await page.getByText('You have seen every name').isVisible().catch(() => false)) break
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(260)
    }
    await page.getByText('You have seen every name').waitFor({ timeout: 8000 })
    c('real end of deck shows empty state', true)
    await page.getByRole('button', { name: 'Open Settings' }).click()
    c('"Open Settings" navigates', (await tab(page, 'Settings').getAttribute('aria-current')) === 'page')
    mock.missingRpc = true
  })

  // ============ 6. database not updated state ============
  await scenario(`missing-rpc ${tag}`, vp, async ({ page, mock, c }) => {
    await seedCouple(mock)
    mock.missingRpc = true
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByText('The database needs the latest update').waitFor()
    c('Swipe shows a friendly "database needs update" message when suggest_names is missing', true)
    await tab(page, 'Shortlist').click()
    await page.getByText(/database needs the latest update/i).first().waitFor({ timeout: 3000 }).catch(() => {})
    c('no horizontal scroll in missing-rpc state', await noHScroll(page))
  })

  // ============ 7. shortlist ============
  await scenario(`shortlist ${tag}`, vp, async ({ page, mock, c }) => {
    const { nid } = await seedCouple(mock, { matches: [1, 2, 3, 5] })
    await goto(page, '#shortlist')
    await signIn(page, 'a@x.test')
    await page.getByRole('tab', { name: 'Rank', exact: true }).waitFor()
    await page.getByRole('button', { name: /Move Name1 .* down/ }).waitFor()
    c('shortlist: no horizontal scroll', await noHScroll(page))
    const small = await smallTargets(page)
    c('shortlist touch targets >= 44px', small.length === 0, small.join('; '))
    // XSS name (id 3) in list
    c('XSS name rendered as text in rank list', (await page.evaluate(() => window.__xss)) === undefined && (await page.getByText('<script>', { exact: false }).count()) > 0)
    await page.getByRole('button', { name: /Move Name1 .* down/ }).click()
    await page.getByText('Saved', { exact: true }).waitFor({ timeout: 4000 })
    const a = mock.userByEmail('a@x.test')
    const order = mock.state.rankings.filter((r) => r.user_id === a.id).sort((x, y) => x.position - y.position).map((r) => r.name_id)
    c('rank: moving Name1 down saves new order', order[0] === 2 && order[1] === 1, JSON.stringify(order))
    // keyboard operation
    await page.getByRole('button', { name: /Move Name5 .* up/ }).focus()
    await page.keyboard.press('Enter')
    await page.getByText('Saved', { exact: true }).waitFor({ timeout: 4000 })
    c('rank: keyboard Enter on a move button reorders & saves', true)
    // leave quickly: unmount flush
    await page.getByRole('button', { name: /Move Name5 .* up/ }).click()
    await page.getByRole('tab', { name: 'Head to head' }).click()
    await page.waitForTimeout(1200)
    const order2 = mock.state.rankings.filter((r) => r.user_id === a.id).sort((x, y) => x.position - y.position).map((r) => r.name_id)
    c('rank: edit flushed when leaving the sub-tab within the debounce', order2.length === 4, JSON.stringify(order2))
    // duel
    await page.getByText('Tap the name you like more.').waitFor()
    const btns = page.getByRole('group', { name: 'Choose your favourite' }).getByRole('button')
    await btns.first().click()
    await page.waitForFunction(() => /1 duel this session/.test(document.body.innerText))
    c('duel: choice recorded, counter increments', mock.state.duels.length === 1)
    await page.getByRole('button', { name: 'Skip' }).click()
    c('duel: Skip works without recording', mock.state.duels.length === 1)
    c('duel: touch targets', (await smallTargets(page)).length === 0, (await smallTargets(page)).join('; '))
    await page.getByRole('tab', { name: "Couple's ranking" }).click()
    await page.getByRole('list').first().waitFor()
    const items = await page.locator('ol > li').count()
    c("couple's ranking lists all matches", items >= 4, `${items} items`)
    // tablist semantics
    const sel = await page.getByRole('tab', { selected: true }).count()
    c('exactly one sub-tab is aria-selected', sel === 1)
    const panelLabelled = await page.evaluate(() => { const p = document.querySelector('[role=tabpanel]'); return !!(p && (p.getAttribute('aria-labelledby') || p.getAttribute('aria-label'))) })
    c('tabpanel is labelled / tabs have aria-controls', panelLabelled, 'role=tabpanel has no aria-labelledby; role=tab has no aria-controls')
    const wiring = await page.evaluate(() => {
      const panel = document.querySelector('[role=tabpanel]')
      const tabs = [...document.querySelectorAll('[role=tab]')]
      const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
      return { controls: tabs.every((t) => document.getElementById(t.getAttribute('aria-controls') || '_') === panel), labelled: panel.getAttribute('aria-labelledby') === sel.id, n: tabs.length }
    })
    c('F14: every sub-tab aria-controls the tabpanel and the panel is aria-labelledby the selected tab', wiring.controls && wiring.labelled && wiring.n === 3, JSON.stringify(wiring))
    await page.getByRole('tab', { name: "Couple's ranking" }).focus()
    await page.keyboard.press('ArrowLeft')
    c('F14: ArrowLeft moves to the previous sub-tab', (await page.getByRole('tab', { name: 'Head to head' }).getAttribute('aria-selected')) === 'true')
    await page.getByRole('tab', { name: 'Head to head' }).click()
    await page.getByText('Tap the name you like more.').waitFor()
    const dl = await headingLevels(page)
    c('F14: Head to head has h1 then h2 (no h3 straight after h1)', orderOk(dl) && !dl.includes(3), JSON.stringify(dl))
    await page.getByRole('tab', { name: "Couple's ranking" }).click()
    // empty state
    mock.state.matches.length = 0
    await page.getByRole('tab', { name: 'Rank', exact: true }).click()
    await page.getByText('Nothing to rank yet').waitFor()
    c('empty shortlist shows empty state', true)
  })

  // ============ 8. offline / recovery ============
  await scenario(`offline ${tag}`, vp, async ({ page, mock, ctx, c }) => {
    await seedCouple(mock, { matches: [1, 2] })
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByTestId('top-card').waitFor()
    const a = mock.userByEmail('a@x.test')
    mock.offline = true; await ctx.setOffline(true)
    const cur = (await page.getByTestId('top-card').getAttribute('aria-label')).split(' ')[0]
    await page.getByRole('button', { name: 'Like', exact: true }).click()
    await page.getByRole('alert').first().waitFor({ timeout: 8000 })
    const msg = await page.getByRole('alert').first().innerText()
    c('offline swipe shows an error message', /could not save/i.test(msg), msg)
    c('offline swipe puts the card back on top (not lost)', (await page.getByTestId('top-card').getAttribute('aria-label')).startsWith(cur + ' '))
    mock.offline = false; await ctx.setOffline(false)
    await page.getByRole('button', { name: 'Like', exact: true }).click()
    await page.waitForTimeout(800)
    c('after reconnect the same card can be swiped and is saved', mock.state.swipes.some((s) => s.user_id === a.id && `Name${s.name_id}` === cur && s.liked))
    // Matches while offline
    await tab(page, 'Matches').click()
    await page.getByText('Name1', { exact: false }).first().waitFor()
    mock.offline = true; await ctx.setOffline(true)
    await page.getByRole('button', { name: 'Refresh' }).click()
    await page.getByRole('alert').first().waitFor({ timeout: 8000 })
    c('offline Matches refresh shows an error with Retry', (await page.getByRole('button', { name: 'Retry' }).count()) > 0)
    c('offline Matches keeps already-loaded list visible', await page.getByText('Name1', { exact: false }).first().isVisible())
    mock.offline = false; await ctx.setOffline(false)
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.getByRole('alert').waitFor({ state: 'detached', timeout: 5000 })
    c('Matches recovers after Retry when back online', true)
    // App-level: coming back to foreground while offline must not nuke the shell
    await tab(page, 'Settings').click()
    mock.offline = true; await ctx.setOffline(true)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(10000) // postgrest-js retries failed GETs for a few seconds before reporting an error
    const shellStillThere = (await page.getByRole('navigation', { name: 'Main' }).count()) > 0
    c('going offline then foregrounding keeps the app shell (tab bar) on screen', shellStillThere, shellStillThere ? '' : 'whole app replaced by a bare error (no tab bar, no Retry, no Sign out)')
    const banner = page.getByTestId('error-banner')
    c('F4: a background refresh error shows a small banner', (await banner.count()) === 1)
    const bannerText = (await banner.innerText().catch(() => '')) || ''
    c('F4/I1: banner text is friendly (no "TypeError" / "Failed to fetch")', /can't reach the server/i.test(bannerText) && !/TypeError|failed to fetch/i.test(bannerText), bannerText.replace(/\s+/g, ' '))
    c('F4: the current screen stays mounted under the banner (Settings form still there)', await page.locator('#surname').isVisible())
    c('F4: banner has Retry and Dismiss buttons', (await banner.getByRole('button', { name: 'Retry' }).count()) === 1 && (await banner.getByRole('button', { name: 'Dismiss' }).count()) === 1)
    await banner.getByRole('button', { name: 'Dismiss' }).click()
    c('F4: banner can be dismissed', (await page.getByTestId('error-banner').count()) === 0)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByTestId('error-banner').waitFor({ timeout: 20000 })
    c('F4: the next visibility change retries and shows the banner again', true)
    mock.offline = false; await ctx.setOffline(false)
    await page.getByTestId('error-banner').getByRole('button', { name: 'Retry' }).click()
    await page.getByTestId('error-banner').waitFor({ state: 'detached', timeout: 8000 })
    c('F4: Retry button recovers and clears the banner', (await page.getByRole('navigation', { name: 'Main' }).count()) > 0)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(1500)
    c('app recovers by itself after going back online', (await page.getByRole('navigation', { name: 'Main' }).count()) > 0 && (await page.getByTestId('error-banner').count()) === 0)
  })

  // ============ 9. reduced motion ============
  await scenario(`reduced-motion ${tag}`, { ...vp, reducedMotion: 'reduce' }, async ({ page, mock, ctx, c }) => {
    await seedCouple(mock)
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByTestId('top-card').waitFor()
    await page.getByRole('button', { name: 'Like', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid=top-card]')?.getAttribute('aria-label')?.startsWith('Name2 '), null, { timeout: 2000 })
    c('reduced motion: Like button advances immediately', true)
    const cdp = await ctx.newCDPSession(page)
    const cur = (await page.getByTestId('top-card').getAttribute('aria-label')).split(' ')[0]
    await touchDrag(cdp, page, 200)
    await page.waitForTimeout(500)
    c('reduced motion: card is not draggable (buttons/keys are the way)', (await page.getByTestId('top-card').getAttribute('aria-label')).startsWith(cur + ' '))
    const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    c('reduced motion: no running CSS animations on the swipe screen', anim === 0, `${anim} running`)
  })

  // ============ 9b. several matches at once ============
  await scenario(`multi-match ${tag}`, vp, async ({ page, mock, c }) => {
    const { nid } = await seedCouple(mock, { surname: 'Lee', matches: [1] })
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByTestId('top-card').waitFor()
    const fire = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForTimeout(400)
    mock.addMatch(nid, 5); mock.addMatch(nid, 6); mock.addMatch(nid, 7); mock.addMatch(nid, 8)
    await fire()
    const dlg = page.getByRole('dialog')
    await dlg.waitFor({ timeout: 6000 })
    await page.waitForTimeout(500)
    const text = await dlg.innerText()
    c('F11: four matches at once give ONE overlay', (await page.getByRole('dialog').count()) === 1)
    c('F11: overlay says "4 new matches" and lists the names', /4 new matches/.test(text) && ['Name5 Lee', 'Name6 Lee', 'Name7 Lee', 'Name8 Lee'].every((n) => text.includes(n)), text.replace(/\s+/g, ' '))
    c('F11: the multi overlay has a "See matches" button', (await dlg.getByRole('button', { name: 'See matches' }).count()) === 1)
    c('F11: no horizontal scroll with the list', await noHScroll(page))
    await page.keyboard.press('Escape')
    await dlg.waitFor({ state: 'detached' })
    await page.waitForTimeout(300)
    c('F11: dismissing closes everything (no second overlay)', (await page.getByRole('dialog').count()) === 0)
    mock.addMatch(nid, 9)
    await fire()
    await dlg.waitFor({ timeout: 6000 })
    c('F11: a single new match shows its name, not a count', /Name9 Lee/.test(await dlg.innerText()) && !/new matches/.test(await dlg.innerText()))
    await dlg.getByRole('button', { name: 'See matches' }).click()
    await dlg.waitFor({ state: 'detached' })
    c('F11: "See matches" opens the Matches tab', (await tab(page, 'Matches').getAttribute('aria-current')) === 'page')
    c('F10: focus after "See matches" is inside the page, not on <body>', (await page.evaluate(() => document.activeElement?.tagName)) !== 'BODY')
  })

  // ============ 9c. first-load failure ============
  await scenario(`first-load-error ${tag}`, vp, async ({ page, mock, c }) => {
    await seedCouple(mock)
    mock.fail = ({ path }) => path === '/rest/v1/nurseries'
    await goto(page)
    await signIn(page, 'a@x.test')
    await page.getByRole('button', { name: 'Retry' }).waitFor()
    c('F4: a first-load failure shows a full-screen error with Retry and Sign out', (await page.getByRole('button', { name: 'Sign out' }).count()) === 1 && (await page.getByRole('navigation', { name: 'Main' }).count()) === 0)
    c('F4: the first-load error screen has an h1 and one main', (await page.locator('main h1').count()) === 1 && (await page.locator('main').count()) === 1)
    mock.fail = null
    await page.getByRole('button', { name: 'Retry' }).click()
    await tab(page, 'Swipe').waitFor()
    c('F4: Retry on the error screen loads the app', true)
    mock.fail = ({ path }) => path === '/rest/v1/nurseries'
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByTestId('error-banner').waitFor()
    c('F4: a later failure leaves the shell and the swipe card in place', (await page.getByTestId('top-card').count()) === 1 && (await tab(page, 'Swipe').count()) === 1)
    mock.fail = null
  })

  // ============ 9d. settings: new code, leave nursery ============
  await scenario(`settings-flows ${tag}`, vp, async ({ page, mock, c }) => {
    const { nid } = await seedCouple(mock, { matches: [1, 2] })
    let dialogs = 0
    page.on('dialog', (d) => { dialogs++; d.dismiss() })
    await goto(page, '#settings')
    await signIn(page, 'a@x.test')
    await page.getByTestId('invite-code').waitFor()
    const before = await page.getByTestId('invite-code').innerText()
    await page.getByRole('button', { name: 'New invite code' }).click()
    await page.getByTestId('rotated-code').waitFor()
    const shown = await page.getByTestId('rotated-code').innerText()
    c('rotate: calls rotate_invite_code once', mock.rotateCalls === 1)
    c('rotate: new BABY- code is shown (8 characters) and replaces the old one', /^BABY-[A-Z0-9]{8}$/.test(shown) && shown !== before && (await page.getByTestId('invite-code').innerText()) === shown, `${before} -> ${shown}`)
    c('rotate: explains the old code stops working', /old code (no longer works|stops working)/i.test(await page.locator('body').innerText()))
    c('rotate: no horizontal scroll', await noHScroll(page))
    // leave: two steps
    await page.getByRole('button', { name: 'Leave nursery' }).click()
    c('leave: first click only asks for confirmation (no rpc yet)', mock.leaveCalls === 0 && (await page.getByRole('button', { name: 'Yes, leave nursery' }).count()) === 1)
    c('leave: explains matches are cleared', /clears the matches you shared/i.test(await page.locator('body').innerText()))
    await page.getByRole('button', { name: 'Cancel' }).click()
    c('leave: Cancel backs out without leaving', mock.leaveCalls === 0 && (await page.getByRole('button', { name: 'Yes, leave nursery' }).count()) === 0)
    c('leave: touch targets >= 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join('; '))
    await page.getByRole('button', { name: 'Leave nursery' }).click()
    await page.getByRole('button', { name: 'Yes, leave nursery' }).click()
    await page.getByRole('heading', { name: 'Set up your nursery' }).waitFor({ timeout: 5000 })
    c('leave: calls leave_nursery and returns to the nursery setup screen', mock.leaveCalls === 1)
    c('leave: used an in-page confirmation, not window.confirm', dialogs === 0)
    c('leave: the shared matches were cleared', mock.state.matches.filter((m) => m.nursery_id === nid).length === 0)
  })

  // ============ 10. sign out / other user ============
  await scenario(`user-switch ${tag}`, vp, async ({ page, mock, c }) => {
    const { nid } = await seedCouple(mock, { surname: 'Alpha', matches: [1, 2] })
    const x = mock.addUser('c@x.test', 'password1', 'Carol')
    const y = mock.addUser('d@x.test', 'password1', 'Dan')
    const n2 = mock.addNursery(x.id, 'BABY-CCCC', 'Beta')
    mock.addMember(n2, y.id)
    mock.addMatch(n2, 9)
    await goto(page)
    await signIn(page, 'a@x.test')
    await tab(page, 'Matches').click()
    await page.getByText('Name1 Alpha').waitFor()
    await tab(page, 'Shortlist').click()
    await page.getByRole('tab', { name: 'Rank', exact: true }).waitFor()
    await page.waitForTimeout(500)
    await tab(page, 'Settings').click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('heading', { name: 'Swiper' }).waitFor()
    c('sign out returns to sign-in', true)
    const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => /auth-token/.test(k)))
    c('sign out clears the stored auth token', ls.length === 0, ls.join(','))
    await page.goBack().catch(() => {})
    c('after sign-out, Back does not reveal the shell', (await page.getByRole('navigation', { name: 'Main' }).count()) === 0)
    await signIn(page, 'c@x.test')
    await tab(page, 'Swipe').waitFor()
    await tab(page, 'Matches').click()
    await page.getByText('Name9 Beta').waitFor()
    const body = await page.evaluate(() => document.body.innerText)
    c('second user sees only their own nursery data (no Alpha / Name1)', !/Alpha|Name1\b/.test(body), body.replace(/\s+/g, ' ').slice(0, 120))
    await tab(page, 'Settings').click()
    c('second user Settings shows own code and email', /BABY-CCCC/.test(await page.getByTestId('invite-code').innerText()) && /c@x\.test/.test(await page.locator('body').innerText()))
  })
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`)
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2))
process.exit(failed.length ? 1 : 0)
