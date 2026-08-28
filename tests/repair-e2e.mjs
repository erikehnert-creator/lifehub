/**
 * Der Weg aus der Dublettenlage – so, wie Erik ihn gehen muss.
 *
 * Ausgangslage nachgestellt: Zwei frische Geräte, beide ohne echte Daten,
 * beide haben ihre Beispielkonten auf den Server geschoben. Danach:
 *   1. Server leeren
 *   2. PC: Excel-Daten einspielen, "Diesen Bestand auf den Server laden"
 *   3. Handy: "Dieses Gerät vom Server befüllen"
 *   4. Probe: Änderung am Handy taucht am PC auf – ohne Knopfdruck
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import pg from 'pg'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SUPA = 'http://127.0.0.1:54321'
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0])
  const file = path.join('/home/claude/lifehub/app/dist', rel === '/' ? 'index.html' : rel)
  if (!file.startsWith('/home/claude/lifehub/app/dist') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nicht gefunden'); return
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(file))
})
await new Promise((r) => site.listen(8081, r))

const pool = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'test', database: 'postgres', port: 5432 })

const fails = []
const norm = (v) => String(v).replace(/ /g, ' ').trim()
const pruefe = (name, ist, soll) => {
  const ok = norm(ist) === norm(soll)
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${name}: ${ist}${ok ? '' : `  (erwartet: ${soll})`}`)
  if (!ok) fails.push(name)
}

async function starte(name, url, viewport) {
  const dir = `/tmp/rep-${name}`
  fs.rmSync(dir, { recursive: true, force: true })
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: EXE, viewport })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url)
  await page.waitForSelector('#root > *', { timeout: 40000 })
  await page.waitForTimeout(2500)
  return { ctx, page, url, errors, name }
}
const geh = async (d, hash) => { await d.page.goto(d.url + '#' + hash); await d.page.waitForTimeout(1200) }

async function anmelden(d) {
  await geh(d, '/einstellungen/sync')
  await d.page.locator('input[placeholder*="supabase.co"]').fill(SUPA)
  await d.page.locator('input[placeholder*="supabase.co"]').blur()
  await d.page.waitForTimeout(300)
  const felder = d.page.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON)
  await felder.nth(1).blur()
  await d.page.waitForTimeout(500)
  await d.page.locator('input[type=email]').fill(MAIL)
  await d.page.locator('input[type=password]').fill(PASS)
  await d.page.locator('button', { hasText: 'Anmelden' }).click()
  await d.page.waitForTimeout(2500)
  return (await d.page.innerText('#root')).includes('angemeldet als')
}

async function warteAufMeldung(d, sekunden = 90) {
  for (let i = 0; i < sekunden; i++) {
    await d.page.waitForTimeout(1000)
    const t = await d.page.innerText('#root')
    const m = t.match(/(Synchronisiert:[^\n]*|Vom Server übernommen:[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
    if (m) return m[1]
  }
  return '(keine Rückmeldung)'
}

const kontenZahl = async (d) => {
  await geh(d, '/finanzen/konten')
  await d.page.waitForTimeout(1500)
  // Konten werden als Karten dargestellt; gezählt wird der Kontoname je Karte.
  return await d.page.locator('.card .list-title').count()
}
const vermoegen = async (d) => {
  await geh(d, '/finanzen')
  await d.page.waitForTimeout(1500)
  return ((await d.page.innerText('#root')).match(/Gesamtvermögen\s*\n?\s*([^\n]+)/) || ['', '—'])[1]
}

/* =============================================== Ausgangslage nachstellen */

console.log('\n0) Zwei frische Geräte, beide schieben ihre Beispielkonten hoch')
const pc = await starte('pc', 'file:///home/claude/lifehub/LifeHub.html', { width: 1280, height: 900 })
const handy = await starte('handy', 'http://127.0.0.1:8081/', { width: 390, height: 844 })
pruefe('PC angemeldet', await anmelden(pc), 'true')
pruefe('Handy angemeldet', await anmelden(handy), 'true')

// Beide wählen (falsch) "mein Bestand" – so entsteht die Dublettenlage
for (const d of [pc, handy]) {
  await geh(d, '/einstellungen/sync')
  await d.page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).click()
  await d.page.waitForTimeout(600)
  await d.page.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
  console.log(`   ${d.name} →`, await warteAufMeldung(d))
}
const kontenAufServer = async () => (await pool.query('SELECT count(*)::int AS n FROM accounts WHERE deleted_at IS NULL')).rows[0].n
console.log('   Konten auf dem Server jetzt:', await kontenAufServer(), '(doppelt – genau die Lage von Erik)')

/* ============================================================ Reparatur */

console.log('\n1) Server leeren')
const tabellen = (await pool.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename)
await pool.query(`TRUNCATE ${tabellen.map((t) => `"${t}"`).join(', ')}`)
pruefe('Server ist leer', await kontenAufServer(), '0')

