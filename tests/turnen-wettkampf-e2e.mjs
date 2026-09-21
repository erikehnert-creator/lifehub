/**
 * Turnen, Phase 2B1: Wettkämpfe erfassen – und die Übung von damals behalten.
 *
 * Die Kernlogik ist in `turnen-wettkampf.test.ts` einzeln nachgerechnet. Hier
 * geht es um das, was Unit-Tests nicht zeigen:
 *
 *   - Läuft das Erfassen eines Mehrkampfs am Handy durch?
 *   - Bleibt ein Oktober-Wettkampf unverändert, wenn die Kür im Dezember
 *     geändert, ein Element umbenannt und ein anderes gelöscht wird? Das ist
 *     der eigentliche Prüfgegenstand.
 *   - Erzeugt ein zweites Speichern eine Dublette?
 *   - Sehen PC und Handy nach dem Abgleich denselben Wettkampf – auch wenn
 *     einer davon offline erfasst wurde?
 *
 * Aufruf:  node tests/turnen-wettkampf-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54398 })
const web = await starteWebserver(8092)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')
const zerlege = (t) => String(t).trim().split(/\r?\n/).map((z) => z.trim()).filter(Boolean)

/* --------------------------------------------------------------- Hilfen */

/** Den Wert einer Kennzeile lesen – Name und Wert stehen in getrennten Zeilen. */
function kennwert(text, name) {
  const zeilen = zerlege(text)
  const i = zeilen.findIndex((z) => z.includes(name))
  return i >= 0 ? zeilen[i + 1] ?? '' : ''
}

async function legeElementAn(g, { name, geraet, buchstabe, wert }) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('button', { hasText: /^\+ (Element|Erstes Element)$/ }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal input').first().fill(name)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  if (buchstabe) {
    await g.page.locator('.modal .field', { hasText: 'Schwierigkeit' }).locator('input').first().fill(buchstabe)
  }
  if (wert) {
    await g.page.locator('.modal .field', { hasText: 'Wert' }).locator('input').first().fill(wert)
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1100)
}

/** Ein vorhandenes Element öffnen und ändern. */
async function aendereElement(g, name, fn) {
  await geh(g, '/turnen/elemente', 1400)
  await g.page.locator('.list-row', { hasText: name }).first().click()
  await g.page.waitForTimeout(800)
  await fn(g.page.locator('.modal').last())
  await g.page.waitForTimeout(400)
}

async function legeKuerAn(g, { name, geraet, elemente }) {
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
  await g.page.locator('.modal').last().locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1400)
}

/** Den Wettkampf-Editor öffnen – neu oder über die Zeile. */
async function oeffneWettkampf(g, name) {
  await geh(g, '/turnen/wettkaempfe', 1500)
  if (name) {
    await g.page.locator('.list-row', { hasText: name }).first().click()
  } else {
    await g.page.locator('button', { hasText: /^\+ (Wettkampf|Erster Wettkampf)$/ }).first().click()
  }
  await g.page.waitForTimeout(900)
}

/** Aus dem Detail in den Editor. */
async function zumBearbeiten(g) {
  await g.page.locator('.modal button', { hasText: 'Bearbeiten' }).first().click()
  await g.page.waitForTimeout(900)
}

/** Die Notenfelder eines Geräts im Editor füllen. */
async function fuelleGeraet(g, geraet, werte) {
  const karte = g.page.locator('.modal .wk-karte').filter({ hasText: geraet }).first()
  for (const [label, wert] of Object.entries(werte)) {
    await karte.locator('.field', { hasText: label }).locator('input').first().fill(wert)
    await g.page.waitForTimeout(120)
  }
}

async function speichere(g) {
  await g.page.locator('.modal').last().locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1500)
}

/** Die Elementnamen der historischen Fassung, die gerade offen ist. */
async function fassungsFolge(g) {
  return (await g.page.locator('.modal .kuer-zeile .kuer-name-text').allInnerTexts())
    .map((t) => t.trim())
}

/** Die Endnote, die das Detail für ein Gerät zeigt. */
async function endnoteIm(g, geraet) {
  const karte = g.page.locator('.modal .wk-karte').filter({ hasText: geraet }).first()
  const note = karte.locator('.wk-note.stark .wk-note-wert').first()
  return (await note.innerText()).trim()
}

