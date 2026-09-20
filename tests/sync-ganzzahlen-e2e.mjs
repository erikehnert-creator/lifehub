/**
 * Der Fehler „metrics: 400 / 22P02", einmal vollständig nachgestellt.
 *
 * Die Unit-Tests prüfen die Teile: den Seed-Wert, Migration 9, das Erkennen
 * beim Senden. Was sie NICHT prüfen können, ist der Weg, auf dem Erik den
 * Fehler tatsächlich gesehen hat – eine bestehende Datenbank auf dem Gerät,
 * ein Server, der Ganzzahlen ernst nimmt, und ein Abgleich dazwischen.
 *
 * Ablauf:
 *   1. ALTE Fassung (aus Git) in einem dauerhaften Browserprofil öffnen.
 *      Sie legt Ballaststoffe mit Sortierwert 23.5 an – so, wie es auf Eriks
 *      Geräten steht.
 *   2. Abgleich gegen den strengen Server: metrics MUSS scheitern. Ohne diesen
 *      Schritt wüsste man nicht, ob der Nachbau streng genug ist, und der
 *      Test wäre grün, ohne je etwas bewiesen zu haben.
 *   3. NEUE Fassung auf demselben Profil: Migration 9 läuft.
 *   4. Abgleich erneut: jetzt muss er durchgehen, der Server die Zeile haben,
 *      der Sortierwert ganzzahlig sein, nichts doppelt und nichts verloren.
 *
 * Der Server ist bewusst ein eigener, kleiner Nachbau statt eines echten
 * Postgres: Die Typen liest er aus `supabase/migrations/0001_init.sql` – also
 * aus derselben Datei, die Erik im SQL-Editor ausführt – und weist genau das
 * zurück, was PostgreSQL zurückweist, mit demselben Code 22P02. Damit läuft
 * die Prüfung überall, auch in GitHub Actions, ohne Datenbankinstallation.
 *
 * Aufruf:  node tests/sync-ganzzahlen-e2e.mjs
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { starteNachbau, ganzzahlSpalten, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const datei = (p) => 'file:///' + p.split(path.sep).join('/')
const PORT = 54399
const SUPA = `http://127.0.0.1:${PORT}`

let fehler = 0
const pruefe = (name, ok, zusatz = '') => {
  if (ok) console.log(`  OK   ${name}${zusatz ? ' – ' + zusatz : ''}`)
  else { console.log(`  FEHL ${name}${zusatz ? ' – ' + zusatz : ''}`); fehler++ }
}

/* --------------------------------------------- Der strenge Server-Nachbau */

/**
 * Der Nachbau liegt in `_supabase-nachbau.mjs` – dieselbe Fassung, die auch
 * sync-e2e benutzt. Vorher stand er hier ein zweites Mal wörtlich im Text.
 */
const INT = ganzzahlSpalten()
let nachbau                       // wird in main() gestartet
let tabellen, abgelehnt

/* ---------------------------------------------------- Ablauf im Browser */

async function warteAufApp(p, ms = 60000) {
  const bis = Date.now() + ms
  while (Date.now() < bis) {
    if (await p.$('.page')) return true
    await p.waitForTimeout(300)
  }
  return false
}

const geh = async (p, url, hash) => { await p.goto(url + '#' + hash); await p.waitForTimeout(1500) }

async function anmelden(p, url) {
  await geh(p, url, '/einstellungen/sync')
  // Ist ein Server fest eingebaut (src/sync/config.ts), liegen die Felder für
  // eine andere Verbindung hinter einem Aufklapper. Ohne diesen Klick findet
  // der Test das Eingabefeld nicht und liefe in eine Zeitüberschreitung.
  const aufklapper = p.locator('text=Andere Server-Verbindung nutzen')
  if (await aufklapper.count()) { await aufklapper.first().click(); await p.waitForTimeout(500) }

  const feld = p.locator('input[placeholder*="supabase.co"]')
  await feld.fill(SUPA); await feld.blur(); await p.waitForTimeout(400)
  const felder = p.locator('.card', { hasText: 'Server' }).locator('input')
  await felder.nth(1).fill(ANON); await felder.nth(1).blur(); await p.waitForTimeout(600)
  await p.locator('input[type=email]').fill(MAIL)
  await p.locator('input[type=password]').fill(PASS)
  await p.locator('button', { hasText: 'Anmelden' }).click()
  await p.waitForTimeout(3000)
  return (await p.innerText('#root')).includes('angemeldet als')
}

