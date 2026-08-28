/**
 * Prüft, ob die gehostete Fassung auch in einem Unterordner läuft –
 * genau so, wie GitHub Pages sie ausliefert (…github.io/lifehub/).
 * Zusätzlich: Registriert sich der Service Worker, und startet die App
 * anschließend ohne Netz?
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const ROOT = '/home/claude/lifehub/app/dist'
const PREFIX = '/lifehub'
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0])
  if (!rel.startsWith(PREFIX)) { res.writeHead(404); res.end('nicht gefunden'); return }
  rel = rel.slice(PREFIX.length) || '/'
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel)
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nicht gefunden'); return
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(8099, r))

const fails = []
const pruefe = (name, ist, soll) => {
  const ok = String(ist) === String(soll)
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${name}: ${ist}${ok ? '' : `  (erwartet: ${soll})`}`)
  if (!ok) fails.push(name)
}

const dir = '/tmp/pages-check'
fs.rmSync(dir, { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  viewport: { width: 390, height: 844 },
})
const page = ctx.pages()[0] ?? await ctx.newPage()
const fehler = []
const vierNullVier = []
page.on('pageerror', (e) => fehler.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()) })
page.on('response', (r) => { if (r.status() === 404) vierNullVier.push(r.url()) })

const URL_APP = `http://127.0.0.1:8099${PREFIX}/`
await page.goto(URL_APP)
await page.waitForSelector('#root > *', { timeout: 40000 })
await page.waitForTimeout(4000)

pruefe('App startet im Unterordner', (await page.innerText('#root')).includes('Finanzen'), 'true')
pruefe('Keine fehlenden Dateien (404)', vierNullVier.length, '0')
if (vierNullVier.length) console.log('   ', vierNullVier.slice(0, 5))

const sw = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration()
  return r ? (r.active ? 'aktiv' : 'registriert') : 'keiner'
})
pruefe('Service Worker', sw, 'aktiv')

const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? '-')
console.log('   Geltungsbereich:', scope)

// Daten anlegen, damit der Offline-Start etwas zu zeigen hat
await page.goto(URL_APP + '#/einstellungen')
await page.waitForTimeout(1500)

// Jetzt Netz kappen und neu laden
await ctx.setOffline(true)
await page.goto(URL_APP)
await page.waitForTimeout(500)
let offlineOk = false
try {
  await page.waitForSelector('#root > *', { timeout: 25000 })
  await page.waitForTimeout(3000)
  offlineOk = (await page.innerText('#root')).includes('Finanzen')
} catch { offlineOk = false }
pruefe('Startet auch ohne Internet', offlineOk, 'true')
await page.screenshot({ path: '/tmp/pages-offline.png' })

await ctx.setOffline(false)
console.log('JS-Fehler:', fehler.length, fehler.slice(0, 3))
await ctx.close(); server.close()
console.log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlles in Ordnung.')
process.exit(fails.length ? 1 : 0)