let pc, handy
try {
  /* ==================================================== Reiter erreichbar */
  pc = await starteGeraet({ name: 'wk-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/turnen', 1800)
  const reiter = await text(pc)
  pruefe('Der Bereich Turnen zeigt jetzt fünf Reiter',
    ['Übersicht', 'Elemente', 'Training', 'Küren', 'Wettkämpfe'].every((r) => reiter.includes(r)))

  await geh(pc, '/turnen/wettkaempfe', 1500)
  pruefe('Der Reiter Wettkämpfe ist leer und sagt das auch',
    /Noch kein Wettkampf/.test(await text(pc)))

  /* --------------------------------------- Elemente und eine Reckkür */
  await legeElementAn(pc, { name: 'Kippe', geraet: 'Reck', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Riesenfelge', geraet: 'Reck', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Hocksalto ab', geraet: 'Reck', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Rondat', geraet: 'Boden', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Stützkehre', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })

  await legeKuerAn(pc, {
    name: 'Reckkür 2026', geraet: 'Reck',
    elemente: ['Kippe', 'Riesenfelge', 'Hocksalto ab'],
  })
  pruefe('Die Reckkür steht da', /Reckkür 2026/.test(await text(pc)))

  /* ============================== Wettkampf mit drei Geraeten anlegen */
  await oeffneWettkampf(pc, null)
  await pc.page.locator('.modal input').first().fill('Bezirksmeisterschaft')
  await pc.page.locator('.modal .field', { hasText: 'Datum' }).locator('input').first().fill('2026-10-04')
  await pc.page.locator('.modal .field', { hasText: 'Ort' }).locator('input').first().fill('Dresden')
  await pc.page.waitForTimeout(400)

  for (const g of ['Boden', 'Barren', 'Reck']) {
    await pc.page.locator('.modal .turn-geraete .turn-geraet', { hasText: g }).first().click()
    await pc.page.waitForTimeout(250)
  }
  const karten = await pc.page.locator('.modal .wk-karte').count()
  pruefe('Drei Geräte stehen zum Eintragen bereit', karten === 3, `${karten} Karten`)

  // Dezimalwerte, einmal mit Komma und einmal mit Punkt.
  await fuelleGeraet(pc, 'Boden', { 'D-Wert': '4,2', 'E-Wert': '8,15', 'Endnote': '12,35' })
  await fuelleGeraet(pc, 'Barren', { 'D-Wert': '3.5', 'E-Wert': '7,9', 'Endnote': '11,4' })
  // Reck: absichtlich OHNE E-Wert.
  await fuelleGeraet(pc, 'Reck', { 'D-Wert': '3,8', 'Endnote': '11,95', 'Platz': '2' })

  // Die Reckkuer als Grundlage waehlen - sie wird eingefroren.
  const reckKarte = pc.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
  await reckKarte.locator('button', { hasText: 'Kür auswählen' }).first().click()
  await pc.page.waitForTimeout(800)
  const waehlerText = await pc.page.locator('.modal').last().innerText()
  pruefe('Der Kürwähler sagt, dass die Kür festgehalten wird',
    /festgehalten/.test(waehlerText))
  await pc.page.locator('.modal').last().locator('.list-row', { hasText: 'Reckkür 2026' }).first().click()
  await pc.page.waitForTimeout(700)

  await speichere(pc)

  const nachAnlegen = await text(pc)
  pruefe('Der Wettkampf steht in der Liste', /Bezirksmeisterschaft/.test(nachAnlegen))
  pruefe('Mit Ort und Zahl der Geräte',
    /Dresden/.test(nachAnlegen) && /3 Geräte/.test(nachAnlegen))

  /* ------------------------------------------------ Das Detail lesen */
  await oeffneWettkampf(pc, 'Bezirksmeisterschaft')
  const detail = await pc.page.locator('.modal').first().innerText()
  pruefe('Das Detail nennt alle drei Geräte',
    /Boden/.test(detail) && /Barren/.test(detail) && /Reck/.test(detail))
  pruefe('Die Endnote steht mit Dezimalstellen da', /12,35/.test(detail),
    detail.split(/\r?\n/).find((z) => /12,35/.test(z)))
  pruefe('Eine fehlende E-Note erscheint als Strich, nicht als 0',
    /—/.test(detail) && !/\b0,0\b/.test(detail))
  pruefe('Die Platzierung steht dabei', /Platz 2/.test(detail))
  pruefe('Die beste Note ist markiert', /beste Note/.test(detail))
  pruefe('Die niedrigste ebenfalls', /niedrigste Note/.test(detail))

  const bodenNote = await endnoteIm(pc, 'Boden')
  pruefe('Boden trägt 12,35', bodenNote === '12,35', bodenNote)

  /* --------------------------------- Die eingefrorene Fassung ansehen */
  await pc.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
    .locator('button', { hasText: 'Fassung vom' }).first().click()
  await pc.page.waitForTimeout(800)
  const fassungOkt = await fassungsFolge(pc)
  pruefe('Die Fassung zeigt die damalige Elementfolge',
    JSON.stringify(fassungOkt) === JSON.stringify(['Kippe', 'Riesenfelge', 'Hocksalto ab']),
    fassungOkt.join(' · '))
  const fassungText = await pc.page.locator('.modal').last().innerText()
  pruefe('Mit der damaligen Schwierigkeitssumme',
    kennwert(fassungText, 'Schwierigkeitssumme') === '0,6',
    kennwert(fassungText, 'Schwierigkeitssumme'))
  pruefe('Und sie heisst nicht D-Wert', !/D-Wert|D-Note/.test(fassungText))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* --------------------------- Zweites Speichern: keine Dubletten */
  await abgleich(pc)
  const ergErst = server.zeilen('gym_results').filter((z) => !z.deleted_at).length
  const fasErst = server.zeilen('gym_routine_versions').filter((z) => !z.deleted_at).length
  pruefe('Auf dem Server liegen drei Ergebnisse', ergErst === 3, `${ergErst}`)
  pruefe('Und genau eine Kürfassung', fasErst === 1, `${fasErst}`)

  await oeffneWettkampf(pc, 'Bezirksmeisterschaft')
  await zumBearbeiten(pc)
  await speichere(pc)
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(500)
  await abgleich(pc)
  pruefe('Ein zweites Speichern erzeugt keine Ergebnisdublette',
    server.zeilen('gym_results').filter((z) => !z.deleted_at).length === ergErst)
  pruefe('Und auch keine zweite Fassung',
    server.zeilen('gym_routine_versions').filter((z) => !z.deleted_at).length === fasErst)
  pruefe('Und keinen zweiten Wettkampf',
    server.zeilen('gym_competitions').filter((z) => !z.deleted_at).length === 1)

  /* ============================================================
     Der Kern: Die Historie bleibt unberuehrt
     ============================================================ */

  // 1. Die Kuer wird geaendert: ein Element raus, die Reihenfolge gedreht.
  await geh(pc, '/turnen/kueren', 1400)
  await pc.page.locator('.list-row', { hasText: 'Reckkür 2026' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal .kuer-zeile', { hasText: 'Riesenfelge' })
    .first().locator('button[aria-label="entfernen"]').click()
  await pc.page.waitForTimeout(300)
  await pc.page.locator('.modal .kuer-zeile').first()
    .locator('button[aria-label="nach unten"]').click()
  await pc.page.waitForTimeout(300)
  await speichere(pc)

  // 2. Ein Element wird umbenannt.
  await aendereElement(pc, 'Kippe', async (modal) => {
    await modal.locator('input').first().fill('Kippe aus dem Hang')
    await modal.locator('button', { hasText: 'Speichern' }).first().click()
  })
  await pc.page.waitForTimeout(1200)

  // 3. Ein Element wird geloescht.
  await geh(pc, '/turnen/elemente', 1400)
  await pc.page.locator('.list-row', { hasText: 'Hocksalto ab' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(1300)

  // Die lebende Kuer sieht jetzt anders aus ...
  await geh(pc, '/turnen/kueren', 1400)
  await pc.page.locator('.list-row', { hasText: 'Reckkür 2026' }).first().click()
  await pc.page.waitForTimeout(900)
  const lebend = await fassungsFolge(pc)
  pruefe('Die lebende Kür hat sich verändert',
    JSON.stringify(lebend) !== JSON.stringify(fassungOkt), lebend.join(' · '))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  // ... der Wettkampf aber NICHT.
  await oeffneWettkampf(pc, 'Bezirksmeisterschaft')
  await pc.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
    .locator('button', { hasText: 'Fassung vom' }).first().click()
  await pc.page.waitForTimeout(800)
  const fassungDanach = await fassungsFolge(pc)
  pruefe('Die historische Fassung ist Zeichen für Zeichen dieselbe',
    JSON.stringify(fassungDanach) === JSON.stringify(fassungOkt),
    `${fassungOkt.join(' · ')}  ->  ${fassungDanach.join(' · ')}`)
  pruefe('Das umbenannte Element heisst dort weiterhin wie damals',
    fassungDanach.includes('Kippe') && !fassungDanach.includes('Kippe aus dem Hang'))
  pruefe('Das gelöschte Element steht dort weiterhin vollständig',
    fassungDanach.includes('Hocksalto ab'))

  const danachText = await pc.page.locator('.modal').last().innerText()
  pruefe('Auch die damalige Schwierigkeitssumme ist unverändert',
    kennwert(danachText, 'Schwierigkeitssumme') === '0,6',
    kennwert(danachText, 'Schwierigkeitssumme'))
  pruefe('LifeHub sagt dazu, dass die Kür seitdem geändert wurde',
    /seitdem geändert/.test(danachText))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  // Die Endnoten des Wettkampfs sind ebenfalls unangetastet.
  pruefe('Die Endnote des Wettkampfs steht unverändert da',
    (await endnoteIm(pc, 'Boden')) === '12,35')
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ------------------------ Kuer loeschen: Historie bleibt lesbar */
  await geh(pc, '/turnen/kueren', 1400)
  await pc.page.locator('.list-row', { hasText: 'Reckkür 2026' }).first().click()
  await pc.page.waitForTimeout(900)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  const kuerWarnung = await pc.page.locator('.modal').last().innerText()
  pruefe('Das Löschen der Kür nennt den Wettkampf, der mit ihr geturnt wurde',
    /Wettkampf geturnt/.test(kuerWarnung),
    zerlege(kuerWarnung).find((z) => /Wettkampf/.test(z)))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(1300)

  await oeffneWettkampf(pc, 'Bezirksmeisterschaft')
  await pc.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
    .locator('button', { hasText: 'Fassung vom' }).first().click()
  await pc.page.waitForTimeout(800)
  const nachKuerLoeschen = await fassungsFolge(pc)
  pruefe('Nach dem Löschen der Kür bleibt die Fassung vollständig lesbar',
    JSON.stringify(nachKuerLoeschen) === JSON.stringify(fassungOkt),
    nachKuerLoeschen.join(' · '))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ================= Zweiter Wettkampf am selben Tag, ein Gerät ===== */
  await oeffneWettkampf(pc, null)
  await pc.page.locator('.modal input').first().fill('Gerätefinale Reck')
  await pc.page.locator('.modal .field', { hasText: 'Datum' }).locator('input').first().fill('2026-10-04')
  await pc.page.waitForTimeout(400)
  await pc.page.locator('.modal .turn-geraete .turn-geraet', { hasText: 'Reck' }).first().click()
  await pc.page.waitForTimeout(300)
  await fuelleGeraet(pc, 'Reck', { 'D-Wert': '3,9', 'E-Wert': '8,2', 'Endnote': '12,1', 'Platz': '1' })
  await speichere(pc)

  const beide = await text(pc)
  pruefe('Zwei Wettkämpfe am selben Tag stehen nebeneinander',
    /Bezirksmeisterschaft/.test(beide) && /Gerätefinale Reck/.test(beide))
  pruefe('Der zweite nennt genau ein Gerät', /1 Gerät/.test(beide))

  await abgleich(pc)
  const zweiWk = server.zeilen('gym_competitions').filter((z) => !z.deleted_at)
  pruefe('Beide liegen als eigene Zeilen auf dem Server', zweiWk.length === 2, `${zweiWk.length}`)
  pruefe('Ihre Ergebnisse gehen nicht durcheinander',
    server.zeilen('gym_results').filter((z) => !z.deleted_at).length === 4)

  /* ---------------------- Bearbeiten: ein Gerät dazu, eines weg */
  await oeffneWettkampf(pc, 'Gerätefinale Reck')
  await zumBearbeiten(pc)
  await pc.page.locator('.modal .turn-geraete .turn-geraet', { hasText: 'Boden' }).first().click()
  await pc.page.waitForTimeout(300)
  await fuelleGeraet(pc, 'Boden', { 'D-Wert': '4,0', 'E-Wert': '8,0', 'Endnote': '12,0' })
  await speichere(pc)
  await pc.page.waitForTimeout(600)
  const nachBearbeiten = await pc.page.locator('.modal').first().innerText()
  pruefe('Ein Gerät lässt sich nachtragen',
    /Boden/.test(nachBearbeiten) && /12,0/.test(nachBearbeiten))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ---------------------------------- Plausibilitaet ohne Urteil */
  await oeffneWettkampf(pc, 'Gerätefinale Reck')
  await zumBearbeiten(pc)
  await fuelleGeraet(pc, 'Boden', { 'Endnote': '12,5' })
  await pc.page.waitForTimeout(500)
  const hinweisText = await pc.page.locator('.modal .wk-karte')
    .filter({ hasText: 'Boden' }).first().innerText()
  pruefe('Bei einer Abweichung stellt LifeHub beide Zahlen nebeneinander',
    /12,0/.test(hinweisText) && /12,5/.test(hinweisText), zerlege(hinweisText).find((z) => /ergibt/.test(z)))
  pruefe('Ohne ein Urteil zu fällen',
    /Beides kann richtig sein/.test(hinweisText) && !/falsch|Fehler/i.test(hinweisText))
  const speicherbar = await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Speichern' }).first().isEnabled()
  pruefe('Und hält vom Speichern nicht ab', speicherbar)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ------------------------------------------------- Auswertung */
  const auswertung = await text(pc)
  pruefe('Die Auswertung ist da', /Auswertung/.test(auswertung))
  await pc.page.locator('button', { hasText: 'Bestwerte und Starts' }).first().click()
  await pc.page.waitForTimeout(600)
  const bestwerte = await text(pc)
  pruefe('Sie nennt Bestwerte und Starts je Gerät',
    /Starts|1 Start/.test(bestwerte) && /best\./.test(bestwerte))
  pruefe('Ohne eine Rangfolge zwischen den Geräten zu behaupten',
    /nicht dieselbe Währung/.test(bestwerte))
  pruefe('Und ohne eine Aussage über Training und Wettkampf',
    !/Korrelation|Zusammenhang zwischen Training/i.test(bestwerte))

  /* ================================================= Das Handy sieht es */
  await abgleich(pc)
  handy = await starteGeraet({ name: 'wk-handy', url: web.url, viewport: { width: 390, height: 844 } })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)

  await geh(handy, '/turnen/wettkaempfe', 2000)
  const amHandy = await text(handy)
  pruefe('Handy sieht beide Wettkämpfe',
    /Bezirksmeisterschaft/.test(amHandy) && /Gerätefinale Reck/.test(amHandy))

  await oeffneWettkampf(handy, 'Bezirksmeisterschaft')
  pruefe('Mit denselben Noten', (await endnoteIm(handy, 'Boden')) === '12,35')
  await handy.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
    .locator('button', { hasText: 'Fassung vom' }).first().click()
  await handy.page.waitForTimeout(900)
  const handyFassung = await fassungsFolge(handy)
  pruefe('Und derselben historischen Kürfassung',
    JSON.stringify(handyFassung) === JSON.stringify(fassungOkt), handyFassung.join(' · '))
  await handy.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ------------------------------- 390 px und dunkle Ansicht */
  const breiteDetail = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Das Wettkampfdetail bleibt auf 390 px im Rahmen',
    breiteDetail.doc <= breiteDetail.fenster + 1,
    `${breiteDetail.doc} px Inhalt, ${breiteDetail.fenster} px Fenster`)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(800)
  const dunkel = await handy.page.evaluate(() => {
    const karte = document.querySelector('.wk-karte')
    return karte ? {
      thema: document.documentElement.getAttribute('data-theme'),
      hintergrund: getComputedStyle(karte).backgroundColor,
    } : null
  })
  pruefe('Die dunkle Ansicht greift auch im Wettkampf',
    dunkel?.thema === 'dark', JSON.stringify(dunkel))
  await handy.page.emulateMedia({ colorScheme: 'light' })
  await handy.page.waitForTimeout(500)
  await handy.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await handy.page.waitForTimeout(600)

  // Der Editor mit sechs Geraeten muss am Handy erfassbar bleiben.
  await oeffneWettkampf(handy, null)
  await handy.page.locator('.modal input').first().fill('Mehrkampf am Handy')
  for (const g of ['Boden', 'Pauschenpferd', 'Ringe', 'Sprung', 'Barren', 'Reck']) {
    await handy.page.locator('.modal .turn-geraete .turn-geraet', { hasText: g }).first().click()
    await handy.page.waitForTimeout(150)
  }
  await handy.page.waitForTimeout(500)
  const sechs = await handy.page.locator('.modal .wk-karte').count()
  pruefe('Sechs Geräte lassen sich am Handy auf einmal öffnen', sechs === 6, `${sechs} Karten`)
  const breiteEditor = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Auch der Editor läuft auf 390 px nicht heraus',
    breiteEditor.doc <= breiteEditor.fenster + 1,
    `${breiteEditor.doc} px Inhalt, ${breiteEditor.fenster} px Fenster`)
  const feldBreite = await handy.page.locator('.modal .wk-felder .input').first()
    .evaluate((el) => el.getBoundingClientRect().width)
  pruefe('Die Notenfelder sind am Handy breit genug', feldBreite >= 70,
    `${Math.round(feldBreite)} px`)
  await handy.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ================================================= Offline erfassen */
  await handy.ctx.setOffline(true)
  await oeffneWettkampf(handy, null)
  await handy.page.locator('.modal input').first().fill('Hallenpokal')
  await handy.page.locator('.modal .field', { hasText: 'Datum' }).locator('input').first().fill('2026-11-15')
  await handy.page.waitForTimeout(300)
  await handy.page.locator('.modal .turn-geraete .turn-geraet', { hasText: 'Barren' }).first().click()
  await handy.page.waitForTimeout(300)
  await fuelleGeraet(handy, 'Barren', { 'D-Wert': '3,6', 'E-Wert': '8,4', 'Endnote': '12,0' })
  await speichere(handy)
  pruefe('Offline lässt sich ein Wettkampf erfassen',
    /Hallenpokal/.test(await text(handy)))

  await handy.ctx.setOffline(false)
  await handy.page.waitForTimeout(600)
  await abgleich(handy)
  await abgleich(pc)

  await geh(pc, '/turnen/wettkaempfe', 1800)
  const amPc = await text(pc)
  pruefe('Nach dem Abgleich sieht der PC den offline erfassten Wettkampf',
    /Hallenpokal/.test(amPc))
  await oeffneWettkampf(pc, 'Hallenpokal')
  pruefe('Mit den offline eingetragenen Noten', (await endnoteIm(pc, 'Barren')) === '12,0')
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Schließen' }).first().click()
  await pc.page.waitForTimeout(600)

  const wkServer = server.zeilen('gym_competitions').filter((z) => !z.deleted_at)
  pruefe('Auf dem Server liegen drei Wettkämpfe', wkServer.length === 3, `${wkServer.length}`)

  /* ------------------------------------------------ Wettkampf löschen */
  const vorLoeschen = server.zeilen('gym_results').filter((z) => !z.deleted_at).length
  await oeffneWettkampf(pc, 'Hallenpokal')
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(1400)
  pruefe('Ein gelöschter Wettkampf verschwindet aus der Liste',
    !/Hallenpokal/.test(await text(pc)))

  await abgleich(pc)
  const nachLoeschen = server.zeilen('gym_results').filter((z) => !z.deleted_at).length
  pruefe('Seine Ergebnisse gehen logisch mit', nachLoeschen === vorLoeschen - 1,
    `${vorLoeschen} vorher, ${nachLoeschen} nachher`)
  pruefe('Die Kürfassungen bleiben dabei erhalten',
    server.zeilen('gym_routine_versions').filter((z) => !z.deleted_at).length === fasErst)

  await abgleich(handy)
  await geh(handy, '/turnen/wettkaempfe', 2000)
  pruefe('Das Handy sieht die Löschung ebenfalls',
    !/Hallenpokal/.test(await text(handy)))

  /* ----------------------------------- Regression: Küren und Training */
  await geh(pc, '/turnen/kueren', 1500)
  pruefe('Der Reiter Küren funktioniert weiterhin',
    !/Fehler/.test(await text(pc)))
  await geh(pc, '/turnen/training', 1500)
  pruefe('Der Reiter Training ebenfalls',
    /Training/.test(await text(pc)))

  /* ------------------------------------------------- Konsolenfehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/i.test(f))
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
