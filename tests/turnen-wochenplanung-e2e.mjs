/**
 * Turnen, Phase 3B: Kommende Einheiten im Browser.
 *
 * Die Verteilungsregeln sind in `turnen-wochenplanung.test.ts` einzeln
 * nachgerechnet. Hier geht es um den Weg, den die Unit-Tests nicht zeigen:
 *
 *   Turntermine anlegen → Wochenvorschlag steht da → Inhalte sind auf die Tage
 *   verteilt → Nutzer verschiebt und entfernt → **erste Einheit erfassen** →
 *   zurück zur Übersicht → der Termin ist absolviert und die zweite Einheit
 *   rechnet mit dem neuen Datenstand
 *
 * Dazu die Stellen, an denen ein Planungsmodul typischerweise Schaden anrichtet:
 *
 *   - ein geplanter Termin darf nicht als absolviertes Training zählen
 *   - ein erfasstes Training muss den Termin wirklich schliessen
 *   - ein gelöschter Termin verschwindet ohne Rest
 *   - die Aufgaben des Planers bleiben unberührt
 *   - es entstehen keine doppelten Einheiten
 *
 * Dazu: 390 px, dunkler Modus, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-wochenplanung-e2e.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const FIXTURE = path.join(WURZEL, 'tests', 'fixtures', 'protokoll-score-2026.json')
if (!brauche(FIXTURE, 'Der Protokollbestand fehlt.')) process.exit(0)
const seitenBestand = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

const { parseProtokoll } = await import('../supabase/functions/wettkampf-import/protokoll.ts')
const bestand = parseProtokoll(seitenBestand)
const erik = bestand.teilnehmer.find((t) => (t.name.wert ?? '').startsWith('Ehnert'))
if (!erik) {
  console.log('\n  ÜBERSPRUNGEN: Kein Eintrag „Ehnert" im Bestand.\n')
  process.exit(0)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-wp-'))
const PDF_DATEI = path.join(TMP, 'Sachsenmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter\n')

const server = await starteNachbau({ port: 54411, protokoll: seitenBestand })
const web = await starteWebserver(8103)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

/** Tage relativ zu heute als YYYY-MM-DD – lokal, wie das Datumsfeld erwartet. */
function tagIn(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const planBlock = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächstes Training' }).first()
const planText = async (g) => (await planBlock(g).innerText()).replace(/\n/g, ' | ')

/** Die Einheiten der Wochenansicht mit ihren Geräten, in Reihenfolge. */
const wochenTage = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.textContent?.includes('Nächstes Training'))
  if (!karte) return []
  return [...karte.querySelectorAll('.wp-einheit')].map((el) => ({
    datum: el.querySelector('.wp-datum')?.textContent?.trim() ?? '',
    geraete: [...el.querySelectorAll('.wp-geraet .wp-name')].map((x) => x.textContent?.trim()),
  }))
})

const offeneGeraete = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.textContent?.includes('Nächstes Training'))
  if (!karte) return []
  return [...karte.querySelectorAll('.wp-offen-zeile .wp-name')].map((x) => x.textContent?.trim())
})

/* --------------------------------------------------------------- Hilfen */

async function legeElementAn(g, { name, geraet, buchstabe, wert }) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (buchstabe) {
    await g.page.locator('.modal .field', { hasText: 'Schwierigkeit' })
      .locator('input').first().fill(buchstabe)
  }
  if (wert) {
    await g.page.locator('.modal .field', { hasText: 'Wert' })
      .locator('input').first().fill(wert)
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1100)
}

