/**
 * Turnen, Phase 3A: Nächstes Training im Browser.
 *
 * Die Auswahlregeln sind in `turnen-trainingsplanung.test.ts` einzeln
 * nachgerechnet. Hier geht es um den Weg, den die Unit-Tests nicht zeigen:
 *
 *   Wettkampf importieren → Elemente und Küren anlegen → Vorschlag steht da
 *   → Training erfassen → die Analyse zieht nach → **der Vorschlag reagiert
 *   darauf** → Nutzer ändert die Auswahl
 *
 * Geprüft wird ausdrücklich die Veränderung, und zwar in dieser Reihenfolge:
 *
 *   1. ohne Trainingsdaten – keine Elementempfehlung, aber ein Durchgang
 *   2. nach gutem Training – der schwierigere Kandidat erscheint
 *   3. nach abgebrochenen Kürdurchgängen – die Kür rückt nach vorn
 *   4. nach schlechtem Training – die Elemente rücken nach vorn, der Kandidat
 *      verschwindet
 *
 * Die Kuerdurchgaenge muessen VOR dem schlechten Training kommen: Ein
 * schlechtes Training bleibt 56 Tage im Beobachtungsfenster, und danach
 * koennen die Elemente gar nicht mehr `stabil` sein – der Fall „Elemente
 * stehen, Kür nicht" wäre dann nicht mehr herstellbar. Genau daran ist diese
 * Prüfung beim ersten Lauf gescheitert.
 *
 * Vier Geräte werden aufgebaut, nicht eines: Reihenfolge ändern, abwählen und
 * dazunehmen sind an einem einzigen Gerät nicht prüfbar.
 *
 * Dazu: dass die Nutzerwahl nichts speichert, dass es **keine** Zeitplanung
 * gibt, 390 px, dunkler Modus, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-trainingsplanung-e2e.mjs
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-tp-'))
const PDF_DATEI = path.join(TMP, 'Sachsenmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter\n')

const server = await starteNachbau({ port: 54407, protokoll: seitenBestand })
const web = await starteWebserver(8099)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

/** Der Block „Nächstes Training" auf der Turnübersicht. */
const planBlock = (g) =>
  g.page.locator('.card').filter({ hasText: 'Nächstes Training' }).first()

/** Die Karte eines Geräts im Vorschlag. */
const planGeraet = (g, geraet) =>
  planBlock(g).locator('.np-geraet').filter({ hasText: geraet }).first()

const planText = async (g) => (await planBlock(g).innerText()).replace(/\n/g, ' | ')

/** Die Gerätenamen im Vorschlag, in Reihenfolge. */
async function vorschlag(g) {
  return g.page.evaluate(() => {
    const karte = [...document.querySelectorAll('.card')]
      .find((c) => c.textContent?.includes('Nächstes Training'))
    if (!karte) return []
    return [...karte.querySelectorAll('.np-geraet .np-name')].map((e) => e.textContent?.trim())
  })
}

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

/** Ein Training erfassen: je Element so viele Tipps auf die gewünschte Güte. */
async function erfasseTraining(g, { geraet, tipps, durchgaenge }) {
  await geh(g, '/turnen/training', 1500)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await g.page.waitForTimeout(800)
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
  await g.page.waitForTimeout(1800)
}

