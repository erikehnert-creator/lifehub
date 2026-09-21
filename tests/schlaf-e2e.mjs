/**
 * Eine importierte Nacht muss in LifeHub ankommen – auf beiden Geräten.
 *
 * ---------------------------------------------------------------------------
 * Was hier geprüft wird und was nicht
 *
 * Die Edge Function selbst läuft auf Deno und lässt sich von hier nicht
 * starten. Ihre Rechnung ist deshalb in `tests/schlaf.test.ts` und
 * `tests/schlaf-import.test.ts` einzeln nachgerechnet – Aggregation,
 * Zeitzonen, Wiederholbarkeit, Token.
 *
 * Diese Prüfung setzt danach an: Sie legt die Nächte so auf den Server, wie
 * die Funktion sie schreiben würde, und sieht nach, was die App daraus macht.
 * Das ist der Teil, der mit Unit-Tests nicht zu haben ist – der Abgleich, die
 * Anzeige auf „Heute", die Liste unter Tracking und der Tageswert, den die
 * Automatik daraus zieht.
 *
 * Aufruf:  node tests/schlaf-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import { idAusSchluessel } from '../supabase/functions/_shared/stabileId.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54397 })
const web = await starteWebserver(8088)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

/**
 * Heute – in ORTSZEIT, so wie `todayString()` in der App.
 *
 * `toISOString()` rechnet in UTC. Zwischen Mitternacht und zwei Uhr liegt
 * Mitteleuropa einen Tag davor: Um 00:18 Uhr am 22. wäre das UTC-Datum noch
 * der 21. Der Test legte die Nacht dann auf einen anderen Tag, als die
 * Heute-Seite anzeigt, und die Prüfung fiel um – zuverlässig, aber nur
 * nachts. Genau so ist sie am 22.09.2026 aufgefallen.
 */
const alsTag = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const heute = alsTag(new Date())
const tagVor = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return alsTag(d)
}

/**
 * Eine Nacht so auf den Server legen, wie die Edge Function sie schriebe –
 * einschliesslich der aus dem Tag abgeleiteten ID. Genau die ist der Grund,
 * warum ein zweiter Import keine zweite Nacht ergibt.
 */
function legeNachtAufServer({ day, dauer, phasen = false, quelle = 'Sleep Cycle' }) {
  const id = idAusSchluessel('sleep_sessions', day)
  const jetzt = new Date().toISOString()
  if (!server.tabellen.has('sleep_sessions')) server.tabellen.set('sleep_sessions', new Map())
  const store = server.tabellen.get('sleep_sessions')
  const vorhanden = store.get(id)
  store.set(id, {
    id,
    user_id: '11111111-1111-1111-1111-111111111111',
    day,
    start_at: `${day}T00:30:00+02:00`,
    end_at: `${day}T07:00:00+02:00`,
    duration_min: dauer,
    awake_min: phasen ? 18 : null,
    in_bed_min: dauer + 20,
    core_min: phasen ? Math.round(dauer * 0.55) : null,
    deep_min: phasen ? Math.round(dauer * 0.2) : null,
    rem_min: phasen ? dauer - Math.round(dauer * 0.55) - Math.round(dauer * 0.2) : null,
    source: quelle,
    note: null,
    created_at: vorhanden?.created_at ?? jetzt,
    updated_at: jetzt,
    deleted_at: null,
    version: (vorhanden?.version ?? 0) + 1,
    last_device_id: 'apple-health',
    server_rev: 100000 + store.size + (vorhanden ? 1000 : 0),
  })
  return id
}

const text = async (g) => (await g.page.innerText('#root'))