async function legeWettkampfKuerAn(g, { name, geraet, elemente }) {
  await geh(g, '/turnen/kueren', 1400)
  await g.page.locator('button', { hasText: /^\+ (Kür|Erste Kür)$/ }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(400)
  await g.page.locator('.modal button', { hasText: '+ Element' }).first().click()
  await g.page.waitForTimeout(800)
  const waehler = g.page.locator('.modal').last()
  for (const n of elemente) {
    await waehler.locator('.list-row', { hasText: n }).first().click()
    await g.page.waitForTimeout(250)
  }
  await waehler.locator('button', { hasText: 'Fertig' }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal').last()
    .locator('label', { hasText: 'Aktive Wettkampfkür' })
    .locator('input[type=checkbox]').first().check()
  await g.page.waitForTimeout(300)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1500)
}

async function erfasseTraining(g, { geraet, tipps, einheitAmTag, amTag }) {
  await geh(g, '/turnen/training', 1600)
  if (einheitAmTag) {
    // Eine vorhandene (geplante) Einheit oeffnen, statt eine neue anzulegen -
    // genau der Weg, der den Termin schliessen muss.
    await g.page.locator('.list-row').filter({ hasText: einheitAmTag }).first().click()
  } else {
    await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  }
  await g.page.waitForTimeout(900)
  // Wer ein Training erfasst, hat es hinter sich. Steht im Editor noch der
  // Tag des Termins (also morgen), waere das eine Einheit in der Zukunft -
  // und die zaehlt zu Recht nicht als absolviert (core/turnen/einheiten.ts).
  if (amTag) {
    await g.page.locator('.modal input[type=date]').first().fill(amTag)
    await g.page.waitForTimeout(400)
  }
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(700)
  for (const [elementName, guete] of Object.entries(tipps)) {
    const zeile = g.page.locator('.turn-zeile', { hasText: elementName }).first()
    const knoepfe = zeile.locator('.turn-zaehler-knopf')
    for (const [welche, anzahl] of Object.entries(guete)) {
      const index = welche === 'clean' ? 0 : welche === 'shaky' ? 1 : 2
      for (let i = 0; i < anzahl; i++) await knoepfe.nth(index).click()
    }
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1900)
}

/** In die Wochenansicht umschalten. */
async function zurWoche(g) {
  const knopf = planBlock(g).locator('.segment button', { hasText: 'Kommende Einheiten' }).first()
  if (!(await knopf.count())) return false
  if ((await knopf.getAttribute('aria-pressed')) !== 'true') {
    await knopf.click()
    await g.page.waitForTimeout(900)
  }
  return true
}

/** Einen Turntermin über die Wochenansicht anlegen. */
async function legeTerminAn(g, { inTagen, dauer }) {
  await geh(g, '/turnen', 2200)
  await zurWoche(g)
  await planBlock(g).locator('button', { hasText: '+ Turntermin' }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input[type=date]').first().fill(tagIn(inTagen))
  if (dauer) await modal.locator('input[type=number]').first().fill(String(dauer))
  await modal.locator('button', { hasText: 'Planen' }).first().click()
  await g.page.waitForTimeout(1700)
}

/**
 * Denselben Termin ueber den ALLGEMEINEN Trainingseditor anlegen.
 *
 * Bis zum 30.09.2026 ging das nicht: Der Editor unter Tracking setzte keine
 * Disziplin, und eine dort als „Turntraining" geplante Einheit war fuer die
 * Turnplanung unsichtbar. Erkannt wird sie weiterhin NICHT am Titel, sondern
 * an dem Feld „Disziplin", das hier angetippt wird.
 */
async function legeTerminUeberTrackingAn(g, { inTagen, titel = 'Turntraining' }) {
  await geh(g, '/tracking/training', 2200)
  await g.page.locator('button', { hasText: '+ Einheit' }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('.chip', { hasText: /^Geplant$/ }).first().click()
  await modal.locator('input[type=date]').first().fill(tagIn(inTagen))
  // Ueber den Platzhalter, nicht ueber die Position: Der Editor hat mehrere
  // Felder mit derselben Klasse, und eine Nummer stimmt nur bis zur naechsten
  // Zeile, die jemand dazwischenschiebt.
  await modal.locator('input[placeholder^="z. B. Turntraining"]').first().fill(titel)
  // Genau „Turnen" – der Vorschlagschip „Turntraining" darunter enthaelt
  // dasselbe Wort und waere die falsche Schaltflaeche.
  await modal.locator('.chip', { hasText: /^Turnen$/ }).first().click()
  await modal.locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1700)
}

const geplanteAufServer = () => server.zeilen('workout_sessions')
  .filter((z) => !z.deleted_at && z.discipline === 'turnen' && z.status === 'planned')

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'wp-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  if (await namensfeld.count()) {
    await namensfeld.fill('Erik Ehnert')
    await pc.page.waitForTimeout(700)
  }

  /* ==================================================== Schritt 1: Import */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal input[type=file]').first().setInputFiles(PDF_DATEI)
  await pc.page.waitForTimeout(1800)
  await pc.page.locator('.modal .list-row').filter({ hasText: erik.name.wert }).first().click()
  await pc.page.waitForTimeout(1200)
  await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(2000)
  await abgleich(pc)

  /* ======================= Schritt 2: drei Geräte mit Kür, ein Training */
  await legeElementAn(pc, { name: 'Felge vorwärts', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Kippe zum Handstand', geraet: 'Barren', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Riesenfelge', geraet: 'Reck', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Tkatschew', geraet: 'Reck', buchstabe: 'D', wert: '0,4' })
  await legeElementAn(pc, { name: 'Kreuzhang', geraet: 'Ringe', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Muskelaufzug', geraet: 'Ringe', buchstabe: 'B', wert: '0,2' })
  await legeWettkampfKuerAn(pc, {
    name: 'Barrenkür 2026', geraet: 'Barren',
    elemente: ['Felge vorwärts', 'Kippe zum Handstand'],
  })
  await legeWettkampfKuerAn(pc, {
    name: 'Reckkür 2026', geraet: 'Reck', elemente: ['Riesenfelge', 'Tkatschew'],
  })
  await legeWettkampfKuerAn(pc, {
    name: 'Ringekür 2026', geraet: 'Ringe', elemente: ['Kreuzhang', 'Muskelaufzug'],
  })

  /* -------------------------- Schritt 3: leere Woche, aber erreichbar */
  await geh(pc, '/turnen', 2400)
  pruefe('Der Umschalter steht auch ohne Termin da – sonst käme man nie hin',
    await zurWoche(pc), (await planText(pc)).slice(0, 200))
  const leer = await planText(pc)
  pruefe('Die leere Woche erfindet keine Trainingstage',
    /noch kein Turntraining\s*\|?\s*geplant|kein Turntraining/.test(leer), leer.slice(0, 300))
  pruefe('Und nennt den Zeitraum',
    /kommenden 14 Tage/.test(leer), leer.slice(0, 300))
  pruefe('Der Anlegeknopf ist da',
    (await planBlock(pc).locator('button', { hasText: '+ Turntermin' }).count()) > 0)

  /* ============================ Schritt 4: zwei Turntermine über die Ansicht */
  await legeTerminAn(pc, { inTagen: 1 })
  await legeTerminAn(pc, { inTagen: 4 })
  await abgleich(pc)

  pruefe('Beide Termine liegen als geplante Turneinheiten auf dem Server',
    geplanteAufServer().length === 2, `${geplanteAufServer().length}`)
  pruefe('Sie tragen die Disziplin Turnen und den Status geplant',
    geplanteAufServer().every((z) => z.discipline === 'turnen' && z.status === 'planned'))

  await geh(pc, '/turnen', 2600)
  await zurWoche(pc)
  const verteilt = await wochenTage(pc)
  pruefe('Die Woche zeigt beide Tage', verteilt.length === 2, JSON.stringify(verteilt))
  pruefe('Und verteilt die Geräte auf beide – nicht alles auf den ersten Tag',
    verteilt[0].geraete.length > 0 && verteilt[1].geraete.length > 0,
    JSON.stringify(verteilt))
  pruefe('Kein Gerät steht an beiden Tagen, solange die Kür nicht das Problem ist',
    verteilt[0].geraete.every((g) => !verteilt[1].geraete.includes(g)),
    JSON.stringify(verteilt))
  pruefe('Die Zahl der Einheiten steht dabei',
    /2 Einheiten geplant/.test(await planText(pc)))

  /* -------------- Ein geplanter Termin ist kein absolviertes Training */
  await geh(pc, '/turnen', 2200)
  const uebersicht = await pc.page.innerText('#root')
  pruefe('„Letzte Einheit" nennt keinen Termin aus der Zukunft',
    !/Letzte Einheit[\s\S]{0,40}in \d+ Tagen/.test(uebersicht),
    uebersicht.replace(/\n/g, ' | ').slice(0, 260))

  await geh(pc, '/turnen/training', 1800)
  const trainingListe = await pc.page.innerText('#root')
  pruefe('Die Trainingsliste kennzeichnet die Termine als geplant',
    /geplant/.test(trainingListe), trainingListe.replace(/\n/g, ' | ').slice(0, 300))
  pruefe('Und zählt sie nicht als absolvierte Einheiten',
    /0 Einheiten|dazu 2 geplante Termine/.test(trainingListe),
    trainingListe.replace(/\n/g, ' | ').slice(0, 300))

  /* ===================== Schritt 5: der Nutzer greift in die Verteilung ein */
  await geh(pc, '/turnen', 2400)
  await zurWoche(pc)
  const vorher = await wochenTage(pc)
  const zuVerschieben = vorher[0].geraete[0]

  const auswahl = planBlock(pc).locator('.wp-einheit').first()
    .locator('.wp-geraet').filter({ hasText: zuVerschieben }).first()
    .locator('select').first()
  await auswahl.selectOption({ index: 1 })
  await pc.page.waitForTimeout(900)
  const nachVerschieben = await wochenTage(pc)
  pruefe('Ein Gerät lässt sich auf den anderen Tag verschieben',
    !nachVerschieben[0].geraete.includes(zuVerschieben)
    && nachVerschieben[1].geraete.includes(zuVerschieben),
    `${JSON.stringify(vorher)} -> ${JSON.stringify(nachVerschieben)}`)

  const weg = nachVerschieben[1].geraete[0]
  await planBlock(pc).locator('.wp-einheit').nth(1)
    .locator('.wp-geraet').filter({ hasText: weg }).first()
    .locator('button[aria-label$="entfernen"]').first().click()
  await pc.page.waitForTimeout(900)
  pruefe('Ein Gerät lässt sich entfernen und steht dann offen',
    (await offeneGeraete(pc)).includes(weg),
    JSON.stringify(await offeneGeraete(pc)))

  await planBlock(pc).locator('button', { hasText: 'zurücksetzen' }).first().click()
  await pc.page.waitForTimeout(900)
  pruefe('Zurücksetzen stellt die berechnete Verteilung wieder her',
    JSON.stringify(await wochenTage(pc)) === JSON.stringify(vorher),
    `${JSON.stringify(await wochenTage(pc))} != ${JSON.stringify(vorher)}`)

  /* ---------------- Die Nutzerwahl wird nicht gespeichert */
  await abgleich(pc)
  const einstellungen = server.zeilen('settings').filter((z) => !z.deleted_at)
  pruefe('Es entsteht keine Einstellung für die Wochenplanung',
    einstellungen.filter((z) => /woche|verteil|wochenplan/i.test(z.key ?? '')).length === 0)
  const tabellen = Object.keys(server.alleTabellen ? server.alleTabellen() : {})
  pruefe('Und keine Tabelle',
    tabellen.filter((t) => /wochenplan|training_plan/i.test(t)).length === 0)

  /* ============= Schritt 6: erste Einheit erfassen – der Termin schliesst */
  const aufgabenVorher = server.zeilen('tasks').filter((z) => !z.deleted_at).length
  await erfasseTraining(pc, {
    geraet: 'Barren',
    tipps: { 'Felge vorwärts': { clean: 12 }, 'Kippe zum Handstand': { clean: 12 } },
    einheitAmTag: 'geplant',
    amTag: tagIn(0),
  })
  await abgleich(pc)

  pruefe('Nach dem Erfassen ist nur noch ein Termin geplant',
    geplanteAufServer().length === 1, `${geplanteAufServer().length}`)
  const absolviert = server.zeilen('workout_sessions')
    .filter((z) => !z.deleted_at && z.discipline === 'turnen' && z.status === 'completed')
  pruefe('Die erfasste Einheit steht als absolviert da',
    absolviert.length === 1, `${absolviert.length}`)
  pruefe('Es ist keine zweite Einheit daneben entstanden',
    server.zeilen('workout_sessions').filter((z) => !z.deleted_at && z.discipline === 'turnen').length === 2,
    `${server.zeilen('workout_sessions').filter((z) => !z.deleted_at && z.discipline === 'turnen').length}`)
  pruefe('Die Aufgaben des Planers sind unberührt',
    server.zeilen('tasks').filter((z) => !z.deleted_at).length === aufgabenVorher,
    `${aufgabenVorher} -> ${server.zeilen('tasks').filter((z) => !z.deleted_at).length}`)

  /* ------------- Schritt 7: die zweite Einheit reagiert auf den Datenstand */
  await geh(pc, '/turnen', 2600)
  await zurWoche(pc)
  const danach = await wochenTage(pc)
  pruefe('Es bleibt genau eine kommende Einheit', danach.length === 1,
    JSON.stringify(danach))
  const nachText = await planText(pc)
  pruefe('Sie nennt jetzt den Phase-3A-Vorschlag für eine einzelne Einheit',
    /1 Einheit geplant/.test(nachText), nachText.slice(0, 300))
  pruefe('Barren ist nach dem guten Training nicht mehr der einzige Inhalt',
    danach[0].geraete.length > 0, JSON.stringify(danach))

  await geh(pc, '/turnen', 2200)
  const uebersichtDanach = await pc.page.innerText('#root')
  // Jetzt gibt es genau EINE absolvierte Einheit - der noch offene Termin
  // zaehlt weiterhin nicht mit.
  pruefe('Die Übersicht zählt genau eine absolvierte Einheit',
    /Einheiten gesamt\s+1(\s|$)/.test(uebersichtDanach.replace(/\n/g, ' ')),
    uebersichtDanach.replace(/\n/g, ' | ').slice(0, 300))

  /* ======================= Schritt 8: Termin löschen */
  await geh(pc, '/turnen', 2400)
  await zurWoche(pc)
  await planBlock(pc).locator('button', { hasText: 'Termin löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(1500)
  await abgleich(pc)
  pruefe('Ein gelöschter Termin verschwindet vollständig',
    geplanteAufServer().length === 0, `${geplanteAufServer().length}`)
  pruefe('Das erfasste Training bleibt davon unberührt',
    server.zeilen('workout_sessions')
      .filter((z) => !z.deleted_at && z.status === 'completed' && z.discipline === 'turnen').length === 1)

  await geh(pc, '/turnen', 2400)
  await zurWoche(pc)
  pruefe('Die Woche ist danach wieder leer und erfindet nichts',
    (await wochenTage(pc)).length === 0, JSON.stringify(await wochenTage(pc)))

  /* ============================================ Handy: 390 px und dunkel */
  await legeTerminAn(pc, { inTagen: 2, dauer: 45 })
  await legeTerminAn(pc, { inTagen: 6 })
  await abgleich(pc)

  handy = await starteGeraet({
    name: 'wp-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 2800)
  pruefe('Das Handy zeigt die Wochenansicht nach dem Abgleich', await zurWoche(handy))

  const handyTage = await wochenTage(handy)
  pruefe('Beide Termine stehen da', handyTage.length === 2, JSON.stringify(handyTage))
  const handyText = await planText(handy)
  pruefe('Die kurze Einheit ist als solche gekennzeichnet',
    /kurze Einheit/.test(handyText), handyText.slice(0, 400))
  pruefe('Es steht keine Minutenverteilung je Gerät da',
    !/\d+\s*min\s*·\s*\d+\s*min/.test(handyText), handyText.slice(0, 400))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Übersicht läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const passt = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.wp-einheit, .wp-geraet, .wp-kopf, .wp-offen-zeile')]
    return els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Wochenkacheln passen in die Breite', passt)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(900)
  pruefe('Im dunklen Modus steht dasselbe da',
    /Einheiten geplant/.test(await planText(handy)))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.wp-einheit')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Und die Wochenkacheln haben eine eigene Farbe',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })

  /* ======== Der allgemeine Trainingseditor kennt die Disziplin jetzt auch ==
     Bis zum 30.09.2026 eine bekannte Luecke: Unter Tracking liess sich eine
     Einheit planen, aber ohne Disziplin – und damit war sie fuer die
     Turnplanung unsichtbar. Erkannt wird sie weiterhin NICHT am Titel. */
  const vorherGeplant = geplanteAufServer().length
  await legeTerminUeberTrackingAn(pc, { inTagen: 9 })
  await abgleich(pc)
  const neueZeile = geplanteAufServer().find((z) => z.title === 'Turntraining')
  pruefe('Der Termin aus dem Trainingseditor traegt die Disziplin Turnen',
    !!neueZeile, `${geplanteAufServer().length} geplante (vorher ${vorherGeplant})`)

  await geh(pc, '/turnen', 2600)
  await zurWoche(pc)
  const mitTracking = await wochenTage(pc)
  // `.wp-datum` zeigt den Tag als „09.10." – so vergleicht sich das, ohne
  // die Formatierung des Bildschirms nachzubauen.
  const alsKurz = (tag) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`
  pruefe('Und er erscheint in den kommenden Einheiten',
    mitTracking.some((t) => t.datum === alsKurz(tagIn(9))),
    JSON.stringify(mitTracking.map((t) => t.datum)))

  /* Bearbeiten darf die Disziplin nicht verlieren. */
  await geh(pc, '/tracking/training', 2200)
  // In der Karte „Geplant" oeffnet der Knopf „…" den Editor - die Zeile
  // selbst ist dort nicht anklickbar.
  await pc.page.locator('.list-row', { hasText: 'Turntraining' })
    .first().locator('button', { hasText: '…' }).first().click()
  await pc.page.waitForTimeout(900)
  const bearbeiten = pc.page.locator('.modal').last()
  await bearbeiten.locator('input[placeholder^="z. B. Turntraining"]').first().fill('Turntraining A')
  await bearbeiten.locator('button', { hasText: 'Speichern' }).first().click()
  await pc.page.waitForTimeout(1700)
  await abgleich(pc)
  pruefe('Bearbeiten behaelt die Disziplin',
    geplanteAufServer().some((z) => z.title === 'Turntraining A'),
    JSON.stringify(geplanteAufServer().map((z) => `${z.title}/${z.discipline}`)))

  /* ==================================================== Keine Fehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|415|422/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
} catch (fehler) {
  console.log(`\n  ABBRUCH: ${fehler?.stack ?? fehler}\n`)
  fehlend.push('Abbruch')
} finally {
  await pc?.stop?.()
  await handy?.stop?.()
  await web?.stop?.()
  await server?.stop?.()
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
