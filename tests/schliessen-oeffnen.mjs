/**
 * Am Handy etwas eintragen und die App im selben Moment wegwischen –
 * überlebt der Eintrag das, und geht er beim nächsten Öffnen von allein raus?
 *
 * Nachgestellt wird das echte Wegwischen: erst meldet der Browser, dass die
 * App in den Hintergrund geht, dann wird sie geschlossen – ohne die übliche
 * kurze Sammelpause abzuwarten.
 *
 * Der Weg zurück zum PC wird in tests/repair-e2e.mjs geprüft.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import pg from 'pg'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join('/home/claude/lifehub/app/dist', rel === '/' ? 'index.html' : rel)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
await new Promise((r) => site.listen(8081, r))
const pool = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'test', database: 'postgres', port: 5432 })

const fails = []
const pruefe = (name, ist, soll) => {
  const ok = String(ist) === String(soll)
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${name}: ${ist}${ok ? '' : `  (erwartet: ${soll})`}`)
  if (!ok) fails.push(name)
}

/** Der Nachbau vergisst Anmeldungen beim Neustart – hier neu anmelden. */
async function anmelden(page, basis) {
  await page.goto(basis + '#/einstellungen/sync')
  await page.waitForTimeout(1200)
  if ((await page.locator('input[type=email]').count()) === 0) return 'war angemeldet'
  await page.locator('input[type=email]').fill('erik@test.de')
  await page.locator('input[type=password]').fill('geheim123')
  await page.locator('button', { hasText: 'Anmelden' }).click()
  await page.waitForTimeout(2500)
  return (await page.innerText('#root')).includes('angemeldet als') ? 'neu angemeldet' : 'FEHLGESCHLAGEN'
}

const oeffneHandy = async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/rep-handy', {
    executablePath: EXE, viewport: { width: 390, height: 844 },
  })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  await page.goto('http://127.0.0.1:8081/#/heute')
  await page.waitForSelector('#root > *', { timeout: 40000 })
  await page.waitForTimeout(3500)
  return { ctx, page }
}

console.log('\n1) Am Handy eine Buchung erfassen und SOFORT schließen')
let h = await oeffneHandy()
console.log('   Handy:', await anmelden(h.page, 'http://127.0.0.1:8081/'))
await h.page.goto('http://127.0.0.1:8081/#/finanzen')
await h.page.waitForTimeout(1500)
await h.page.locator('.fab, button.fab').first().click()
await h.page.waitForTimeout(800)
await h.page.locator('.modal button', { hasText: 'Ausgabe' }).first().click()
await h.page.waitForTimeout(700)
for (const k of ['9', '9']) {
  await h.page.locator('.numpad button', { hasText: new RegExp('^' + k + '$') }).first().click()
}
await h.page.locator('button', { hasText: 'Weitere Angaben' }).click()
await h.page.waitForTimeout(400)
await h.page.locator('input[placeholder*="REWE"]').fill('Zugewischt')
await h.page.locator('.modal button', { hasText: /^Speichern$/ }).last().click()

// So wie am iPhone: erst wandert die App in den Hintergrund (das meldet der
// Browser), dann wird sie weggewischt. Bewusst ohne Wartezeit dazwischen.
await h.page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pagehide'))
})
await h.page.waitForTimeout(400)
await h.ctx.close()
console.log('   App in den Hintergrund geschickt und sofort weggewischt')

const aufServer = async (name) =>
  (await pool.query('SELECT count(*)::int n FROM transactions WHERE merchant=$1', [name])).rows[0].n
// Ob schon übertragen oder nicht, ist hier egal – geprüft wird, dass die
// Buchung den Neustart überlebt und am Ende überall ankommt.
console.log('   Auf dem Server bereits vorhanden:', await aufServer('Zugewischt'))

console.log('\n2) Handy wieder öffnen – nur öffnen, nichts anklicken')
h = await oeffneHandy()
const lokalDa = (await h.page.locator('#root').innerText()).length > 0
await h.page.goto('http://127.0.0.1:8081/#/finanzen/buchungen')
await h.page.waitForTimeout(2000)
pruefe('Buchung ist nach dem Neustart noch da',
  (await h.page.innerText('#root')).includes('Zugewischt'), 'true')

let hoch = false
for (let i = 0; i < 40 && !hoch; i++) {
  await h.page.waitForTimeout(1000)
  hoch = (await aufServer('Zugewischt')) > 0
}
pruefe('Beim Öffnen von allein hochgeladen', hoch, 'true')

console.log('\nHinweis: Dass die Änderung anschließend auch am PC ankommt, prüft')
console.log('tests/repair-e2e.mjs – dort mit frischen Geräten und sauberem Server.')

await h.ctx.close(); site.close(); await pool.end()
console.log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlle Prüfungen bestanden.')
process.exit(fails.length ? 1 : 0)
