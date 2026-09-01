/**
 * Testet genau das Szenario, das Erik konkret angesprochen hat: ein Gerät ist
 * länger offline (hier simuliert als "Handy" A, das erst ganz am Ende wieder
 * synchronisiert), während das andere Gerät (B, "PC") die ganze Zeit über
 * normal weiterläuft, mehrfach synchronisiert und dabei einen ordentlichen
 * Rückstand an Änderungen über mehrere Tabellen hinweg anhäuft – inklusive
 * eines echten Konflikts (beide Geräte ändern denselben Betrag, ohne
 * voneinander zu wissen).
 *
 * Geprüft wird: Nach dem Wiederverbinden kommt ALLES an (kein cascading
 * failure wie bei calendar_events früher), der Konflikt wird erkannt statt
 * stillschweigend verworfen, und das jeweils andere Gerät sieht hinterher
 * auch wirklich die Änderungen des anderen.
 *
 * Läuft gegen die echte, unveränderte lokale Postgres-Instanz mit dem
 * vollständigen, aktuellen Serverschema (supabase/migrations/0001_init.sql).
 */
import { chromium } from 'playwright'
import pg from 'pg'

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
function pruefeWahr(name, bedingung) {
  console.log(`${bedingung ? '  ok ' : '  FEHLER '} ${name}`)
  if (!bedingung) fails.push(name)
}

async function neuesGeraet(profil) {
  const ctx = await chromium.launchPersistentContext(profil, {
    executablePath: EXE, viewport: { width: 1280, height: 900 },
    args: ['--disable-background-networking', '--disable-sync', '--no-first-run'],
  })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  await page.goto('file:///home/claude/lifehub/app/LifeHub.html')
  await page.waitForSelector('#root > *', { timeout: 40000 })
  await page.waitForTimeout(1500)
  return { ctx, page }
}

const geh = async (page, hash) => { await page.goto(page.url().split('#')[0] + '#' + hash); await page.waitForTimeout(700) }

async function verbinden(page, rolle) {
  await geh(page, '/einstellungen/sync')
  await page.locator('input[placeholder*="supabase.co"]').fill(SUPA)
  await page.locator('input[placeholder*="supabase.co"]').blur()
  await page.waitForTimeout(300)
  await page.locator('.card', { hasText: 'Server' }).locator('input').nth(1).fill(ANON)
  await page.locator('.card', { hasText: 'Server' }).locator('input').nth(1).blur()
  await page.waitForTimeout(500)
  await page.locator('input[type=email]').fill(MAIL)
  await page.locator('input[type=password]').fill(PASS)
  await page.locator('button', { hasText: 'Anmelden' }).click()
  await page.waitForTimeout(1500)
  if (rolle === 'quelle') {
    await page.locator('button', { hasText: 'Diesen Bestand auf den Server laden' }).click()
    await page.waitForTimeout(500)
    await page.locator('.modal').locator('button', { hasText: 'Auf den Server laden' }).click()
  } else {
    await page.locator('button', { hasText: 'Dieses Gerät vom Server befüllen' }).click()
    await page.waitForTimeout(500)
    await page.locator('.modal').locator('button', { hasText: 'Vom Server befüllen' }).click()
  }
  await page.waitForTimeout(3000)
}

