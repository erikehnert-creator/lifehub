/**
 * Zwei Geräte, ein Server: der Abgleich einmal vollständig durchgespielt.
 *
 * ---------------------------------------------------------------------------
 * Was hier geprüft wird
 *
 *   1. Hinauf   PC lädt seinen Bestand auf den Server.
 *   2. Herunter Das Handy meldet sich an und holt ihn – dieselben Konten,
 *               dieselben Tagesarten, nichts doppelt.
 *   3. Zurück   Das Handy legt ein Konto an, der PC sieht es nach dem
 *               nächsten Abgleich.
 *   4. Rückstand Ein Gerät bleibt „offline", während das andere weiterarbeitet.
 *               Nach dem Wiederverbinden muss ALLES ankommen.
 *   5. Kein Dominoeffekt: Scheitert eine einzelne Tabelle, müssen die anderen
 *               trotzdem durchgehen. Genau das war einmal nicht so – als der
 *               Server-Tabelle `calendar_events` eine Spalte fehlte, fiel
 *               alles aus, was in SYNCED_TABLES danach kam (u. a. tasks und
 *               metric_entries), stillschweigend.
 *
 * ---------------------------------------------------------------------------
 * Was sich gegenüber der alten Fassung geändert hat
 *
 * Diese Prüfung ersetzt drei Skripte, die nirgends mehr liefen:
 * `sync-e2e.mjs` (alt), `sync-e2e-cascade.mjs` und
 * `sync-e2e-offline-backlog.mjs`. Sie brauchten ein echtes Postgres auf
 * 127.0.0.1:5432 mit fest eingetragenem Passwort, teils einen Server in einem
 * bestimmten kaputten Zustand – und `sync-e2e.mjs` zusätzlich einen Export von
 * Eriks ECHTEN Finanz- und Gesundheitsdaten, der zu Recht nicht im Repo liegt.
 *
 * Jetzt: der Nachbau aus `_supabase-nachbau.mjs` (kein Postgres, kein
 * Passwort) und der Bestand, den LifeHub beim ersten Start selbst anlegt
 * (keine echten Daten). Damit läuft die Prüfung auf jedem Rechner und in
 * GitHub Actions.
 *
 * Aufruf:  node tests/sync-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import {
  starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST,
} from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54398 })
const web = await starteWebserver(8087)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

/** Ein Konto über die Oberfläche anlegen – etwas, das man hinterher wiedererkennt. */
async function legeKontoAn(g, name) {
  await geh(g, '/finanzen/konten')
  await g.page.locator('button', { hasText: '+ Konto' }).first().click()
  await g.page.waitForTimeout(600)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1200)
}

/**
 * Einen Termin anlegen – damit `calendar_events` etwas zu senden hat.
 *
 * Über die Schnelleingabe, weil der Knopf dort auf jeder Seite erreichbar ist.
 * Der Knopf am Ende heisst „Termin erstellen", nicht „Speichern" – beim
 * Bearbeiten hiesse er anders.
 */
async function legeTerminAn(g, titel) {
  await geh(g, '/heute')
  await g.page.locator('.fab').first().click()
  await g.page.waitForTimeout(600)
  await g.page.locator('.modal button', { hasText: 'Termin' }).first().click()
  await g.page.waitForTimeout(600)
  await g.page.locator('.modal input').first().fill(titel)
  await g.page.locator('.modal button', { hasText: 'Termin erstellen' }).first().click()
  await g.page.waitForTimeout(1200)
}

async function kontoNamen(g) {
  await geh(g, '/finanzen/konten')
  const text = await g.page.innerText('#root')
  return text
}

