/**
 * Turnen, Phase 3C: Kommender Wettkampf und Wettkampfstand im Browser.
 *
 * Die Regeln selbst sind in `turnen-wettkampfvorbereitung.test.ts` einzeln
 * nachgerechnet. Hier geht es um den Weg, den die Unit-Tests nicht zeigen:
 *
 *   Turnen öffnen → noch kein kommender Wettkampf → einen anlegen → Countdown
 *   steht da → Küren erscheinen je Gerät → Training mit Elementversuchen UND
 *   Kürdurchgang erfassen → zurück zur Übersicht → der Wettkampfstand hat sich
 *   geändert → Kür ändern → die alten Durchgänge zählen nicht mehr → der
 *   historische Wettkampf bleibt unberührt
 *
 * Dazu die Stellen, an denen eine solche Ansicht typischerweise Schaden
 * anrichtet:
 *
 *   - ein künftiger Wettkampf darf kein Ergebnis erzeugen
 *   - er darf nicht in der Leistungsanalyse auftauchen
 *   - ein vergangener Termin darf nicht automatisch als absolviert gelten
 *   - es darf keine Tabelle und keine Einstellung dafür entstehen
 *   - der Trainingsvorschlag muss ohne Wettkampf unverändert funktionieren
 *   - nirgends ein Prozentwert oder eine sportwissenschaftliche Aussage
 *
 * Dazu: 390 px, dunkler Modus, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-wettkampfziel-e2e.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const server = await starteNachbau({ port: 54413 })
const web = await starteWebserver(8105)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

/** Tage relativ zu heute als YYYY-MM-DD – lokal, wie das Datumsfeld erwartet. */
function tagIn(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const zielKarte = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächster Wettkampf' }).first()
const zielText = async (g) => (await zielKarte(g).innerText()).replace(/\n/g, ' | ')

const planBlock = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächstes Training' }).first()
const planText = async (g) => (await planBlock(g).innerText()).replace(/\n/g, ' | ')

/** Die Gerätezeilen der Wettkampfkarte mit ihren Angaben. */
const zielGeraete = (g) => g.page.evaluate(() => {
  const karte = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('.card-title')?.textContent?.includes('Nächster Wettkampf'))
  if (!karte) return []
  return [...karte.querySelectorAll('.wz-geraet')].map((el) => ({
    name: el.querySelector('.wz-geraet-name')?.textContent?.trim() ?? '',
    pille: el.querySelector('.pill')?.textContent?.trim() ?? '',
    zeilen: [...el.querySelectorAll('.wz-geraet-zeilen span')]
      .map((x) => x.textContent?.trim() ?? ''),
  }))
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

/** Ein Element zu einer bestehenden Kür hinzufügen – die Fassung ändert sich. */
async function ergaenzeKuer(g, { kuer, element }) {
  await geh(g, '/turnen/kueren', 1400)
  await g.page.locator('.list-row', { hasText: kuer }).first().click()
  await g.page.waitForTimeout(900)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: '+ Element' }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal').last()
    .locator('.list-row', { hasText: element }).first().click()
  await g.page.waitForTimeout(300)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Fertig' }).first().click()
  await g.page.waitForTimeout(700)
  await g.page.locator('.modal').last()
    .locator('button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1500)
}

/**
 * Einen Wettkampf anlegen – mit oder ohne Noten.
 *
 * Ohne `noten` entsteht genau das, worum es in Phase 3C geht: ein Wettkampf
 * mit Namen und Datum und ohne eine einzige Ergebniszeile.
 */
async function legeWettkampfAn(g, { name, tag, ort, noten }) {
  await geh(g, '/turnen/wettkaempfe', 1600)
  await g.page.locator('button', { hasText: /^\+ Wettkampf$/ }).first().click()
  await g.page.waitForTimeout(900)
  const modal = g.page.locator('.modal').last()
  await modal.locator('input').first().fill(name)
  await modal.locator('input[type=date]').first().fill(tag)
  await g.page.waitForTimeout(400)
  if (ort) {
    await modal.locator('.field', { hasText: 'Ort' }).locator('input').first().fill(ort)
  }
  if (noten) {
    await modal.locator('.turn-geraet', { hasText: noten.geraet }).first().click()
    await g.page.waitForTimeout(600)
    const felder = modal.locator('.wk-geraet, .wk-liste > *').first()
    for (const [label, wert] of Object.entries(noten.werte)) {
      await felder.locator('.field', { hasText: label }).locator('input').first().fill(wert)
      await g.page.waitForTimeout(150)
    }
  }
  await modal.locator('button', { hasText: /^(Speichern)$/ }).first().click()
  await g.page.waitForTimeout(1800)
}

/** Eine Einheit mit Elementversuchen und optional Kürdurchgängen erfassen. */
async function erfasseTraining(g, { geraet, tipps, durchgaenge }) {
  await geh(g, '/turnen/training', 1600)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await g.page.waitForTimeout(900)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(700)

  for (const [elementName, guete] of Object.entries(tipps ?? {})) {
    const zeile = g.page.locator('.turn-zeile', { hasText: elementName }).first()
    const knoepfe = zeile.locator('.turn-zaehler-knopf')
    for (const [welche, anzahl] of Object.entries(guete)) {
      const index = welche === 'clean' ? 0 : welche === 'shaky' ? 1 : 2
      for (let i = 0; i < anzahl; i++) await knoepfe.nth(index).click()
    }
  }

  for (const [i, d] of (durchgaenge ?? []).entries()) {
    await g.page.locator('.modal button', { hasText: '+ Durchgang' }).first().click()
    await g.page.waitForTimeout(400)
    const zeile = g.page.locator('.modal .turn-durchgang').nth(i)
    if (d.komplett === false) {
      await zeile.locator('.turn-durchgang-schalter').first().click()
      await g.page.waitForTimeout(150)
    }
    for (let n = 0; n < (d.stuerze ?? 0); n++) {
      await zeile.locator('.turn-zaehlfeld').filter({ hasText: 'Stürze' })
        .locator('button', { hasText: '+' }).first().click()
    }
  }

  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1900)
}

const wettkaempfeAufServer = () =>
  server.zeilen('gym_competitions').filter((z) => !z.deleted_at)
const ergebnisseAufServer = () =>
  server.zeilen('gym_results').filter((z) => !z.deleted_at)

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'wz-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  /* =============== Schritt 1: Turnen öffnen – noch ist alles leer =======
     Ohne ein einziges Element und ohne Termin bleibt der Einstieg, wie er
     war: eine Wettkampfkarte ueber nichts waere nur Lärm. */
  await geh(pc, '/turnen', 2200)
  const ganzLeer = (await pc.page.innerText('#root')).replace(/\n/g, ' | ')
  pruefe('Ohne Elemente und ohne Termin steht der Einstieg da',
    /noch leer|Elemente anlegen/.test(ganzLeer), ganzLeer.slice(0, 300))
  pruefe('Und keine Wettkampfkarte',
    (await zielKarte(pc).count()) === 0, ganzLeer.slice(0, 200))

  /* ===== Schritt 2: ein Termin OHNE jede Turndaten ist trotzdem sichtbar ==
     Ein kommender Wettkampf ist eine eigenstaendige Auskunft. Ihn hinter dem
     Element-Onboarding zu verstecken hiesse, ihn unerreichbar zu machen. */
  await legeWettkampfAn(pc, { name: 'Vorab-Termin', tag: tagIn(19), ort: 'Dresden' })
  await geh(pc, '/turnen', 2600)
  const nurTermin = await zielText(pc)
  pruefe('Der Termin steht auch ohne ein einziges Element da',
    /Vorab-Termin/.test(nurTermin), nurTermin.slice(0, 300))
  pruefe('Mit Datum und Countdown',
    /in 19 Tagen/.test(nurTermin), nurTermin.slice(0, 300))
  pruefe('Es wird benannt, dass Turndaten fehlen',
    /Noch keine Elemente oder Wettkampfküren hinterlegt/.test(nurTermin),
    nurTermin.slice(0, 400))
  pruefe('Und es entstehen KEINE leeren Gerätekarten',
    (await zielGeraete(pc)).length === 0, JSON.stringify(await zielGeraete(pc)))
  pruefe('Es gibt auch keinen Details-Knopf über nichts',
    (await zielKarte(pc).locator('button', { hasText: 'Details' }).count()) === 0)
  const einstiegDaneben = (await pc.page.innerText('#root')).replace(/\n/g, ' | ')
  pruefe('Der bestehende Einstieg bleibt darunter stehen',
    /noch leer|Elemente anlegen/.test(einstiegDaneben), einstiegDaneben.slice(0, 400))
  pruefe('Es sind dabei keine Elemente entstanden',
    server.zeilen('gym_elements').filter((z) => !z.deleted_at).length === 0,
    `${server.zeilen('gym_elements').filter((z) => !z.deleted_at).length}`)
  pruefe('Und keine Kür',
    server.zeilen('gym_routines').filter((z) => !z.deleted_at).length === 0,
    `${server.zeilen('gym_routines').filter((z) => !z.deleted_at).length}`)

  /* ----------------------------- Der Leerzustand bei 390 px und dunkel */
  await pc.page.setViewportSize({ width: 390, height: 844 })
  await pc.page.emulateMedia({ colorScheme: 'dark' })
  await geh(pc, '/turnen', 2400)
  pruefe('Der Leerzustand zeigt den Termin auch am Handy im dunklen Modus',
    /Vorab-Termin/.test(await zielText(pc)) && /in 19 Tagen/.test(await zielText(pc)),
    (await zielText(pc)).slice(0, 300))
  const leerUeberlauf = await pc.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Er läuft dabei nicht seitlich weg',
    leerUeberlauf.doc <= leerUeberlauf.fenster + 2,
    `${leerUeberlauf.doc} > ${leerUeberlauf.fenster}`)
  const leerKontrast = await pc.page.evaluate(() => {
    const el = document.querySelector('.wz-name')
    if (!el) return null
    return { farbe: getComputedStyle(el).color, grund: getComputedStyle(document.body).backgroundColor }
  })
  pruefe('Und hebt sich im dunklen Modus ab',
    !!leerKontrast && leerKontrast.farbe !== leerKontrast.grund,
    JSON.stringify(leerKontrast))
  await pc.page.emulateMedia({ colorScheme: 'light' })
  await pc.page.setViewportSize({ width: 1280, height: 900 })

  /* --------------- Wettkampf entfernen: die Karte verschwindet wieder */
  await geh(pc, '/turnen/wettkaempfe', 1800)
  await pc.page.locator('.list-row', { hasText: 'Vorab-Termin' }).first().click()
  await pc.page.waitForTimeout(900)
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).first().click()
  await pc.page.waitForTimeout(700)
  await pc.page.locator('.modal button', { hasText: 'Löschen' }).last().click()
  await pc.page.waitForTimeout(1500)
  await abgleich(pc)
  await geh(pc, '/turnen', 2400)
  pruefe('Nach dem Löschen ist die Wettkampfkarte wieder weg',
    (await zielKarte(pc).count()) === 0,
    (await pc.page.innerText('#root')).replace(/\n/g, ' | ').slice(0, 300))

  /* ============ Schritt 3: Elemente und Wettkampfküren an zwei Geräten */
  await legeElementAn(pc, { name: 'Riesenfelge', geraet: 'Reck', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Tkatschew', geraet: 'Reck', buchstabe: 'D', wert: '0,4' })
  await legeElementAn(pc, { name: 'Jaeger', geraet: 'Reck', buchstabe: 'D', wert: '0,4' })
  await legeElementAn(pc, { name: 'Felge vorwärts', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Kippe zum Handstand', geraet: 'Barren', buchstabe: 'C', wert: '0,3' })
  await legeWettkampfKuerAn(pc, {
    name: 'Reckkür 2026', geraet: 'Reck', elemente: ['Riesenfelge', 'Tkatschew'],
  })
  await legeWettkampfKuerAn(pc, {
    name: 'Barrenkür 2026', geraet: 'Barren',
    elemente: ['Felge vorwärts', 'Kippe zum Handstand'],
  })

  /* ============= Schritt 4: noch kein kommender Wettkampf eingetragen */
  await geh(pc, '/turnen', 2600)
  const leer = await zielText(pc)
  pruefe('Ohne Wettkampf sagt die Karte das klar',
    /Noch kein kommender Wettkampf eingetragen/.test(leer), leer.slice(0, 300))
  pruefe('Und bietet einen Weg dorthin an',
    (await zielKarte(pc).locator('button', { hasText: 'Wettkampf hinzufügen' }).count()) > 0)
  pruefe('Der Trainingsvorschlag steht trotzdem da – er hängt an keinem Wettkampf',
    (await planBlock(pc).count()) > 0, (await planText(pc)).slice(0, 200))
  const planOhneWk = await planText(pc)
  pruefe('Und nennt dabei keinen Wettkampf',
    !/Wettkampf in [0-9]+ Tagen/.test(planOhneWk), planOhneWk.slice(0, 300))

  /* ========================= Schritt 5: einen Zukunftswettkampf anlegen */
  await legeWettkampfAn(pc, {
    name: 'Sachsenmeisterschaft', tag: tagIn(24), ort: 'Chemnitz',
  })
  await abgleich(pc)

  pruefe('Der Wettkampf liegt als gewöhnliche Zeile auf dem Server',
    wettkaempfeAufServer().some((z) => z.name === 'Sachsenmeisterschaft'),
    JSON.stringify(wettkaempfeAufServer().map((z) => z.name)))
  pruefe('Ein künftiger Wettkampf erzeugt KEINE Ergebniszeile',
    ergebnisseAufServer().length === 0, `${ergebnisseAufServer().length}`)
  const wkZeile = wettkaempfeAufServer().find((z) => z.name === 'Sachsenmeisterschaft')
  pruefe('Und trägt kein Statusfeld und keine Platzierung',
    wkZeile && wkZeile.rank_allround === null && wkZeile.score_allround === null
      && !('status' in wkZeile),
    JSON.stringify(wkZeile))

  /* ======================= Schritt 6: die Übersicht zeigt den Countdown */
  await geh(pc, '/turnen', 2600)
  const mitWk = await zielText(pc)
  pruefe('Der Name steht da', /Sachsenmeisterschaft/.test(mitWk), mitWk.slice(0, 300))
  pruefe('Und der Abstand in Kalendertagen',
    /in 24 Tagen/.test(mitWk), mitWk.slice(0, 300))
  pruefe('Der Ort steht dabei', /Chemnitz/.test(mitWk), mitWk.slice(0, 300))
  pruefe('Es steht keine Bewertung des Abstands da',
    !/reich|spät|knapp|rechtzeitig|genug Zeit/i.test(mitWk), mitWk.slice(0, 400))
  pruefe('Und kein Prozentwert über die Wettkampfbereitschaft',
    !/\d+\s?%/.test(mitWk), mitWk.slice(0, 400))

  /* ================= Schritt 7: die aktuellen Wettkampfküren je Gerät */
  const geraete1 = await zielGeraete(pc)
  pruefe('Beide Geräte mit Wettkampfkür stehen da',
    geraete1.length === 2, JSON.stringify(geraete1))
  pruefe('In Wettkampfreihenfolge – Barren vor Reck',
    geraete1[0].name === 'Barren' && geraete1[1].name === 'Reck',
    JSON.stringify(geraete1.map((g) => g.name)))
  pruefe('Je Gerät steht der Name der Kür',
    geraete1.some((g) => g.zeilen.some((z) => /Reckkür 2026/.test(z))),
    JSON.stringify(geraete1))
  pruefe('Ohne Trainingsdaten fallen die Kürelemente auf',
    geraete1.every((g) => /auffällig/i.test(g.pille)),
    JSON.stringify(geraete1.map((g) => g.pille)))
  pruefe('Die Herkunft der Geräteliste wird benannt',
    /erfasst LifeHub nicht/.test(mitWk), mitWk.slice(0, 500))

  /* ================== Schritt 8: Training mit Versuchen UND Durchgang */
  await erfasseTraining(pc, {
    geraet: 'Reck',
    tipps: { Riesenfelge: { clean: 12 }, Tkatschew: { clean: 12 } },
    durchgaenge: [{ komplett: true }, { komplett: true }, { komplett: true }],
  })
  await abgleich(pc)

  const runs = server.zeilen('gym_routine_runs').filter((z) => !z.deleted_at)
  pruefe('Die Kürdurchgänge sind gespeichert', runs.length === 3, `${runs.length}`)
  pruefe('Es ist dadurch kein Wettkampfergebnis entstanden',
    ergebnisseAufServer().length === 0, `${ergebnisseAufServer().length}`)

  /* ============== Schritt 9: der Wettkampfstand reagiert auf die Daten */
  await geh(pc, '/turnen', 2800)
  const geraete2 = await zielGeraete(pc)
  const reck2 = geraete2.find((g) => g.name === 'Reck')
  pruefe('Reck steht nach dem guten Training ohne offene Punkte da',
    reck2 && /keine offenen Punkte/i.test(reck2.pille), JSON.stringify(reck2))
  pruefe('Die Kür am Stück ist jetzt als stabil benannt',
    reck2 && reck2.zeilen.some((z) => /Kür am Stück: stabil/.test(z)),
    JSON.stringify(reck2))
  const barren2 = geraete2.find((g) => g.name === 'Barren')
  pruefe('Barren bleibt unberührt auffällig – ein Gerät färbt nicht auf das andere ab',
    barren2 && /auffällig/i.test(barren2.pille), JSON.stringify(barren2))

  pruefe('Der Trainingsvorschlag nennt den Wettkampf als Kontext',
    /Wettkampf in 24 Tagen/.test(await planText(pc)),
    (await planText(pc)).slice(0, 400))

  /* ------------------------------------------------- Die Detailansicht */
  await zielKarte(pc).locator('button', { hasText: 'Details' }).first().click()
  await pc.page.waitForTimeout(900)
  const detail = (await pc.page.locator('.modal').last().innerText()).replace(/\n/g, ' | ')
  pruefe('Das Detail nennt die Schwierigkeitssumme',
    /Schwierigkeitssumme/.test(detail), detail.slice(0, 400))
  pruefe('Und nennt sie ausdrücklich nicht D-Wert',
    !/Schwierigkeitssumme[^|]*D-Wert/.test(detail), detail.slice(0, 500))
  pruefe('Es stehen die Einzelzahlen der Durchgänge da',
    /komplett/.test(detail) && /sturzfrei/.test(detail), detail.slice(0, 600))
  pruefe('Der Vorbehalt zur Kategorie steht dabei',
    /keine Zusage/i.test(detail), detail.slice(0, 900))
  pruefe('Ohne Wettkampfergebnis sagt das Detail genau das',
    /noch kein ausgewertetes Wettkampfergebnis/i.test(detail), detail.slice(0, 900))
  await pc.page.locator('.modal button', { hasText: 'Schliessen' }).first().click()
  await pc.page.waitForTimeout(700)

  /* ============ Schritt 10: Kür ändern – alte Durchgänge zählen nicht */
  await ergaenzeKuer(pc, { kuer: 'Reckkür 2026', element: 'Jaeger' })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const geraete3 = await zielGeraete(pc)
  const reck3 = geraete3.find((g) => g.name === 'Reck')
  pruefe('Nach der Küränderung gilt die aktuelle Fassung als nicht erfasst',
    reck3 && reck3.zeilen.some((z) => /aktuelle Fassung noch nicht erfasst/i.test(z)),
    JSON.stringify(reck3))
  pruefe('Und die drei alten Durchgänge stehen nicht mehr als Kürstabilität da',
    reck3 && !reck3.zeilen.some((z) => /Kür am Stück: stabil/.test(z)),
    JSON.stringify(reck3))
  pruefe('Die Durchgänge selbst sind nicht gelöscht worden',
    server.zeilen('gym_routine_runs').filter((z) => !z.deleted_at).length === 3,
    `${server.zeilen('gym_routine_runs').filter((z) => !z.deleted_at).length}`)

  /* ====== Schritt 11: ein historischer Wettkampf bleibt unverändert ====== */
  await legeWettkampfAn(pc, {
    name: 'Bezirksmeisterschaft', tag: tagIn(-40),
    noten: { geraet: 'Reck', werte: { 'D-Wert': '3,2', 'E-Wert': '7,8', Endnote: '11,0' } },
  })
  await abgleich(pc)
  const altesErgebnis = ergebnisseAufServer().find((z) => z.apparatus === 'reck')
  pruefe('Das historische Ergebnis ist gespeichert',
    !!altesErgebnis && Number(altesErgebnis.final_score) === 11,
    JSON.stringify(altesErgebnis))
  const standVorher = JSON.stringify(altesErgebnis)

  await geh(pc, '/turnen', 2800)
  const mitHistorie = await zielText(pc)
  pruefe('Der kommende Wettkampf ist weiterhin der künftige',
    /Sachsenmeisterschaft/.test(mitHistorie) && /in 24 Tagen/.test(mitHistorie),
    mitHistorie.slice(0, 300))
  pruefe('Der vergangene Wettkampf erscheint nicht als kommender',
    !/Bezirksmeisterschaft[^|]*in \d+ Tagen/.test(mitHistorie), mitHistorie.slice(0, 400))

  // Eine weitere Kueraenderung darf das historische Ergebnis nicht anfassen.
  await ergaenzeKuer(pc, { kuer: 'Barrenkür 2026', element: 'Felge vorwärts' })
  await abgleich(pc)
  pruefe('Das historische Ergebnis ist unverändert geblieben',
    JSON.stringify(ergebnisseAufServer().find((z) => z.apparatus === 'reck')) === standVorher,
    `${standVorher} -> ${JSON.stringify(ergebnisseAufServer().find((z) => z.apparatus === 'reck'))}`)

  /* ===== Schritt 12: ein vergangener Termin ohne Ergebnis wird benannt */
  await legeWettkampfAn(pc, { name: 'Pokalturnen', tag: tagIn(-5) })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const mitOffenem = await zielText(pc)
  pruefe('Ein vergangener Termin ohne Ergebnis wird benannt',
    /Ergebnis ist noch nicht erfasst|noch kein erfasstes Ergebnis/.test(mitOffenem),
    mitOffenem.slice(0, 500))
  pruefe('Es ist dafür kein Ergebnis erzeugt worden',
    ergebnisseAufServer().filter((z) => z.competition_id
      === wettkaempfeAufServer().find((w) => w.name === 'Pokalturnen')?.id).length === 0)

  /* ========== Schritt 13: mehrere kommende Wettkämpfe, keine Periodisierung */
  await legeWettkampfAn(pc, { name: 'Landesfinale', tag: tagIn(60) })
  await abgleich(pc)
  await geh(pc, '/turnen', 2800)
  const mitZweien = await zielText(pc)
  pruefe('Der nächste bleibt primär',
    mitZweien.indexOf('Sachsenmeisterschaft') < mitZweien.indexOf('Landesfinale'),
    mitZweien.slice(0, 400))
  // Die Kopfzeile steht per CSS in Grossbuchstaben - `innerText` liefert sie
  // so, wie sie dasteht.
  pruefe('Der weitere steht nur als Liste darunter',
    /danach/i.test(mitZweien) && /Landesfinale/.test(mitZweien), mitZweien.slice(0, 500))
  pruefe('Ohne eine Aussage über die Verteilung zwischen beiden',
    !/zuerst|Aufbau|Formaufbau|Höhepunkt|Zwischenwettkampf/i.test(mitZweien),
    mitZweien.slice(0, 600))

  /* ============== Schritt 14: keine Tabelle, keine Einstellung dafür */
  const tabellen = Object.keys(server.alleTabellen ? server.alleTabellen() : {})
  pruefe('Es ist keine Tabelle für Wettkampfbereitschaft entstanden',
    tabellen.filter((t) => /readiness|wettkampfziel|competition_goal|upcoming/i.test(t)).length === 0,
    JSON.stringify(tabellen))
  const einstellungen = server.zeilen('settings').filter((z) => !z.deleted_at)
  pruefe('Und keine Einstellung',
    einstellungen.filter((z) => /wettkampfziel|readiness|countdown/i.test(z.key ?? '')).length === 0)

  /* ============ Schritt 15: die Leistungsanalyse ignoriert den Termin */
  await geh(pc, '/turnen/analyse', 2400)
  const analyse = (await pc.page.innerText('#root')).replace(/\n/g, ' | ')
  pruefe('Die Analyse wertet den künftigen Wettkampf nicht aus',
    !/Sachsenmeisterschaft/.test(analyse), analyse.slice(0, 500))

  /* ============================================ Handy: 390 px und dunkel */
  handy = await starteGeraet({
    name: 'wz-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 3000)

  const handyText = await zielText(handy)
  pruefe('Das Handy zeigt den Countdown',
    /in 24 Tagen/.test(handyText), handyText.slice(0, 300))
  const handyGeraete = await zielGeraete(handy)
  pruefe('Und beide Geräte', handyGeraete.length === 2, JSON.stringify(handyGeraete))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Übersicht läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const passt = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll(
      '.wz-kopf, .wz-geraet, .wz-geraet-kopf, .wz-weitere-zeile, .wz-geraet-zeilen')]
    return els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Wettkampfzeilen passen in die Breite', passt)

  await zielKarte(handy).locator('button', { hasText: 'Details' }).first().click()
  await handy.page.waitForTimeout(1000)
  const detailPasst = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.modal .wz-detail, .modal .kennzeile')]
    return els.length > 0 && els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Die Detailansicht passt bei 390 px', detailPasst)
  await handy.page.locator('.modal button', { hasText: 'Schliessen' }).first().click()
  await handy.page.waitForTimeout(600)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(900)
  pruefe('Im dunklen Modus steht dasselbe da',
    /in 24 Tagen/.test(await zielText(handy)))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.wz-geraet-name')
    if (!el) return null
    const s = getComputedStyle(el)
    const k = getComputedStyle(document.body)
    return { farbe: s.color, grund: k.backgroundColor }
  })
  pruefe('Und hebt sich vom Hintergrund ab',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })

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