console.log('\n2) PC: Excel-Daten einspielen')
await geh(pc, '/einstellungen')
await pc.page.locator('button', { hasText: 'Daten & Backup' }).first().click()
await pc.page.waitForTimeout(500)
await pc.page.locator('input[type=file][accept*="json"]').first().setInputFiles('/home/claude/lifehub/LifeHub-Daten-Erik.json')
await pc.page.waitForTimeout(1500)
await pc.page.locator('.modal .btn-primary').first().click()
await pc.page.waitForTimeout(4500)
pruefe('PC Gesamtvermögen', await vermoegen(pc), '15.106 €')
pruefe('PC Konten einfach', await kontenZahl(pc), '6')

console.log('\n3) PC: Erstverbindung zurücksetzen und als Quelle hochladen')
await geh(pc, '/einstellungen/sync')
await pc.page.locator('button', { hasText: 'Erstverbindung zurücksetzen' }).first().click()
await pc.page.waitForTimeout(500)
await pc.page.locator('button', { hasText: /^Zurücksetzen$/ }).first().click()
await pc.page.waitForTimeout(1200)
await pc.page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).click()
await pc.page.waitForTimeout(600)
await pc.page.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
console.log('   PC →', await warteAufMeldung(pc))
pruefe('Server hat 6 Konten', await kontenAufServer(), '6')

console.log('\n4) Handy: zurücksetzen und vom Server befüllen')
await geh(handy, '/einstellungen/sync')
await handy.page.locator('button', { hasText: 'Erstverbindung zurücksetzen' }).first().click()
await handy.page.waitForTimeout(500)
await handy.page.locator('button', { hasText: /^Zurücksetzen$/ }).first().click()
await handy.page.waitForTimeout(1200)
await handy.page.locator('button', { hasText: 'Dieses Gerät vom Server befüllen' }).click()
await handy.page.waitForTimeout(600)
await handy.page.locator('.modal button', { hasText: 'Vom Server befüllen' }).click()
console.log('   Handy →', await warteAufMeldung(handy))
pruefe('Handy Gesamtvermögen', await vermoegen(handy), '15.106 €')
pruefe('Handy Konten einfach', await kontenZahl(handy), '6')

console.log('\n5) Von selbst abgleichen – ohne einen Knopf zu drücken')
await geh(handy, '/finanzen')
await handy.page.locator('.fab, button.fab').first().click()
await handy.page.waitForTimeout(800)
await handy.page.locator('.modal button', { hasText: 'Ausgabe' }).first().click()
await handy.page.waitForTimeout(700)
for (const k of ['4', '2']) {
  await handy.page.locator('.numpad button', { hasText: new RegExp('^' + k + '$') }).first().click()
}
await handy.page.locator('button', { hasText: 'Weitere Angaben' }).click()
await handy.page.waitForTimeout(400)
await handy.page.locator('input[placeholder*="REWE"]').fill('Ohne Knopfdruck')
await handy.page.locator('.modal button', { hasText: /^Speichern$/ }).last().click()
await handy.page.waitForTimeout(1800)
await geh(handy, '/finanzen/buchungen')
await handy.page.waitForTimeout(1500)
pruefe('Buchung am Handy angelegt',
  (await handy.page.innerText('#root')).includes('Ohne Knopfdruck'), 'true')

// Nur warten – nichts anklicken. Das Handy muss von allein senden.
let angekommen = false
for (let i = 0; i < 40 && !angekommen; i++) {
  await handy.page.waitForTimeout(1000)
  const n = (await pool.query(
    "SELECT count(*)::int AS n FROM transactions WHERE merchant = 'Ohne Knopfdruck'")).rows[0].n
  angekommen = n > 0
}
pruefe('Handy sendet von allein', angekommen, 'true')

// Und der PC holt es von allein – nur die Seite offen lassen
await geh(pc, '/finanzen/buchungen')
let beimPC = false
for (let i = 0; i < 40 && !beimPC; i++) {
  await pc.page.waitForTimeout(1000)
  beimPC = (await pc.page.innerText('#root')).includes('Ohne Knopfdruck')
}
pruefe('PC holt von allein', beimPC, 'true')

console.log('\n6) Anzeige "abgeglichen vor …"')
const seitenleiste = await pc.page.locator('.sidebar').innerText()
pruefe('PC zeigt einen erfolgten Abgleich an',
  /(gerade abgeglichen|abgeglichen vor)/.test(seitenleiste), 'true')

console.log('\nJS-Fehler PC   :', pc.errors.length, pc.errors.slice(0, 3))
console.log('JS-Fehler Handy:', handy.errors.length, handy.errors.slice(0, 3))
await pc.ctx.close(); await handy.ctx.close(); site.close(); await pool.end()
console.log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlle Prüfungen bestanden.')
process.exit(fails.length ? 1 : 0)