let pc, handy
try {
  /* ------------------------------------------------ Vorbereiten */
  pc = await starteGeraet({ name: 'schlaf-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  /* --------------------------------- Die Funktion schreibt Naechte */
  legeNachtAufServer({ day: heute, dauer: 462, phasen: true })        // 7 h 42 min
  legeNachtAufServer({ day: tagVor(1), dauer: 401 })                  // 6 h 41 min
  legeNachtAufServer({ day: tagVor(2), dauer: 488 })                  // 8 h 8 min

  const holen = await abgleich(pc)
  pruefe('PC holt die Naechte', /Synchronisiert/.test(holen), holen)

  /* ------------------------------------------------ Anzeige Heute */
  await geh(pc, '/heute', 2500)
  const heuteText = await text(pc)
  pruefe('Heute nennt die Schlafdauer', /7 h 42 min/.test(heuteText),
    (heuteText.match(/Schlaf[^\n]*/) ?? ['—'])[0])
  pruefe('Heute nennt auch die Uhrzeiten', /00:30.{0,3}07:00/.test(heuteText))

  /* --------------------------------------------- Anzeige Tracking */
  await geh(pc, '/tracking/schlaf', 2500)
  const trackText = await text(pc)
  pruefe('Tracking zeigt den Schlafreiter', /Die einzelnen N/.test(trackText))
  pruefe('Alle drei Naechte stehen in der Liste',
    /7 h 42 min/.test(trackText) && /6 h 41 min/.test(trackText) && /8 h 8 min/.test(trackText))
  pruefe('Der Schnitt wird genannt', /Schnitt/.test(trackText))

  /* ------------------------------------- Phasen in der Einzelnacht */
  await pc.page.locator('.list-row', { hasText: '7 h 42 min' }).first().click()
  await pc.page.waitForTimeout(900)
  const detail = await text(pc)
  pruefe('Die Nacht mit Phasen zeigt Tiefschlaf und REM',
    /Tiefschlaf/.test(detail) && /REM/.test(detail))
  await pc.page.locator('.modal button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* -------------------------- Nacht OHNE Phasen sagt das ausdruecklich */
  await pc.page.locator('.list-row', { hasText: '6 h 41 min' }).first().click()
  await pc.page.waitForTimeout(900)
  const ohnePhasen = await text(pc)
  pruefe('Ohne Phasen steht ein erklaerender Satz statt vier Nullen',
    /keine Schlafphasen/.test(ohnePhasen))
  await pc.page.locator('.modal button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ------------------------------------ Tageswert fuer die Analyse */
  // Die Automatik traegt die Stunden in sleep_h nach - daran haengen
  // Zielbereich und Zusammenhangsrechnung (core/schlafMetrik.ts).
  //
  // Geprueft wird auf dem SERVER, nicht im Text der Seite: Auf der Tagesseite
  // steht der Wert in einem Eingabefeld, und dessen Inhalt taucht im
  // sichtbaren Text gar nicht auf - die Pruefung waere immer rot gewesen,
  // ohne dass irgendetwas kaputt ist.
  await geh(pc, '/tracking', 3000)
  await abgleich(pc)
  const schlafMetrik = server.zeilen('metrics').find((m) => m.key === 'sleep_h')
  pruefe('Die Metrik sleep_h liegt auf dem Server', !!schlafMetrik)
  const schlafWerte = server.zeilen('metric_entries')
    .filter((e) => e.metric_id === schlafMetrik?.id)
  const heutigerWert = schlafWerte.find((e) => e.day === heute)
  pruefe('Der Tageswert Schlaf ist nachgezogen',
    Math.abs(Number(heutigerWert?.value_num) - 7.7) < 0.01,
    `value_num = ${heutigerWert?.value_num}`)
  pruefe('Er ist als mitgefuehrt gekennzeichnet, nicht als Handeingabe',
    heutigerWert?.source === 'sleep_session', String(heutigerWert?.source))
  pruefe('Je Nacht genau ein Tageswert', schlafWerte.length === 3, `${schlafWerte.length} Eintraege`)

  /* ---------------------------------- Zweiter Abgleich: nichts doppelt */
  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2500)
  const nachZweitem = await text(pc)
  const treffer = (nachZweitem.match(/7 h 42 min/g) ?? []).length
  pruefe('Ein zweiter Abgleich legt die Nacht nicht doppelt an', treffer <= 2,
    `${treffer}x gefunden (Kopfzeile plus Liste)`)

  /* ------------------------ Korrektur aus Apple Health kommt durch */
  legeNachtAufServer({ day: heute, dauer: 431 })   // 7 h 11 min statt 7 h 42
  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2500)
  const korrigiert = await text(pc)
  pruefe('Eine nachtraegliche Korrektur ersetzt die Nacht',
    /7 h 11 min/.test(korrigiert) && !/7 h 42 min/.test(korrigiert))

  /* ------------------------------------------- Das Handy sieht es auch */
  handy = await starteGeraet({ name: 'schlaf-handy', url: web.url, viewport: { width: 390, height: 844 } })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/tracking/schlaf', 2500)
  const handyText = await text(handy)
  pruefe('Handy zeigt dieselben Naechte',
    /7 h 11 min/.test(handyText) && /8 h 8 min/.test(handyText))

  const aufServer = server.zeilen('sleep_sessions').length
  pruefe('Auf dem Server steht je Nacht genau eine Zeile', aufServer === 3, `${aufServer} Zeilen`)

  /* ------------------------------------------------- Konsolenfehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
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