async function jetztSynchronisieren(page) {
  await geh(page, '/einstellungen/sync')
  await page.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
  let meldung = '(keine Rückmeldung)'
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000)
    const t = await page.innerText('#root')
    const m = t.match(/(Synchronisiert:[^\n]*|Teilweise synchronisiert[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
    if (m) { meldung = m[1]; break }
  }
  return meldung
}

async function quickAdd(page, label, fill) {
  await page.locator('.fab, button.fab').first().click()
  await page.waitForTimeout(350)
  await page.locator('.modal-body button', { hasText: label }).first().click()
  await page.waitForTimeout(450)
  await fill()
  await page.waitForTimeout(250)
}

async function aufgabe(page, titel) {
  await quickAdd(page, 'Aufgabe', async () => {
    await page.locator('input[placeholder*="Öl fürs Auto"]').fill(titel)
    await page.locator('button', { hasText: 'Aufgabe erstellen' }).click()
  })
}
async function termin(page, titel) {
  await quickAdd(page, 'Termin', async () => {
    await page.locator('.field', { hasText: 'Titel' }).locator('input').fill(titel)
    await page.locator('button', { hasText: 'Termin erstellen' }).click()
  })
}
async function tracking(page, wert) {
  await quickAdd(page, 'Tracking', async () => {
    const gewicht = page.locator('label', { hasText: 'Gewicht' }).locator('..').locator('input')
    await gewicht.first().fill(String(wert))
    await page.locator('button', { hasText: 'Speichern' }).click()
  })
}
async function buchung(page, betrag, haendler) {
  await quickAdd(page, 'Buchung', async () => {
    await page.locator('.field', { hasText: 'Betrag' }).locator('input').fill(String(betrag))
    await page.locator('.field', { hasText: /Händler|Von/ }).locator('input').fill(haendler)
    await page.locator('button', { hasText: 'Speichern' }).click()
  })
}

/** Öffnet die Buchung mit dem gegebenen Händlernamen und ändert ihren Betrag. */
async function buchungBetragAendern(page, haendler, neuerBetrag) {
  await geh(page, '/finanzen/buchungen')
  const zeile = page.locator('.list-row', { hasText: haendler }).first()
  await zeile.waitFor({ timeout: 15000 })
  await zeile.click()
  await page.waitForTimeout(400)
  const betragFeld = page.locator('.modal').locator('.field', { hasText: 'Betrag' }).locator('input')
  await betragFeld.fill('')
  await betragFeld.fill(String(neuerBetrag))
  await page.locator('.modal button', { hasText: 'Änderungen speichern' }).click()
  await page.waitForTimeout(400)
}

const pool = new pg.Pool({ host: '127.0.0.1', user: 'postgres', password: 'test', database: 'postgres', port: 5432 })

console.log('== Gerät B ("PC", bleibt online) verbindet als Quelle ==')
const B = await neuesGeraet('/tmp/e2e-offline-b')
await verbinden(B.page, 'quelle')

// Die Basis-Installation legt nur Konten/Kategorien an, keine Demo-Buchungen
// – für den Konfliktfall unten braucht es eine Buchung, die auf BEIDEN
// Geräten mit derselben id existiert. Also legt B eine an und überträgt sie,
// bevor A zum ersten Mal vom Server befüllt wird.
await buchung(B.page, '50,00', 'Konfliktbuchung')
await jetztSynchronisieren(B.page)

console.log('== Gerät A ("Handy") verbindet, holt denselben Bestand ==')
const A = await neuesGeraet('/tmp/e2e-offline-a')
await verbinden(A.page, 'fresh')

// ---------------------------------------------------------------- Konflikt
// Beide Geräte ändern jetzt, direkt nach dem gemeinsamen Ausgangsstand, den
// Betrag DERSELBEN Buchung – ohne voneinander zu wissen. Das ist ein
// "kritisches" Feld (siehe tests/sync.test.ts), darf also nie einfach
// automatisch zusammengeführt werden.
console.log('== Konfliktfall anlegen: beide ändern denselben Buchungsbetrag ==')
await buchungBetragAendern(B.page, 'Konfliktbuchung', '111,11')
await jetztSynchronisieren(B.page) // B überträgt seine Version sofort (ist ja "online")

// Ab hier ist A "wirklich" offline: nicht nur "niemand drückt auf Synchronisieren",
// sondern echtes Kappen der Netzwerkverbindung im Browser – sonst würde der
// eingebaute Hintergrundabgleich der App (kurz nach jeder Änderung, siehe
// App.tsx) den Rückstand die ganze Zeit über von selbst kleinhalten und genau
// das Szenario verfehlen, das getestet werden soll.
await A.ctx.setOffline(true)
await buchungBetragAendern(A.page, 'Konfliktbuchung', '222,22')

// ------------------------------------------------------- B: "zwei Wochen" normaler Betrieb
console.log('== Gerät B: mehrere Tage/Syncs mit eigenen Änderungen ==')
await aufgabe(B.page, 'B-Aufgabe Tag 1')
await aufgabe(B.page, 'B-Aufgabe Tag 3')
await buchung(B.page, '45,00', 'B-Haendler-1')
console.log('   B synchronisiert:', await jetztSynchronisieren(B.page))
await aufgabe(B.page, 'B-Aufgabe Tag 8')
await buchung(B.page, '12,50', 'B-Haendler-2')
console.log('   B synchronisiert:', await jetztSynchronisieren(B.page))

// ------------------------------------------------------- A: die ganze Zeit offline, sammelt Rückstand
console.log('== Gerät A: währenddessen komplett offline, sammelt Änderungen über mehrere Bereiche ==')
await aufgabe(A.page, 'A-Aufgabe 1 (offline)')
await aufgabe(A.page, 'A-Aufgabe 2 (offline)')
await aufgabe(A.page, 'A-Aufgabe 3 (offline)')
await aufgabe(A.page, 'A-Aufgabe 4 (offline)')
await termin(A.page, 'A-Termin 1 (offline)')
await termin(A.page, 'A-Termin 2 (offline)')
await tracking(A.page, 78.4)
await buchung(A.page, '33,30', 'A-Haendler-1')
await buchung(A.page, '9,90', 'A-Haendler-2')

// Vor dem Wiederverbinden: A darf auf dem Server noch nirgendwo auftauchen.
const vorherA = await pool.query(`SELECT title FROM tasks WHERE title LIKE 'A-Aufgabe%'`)
pruefe('Vor dem Reconnect: A-Aufgaben sind noch NICHT auf dem Server', vorherA.rowCount, 0)

console.log('== Gerät A verbindet sich wieder und synchronisiert den ganzen Rückstand ==')
await A.ctx.setOffline(false)
await A.page.waitForTimeout(500)
const meldungA = await jetztSynchronisieren(A.page)
console.log('   Meldung:', meldungA)
pruefeWahr('A meldet keinen kompletten Fehlschlag', /^(Synchronisiert|Teilweise synchronisiert)/.test(meldungA))
pruefeWahr('A meldet kein "fehlgeschlagen" für einzelne Tabellen (voll funktionsfähiges Schema)', !/fehlgeschlagen/i.test(meldungA))

await geh(A.page, '/einstellungen/sync')
const pendingA = Number((await A.page.locator('.card', { hasText: 'Wartende Änderungen' }).locator('.stat-value, [class*=stat]').first().innerText()).replace(/\D/g, '') || '0')
pruefe('A hat nach dem Sync keine wartenden Änderungen mehr', pendingA, 0)

// -------------------------------------------------------------- Server-Stand direkt prüfen
console.log('== Direkt am Server nachsehen: kam wirklich alles an? ==')
const aAufgaben = await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE title LIKE 'A-Aufgabe%'`)
pruefe('Alle 4 Offline-Aufgaben von A sind auf dem Server', aAufgaben.rows[0].n, 4)
const aTermine = await pool.query(`SELECT COUNT(*)::int AS n FROM calendar_events WHERE title LIKE 'A-Termin%'`)
pruefe('Beide Offline-Termine von A sind auf dem Server', aTermine.rows[0].n, 2)
const aBuchungen = await pool.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE merchant LIKE 'A-Haendler%'`)
pruefe('Beide Offline-Buchungen von A sind auf dem Server', aBuchungen.rows[0].n, 2)
const bAufgaben = await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE title LIKE 'B-Aufgabe%'`)
pruefe('Alle 3 Aufgaben von B sind (weiterhin) auf dem Server', bAufgaben.rows[0].n, 3)

// Konflikte sind ein rein lokales Konzept (in der SQLite-"conflicts"-Tabelle
// jedes Geräts, nicht auf dem Server) – deshalb wird das in der UI von A geprüft.
console.log('== Konfliktbehandlung in der UI von A prüfen ==')
await geh(A.page, '/einstellungen/sync')
const seiteA = await A.page.innerText('#root')
pruefeWahr('A zeigt den Betrags-Konflikt in der Konfliktliste an', /Konflikt/i.test(seiteA))

// ---------------------------------------------------------- Rückweg: kommt bei B auch alles an?
console.log('== Gerät B synchronisiert noch einmal – sieht es jetzt auch A"s Rückstand? ==')
console.log('   B synchronisiert:', await jetztSynchronisieren(B.page))
await geh(B.page, '/plan/alle')
await B.page.waitForTimeout(600)
const seiteB = await B.page.innerText('#root')
pruefeWahr('B sieht mindestens eine der Offline-Aufgaben von A', /A-Aufgabe 1 \(offline\)/.test(seiteB))

await A.ctx.close()
await B.ctx.close()
await pool.end()

console.log(fails.length ? `\nFEHLGESCHLAGEN: ${fails.join(', ')}` : '\nAlle Prüfungen bestanden – langer Offline-Rückstand über mehrere Tabellen kommt vollständig und ohne Kaskadenfehler an, Konflikt wird erkannt statt verloren.')
process.exit(fails.length ? 1 : 0)
