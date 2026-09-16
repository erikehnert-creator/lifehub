/**
 * Der Weg von der alten auf die neue Fassung – mit echten Daten dazwischen.
 *
 * Die Unit-Tests und die übrigen Browser-Prüfungen starten immer mit einer
 * leeren Datenbank. Genau der Fall, der in der Wirklichkeit vorkommt, bleibt
 * dabei ungeprüft: Auf Eriks Geräten liegt eine Datenbank nach Migration 7,
 * voll mit Buchungen, Aufgaben und Messwerten. Migration 8 muss darauf laufen,
 * ohne dass etwas verlorengeht.
 *
 * Ablauf:
 *   1. ALTE Fassung (aus Git, vor diesem Update) in einem dauerhaften
 *      Browserprofil öffnen und Daten anlegen.
 *   2. Dasselbe Profil mit der NEUEN Fassung öffnen.
 *   3. Nachsehen, ob die Daten noch da sind und die neuen Felder existieren.
 *
 * Welche Fassung die „alte" ist, sucht der Test selbst: die jüngste, deren
 * `src/db/schema.ts` eine NIEDRIGERE höchste Migrationsnummer hatte als HEAD.
 * Ein festes HEAD~1 wäre nur an dem einen Tag richtig, an dem die Migration
 * entsteht – sobald ein weiterer Commit darauf liegt, prüfte der Test die
 * neue Fassung gegen sich selbst und wäre still bedeutungslos geworden.
 *
 * Aufruf:  node tests/migration-e2e.mjs
 *          LIFEHUB_MIGRATION_BASIS=<commit> node tests/migration-e2e.mjs
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const datei = (p) => 'file:///' + p.split(path.sep).join('/')

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name} ${zusatz}`)
  else { console.log(`  FEHL ${name} ${zusatz}`); fehler++ }
}

async function warteAufApp(p, ms = 60000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(300)
  }
  return false
}

/**
 * Spalten von food_entries, gelesen aus der Datei, die die App wirklich in
 * IndexedDB abgelegt hat – nicht aus dem, was eine Ansicht davon zeigt.
 */
async function nahrungsSpalten(p) {
  const bytes = await p.evaluate(async () => {
    const idb = await new Promise((ok, nein) => {
      const r = indexedDB.open('lifehub'); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error)
    })
    const wert = await new Promise((ok, nein) => {
      const r = idb.transaction('files').objectStore('files').get('lifehub.db')
      r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error)
    })
    idb.close()
    return wert ? Array.from(new Uint8Array(wert)) : null
  })
  if (!bytes) return []
  const SQL = await (await import('sql.js')).default()
  const db = new SQL.Database(new Uint8Array(bytes))
  const res = db.exec('PRAGMA table_info(food_entries)')
  db.close()
  return res.length ? res[0].values.map((r) => String(r[1])) : []
}

/** Höchste Migrationsnummer in einer Fassung von src/db/schema.ts. */
function hoechsteMigration(inhalt) {
  const treffer = [...inhalt.matchAll(/^\s*id:\s*(\d+),\s*$/gm)].map((m) => Number(m[1]))
  return treffer.length ? Math.max(...treffer) : 0
}

/**
 * Die jüngste Fassung mit niedrigerer Migrationsnummer als HEAD – also genau
 * die, die auf den Geräten liegt, bevor dieses Update ankommt.
 */
