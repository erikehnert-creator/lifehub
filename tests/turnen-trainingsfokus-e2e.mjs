/**
 * Turnen, Phase 2D: Trainingsfokus im Browser.
 *
 * Die Rechnung ist in `turnen-trainingsfokus.test.ts` einzeln nachgerechnet.
 * Hier geht es um den Weg, den die Unit-Tests nicht zeigen:
 *
 *   Wettkampf importieren → Vergleichswerte da → Elemente und Kür anlegen
 *   → Training erfassen → Analyse öffnen → **der Trainingsfokus ändert sich
 *   nachvollziehbar**
 *
 * Geprüft wird ausdrücklich die Veränderung: Vor dem Training steht dort, dass
 * die Trainingsbasis fehlt; nach einem stabilen Training steht ein Kandidat da;
 * nach einem schlechten Training kippt die Empfehlung auf Stabilisieren. Eine
 * Momentaufnahme allein würde nicht zeigen, dass die Karte wirklich aus den
 * Daten kommt.
 *
 * Dazu: 390 px, dunkler Modus, keine Konsolenfehler.
 *
 * Aufruf:  node tests/turnen-trainingsfokus-e2e.mjs
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-tf-'))
const PDF_DATEI = path.join(TMP, 'Sachsenmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter\n')

const server = await starteNachbau({ port: 54404, protokoll: seitenBestand })
const web = await starteWebserver(8096)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

/** Die Trainingsfokus-Kachel eines Geräts. */
const fokusKarte = (g, geraet) =>
  g.page.locator('.card').filter({ hasText: 'Trainingsfokus' })
    .locator('.wk-karte').filter({ hasText: new RegExp(`^${geraet}`) }).first()

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
async function erfasseTraining(g, { geraet, tipps }) {
  await geh(g, '/turnen/training', 1500)
  await g.page.locator('button', { hasText: '+ Training erfassen' }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal .turn-geraet', { hasText: geraet }).first().click()
  await g.page.waitForTimeout(600)

  for (const [elementName, guete] of Object.entries(tipps)) {
    const zeile = g.page.locator('.turn-zeile', { hasText: elementName }).first()
    const knoepfe = zeile.locator('.turn-zaehler-knopf')
    for (const [welche, anzahl] of Object.entries(guete)) {
      const index = welche === 'clean' ? 0 : welche === 'shaky' ? 1 : 2
      for (let i = 0; i < anzahl; i++) {
        await knoepfe.nth(index).click()
      }
    }
  }
  await g.page.locator('.modal button', { hasText: 'Speichern' }).first().click()
  await g.page.waitForTimeout(1600)
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'tf-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  if (await namensfeld.count()) {
    await namensfeld.fill('Erik Ehnert')
    await pc.page.waitForTimeout(700)
  }

  /* ------------------------------------- Ohne Wettkampf: keine Priorität */
  await geh(pc, '/turnen/analyse', 1500)
  pruefe('Ohne Wettkampf gibt es keine Analyse und keinen Trainingsfokus',
    /Noch kein Wettkampfergebnis/.test(await text(pc)))

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
    server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length === 7,
    `${server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length}`)

  /* ------------------------ Schritt 2: Trainingsfokus ohne Trainingsdaten */
  await geh(pc, '/turnen/analyse', 2000)
  const ohneTraining = await text(pc)
  pruefe('Der Bereich Trainingsfokus ist da', /Trainingsfokus/.test(ohneTraining))
  pruefe('Er sagt, dass die Kür am Stück nicht erfasst wird',
    /Ob du die Kür am Stück/.test(ohneTraining))

  const barrenVorher = await fokusKarte(pc, 'Barren').innerText()
  pruefe('Barren hat hohe Priorität – Schwierigkeit unter dem Feld, Endnote 4. von 6',
    /Priorität: hoch/.test(barrenVorher), barrenVorher.replace(/\n/g, ' | '))
  pruefe('Barren nennt als Wettkampffokus die Schwierigkeit',
    /Schwierigkeit/.test(barrenVorher))
  pruefe('Barren nennt noch keine Trainingslage',
    /keine Wettkampfkür hinterlegt/.test(barrenVorher), barrenVorher.replace(/\n/g, ' | '))

  const sprungVorher = await fokusKarte(pc, 'Sprung').innerText()
  pruefe('Sprung bleibt auf halten – trotz der niedrigsten Rohnote',
    /Priorität: halten/.test(sprungVorher), sprungVorher.replace(/\n/g, ' | '))

  // Die Begruendung muss die fehlende Trainingsbasis benennen.
  await fokusKarte(pc, 'Barren').locator('button')
    .filter({ hasText: /Einzelheiten/ }).first().click()
  await pc.page.waitForTimeout(600)
  const barrenDetail = await fokusKarte(pc, 'Barren').innerText()
  pruefe('Die Begründung nennt die echten Plätze aus dem Wettkampf',
    /Platz 1 von 6/.test(barrenDetail) && /Platz 4 geteilt von 6/.test(barrenDetail),
    barrenDetail.replace(/\n/g, ' | ').slice(0, 300))
  pruefe('Und sagt, dass ohne Kür keine Elementebene entsteht',
    /keine Wettkampfkür/.test(barrenDetail))
  pruefe('Es stehen keine erfundenen Elemente da',
    !/Kandidat prüfen/.test(barrenDetail) || /Bezugspunkt/.test(barrenDetail))

  /* ============================ Schritt 3: Elemente, Kür, gutes Training */
  await legeElementAn(pc, { name: 'Felge vorwärts', geraet: 'Barren', buchstabe: 'B', wert: '0,2' })
  await legeElementAn(pc, { name: 'Kippe zum Handstand', geraet: 'Barren', buchstabe: 'C', wert: '0,3' })
  await legeElementAn(pc, { name: 'Doppelsalto Abgang', geraet: 'Barren', buchstabe: 'E', wert: '0,5' })

  await legeWettkampfKuerAn(pc, {
    name: 'Barrenkür 2026', geraet: 'Barren',
    elemente: ['Felge vorwärts', 'Kippe zum Handstand'],
  })

  // Zweimal trainieren, damit im Fenster genug Versuche zusammenkommen:
  // die Kuerelemente sauber, das dritte Element ebenfalls sauber.
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

  await geh(pc, '/turnen/analyse', 2200)
  await fokusKarte(pc, 'Barren').locator('button')
    .filter({ hasText: /Einzelheiten/ }).first().click()
  await pc.page.waitForTimeout(700)
  const nachGutemTraining = await fokusKarte(pc, 'Barren').innerText()

  pruefe('Nach dem Training nennt Barren eine Trainingslage',
    /stabil/.test(nachGutemTraining), nachGutemTraining.replace(/\n/g, ' | ').slice(0, 400))
  pruefe('Die Empfehlung lautet jetzt, die Schwierigkeit zu prüfen',
    /Schwierigkeit gezielt prüfen/.test(nachGutemTraining),
    nachGutemTraining.replace(/\n/g, ' | ').slice(0, 400))
  pruefe('Die aktuelle Kür steht mit ihren Elementen da',
    /Felge vorwärts/.test(nachGutemTraining) && /Kippe zum Handstand/.test(nachGutemTraining))
  pruefe('Das schwierigere Element erscheint als Kandidat',
    /Doppelsalto Abgang/.test(nachGutemTraining),
    nachGutemTraining.replace(/\n/g, ' | ').slice(0, 500))
  pruefe('Es heisst ausdrücklich „als Kandidat prüfen"',
    /Als Kandidat prüfen, nicht als Punktgewinn/.test(nachGutemTraining))
  pruefe('Und nirgends, dass der D-Wert dadurch steigt',
    !/erhöht deinen/.test(nachGutemTraining) && !/bringt 0,/.test(nachGutemTraining))
  pruefe('Die Begründung nennt die Trainingsquote',
    /% der \d+ erfassten Versuche/.test(nachGutemTraining),
    nachGutemTraining.replace(/\n/g, ' | ').slice(0, 500))

  /* =================== Schritt 4: schlechtes Training kippt die Empfehlung */
  for (let runde = 0; runde < 2; runde++) {
    await erfasseTraining(pc, {
      geraet: 'Barren',
      tipps: {
        'Felge vorwärts': { shaky: 5, failed: 4 },
        'Kippe zum Handstand': { shaky: 5, failed: 4 },
      },
    })
  }

  await geh(pc, '/turnen/analyse', 2200)
  await fokusKarte(pc, 'Barren').locator('button')
    .filter({ hasText: /Einzelheiten/ }).first().click()
  await pc.page.waitForTimeout(700)
  const nachSchlechtemTraining = await fokusKarte(pc, 'Barren').innerText()

  pruefe('Die Empfehlung kippt auf Stabilisieren',
    /Erst die Kür stabilisieren/.test(nachSchlechtemTraining),
    nachSchlechtemTraining.replace(/\n/g, ' | ').slice(0, 400))
  pruefe('Die Kür gilt jetzt als instabil',
    /instabil/.test(nachSchlechtemTraining))
  // innerText liefert die Blockkoepfe in Grossbuchstaben - das macht das CSS.
  pruefe('Es stehen auffällige Elemente da',
    /auffällige elemente/i.test(nachSchlechtemTraining))
  pruefe('Die Zählerstände stehen daneben',
    /gestürzt/.test(nachSchlechtemTraining),
    nachSchlechtemTraining.replace(/\n/g, ' | ').slice(0, 500))
  pruefe('Und es wird nicht behauptet, ein Element habe die Note verursacht',
    !/verursacht/.test(nachSchlechtemTraining) && !/kostet/.test(nachSchlechtemTraining))
  pruefe('Der Wettkampfbefund bleibt dabei unverändert Schwierigkeit',
    /Schwierigkeit/.test(nachSchlechtemTraining))

  /* ================================= Schritt 5: unberührte Geräte */
  const sprungNachher = await fokusKarte(pc, 'Sprung').innerText()
  pruefe('Der Sprung bleibt unverändert auf halten',
    /Priorität: halten/.test(sprungNachher), sprungNachher.replace(/\n/g, ' | '))

  /* ================================= Nichts davon wird gespeichert */
  await abgleich(pc)
  const tabellen = Object.keys(server.alleTabellen ? server.alleTabellen() : {})
  const verdaechtig = tabellen.filter((t) => /fokus|empfehlung|prioritaet/i.test(t))
  pruefe('Es entsteht keine Tabelle für Empfehlungen',
    verdaechtig.length === 0, verdaechtig.join(', '))

  /* ============================================ Handy: 390 px und dunkel */
  handy = await starteGeraet({
    name: 'tf-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen/analyse', 2400)

  const handySeite = await text(handy)
  pruefe('Das Handy zeigt den Trainingsfokus nach dem Abgleich',
    /Trainingsfokus/.test(handySeite) && /Priorität: hoch/.test(handySeite))

  await fokusKarte(handy, 'Barren').locator('button')
    .filter({ hasText: /Einzelheiten/ }).first().click()
  await handy.page.waitForTimeout(700)

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }))
  pruefe('Die Seite läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const kacheln = await handy.page.evaluate(() => {
    const els = [...document.querySelectorAll('.tf-element, .tf-zeile')]
    return els.every((el) => el.scrollWidth <= el.clientWidth + 2)
  })
  pruefe('Auch die Elementkacheln passen in die Breite', kacheln)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(800)
  pruefe('Im dunklen Modus steht dasselbe da',
    /Trainingsfokus/.test(await text(handy)))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.tf-element')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Und die Elementkacheln haben eine eigene Farbe',
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
