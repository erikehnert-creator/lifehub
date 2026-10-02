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
import { tokenAbdruck } from '../supabase/functions/_shared/importToken.ts'
import { verarbeiteAnfrage } from '../supabase/functions/schlaf/verarbeite.ts'
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
    // Dieselbe Sequenz wie der Nachbau sie vergibt. Eine eigene, viel hoehere
    // Nummer schob den Lesezeiger des Clients nach vorn - alles, was danach
    // ueber die Edge Function hereinkam, lag darunter und wurde nie geholt.
    server_rev: server.naechsteRev(),
  })
  return id
}

/* ------------------------------------- Der echte Weg des Kurzbefehls
 *
 * Bis hierher legte diese Pruefung die Naechte von Hand auf den Server –
 * „so, wie die Edge Function sie schriebe". Das ist eine Annahme, und genau
 * in ihr sassen zwei Fehler (siehe supabase/functions/schlaf/verarbeite.ts).
 *
 * Der Abschnitt am Ende laeuft deshalb durch die ECHTE Verarbeitung: Der
 * Rumpf ist der, den der iOS-Kurzbefehl schickt (Zeilenform), die
 * Autorisierung laeuft ueber ein Importtoken, und geschrieben wird ueber
 * einen kleinen Adapter auf den Tabellenspeicher des Nachbaus – dasselbe
 * PostgREST, nur ohne HTTP dazwischen.
 *
 * Damit ist die Kette geschlossen: Kurzbefehl → Edge Function → Datenbank →
 * Abgleich → Anzeige.
 */
const NUTZER = '11111111-1111-1111-1111-111111111111'
/** Erfunden, in der Form eines echten Tokens. Nie ein produktives Token hier. */
const IMPORT_TOKEN = 'RTJFVGVzdFRva2VuX2VyZnVuZGVuX25pY2h0X2VjaHQxMjM'

function tabelle(name) {
  if (!server.tabellen.has(name)) server.tabellen.set(name, new Map())
  return server.tabellen.get(name)
}

/** Nur die Bedingungen, die die Funktion wirklich stellt: eq und is.null. */
function trifft(zeile, bedingungen) {
  return bedingungen.every(([feld, ausdruck]) => {
    if (ausdruck === 'is.null') return zeile[feld] === null || zeile[feld] === undefined
    if (ausdruck.startsWith('eq.')) return String(zeile[feld]) === decodeURIComponent(ausdruck.slice(3))
    return true
  })
}

const edgeDb = async (pfad, init) => {
  const [name, abfrage = ''] = pfad.split('?')
  const store = tabelle(name)
  const bedingungen = []
  for (const teil of abfrage.split('&')) {
    if (!teil) continue
    const [k, ...rest] = teil.split('=')
    if (['select', 'limit', 'order'].includes(k)) continue
    bedingungen.push([k, rest.join('=')])
  }
  const treffer = [...store.values()].filter((z) => trifft(z, bedingungen))

  if (!init?.method || init.method === 'GET') return treffer.map((z) => ({ ...z }))
  if (init.method === 'PATCH') {
    const patch = JSON.parse(String(init.body))
    for (const z of treffer) Object.assign(z, patch, { server_rev: server.naechsteRev() })
    return treffer.map((z) => ({ ...z }))
  }
  if (init.method === 'POST') {
    const roh = JSON.parse(String(init.body))
    for (const z of (Array.isArray(roh) ? roh : [roh])) {
      store.set(z.id, { deleted_at: null, note: null, ...z, server_rev: server.naechsteRev() })
    }
    return roh
  }
  throw new Error(`nicht nachgebaut: ${init.method}`)
}

/** Den Importzugang anlegen – genauso, wie LifeHub ihn anlegt. */
async function legeImportzugangAn() {
  const jetzt = new Date().toISOString()
  tabelle('import_tokens').set('tok-e2e', {
    id: 'tok-e2e', user_id: NUTZER, label: 'iPhone (Test)',
    token_hash: await tokenAbdruck(IMPORT_TOKEN), scope: 'schlaf',
    last_used_at: null, revoked_at: null, deleted_at: null,
    created_at: jetzt, updated_at: jetzt,
    version: 1, last_device_id: 'test', server_rev: server.naechsteRev(),
  })
}

/** Den Kurzbefehl ausfuehren: Zeilenform, Bearer-Token, POST. */
async function schickeKurzbefehl(zeilen, token = IMPORT_TOKEN) {
  return verarbeiteAnfrage(
    { methode: 'POST', authorization: 'Bearer ' + token, rumpf: async () => zeilen.join('\n') },
    { db: edgeDb },
  )
}

