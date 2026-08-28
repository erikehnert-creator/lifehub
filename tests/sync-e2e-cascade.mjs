/**
 * Gezielter Test für genau den Fehler, den Erik gemeldet hat: Der
 * Server-Tabelle "calendar_events" fehlt eine Spalte, die die App schon
 * schreibt (end_day/reminder_minutes) – der Push für diese eine Tabelle
 * schlägt fehl. Vor der Reparatur riss das die GESAMTE Synchronisation ab,
 * sobald calendar_events an der Reihe war: jede Tabelle, die in
 * SYNCED_TABLES danach kommt (u. a. tasks, metric_entries), wurde in diesem
 * Lauf gar nicht mehr angefasst.
 *
 * Läuft gegen die echte, unveränderte lokale Postgres-Instanz, deren
 * calendar_events-Tabelle genau diese beiden Spalten fehlen (derselbe Stand
 * wie Eriks echter Server) – kein künstlich nachgebauter Fehler.
 */
import { chromium } from 'playwright'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SUPA = 'http://127.0.0.1:54321'
const ANON = 'anon-test-key'
const MAIL = 'erik@test.de'
const PASS = 'geheim123'

const fails = []
function pruefe(name, ist, soll) {
  const ok = String(ist) === String(soll)
  console.log(`${ok ? '  ok ' : '  FEHLER '} ${name}: ${ist}${ok ? '' : `  (erwartet: ${soll})`}`)
  if (!ok) fails.push(name)
}

const ctx = await chromium.launchPersistentContext('/tmp/e2e-cascade', { executablePath: EXE, viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0] ?? await ctx.newPage()
await page.goto('file:///home/claude/lifehub/app/LifeHub.html')
await page.waitForSelector('#root > *', { timeout: 40000 })
await page.waitForTimeout(2000)

const geh = async (hash) => { await page.goto(page.url().split('#')[0] + '#' + hash); await page.waitForTimeout(1000) }

// 1) Server verbinden + anmelden
await geh('/einstellungen/sync')
await page.locator('input[placeholder*="supabase.co"]').fill(SUPA)
await page.locator('input[placeholder*="supabase.co"]').blur()
await page.waitForTimeout(300)
await page.locator('.card', { hasText: 'Server' }).locator('input').nth(1).fill(ANON)
await page.locator('.card', { hasText: 'Server' }).locator('input').nth(1).blur()
await page.waitForTimeout(500)
await page.locator('input[type=email]').fill(MAIL)
await page.locator('input[type=password]').fill(PASS)
await page.locator('button', { hasText: 'Anmelden' }).click()
await page.waitForTimeout(2000)
pruefe('Angemeldet', (await page.innerText('#root')).includes('angemeldet als'), 'true')

// 2) Aufgabe, Termin und Tracking-Eintrag anlegen (genau die drei Bereiche
// aus Eriks Meldung: Aufgaben, Tracking, "was ich eintrage")
const quickAdd = async (label, fill) => {
  await page.locator('.fab, button.fab').first().click()
  await page.waitForTimeout(400)
  await page.locator('.modal-body button', { hasText: label }).first().click()
  await page.waitForTimeout(500)
  await fill()
  await page.waitForTimeout(300)
}

await quickAdd('Aufgabe', async () => {
  await page.locator('input[placeholder*="Öl fürs Auto"]').fill('Cascade-Test-Aufgabe')
  await page.locator('button', { hasText: 'Aufgabe erstellen' }).click()
})
await page.waitForTimeout(800)

await quickAdd('Termin', async () => {
  await page.locator('.field', { hasText: 'Titel' }).locator('input').fill('Cascade-Test-Termin')
  await page.locator('button', { hasText: 'Termin erstellen' }).click()
})
await page.waitForTimeout(800)

await quickAdd('Tracking', async () => {
  const gewicht = page.locator('label', { hasText: 'Gewicht' }).locator('..').locator('input')
  await gewicht.first().fill('77.7')
  await page.locator('button', { hasText: 'Speichern' }).click()
})
await page.waitForTimeout(800)

// 3) Abgleichen und die Meldung genau ansehen
await geh('/einstellungen/sync')
await page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).click().catch(() => {})
await page.waitForTimeout(400)
if (await page.locator('.modal button', { hasText: 'Auf den Server laden' }).count()) {
  await page.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
} else {
  await page.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
}
let meldung = '(keine Rückmeldung)'
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000)
  const t = await page.innerText('#root')
  const m = t.match(/(Synchronisiert:[^\n]*|Teilweise synchronisiert[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
  if (m) { meldung = m[1]; break }
}
console.log('   Meldung:', meldung)
pruefe('calendar_events wird namentlich als Fehler gemeldet', /calendar_events/.test(meldung), 'true')
pruefe('Push meldet trotzdem Erfolg für die anderen Tabellen (nicht "fehlgeschlagen" im Ganzen)',
  /^(Synchronisiert|Teilweise synchronisiert|Auf den Server geladen)/.test(meldung), 'true')

// 4) Direkt am Server nachsehen: sind Aufgabe und Tracking-Eintrag angekommen,
// obwohl calendar_events (danach in SYNCED_TABLES) fehlschlägt?
import pg from 'pg'
const pool = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'test', database: 'postgres', port: 5432 })
const taskRow = await pool.query(`SELECT title FROM tasks WHERE title = 'Cascade-Test-Aufgabe'`)
const metricRow = await pool.query(`SELECT value_num FROM metric_entries WHERE value_num = 77.7`)
const eventRow = await pool.query(`SELECT title FROM calendar_events WHERE title = 'Cascade-Test-Termin'`)
pruefe('Aufgabe ist auf dem Server angekommen (Tabelle NACH calendar_events)', taskRow.rowCount, 1)
pruefe('Tracking-Eintrag ist auf dem Server angekommen (Tabelle NACH calendar_events)', metricRow.rowCount, 1)
pruefe('Termin blieb wie erwartet lokal hängen (Server-Spalte fehlt)', eventRow.rowCount, 0)
await pool.end()

await ctx.close()
console.log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlle Prüfungen bestanden.')
process.exit(fails.length ? 1 : 0)