async function abgleich(p, url) {
  await geh(p, url, '/einstellungen/sync')
  const erst = p.locator('button', { hasText: 'Diesen Bestand auf den Server laden' })
  if (await erst.count()) {
    await erst.click(); await p.waitForTimeout(800)
    await p.locator('.modal button', { hasText: 'Auf den Server laden' }).click()
  } else {
    await p.locator('button', { hasText: 'Jetzt synchronisieren' }).click()
  }
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000)
    const t = await p.innerText('#root')
    const m = t.match(/(Synchronisiert:[^\n]*|Teilweise synchronisiert[^\n]*|Auf den Server geladen:[^\n]*|Synchronisation fehlgeschlagen:[^\n]*)/)
    if (m) return m[1]
  }
  return '(keine Rückmeldung)'
}

/** Die Fassung vor Migration 9 – gesucht wie in migration-e2e.mjs. */
/**
 * Die Fassung, die den Fehler noch hatte – fest eingetragen, mit Absicht.
 *
 * migration-e2e sucht seinen Altstand dynamisch (die juengste Fassung mit
 * niedrigerer Migrationsnummer), weil er allgemein prueft, dass Migrationen
 * Daten ueberleben lassen. Dieser Test hier prueft etwas anderes: EINEN
 * bestimmten Fehler, "Ballaststoffe mit Sortierwert 23.5". Der steckt in
 * genau dieser Fassung und in keiner spaeteren.
 *
 * Dynamisch gesucht wanderte der Altstand mit jeder neuen Migration weiter
 * und waere ab Migration 10 bei einer Fassung gelandet, die den Fehler laengst
 * nicht mehr hat - Schritt 1 ("der Server MUSS ablehnen") schluege dann fehl,
 * ohne dass irgendetwas kaputt waere. Und ohne Schritt 1 waere nicht belegt,
 * dass der Server-Nachbau ueberhaupt streng genug ist.
 */
const BASIS_MIT_FEHLER = '89caf3f'

function basisFassung() {
  return (process.env.LIFEHUB_MIGRATION_BASIS || BASIS_MIT_FEHLER).trim()
}