/** Die Begründungen eines Geräts aufklappen. */
async function klappeAuf(g, geraet) {
  const karte = planGeraet(g, geraet)
  const knopf = karte.locator('button').filter({ hasText: /Warum dieses Gerät/ }).first()
  if (await knopf.count()) {
    await knopf.click()
    await g.page.waitForTimeout(500)
  }
  return karte.innerText()
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'tp-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  if (await namensfeld.count()) {
    await namensfeld.fill('Erik Ehnert')
    await pc.page.waitForTimeout(700)
  }

  /* ------------------------------------------ Ohne alles: klare Aussage */
  await geh(pc, '/turnen', 1800)
  const leer = await text(pc)
  pruefe('Ohne Elemente gibt es keinen Vorschlag, sondern einen Hinweis',
    /Turnen ist eingerichtet, aber noch leer/.test(leer) || /zu wenig Daten/.test(leer),
    leer.replace(/\n/g, ' | ').slice(0, 200))

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
  pruefe('Die Vergleichswerte liegen vor',
    server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length === 7)

  /* ==================== Schritt 2: Elemente und Kür, noch ohne Training */
  await legeElementAn(pc, { name: 'Felge vorwärts', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Kippe zum Handstand', geraet: 'Barren', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Doppelsalto Abgang', geraet: 'Barren', buchstabe: 'E', wert: '0,5' })
  await legeWettkampfKuerAn(pc, {
    name: 'Barrenkür 2026', geraet: 'Barren',
    elemente: ['Felge vorwärts', 'Kippe zum Handstand'],
  })

  await geh(pc, '/turnen', 2200)
  const ohneTraining = await planText(pc)
  pruefe('Der Block „Nächstes Training" steht auf der Übersicht',
    /Nächstes Training/.test(ohneTraining), ohneTraining.slice(0, 200))
  pruefe('Er sagt ausdrücklich, dass es ein Vorschlag ist',
    /Vorschlag, keine Verpflichtung/.test(ohneTraining))
  pruefe('Barren steht im Vorschlag', (await vorschlag(pc)).includes('Barren'),
    JSON.stringify(await vorschlag(pc)))
  pruefe('Ohne Trainingsdaten steht keine Elementempfehlung da',
    !/gezielt stabilisieren/.test(ohneTraining), ohneTraining.slice(0, 400))
  pruefe('Stattdessen der Hinweis, dass kein Versuch erfasst ist',
    /kein Versuch/.test(ohneTraining), ohneTraining.slice(0, 500))
  pruefe('Und trotzdem ein Kürdurchgang – der ist keine Elementempfehlung',
    /vollständig turnen|vollständige Kürdurchgänge/.test(ohneTraining),
    ohneTraining.slice(0, 500))

  /* ================= Schritt 3: gutes Training – der Kandidat erscheint */
  for (let runde = 0; runde < 2; runde++) {
    await erfasseTraining(pc, {
      geraet: 'Barren',
      tipps: {
        'Felge vorwärts': { clean: 6 },
        'Kippe zum Handstand': { clean: 6 },
        'Doppelsalto Abgang': { clean: 6 },
      },
    })
  }

  await geh(pc, '/turnen', 2200)
  const nachGut = await planText(pc)
  pruefe('Nach gutem Training steht der schwierigere Kandidat im Plan',
    /Doppelsalto Abgang/.test(nachGut), nachGut.slice(0, 600))
  pruefe('Und zwar als „prüfen", nicht als „einbauen"',
    /prüfen/.test(nachGut) && !/einbauen/.test(nachGut), nachGut.slice(0, 600))
  pruefe('Die Entwicklungsarbeit steht bei stabiler Kür vorn',
    /Schwierigkeit zuerst/.test(nachGut), nachGut.slice(0, 600))

  const barrenGut = await klappeAuf(pc, 'Barren')
  pruefe('Die Begründung nennt die echten Wettkampfplätze',
    /von 6/.test(barrenGut), barrenGut.replace(/\n/g, ' | ').slice(0, 400))
  pruefe('Und nennt das Beobachtungsfenster',
    /8 Wochen/.test(barrenGut), barrenGut.replace(/\n/g, ' | ').slice(0, 500))
  pruefe('Nirgends steht, dass der D-Wert dadurch steigt',
    !/erhöht/.test(barrenGut) && !/bringt 0,/.test(barrenGut))

  /* ========= Schritt 4: abgebrochene Kürdurchgänge holen die Kür nach vorn
     Muss VOR dem schlechten Training stehen: Danach liegen 56 Tage lang
     Stuerze im Fenster, und die Elemente koennen gar nicht mehr `stabil`
     sein - der Fall "Elemente stehen, Kuer nicht" waere nicht herstellbar.
     Genau daran ist diese Pruefung beim ersten Lauf gescheitert. */
  await erfasseTraining(pc, {
    geraet: 'Barren',
    tipps: {
      'Felge vorwärts': { clean: 10 },
      'Kippe zum Handstand': { clean: 10 },
    },
    durchgaenge: [
      { komplett: false, stuerze: 1 }, { komplett: false, stuerze: 1 },
      { komplett: false, stuerze: 1 }, { komplett: false, stuerze: 1 },
    ],
  })

  await geh(pc, '/turnen', 2400)
  const nachDurchgaengen = await planText(pc)
  pruefe('Bei stehenden Elementen und wackelnder Kür kommt die Kür zuerst',
    /Kür am Stück zuerst/.test(nachDurchgaengen), nachDurchgaengen.slice(0, 700))
  pruefe('Und es werden bis zu zwei vollständige Durchgänge vorgeschlagen',
    /1–2 vollständige Kürdurchgänge/.test(nachDurchgaengen),
    nachDurchgaengen.slice(0, 700))
  pruefe('Der Kandidat tritt dahinter zurück – erst muss die Kür durchkommen',
    !/Kandidaten prüfen/.test(nachDurchgaengen), nachDurchgaengen.slice(0, 700))

  const barrenKuer = await klappeAuf(pc, 'Barren')
  pruefe('Die Begründung sagt, dass die Einzelelemente stehen',
    /Einzelelemente stehen/.test(barrenKuer),
    barrenKuer.replace(/\n/g, ' | ').slice(0, 500))
  pruefe('Und nennt die Durchgangszahlen',
    /0 von 4 Durchgängen/.test(barrenKuer),
    barrenKuer.replace(/\n/g, ' | ').slice(0, 600))

  /* ============ Schritt 5: schlechtes Training kippt auf die Elemente */
  for (let runde = 0; runde < 2; runde++) {
    await erfasseTraining(pc, {
      geraet: 'Barren',
      tipps: {
        'Felge vorwärts': { shaky: 5, failed: 4 },
        'Kippe zum Handstand': { shaky: 5, failed: 4 },
      },
    })
  }

  await geh(pc, '/turnen', 2200)
  const nachSchlecht = await planText(pc)
  pruefe('Nach schlechtem Training stehen die Elemente vorn',
    /Erst die einzelnen Elemente/.test(nachSchlecht), nachSchlecht.slice(0, 600))
  pruefe('Die auffälligen Kürelemente stehen als Aufgabe da',
    /Felge vorwärts/.test(nachSchlecht) && /stabilisieren|festigen/.test(nachSchlecht),
    nachSchlecht.slice(0, 700))
  pruefe('Der Kandidat verschwindet – erst die Kür',
    !/Doppelsalto Abgang/.test(nachSchlecht), nachSchlecht.slice(0, 700))
  pruefe('Es wird nicht behauptet, ein Element habe die Note verursacht',
    !/verursacht/.test(nachSchlecht) && !/kostet dich/.test(nachSchlecht))

  /* ===== Schritt 6: drei weitere Geräte – jetzt greift die Auswahlgrenze
     Reihenfolge ändern, abwählen und dazunehmen sind an einem einzigen
     Gerät nicht prüfbar. */
  await legeElementAn(pc, { name: 'Riesenfelge', geraet: 'Reck', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Tkatschew', geraet: 'Reck', buchstabe: 'D', wert: '0,4' })
  await legeElementAn(pc, { name: 'Kreuzhang', geraet: 'Ringe', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Muskelaufzug', geraet: 'Ringe', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Flick-Flack', geraet: 'Boden', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Schraubensalto', geraet: 'Boden', buchstabe: 'D', wert: '0,4' })
  await legeWettkampfKuerAn(pc, {
    name: 'Reckkür 2026', geraet: 'Reck', elemente: ['Riesenfelge', 'Tkatschew'],
  })
  await legeWettkampfKuerAn(pc, {
    name: 'Ringekür 2026', geraet: 'Ringe', elemente: ['Kreuzhang', 'Muskelaufzug'],
  })
  await legeWettkampfKuerAn(pc, {
    name: 'Bodenkür 2026', geraet: 'Boden', elemente: ['Flick-Flack', 'Schraubensalto'],
  })

  await geh(pc, '/turnen', 2600)
  const vierGeraete = await vorschlag(pc)
  pruefe('Es stehen höchstens drei Geräte im Vorschlag, obwohl vier in Frage kämen',
    vierGeraete.length === 3, JSON.stringify(vierGeraete))
  pruefe('Und die Zahl steht in der Überschrift',
    /3 Geräte vorgeschlagen/.test(await planText(pc)))


  /* ================================ Schritt 7: der Nutzer greift ein */
  const vorherReihe = await vorschlag(pc)
  pruefe('Es stehen mehrere Geräte im Vorschlag', vorherReihe.length >= 2,
    JSON.stringify(vorherReihe))

  // Reihenfolge: das erste Gerät nach unten.
  await planGeraet(pc, vorherReihe[0]).locator('button[aria-label$="nach unten"]').first().click()
  await pc.page.waitForTimeout(600)
  const nachSchieben = await vorschlag(pc)
  pruefe('Die Reihenfolge lässt sich ändern',
    nachSchieben[0] === vorherReihe[1] && nachSchieben[1] === vorherReihe[0],
    `${JSON.stringify(vorherReihe)} -> ${JSON.stringify(nachSchieben)}`)

  // Einen Inhalt entfernen.
  const erstesGeraet = nachSchieben[0]
  const inhalteVorher = await planGeraet(pc, erstesGeraet).locator('.np-inhalt').count()
  await planGeraet(pc, erstesGeraet).locator('.np-weg').first().click()
  await pc.page.waitForTimeout(600)
  const inhalteNachher = await planGeraet(pc, erstesGeraet).locator('.np-inhalt').count()
  pruefe('Ein einzelner Inhalt lässt sich entfernen',
    inhalteNachher === inhalteVorher - 1, `${inhalteVorher} -> ${inhalteNachher}`)

  // Ein Gerät abwählen.
  await planGeraet(pc, erstesGeraet).locator('button[aria-label$="abwählen"]').first().click()
  await pc.page.waitForTimeout(600)
  const nachAbwahl = await vorschlag(pc)
  pruefe('Ein Gerät lässt sich abwählen', !nachAbwahl.includes(erstesGeraet),
    JSON.stringify(nachAbwahl))

  // Und eines dazunehmen.
  const nachwahl = planBlock(pc).locator('.np-nachwahl button').first()
  if (await nachwahl.count()) {
    const name = (await nachwahl.innerText()).replace('+', '').trim()
    await nachwahl.click()
    await pc.page.waitForTimeout(600)
    pruefe('Ein Gerät lässt sich dazunehmen', (await vorschlag(pc)).includes(name),
      `${name} in ${JSON.stringify(await vorschlag(pc))}`)
  } else {
    pruefe('Ein Gerät lässt sich dazunehmen', true, 'kein weiteres Gerät vorhanden')
  }

  // Zurücksetzen stellt den Vorschlag wieder her.
  await planBlock(pc).locator('button', { hasText: 'zurücksetzen' }).first().click()
  await pc.page.waitForTimeout(700)
  pruefe('Zurücksetzen stellt den Vorschlag wieder her',
    JSON.stringify(await vorschlag(pc)) === JSON.stringify(vorherReihe),
    `${JSON.stringify(await vorschlag(pc))} != ${JSON.stringify(vorherReihe)}`)

  /* ================== Schritt 8: keine Zeitplanung, nur der Umfang
     Phase 3A sagt WAS, nicht wie lange. Eine Minutenverteilung war
     kurzzeitig da und ist als Scope-Ueberschreitung entfernt worden - diese
     Pruefung haelt sie draussen. */
  const ohneZeit = await planText(pc)
  pruefe('Es steht keine Trainingsdauer zur Eingabe da',
    await planBlock(pc).locator('input').count() === 0)
  pruefe('Und keine Minutenangabe je Gerät',
    !/\d+\s*min/.test(ohneZeit) && !/Zeit in der Halle/.test(ohneZeit),
    ohneZeit.slice(0, 400))
  pruefe('Der Umfang trägt die Raumaussage stattdessen',
    /Schwerpunkt|normal|kurz/.test(ohneZeit), ohneZeit.slice(0, 400))

  /* ========================= Nichts davon wird gespeichert */
  await abgleich(pc)
  const tabellen = Object.keys(server.alleTabellen ? server.alleTabellen() : {})
  const verdaechtig = tabellen.filter((t) => /plan|vorschlag|planung/i.test(t))
  pruefe('Es entsteht keine Tabelle für den Plan', verdaechtig.length === 0,
    verdaechtig.join(', '))

  // Die Nutzerwahl darf nicht mitwandern: Sie ist eine Ansicht, kein Datensatz.
  // Nach dem Abgleich steht die Seite nicht mehr zwingend auf der Uebersicht.
  await geh(pc, '/turnen', 2200)
  await planGeraet(pc, (await vorschlag(pc))[0])
    .locator('button[aria-label$="abwählen"]').first().click()
  await pc.page.waitForTimeout(600)
  await abgleich(pc)
  const einst = server.zeilen('settings').filter((z) => !z.deleted_at)
  const planEinstellung = einst.filter((z) => /plan|vorschlag/i.test(z.key ?? ''))
  pruefe('Auch keine Einstellung – die Wahl bleibt im Arbeitsspeicher',
    planEinstellung.length === 0, planEinstellung.map((z) => z.key).join(', '))

  /* ============================================ Handy: 390 px und dunkel */
  handy = await starteGeraet({
    name: 'tp-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 2600)

  const handySeite = await planText(handy)
  pruefe('Das Handy zeigt den Vorschlag nach dem Abgleich',
    /Nächstes Training/.test(handySeite), handySeite.slice(0, 300))
  pruefe('Das Abwählen am PC ist nicht mitgewandert',
    (await vorschlag(handy)).length >= 2, JSON.stringify(await vorschlag(handy)))

  await klappeAuf(handy, (await vorschlag(handy))[0])

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }))
  pruefe('Die Übersicht läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const passt = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.np-geraet, .np-inhalt, .np-kopf')]
    return els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Vorschlagskacheln passen in die Breite', passt)

  const trefferflaeche = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.np-geraet button')]
    return els.every((el) => el.getBoundingClientRect().height >= 24)
  })
  pruefe('Die Knöpfe sind mit dem Daumen zu treffen', trefferflaeche)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(900)
  pruefe('Im dunklen Modus steht dasselbe da',
    /Nächstes Training/.test(await planText(handy)))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.np-geraet')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Und die Vorschlagskacheln haben eine eigene Farbe',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })

  /* ==================================================== Keine Fehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|415|422/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
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