function basisFassung() {
  if (process.env.LIFEHUB_MIGRATION_BASIS) return process.env.LIFEHUB_MIGRATION_BASIS.trim()

  const jetzt = hoechsteMigration(fs.readFileSync(path.join(WURZEL, 'src/db/schema.ts'), 'utf8'))
  const commits = execSync('git log --format=%H -- src/db/schema.ts', { cwd: WURZEL })
    .toString().trim().split(String.fromCharCode(10)).filter(Boolean)

  for (const c of commits) {
    let schema
    try {
      schema = execSync(`git show ${c}:src/db/schema.ts`, { cwd: WURZEL, maxBuffer: 16 * 1024 * 1024 }).toString()
    } catch { continue }
    if (hoechsteMigration(schema) >= jetzt) continue
    // Nur brauchbar, wenn diese Fassung auch eine gebaute LifeHub.html mitbringt.
    try {
      execSync(`git cat-file -e ${c}:LifeHub.html`, { cwd: WURZEL })
      return c
    } catch { /* weiter in die Vergangenheit */ }
  }
  throw new Error(
    `Keine Fassung mit einer Migration unter ${jetzt} gefunden – ` +
    'Basis per LIFEHUB_MIGRATION_BASIS=<commit> vorgeben.',
  )
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-mig-'))
  const alt = path.join(tmp, 'LifeHub-alt.html')
  const profil = path.join(tmp, 'profil')

  // Die Fassung VOR diesem Update aus der Versionsgeschichte holen.
  const vorher = basisFassung()
  fs.writeFileSync(alt, execSync(`git show ${vorher}:LifeHub.html`, {
    cwd: WURZEL, maxBuffer: 64 * 1024 * 1024,
  }))
  console.log(`\n=== Migration von ${vorher.slice(0, 7)} auf HEAD ===\n`)
  console.log(`  alte Fassung: ${(fs.statSync(alt).size / 1048576).toFixed(2)} MB`)

  /* ------------------------------------------- 1. Alte Fassung, Daten anlegen */
  let ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  let p = ctx.pages()[0] ?? await ctx.newPage()
  await p.goto(datei(alt))
  pruefe('Alte Fassung startet', await warteAufApp(p))
  await p.waitForTimeout(3000)

  // Eine Aufgabe und eine Buchung anlegen – Daten, die die Migration überleben muss.
  await p.locator('.fab, button:has-text("+ Erfassen")').first().click()
  await p.waitForTimeout(400)
  await p.locator('button:has-text("Aufgabe")').first().click()
  await p.waitForTimeout(400)
  await p.locator('.modal input.input').first().fill('Altdatenaufgabe')
  await p.locator('.modal button:has-text("Aufgabe")').last().click()
  await p.waitForTimeout(1000)

  // Buchung: Der Betrag läuft über die Kasseneingabe (Ziffern wandern von
  // rechts herein), „Händler" ist das erste gewöhnliche Textfeld.
  await p.locator('.fab, button:has-text("+ Erfassen")').first().click()
  await p.waitForTimeout(400)
  await p.locator('button:has-text("Buchung")').first().click()
  await p.waitForTimeout(600)
  await p.locator('.modal input').first().click()
  await p.keyboard.type('4242')
  await p.locator('.modal input.input:not([type=date]):not([type=file])').nth(1).fill('Altdatenbuchung')
  await p.locator('.modal button:has-text("Speichern")').last().click()
  await p.waitForTimeout(1500)

  // Nachsehen, wo die Daten wirklich stehen – die Heute-Seite zeigt nicht
  // alles, und ein „nicht sichtbar" hier wäre kein Beweis für „nicht da".
  await p.goto(datei(alt) + '#/plan/alle')
  await p.reload(); await warteAufApp(p); await p.waitForTimeout(2000)
  const hatAufgabe = (await p.evaluate(() => document.body.innerText)).includes('Altdatenaufgabe')
  await p.goto(datei(alt) + '#/finanzen/buchungen')
  await p.reload(); await warteAufApp(p); await p.waitForTimeout(2000)
  const hatBuchung = (await p.evaluate(() => document.body.innerText)).includes('Altdatenbuchung')
  pruefe('Aufgabe in der alten Fassung angelegt', hatAufgabe)
  pruefe('Buchung in der alten Fassung angelegt', hatBuchung)

  // Sauber schließen, damit die Datenbank wirklich in IndexedDB liegt.
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await p.waitForTimeout(2500)
  const spaltenAlt = await nahrungsSpalten(p)
  await ctx.close()

  /* ------------------------------------- 2. Dasselbe Profil, neue Fassung */
  ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  p = ctx.pages()[0] ?? await ctx.newPage()
  const fehlerListe = []
  p.on('pageerror', (e) => fehlerListe.push(String(e)))
  p.on('console', (m) => { if (m.type() === 'error') fehlerListe.push(m.text()) })

  // Der Dateiname muss derselbe sein, sonst ist es für den Browser eine
  // andere Herkunft und die alte Datenbank wäre gar nicht sichtbar.
  fs.copyFileSync(path.join(WURZEL, 'LifeHub.html'), alt)
  await p.goto(datei(alt))
  pruefe('Neue Fassung startet auf der alten Datenbank', await warteAufApp(p))
  await p.waitForTimeout(4000)

  /* ------------------------------------------------ 3. Alles noch da? */
  await p.goto(datei(alt) + '#/plan/alle')
  await p.reload()
  await warteAufApp(p)
  await p.waitForTimeout(2500)
  const text = await p.evaluate(() => document.body.innerText)
  pruefe('Aufgabe aus der alten Fassung ist noch da', text.includes('Altdatenaufgabe'))

  await p.goto(datei(alt) + '#/finanzen/buchungen')
  await p.reload()
  await warteAufApp(p)
  await p.waitForTimeout(2500)
  const fin = await p.evaluate(() => document.body.innerText)
  pruefe('Buchung aus der alten Fassung ist noch da', fin.includes('Altdatenbuchung'))

  /* ------------------------------- 4. Die neuen Felder sind wirklich da */
  await p.goto(datei(alt) + '#/plan/vorlagen')
  await p.reload()
  await warteAufApp(p)
  await p.waitForTimeout(2000)
  await p.locator('button:has-text("+ Vorlage")').first().click()
  await p.waitForTimeout(600)
  const hatZeit = await p.locator('.modal input[type=time]').count() > 0
  pruefe('Neue Spalte scheduled_time ist nutzbar', hatZeit)
  if (hatZeit) {
    await p.locator('.modal input.input').first().fill('Nach der Migration')
    await p.locator('.modal input[type=time]').first().fill('06:45')
    await p.locator('.modal button:has-text("Speichern")').first().click()
    await p.waitForTimeout(12000)
    const nachher = await p.evaluate(() => document.body.innerText)
    pruefe('Automatik plant auf der migrierten Datenbank ein', nachher.includes('06:45'),
      nachher.includes('Nach der Migration') ? '' : '(Vorlage nicht gespeichert)')
  }

  // Ernährungsseite rührt die neue Tabelle food_entries an.
  await p.goto(datei(alt) + '#/tracking')
  await p.reload()
  await warteAufApp(p)
  await p.waitForTimeout(2500)
  const tr = await p.evaluate(() => document.body.innerText)
  pruefe('Neue Tabelle food_entries ist ansprechbar', tr.includes('Gegessen'))
  pruefe('Neue Metrik Ballaststoffe ist da', tr.includes('Ballaststoffe'))

  // Die Nährwert-Spalten müssen am Ende genau die sein, die der Server kennt –
  // auch wenn die alte Fassung eine andere Migration 10 mitbrachte (altstand.ts).
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await p.waitForTimeout(2500)
  const spaltenNeu = await nahrungsSpalten(p)
  const server = fs.readFileSync(path.join(WURZEL, 'supabase/migrations/0001_init.sql'), 'utf8')
  const unbekannt = spaltenNeu.filter((s) => !s.startsWith('_') && !new RegExp(`\\b${s}\\b`).test(server))
  if (spaltenAlt.includes('trans_fat_g')) console.log('  (alte Fassung trug die fremde Migration 10)')
  pruefe('food_entries hat nur Spalten, die der Server kennt', spaltenNeu.length > 0 && unbekannt.length === 0,
    unbekannt.join(', '))
  pruefe('Nährwert-Spalten der gültigen Migration 10 sind da',
    ['poly_fat_g', 'mono_fat_g', 'vitamin_a_ug'].every((s) => spaltenNeu.includes(s)))

  const echte = fehlerListe.filter((x) =>
    !/favicon|manifest|sw\.js|ServiceWorker|ERR_FILE_NOT_FOUND/i.test(x))
  pruefe('Keine Fehler beim Migrieren', echte.length === 0, echte.slice(0, 3).join(' | '))

  await ctx.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== ${fehler === 0 ? 'alles bestanden' : fehler + ' Prüfung(en) fehlgeschlagen'} ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
