// Runs axe-core (WCAG 2 A/AA rules) over every screen of the built app against the mocked
// Supabase. Needs axe-core: `npm i axe-core --prefix /tmp/axe` and AXE_PATH=/tmp/axe/node_modules/axe-core/axe.min.js
//   NODE_PATH=$(npm root -g) AXE_PATH=... node scripts/e2e/axe-audit.mjs   (BASE_URL default http://localhost:4190)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createMock } from './mock-supabase.mjs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL || 'http://localhost:4190'
const axeSrc = readFileSync(process.env.AXE_PATH, 'utf8')
const p = new URL(process.env.HTTPS_PROXY || 'http://127.0.0.1:1')
const browser = await chromium.launch({ proxy: { server: `${p.protocol}//${p.host}`, username: decodeURIComponent(p.username), password: decodeURIComponent(p.password), bypass: 'localhost,127.0.0.1' } })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
const mock = createMock({ origin: 'https://ugflrjkgsveufgjvavhz.supabase.co' })
await mock.install(ctx)
await ctx.routeWebSocket(/realtime/, (ws) => ws.close())
const a = mock.addUser('a@x.test', 'password1', 'Alice'), b = mock.addUser('b@x.test', 'password1', 'Bob')
mock.addUser('solo@x.test', 'password1', 'Solo')
const nid = mock.addNursery(a.id, 'BABY-TEST', 'Smith'); mock.addMember(nid, b.id); [1, 2, 5].forEach((m) => mock.addMatch(nid, m))
const page = await ctx.newPage()
const out = []
async function audit(label) {
  await page.addScriptTag({ content: axeSrc })
  const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
  for (const v of r.violations) out.push({ screen: label, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary || '').split('\n')[1] })
}
const tab = (l) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: l })
await page.goto(BASE + '/'); await page.getByPlaceholder('Email').waitFor(); await audit('sign-in')
await page.getByRole('button', { name: /Create an account/ }).click(); await audit('sign-up')
await page.getByRole('button', { name: /Already have/ }).click()
await page.getByPlaceholder('Email').fill('solo@x.test'); await page.getByPlaceholder('Password').fill('password1')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.getByRole('heading', { name: 'Set up your nursery' }).waitFor(); await audit('nursery-setup')
await tab('Swipe').count(); await page.evaluate(() => localStorage.clear()); await page.goto(BASE + '/'); await page.reload()
await page.getByPlaceholder('Email').fill('a@x.test'); await page.getByPlaceholder('Password').fill('password1')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.getByTestId('top-card').waitFor(); await audit('swipe')
await tab('Matches').click(); await page.getByText('Name1').first().waitFor(); await audit('matches')
await tab('Shortlist').click(); await page.getByRole('button', { name: /Move Name1/ }).first().waitFor(); await audit('shortlist-rank')
await page.getByRole('tab', { name: 'Head to head' }).click(); await page.getByText('Tap the name you like more.').waitFor(); await audit('shortlist-duel')
await page.getByRole('tab', { name: "Couple's ranking" }).click(); await page.locator('ol > li').first().waitFor(); await audit('shortlist-couple')
await tab('Settings').click(); await page.getByTestId('invite-code').waitFor(); await audit('settings')
await tab('Swipe').click(); await page.getByTestId('top-card').waitFor()
mock.addMatch(nid, 7); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.getByRole('dialog').waitFor({ timeout: 8000 }); await audit('match-overlay')
console.log(JSON.stringify(out, null, 1))
await browser.close()