let pc, handy
try {
  /* ------------------------------------------------- 1. PC lädt hinauf */
  pc = await starteGeraet({ name: 'sync-pc', url: EINZELDATEI })
  pruefe('PC startet', true)

  const angemeldet = await anmelden(pc, ZUGANG)
  pruefe('PC meldet sich am Server an', angemeldet)

  const hinauf = await abgleich(pc)
  pruefe('PC lädt seinen Bestand hoch', /geladen|Synchronisiert/.test(hinauf), hinauf)

  const kontenAufServer = server.zeilen('accounts').length
  pruefe('Die Konten liegen auf dem Server', kontenAufServer >= 4, `${kontenAufServer} Konten`)

  const tagesartenAufServer = server.zeilen('day_types').length
  pruefe('Die Tagesarten auch', tagesartenAufServer >= 7, `${tagesartenAufServer} Tagesarten`)

  /* ------------------------------------------- 2. Handy holt herunter */
  handy = await starteGeraet({
    name: 'sync-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy startet', true)

  const handyAn = await anmelden(handy, ZUGANG)
  pruefe('Handy meldet sich an', handyAn)

  const herunter = await abgleich(handy)
  pruefe('Handy gleicht ab', /Synchronisiert|geladen/.test(herunter), herunter)

  const handyText = await kontoNamen(handy)
  pruefe('Handy sieht das Girokonto', handyText.includes('Girokonto'))

  // Der eigentliche Punkt: Der Beispielbestand des Handys darf NICHT zusätzlich
  // auf dem Server landen. Genau daraus entstanden Eriks doppelte Konten.
  const kontenNachher = server.zeilen('accounts').length
  pruefe('Nichts hat sich verdoppelt', kontenNachher === kontenAufServer,
    `${kontenAufServer} vorher, ${kontenNachher} nachher`)

  const tagesartenNachher = server.zeilen('day_types').length
  pruefe('Auch die Tagesarten stehen einfach da', tagesartenNachher === tagesartenAufServer,
    `${tagesartenAufServer} vorher, ${tagesartenNachher} nachher`)

  /* ----------------------------------------- 3. Zurück zum PC */
  await legeKontoAn(handy, 'Handy-Konto')
  const zurueck = await abgleich(handy)
  pruefe('Handy sendet sein neues Konto', /Synchronisiert/.test(zurueck), zurueck)

  await abgleich(pc)
  const pcText = await kontoNamen(pc)
  pruefe('PC sieht das Konto vom Handy', pcText.includes('Handy-Konto'))

  /* ------------------------------- 4. Rückstand nach längerer Trennung */
  // Das Handy bleibt stehen, der PC arbeitet weiter.
  await legeKontoAn(pc, 'Rueckstand A')
  await legeKontoAn(pc, 'Rueckstand B')
  await legeKontoAn(pc, 'Rueckstand C')
  await abgleich(pc)

  const aufServer = server.zeilen('accounts').map((a) => a.name)
  pruefe('Alle drei Änderungen liegen auf dem Server',
    ['Rueckstand A', 'Rueckstand B', 'Rueckstand C'].every((n) => aufServer.includes(n)))

  await abgleich(handy)
  const handyNachRueckstand = await kontoNamen(handy)
  pruefe('Das Handy holt den ganzen Rückstand nach',
    ['Rueckstand A', 'Rueckstand B', 'Rueckstand C'].every((n) => handyNachRueckstand.includes(n)))

  /* ------------------------------------- 5. Eine Tabelle scheitert */
  // Ab jetzt weist der Server `calendar_events` zurück – wie damals, als dort
  // eine Spalte fehlte.
  // Erst einen Termin anlegen - sonst hat `calendar_events` gar nichts zu
  // senden und die Tabelle scheitert nie. Genau daran wäre diese Prüfung
  // stillschweigend bedeutungslos geworden.
  await legeTerminAn(pc, 'Zahnarzt')
  server.setzeFehlerTabelle('calendar_events')
  await legeKontoAn(pc, 'Trotzdem da')
  const trotzFehler = await abgleich(pc)
  pruefe('Der Abgleich meldet den Fehler, statt ihn zu verschlucken',
    /Teilweise|fehlgeschlagen/.test(trotzFehler), trotzFehler)

  const nachFehler = server.zeilen('accounts').map((a) => a.name)
  pruefe('Die anderen Tabellen gehen trotzdem durch',
    nachFehler.includes('Trotzdem da'),
    nachFehler.includes('Trotzdem da') ? 'accounts kam an' : 'accounts blieb liegen')

  server.setzeFehlerTabelle(null)
  const geheilt = await abgleich(pc)
  pruefe('Nach der Reparatur läuft der Abgleich wieder sauber',
    /Synchronisiert/.test(geheilt), geheilt)

  /* ------------------------------------------------ Konsolenfehler */
  const echteFehler = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource/i.test(f),
  )
  pruefe('Keine Fehler in der Konsole', echteFehler.length === 0, echteFehler.slice(0, 2).join(' | '))
} finally {
  await pc?.stop()
  await handy?.stop()
  await web.stop()
  await server.stop()
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
