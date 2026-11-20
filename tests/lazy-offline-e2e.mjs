/**
 * Turnen und Einstellungen werden erst beim Öffnen geladen - und müssen
 * trotzdem offline aufgehen.
 *
 * Gebaut wird gegen `dist/` (npm run build), nicht gegen LifeHub.html: Die
 * Einzeldatei bündelt alles in eine Datei, dort gibt es nichts nachzuladen.
 * Ein kleiner Webserver liefert dist aus, weil ein Service Worker http braucht.
 *
 * Geprüft wird:
 *   1. Beim Start werden die beiden Nachladeteile NICHT geladen.
 *   2. Der Service Worker legt sie trotzdem vorsorglich in den Cache.
 *   3. Ohne Netz öffnen sich Turnen und Einstellungen aus dem Cache.
 *   4. Fehlt eine Datei wirklich, erscheint eine Meldung mit „Neu laden" -
 *      kein weißer Bildschirm, und die App darunter bleibt bedienbar.
 *
 * Aufruf:  npm run build && node tests/lazy-offline-e2e.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(WURZEL, 'dist')
if (!existsSync(path.join(DIST, 'index.html'))) {
  console.log('dist/ fehlt - zuerst: npm run build')
  process.exit(1)
}

const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const server = createServer((req, res) => {
  let pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (pfad.endsWith('/')) pfad += 'index.html'
  const datei = path.join(DIST, pfad)
  if (!datei.startsWith(DIST) || !existsSync(datei) || !statSync(datei).isFile()) { res.writeHead(404); res.end('nicht da'); return }
  res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
  res.end(readFileSync(datei))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const BASIS = `http://127.0.0.1:${server.address().port}/`

let fehler = 0
function pruefe(name, bedingung, zusatz = '') {
  if (bedingung) console.log(`  OK   ${name} ${zusatz}`)
  else { console.log(`  FEHL ${name} ${zusatz}`); fehler++ }
}
async function warteAuf(page, fn, ms = 30000, arg) {
  const bis = Date.now() + ms
  for (;;) {
    // Der Service Worker übernimmt beim ersten Mal die Seite und lädt sie dabei
    // neu - ein Abruf mitten in dieser Neuladung schlägt fehl und wird wiederholt.
    try { if (await page.evaluate(fn, arg)) return true } catch { /* Seite lädt gerade neu */ }
    if (Date.now() > bis) return false
    await page.waitForTimeout(250)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' })
const page = await ctx.newPage()
const geladen = []
page.on('request', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) geladen.push(path.basename(u)) })
const konsolenfehler = []
page.on('pageerror', (e) => konsolenfehler.push(String(e)))

console.log('\n=== Nachgeladene Bereiche ===\n')
await page.goto(BASIS)
pruefe('App startet', await warteAuf(page, () => !!document.querySelector('.page'), 60000))

pruefe('Start lädt Turnen NICHT', !geladen.some((n) => n.startsWith('Turnen-')), geladen.join(', '))
pruefe('Start lädt Einstellungen NICHT', !geladen.some((n) => n.startsWith('Settings-')))

// Der Service Worker braucht einen Moment, um die Teile vorsorglich zu holen.
const imCache = await warteAuf(page, async () => {
  const k = await caches.keys()
  if (!k.length) return false
  const namen = (await (await caches.open(k[0])).keys()).map((r) => r.url)
  return namen.some((u) => /\/Turnen-[^/]+\.js$/.test(u)) && namen.some((u) => /\/Settings-[^/]+\.js$/.test(u))
}, 30000)
pruefe('Service Worker hat beide Nachladeteile vorsorglich im Cache', imCache)

/* ------------------------------------------------------------- Offline */
await page.reload()
await warteAuf(page, () => !!document.querySelector('.page'), 30000)
await ctx.setOffline(true)

await page.evaluate(() => { location.hash = '#/turnen' })
const turnenOffline = await warteAuf(page, () => /Übersicht|Elemente|Training/.test(document.body.innerText) && !!document.querySelector('[role="tablist"], .tabs'), 20000)
pruefe('Turnen öffnet sich offline', turnenOffline)

await page.evaluate(() => { location.hash = '#/einstellungen' })
const einstOffline = await warteAuf(page, () => /Konto & Synchronisation/.test(document.body.innerText), 20000)
pruefe('Einstellungen öffnen sich offline', einstOffline)
await ctx.setOffline(false)

/* --------------------------------------------- Datei fehlt wirklich */
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const p2 = await ctx2.newPage()
await p2.route(/\/assets\/Turnen-[^/]+\.js$/, (r) => r.abort())
const fehlerP2 = []
p2.on('pageerror', (e) => fehlerP2.push(String(e)))
await p2.goto(BASIS)
await warteAuf(p2, () => !!document.querySelector('.page'), 60000)
await p2.evaluate(() => { location.hash = '#/turnen' })
const meldung = await warteAuf(p2, () => /konnte nicht geladen werden/.test(document.body.innerText), 15000)
pruefe('Fehlt die Datei, erscheint eine Meldung statt eines weißen Bildschirms', meldung)
pruefe('Die Meldung bietet „Neu laden" an', await p2.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Neu laden')))
pruefe('Die Navigation bleibt sichtbar und bedienbar', await p2.evaluate(() => !!document.querySelector('nav, .sidebar, .mobile-nav')))
await p2.evaluate(() => { location.hash = '#/heute' })
pruefe('Heute lässt sich danach öffnen', await warteAuf(p2, () => !/konnte nicht geladen werden/.test(document.body.innerText), 10000))

pruefe('Keine unbehandelten Fehler', konsolenfehler.length === 0, konsolenfehler.join(' | '))
await browser.close()
server.close()
console.log(fehler ? `\n=== ${fehler} Fehler ===\n` : '\n=== alles bestanden ===\n')
process.exit(fehler ? 1 : 0)