/**
 * Eine Nacht als Health-Proben: ab 23:00 des Vortags, `minuten` lang.
 *
 * In MINUTEN, weil die Pruefung den Text abliest, den `formatDuration`
 * erzeugt – und der laesst volle Stunden weg („6 h", nicht „6 h 0 min").
 * Krumme Dauern sind hier deshalb die eindeutigeren.
 */
function nachtProben(tag, minuten, quelle = 'Sleep Cycle') {
  const vortag = new Date(Date.parse(tag + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
  const beginn = Date.parse(vortag + 'T23:00:00+02:00')
  const ende = beginn + minuten * 60000
  const iso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00')
  return [
    iso(beginn) + '|' + iso(ende) + '|AsleepCore|' + quelle,
    iso(beginn - 15 * 60000) + '|' + iso(ende) + '|InBed|' + quelle,
  ]
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

  /* ======== Der echte Weg: Kurzbefehl → Edge Function → Anzeige ========= */
  await legeImportzugangAn()
  // Ein Tag, den bisher keine Prüfung angefasst hat – sonst mischen sich die
  // von Hand gelegten Nächte mit denen aus dem Kurzbefehl.
  const kbTag = tagVor(6)

  // 1. Ein gültiger Kurzbefehl-Request. 6 h 30 min – eine Zahl, die in keiner
  //    der von Hand gelegten Nächte vorkommt.
  const a1 = await schickeKurzbefehl(nachtProben(kbTag, 390))
  pruefe('Der Kurzbefehl wird angenommen', a1.status === 200, `HTTP ${a1.status} ${JSON.stringify(a1.rumpf)}`)
  pruefe('Die Antwort nennt Empfang und Wirkung',
    a1.rumpf.empfangen === 2 && (a1.rumpf.neu ?? 0) === 1, JSON.stringify(a1.rumpf))

  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2500)
  pruefe('Die übertragene Nacht steht in LifeHub', /6 h 30 min/.test(await text(pc)))

  // 2. Ein fremdes Token darf nichts bewegen.
  const a2 = await schickeKurzbefehl(nachtProben(kbTag, 180), 'ZmFsc2NoZXNUb2tlbl9uaWNodF9lY2h0X2FiY2RlZmdo')
  pruefe('Ein fremdes Token wird abgewiesen', a2.status === 401, `HTTP ${a2.status}`)
  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2000)
  pruefe('Nach dem abgewiesenen Versuch steht die Nacht unverändert da',
    /6 h 30 min/.test(await text(pc)))

  // 3. Dasselbe noch einmal: keine zweite Nacht, keine neue Fassung.
  const a3 = await schickeKurzbefehl(nachtProben(kbTag, 390))
  pruefe('Ein zweiter Lauf ändert nichts', a3.rumpf.unveraendert === 1, JSON.stringify(a3.rumpf))

  // 4. Apple Health korrigiert nach – die Änderung kommt durch.
  const a4 = await schickeKurzbefehl(nachtProben(kbTag, 410))
  pruefe('Eine Korrektur wird als Änderung gemeldet', a4.rumpf.geaendert === 1, JSON.stringify(a4.rumpf))
  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2500)
  const nachKorrektur = await text(pc)
  pruefe('Die Korrektur steht in LifeHub',
    /6 h 50 min/.test(nachKorrektur) && !/6 h 30 min/.test(nachKorrektur))

  // 5. Eine einzelne kaputte Probe darf die Sendung nicht mehr kippen.
  const kbTag2 = tagVor(7)
  const a5 = await schickeKurzbefehl([...nachtProben(kbTag2, 320), 'voelliger unfug'])
  pruefe('Eine kaputte Zeile kippt die Sendung nicht', a5.status === 200, `HTTP ${a5.status}`)
  pruefe('Sie wird aber gezählt', a5.rumpf.zurueckgewiesen === 1, JSON.stringify(a5.rumpf))
  await abgleich(pc)
  await geh(pc, '/tracking/schlaf', 2500)
  pruefe('Die übrigen Proben sind angekommen', /5 h 20 min/.test(await text(pc)))

  // 6. Je Nacht genau eine Zeile auf dem Server – auch nach all dem.
  const alleTage = server.zeilen('sleep_sessions').map((z) => z.day)
  pruefe('Kein Tag steht doppelt auf dem Server',
    new Set(alleTage).size === alleTage.length, alleTage.sort().join(', '))

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