async function main() {
  nachbau = await starteNachbau({ port: PORT, ganzzahlen: true })
  tabellen = nachbau.tabellen
  abgelehnt = nachbau.abgelehnt

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-sync-'))
  const alt = path.join(tmp, 'LifeHub-alt.html')
  const profil = path.join(tmp, 'profil')
  const vorher = basisFassung()
  fs.writeFileSync(alt, execSync(`git show ${vorher}:LifeHub.html`, {
    cwd: WURZEL, maxBuffer: 64 * 1024 * 1024,
  }))
  const neu = path.join(WURZEL, 'LifeHub.html')

  console.log(`\n=== Abgleich über die Migration hinweg (${vorher.slice(0, 7)} → HEAD) ===\n`)
  console.log(`  strenger Server auf ${SUPA}, Typen aus 0001_init.sql`)
  console.log(`  ganzzahlige Spalten in metrics: ${[...(INT.get('metrics') ?? [])].join(', ')}\n`)

  /* ------------------------------------------- 1. Alte Fassung, alter Wert */
  let ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  let p = ctx.pages()[0] ?? await ctx.newPage()
  await p.goto(datei(alt))
  pruefe('Alte Fassung startet', await warteAufApp(p))

  pruefe('Anmeldung am Testserver', await anmelden(p, datei(alt)))
  const meldung1 = await abgleich(p, datei(alt))
  pruefe('Der strenge Server weist metrics zurück',
    /metrics/.test(meldung1) && /400|22P02/.test(meldung1), meldung1.slice(0, 150))
  pruefe('Andere Tabellen kamen trotzdem an', tabellen.size > 3, `${tabellen.size} Tabellen`)
  pruefe('metrics liegt nicht auf dem Server', !(tabellen.get('metrics')?.size))
  await ctx.close()

  /* ----------------------------------------- 2. Neue Fassung, selbe Daten */
  ctx = await chromium.launchPersistentContext(profil, { viewport: { width: 1280, height: 900 } })
  p = ctx.pages()[0] ?? await ctx.newPage()
  const konsole = []
  p.on('pageerror', (e) => konsole.push(String(e)))
  await p.goto(datei(neu))
  pruefe('Neue Fassung startet auf derselben Datenbank', await warteAufApp(p))
  await p.waitForTimeout(2500)

  // Ab hier darf der Server nichts mehr zurückweisen. Der Zählerstand von
  // vorher ist der Vergleichspunkt – ohne ihn wüsste man nur, DASS abgelehnt
  // wurde, nicht ob es vor oder nach der Migration war.
  const ablehnungenVorher = abgelehnt.length

  const meldung2 = await abgleich(p, datei(neu))
  pruefe('Der Abgleich läuft jetzt durch',
    /^Synchronisiert:|^Auf den Server geladen:/.test(meldung2), meldung2.slice(0, 150))
  pruefe('Keine Tabelle mehr als fehlgeschlagen gemeldet', !/Fehlgeschlagen/.test(meldung2))

  const serverMetrics = tabellen.get('metrics')
  pruefe('metrics ist jetzt auf dem Server angekommen', (serverMetrics?.size ?? 0) > 0,
    `${serverMetrics?.size ?? 0} Zeilen`)

  const fiber = [...(serverMetrics?.values() ?? [])].filter((z) => z.key === 'fiber_g')
  pruefe('Ballaststoffe genau einmal auf dem Server – keine Dublette', fiber.length === 1,
    `${fiber.length} Zeile(n)`)
  pruefe('Der Sortierwert auf dem Server ist ganzzahlig',
    fiber.length === 1 && Number.isInteger(Number(fiber[0].sort_order)),
    fiber.length ? String(fiber[0].sort_order) : '—')

  pruefe('Der Server hat vor der Migration überhaupt abgelehnt', ablehnungenVorher > 0,
    `${ablehnungenVorher} Ablehnung(en) in Schritt 1`)
  pruefe('Nach der Migration lehnt der Server nichts mehr ab',
    abgelehnt.length === ablehnungenVorher,
    `${abgelehnt.length - ablehnungenVorher} neue Ablehnung(en)`)

  const wartend = await p.evaluate(() => {
    const t = document.body.innerText
    // Die Statuskarte nennt wartende Änderungen nur, wenn es welche gibt.
    // Fehlt die Karte selbst, ist das ein Fehler (-1) und kein „nichts wartet".
    const karte = [...document.querySelectorAll('.card')].some((c) => /^\s*Status/.test(c.textContent ?? ''))
    if (!karte) return -1
    const m = t.match(/([\d.]+) Änderungen warten auf Übertragung/)
    return m ? Number(m[1].replace(/\./g, '')) : 0
  })
  pruefe('Kein Eintrag bleibt in der Outbox hängen', wartend === 0, `Wartende Änderungen: ${wartend}`)

  // Zweiter Abgleich direkt hinterher: nichts Neues, nichts doppelt.
  const vorherZahl = serverMetrics?.size ?? 0
  const meldung3 = await abgleich(p, datei(neu))
  pruefe('Ein zweiter Abgleich läuft ebenfalls durch', /^Synchronisiert:/.test(meldung3),
    meldung3.slice(0, 120))
  pruefe('und legt auf dem Server nichts doppelt an',
    (tabellen.get('metrics')?.size ?? 0) === vorherZahl,
    `${tabellen.get('metrics')?.size} statt ${vorherZahl}`)

  pruefe('Keine Fehler in der Konsole', konsole.length === 0, konsole.slice(0, 2).join(' | '))

  await ctx.close()
  await nachbau.stop()

  console.log(fehler === 0 ? '\n=== alles bestanden ===\n' : `\n=== ${fehler} Prüfung(en) fehlgeschlagen ===\n`)
  process.exit(fehler === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await nachbau?.stop(); process.exit(1) })
