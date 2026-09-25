/**
 * Turnen, Phase 2C: Leistungsanalyse und Konkurrenzvergleich im Browser.
 *
 * Die Rechnung ist in `turnen-vergleich.test.ts` und `turnen-analyse.test.ts`
 * einzeln nachgerechnet, gegen das echte PDF in `turnen-vergleich-echt.test.ts`.
 * Hier geht es um das, was Unit-Tests nicht zeigen:
 *
 *   - Kommen die Vergleichswerte beim Import wirklich in die Datenbank – und
 *     kommt dabei NICHTS von den anderen Teilnehmern mit? Das ist der
 *     eigentliche Prüfgegenstand.
 *   - Steht auf der Analyseseite der Platz im Feld und nicht die rohe Note
 *     vorn? Sagt sie, dass die höchste Note nicht das stärkste Gerät ist?
 *   - Ist der sechste Reiter am Handy (390 px) erreichbar, ohne dass die Seite
 *     seitlich wegläuft?
 *   - Sieht das Handy nach dem Abgleich dieselbe Analyse wie der PC?
 *   - Ein von Hand erfasster Wettkampf: keine erfundenen Plätze.
 *   - Löschen: gehen die Vergleichswerte mit?
 *
 * Aufruf:  node tests/turnen-analyse-e2e.mjs
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
/** Die Gruppe, gegen die verglichen werden muss – und nur die. */
const gruppe = bestand.teilnehmer.filter((t) => t.klasse === erik.klasse)

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-analyse-'))
const PDF_DATEI = path.join(TMP, 'Sachsenmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter fuer die Pruefung\n')

const server = await starteNachbau({ port: 54402, protokoll: seitenBestand })
const web = await starteWebserver(8095)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')

/** Die Kachel eines Geräts auf der Analyseseite. */
const kachel = (g, geraet) =>
  g.page.locator('.wk-karte').filter({ hasText: new RegExp(`^${geraet}`) }).first()

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'analyse-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  if (await namensfeld.count()) {
    await namensfeld.fill('Erik Ehnert')
    await pc.page.waitForTimeout(700)
  }

  /* ============================================ Ohne Wettkampf: leer */
  await geh(pc, '/turnen/analyse', 1500)
  pruefe('Ohne Wettkampf sagt die Analyse das und lockt nicht mit Zahlen',
    /Noch kein Wettkampfergebnis/.test(await text(pc)))

  /* ================================================== Protokollimport */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal input[type=file]').first().setInputFiles(PDF_DATEI)
  await pc.page.waitForTimeout(1800)

  // Den eigenen Eintrag auswaehlen.
  const eigeneZeile = pc.page.locator('.modal .list-row')
    .filter({ hasText: erik.name.wert }).first()
  await eigeneZeile.click()
  await pc.page.waitForTimeout(1200)

  /* -------------------------------------- Die Vorschau zeigt die Plätze */
  const vorschau = await pc.page.locator('.modal').last().innerText()
  pruefe('Die Vorschau nennt die Vergleichsgruppe',
    /LK 2 AK 18-29/.test(vorschau) && /6 Turner/.test(vorschau), '')
  pruefe('Sie nennt den voraussichtlichen Bodenplatz vor dem Speichern',
    /Boden: voraussichtlich 4\. von 6/.test(vorschau))
  pruefe('Und den voraussichtlichen Sprungplatz',
    /Sprung: voraussichtlich 1\. von 6/.test(vorschau))
  pruefe('Sie sagt ausdrücklich, dass fremde Namen nicht gespeichert werden',
    /speichert LifeHub/.test(vorschau) && /Namen, Jahrgänge und Vereine/.test(vorschau))
  pruefe('Vor dem Bestätigen steht nichts in der Datenbank',
    server.zeilen('gym_benchmarks').length === 0)

  await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(2000)

  /* ==================================================== Die Analyseseite */
  await geh(pc, '/turnen/analyse', 1800)
  const seite = await text(pc)

  pruefe('Die Analyse nennt Klasse und Feldgrösse',
    /LK 2 AK 18-29/.test(seite) && /6 Turner im Feld/.test(seite))
  pruefe('Sie nennt den Mehrkampfplatz', /Mehrkampf 2\. von 6/.test(seite))

  const boden = await kachel(pc, 'Boden').innerText()
  pruefe('Boden steht auf 4. von 6', /4\. von 6/.test(boden), boden.replace(/\n/g, ' | '))
  pruefe('Boden nennt die Rohnote daneben', /11,566/.test(boden))
  pruefe('Boden zeigt den E-Platz 1. von 6', /1\. von 6/.test(boden))
  pruefe('Boden nennt als Fokus die Schwierigkeit', /Fokus: Schwierigkeit/.test(boden))

  const sprung = await kachel(pc, 'Sprung').innerText()
  pruefe('Sprung steht auf 1. von 6 – trotz niedrigerer Rohnote',
    /1\. von 6/.test(sprung) && /11,0/.test(sprung), sprung.replace(/\n/g, ' | '))
  pruefe('Sprung wird NICHT als Schwachpunkt geführt',
    !/Fokus: Schwierigkeit/.test(sprung) && !/Fokus: Ausführung/.test(sprung),
    sprung.replace(/\n/g, ' | '))
  pruefe('Sprung ist als Stärke markiert', /Stärke halten/.test(sprung))

  const reck = await kachel(pc, 'Reck').innerText()
  pruefe('Reck nennt beide Seiten als Fokus',
    /Fokus: Schwierigkeit und Ausführung/.test(reck), reck.replace(/\n/g, ' | '))

  pruefe('Die Seite sagt, dass die höchste Note nicht das stärkste Gerät ist',
    /höchste Note ist nicht das stärkste Gerät/.test(seite))
  pruefe('Und nennt dabei Ringe als höchste Rohnote', /Ringe/.test(seite))

  pruefe('Es gibt einen Abschnitt „Grösste Hebel"', /Grösste Hebel/.test(seite))
  pruefe('Er nennt Barren', /Barren/.test(seite))
  pruefe('Die Abstände zum Median stehen da', /zum Feldmedian/.test(seite))

  /* ------------------------------------------------ Die Detailzahlen */
  await kachel(pc, 'Boden').locator('summary, .collapsible-kopf, button')
    .filter({ hasText: /Zahlen und Begründung/ }).first().click()
  await pc.page.waitForTimeout(600)
  const detail = await kachel(pc, 'Boden').innerText()
  // innerText liefert die Kopfzeile in Grossbuchstaben - das macht das CSS.
  pruefe('Die Detailansicht nennt Median und Bestwert',
    /median/i.test(detail) && /bestwert/i.test(detail), detail.replace(/\n/g, ' | '))
  // Der Sieger turnte am Boden D 4,8 bei E 7,666 - genau umgekehrt zu Erik.
  // Das ist der Zahlenbeleg dafuer, dass hier die Schwierigkeit begrenzt.
  pruefe('Der beste D-Wert des Feldes steht daneben', /4,8/.test(detail))
  pruefe('Die Begründung nennt beide Plätze',
    /Platz 1 von 6/.test(detail) && /Platz 4 geteilt von 6/.test(detail),
    detail.replace(/\n/g, ' | '))
  pruefe('Die Begründung verspricht keinen Punktgewinn',
    !/\bPunkte?\b/.test(detail.split('Verglichen wurde')[0].split('Median')[1] ?? ''))

  /* ----------------------------------- Ein Wettkampf ohne Vergleichsfeld */
  pruefe('Ein Verlauf wird bei einem Wettkampf nicht vorgetäuscht',
    /Für einen Verlauf reicht ein Wettkampf nicht/.test(seite))

  /* ====================================== Was auf dem Server ankommt */
  await abgleich(pc)
  const bm = server.zeilen('gym_benchmarks')
  pruefe('Auf dem Server liegen sieben Vergleichszeilen – sechs Geräte plus Mehrkampf',
    bm.length === 7, `${bm.length}`)
  pruefe('Jede nennt die Feldgrösse 6', bm.every((z) => z.cohort_size === 6))
  pruefe('Jede nennt die Klasse', bm.every((z) => z.cohort_label === 'LK 2 AK 18-29'))
  const bodenZeile = bm.find((z) => z.scope === 'boden')
  pruefe('Der Bodenplatz steht als 4 in final_rank', bodenZeile.final_rank === 4,
    String(bodenZeile.final_rank))
  pruefe('Der geteilte D-Platz ist als geteilt vermerkt',
    bodenZeile.d_rank === 4 && bodenZeile.d_tie_count === 2,
    `${bodenZeile.d_rank}/${bodenZeile.d_tie_count}`)
  pruefe('Der Mehrkampf trägt keine erfundene D-Summe',
    bm.find((z) => z.scope === 'mehrkampf').d_rank === null)

  /* -------------------------------- Der Datenschutz, am Serverbestand */
  const alles = JSON.stringify(server.zeilen('gym_benchmarks'))
  let leck = null
  for (const t of bestand.teilnehmer) {
    const nachname = (t.name.wert ?? '').split(',')[0].trim()
    if (nachname && nachname !== 'Ehnert' && alles.includes(nachname)) leck = nachname
    if (t.verein.wert && t.verein.wert !== erik.verein.wert && alles.includes(t.verein.wert)) {
      leck = t.verein.wert
    }
    if (t.jahrgang.wert && t.jahrgang.wert !== erik.jahrgang.wert
      && alles.includes(String(t.jahrgang.wert))) leck = String(t.jahrgang.wert)
  }
  pruefe('In den Vergleichszeilen steht kein fremder Name, Verein oder Jahrgang',
    leck === null, leck ? `gefunden: ${leck}` : 'nichts gefunden')
  pruefe('Es liegt keine Zeile je fremdem Teilnehmer auf dem Server',
    server.zeilen('gym_results').length === 6,
    `${server.zeilen('gym_results').length} Ergebniszeilen bei ${gruppe.length} Turnern in der Klasse`)

  /* ============================================ Handy: 390 px und Reiter */
  handy = await starteGeraet({
    name: 'analyse-handy', url: web.url, viewport: { width: 390, height: 844 },
  })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)
  await geh(handy, '/turnen', 1800)

  const reiter = handy.page.locator('.tabs button', { hasText: 'Analyse' }).first()
  pruefe('Der Reiter Analyse ist am Handy vorhanden', (await reiter.count()) === 1)
  await reiter.scrollIntoViewIfNeeded()
  await reiter.click()
  await handy.page.waitForTimeout(1800)

  const handySeite = await text(handy)
  pruefe('Das Handy zeigt dieselbe Analyse nach dem Abgleich',
    /6 Turner im Feld/.test(handySeite) && /Fokus: Schwierigkeit/.test(handySeite))

  const ueberlauf = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }))
  pruefe('Die Seite läuft am Handy nicht seitlich weg',
    ueberlauf.doc <= ueberlauf.fenster + 2, `${ueberlauf.doc} > ${ueberlauf.fenster}`)

  const tabelleBreit = await handy.page.evaluate(() => {
    const el = document.querySelector('.an-tabelle')
    return el ? el.scrollWidth <= el.clientWidth + 2 : true
  })
  pruefe('Auch die Zahlentabelle passt in die Breite', tabelleBreit)

  /* ================================================== Dunkler Modus */
  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(800)
  const dunkel = await text(handy)
  pruefe('Im dunklen Modus steht dasselbe da', /6 Turner im Feld/.test(dunkel))
  const kontrast = await handy.page.evaluate(() => {
    const el = document.querySelector('.an-begruendung') || document.querySelector('.wk-karte')
    if (!el) return null
    const s = getComputedStyle(el)
    return { farbe: s.color, grund: s.backgroundColor }
  })
  pruefe('Und die Kacheln haben im dunklen Modus eine eigene Farbe',
    !!kontrast && kontrast.farbe !== kontrast.grund, JSON.stringify(kontrast))
  await handy.page.emulateMedia({ colorScheme: 'light' })

  /* ================================= Von Hand erfasst: keine Erfindung */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: /^\+ (Wettkampf|Erster Wettkampf)$/ }).first().click()
  await pc.page.waitForTimeout(800)
  const neu = pc.page.locator('.modal').last()
  await neu.locator('.field', { hasText: 'Name' }).locator('input').first().fill('Vereinsmeisterschaft')
  await neu.locator('.field', { hasText: 'Datum' }).locator('input').first().fill('2026-07-01')
  await neu.locator('.turn-geraet', { hasText: 'Boden' }).first().click()
  await pc.page.waitForTimeout(400)
  // Die vollen Beschriftungen, nicht „D" und „E": Playwrights `hasText`
  // vergleicht ohne Ruecksicht auf Gross- und Kleinschreibung, und „E" traf
  // damit auch „D-Wert".
  const bodenFelder = neu.locator('.wk-karte').filter({ hasText: 'Boden' }).first()
  await bodenFelder.locator('.field', { hasText: 'D-Wert' }).locator('input').first().fill('3,0')
  await bodenFelder.locator('.field', { hasText: 'E-Wert' }).locator('input').first().fill('8,5')
  await bodenFelder.locator('.field', { hasText: 'Endnote' }).locator('input').first().fill('11,5')
  await neu.locator('button', { hasText: 'Speichern' }).first().click()
  await pc.page.waitForTimeout(1800)

  await geh(pc, '/turnen/analyse', 1800)
  const handErfasst = await text(pc)
  pruefe('Ein von Hand erfasster Wettkampf sagt, dass kein Vergleichsfeld vorliegt',
    /kein Vergleichsfeld/.test(handErfasst), handErfasst.slice(0, 400).replace(/\n/g, ' | '))
  pruefe('Und erfindet dort keinen Geräteplatz',
    !/\d\. von \d/.test((await kachel(pc, 'Boden').innerText())),
    (await kachel(pc, 'Boden').innerText()).replace(/\n/g, ' | '))
  const handKachel = await kachel(pc, 'Boden').innerText()
  pruefe('Die Rohwerte stehen trotzdem da – alle drei',
    /3,0/.test(handKachel) && /8,5/.test(handKachel) && /11,5/.test(handKachel),
    handKachel.replace(/\n/g, ' | '))

  await abgleich(pc)
  pruefe('Der Handwettkampf erzeugt keine Vergleichszeile',
    server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length === 7,
    `${server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length}`)

  /* ============================================ Reimport: keine Dublette */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
  await pc.page.waitForTimeout(800)
  await pc.page.locator('.modal input[type=file]').first().setInputFiles(PDF_DATEI)
  await pc.page.waitForTimeout(1800)
  await pc.page.locator('.modal .list-row').filter({ hasText: erik.name.wert }).first().click()
  await pc.page.waitForTimeout(1000)
  await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(2000)
  await abgleich(pc)
  const nachReimport = server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at)
  pruefe('Ein zweiter Import derselben Datei legt keine zweite Vergleichszeile an',
    nachReimport.length === 7, `${nachReimport.length}`)
  pruefe('Und keinen zweiten Wettkampf',
    server.zeilen('gym_competitions').filter((z) => !z.deleted_at).length === 2,
    `${server.zeilen('gym_competitions').filter((z) => !z.deleted_at).length}`)

  /* ==================================================== Löschen */
  // Es gibt ZWEI Loeschwege - aus der Ansicht und aus dem Editor. Beide
  // muessen die Vergleichswerte mitnehmen. Geprueft werden beide: Beim ersten
  // Versuch raeumte nur einer von ihnen auf, und das ist hier aufgefallen.
  const importiereNochmal = async () => {
    await geh(pc, '/turnen/wettkaempfe', 1500)
    await pc.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
    await pc.page.waitForTimeout(800)
    await pc.page.locator('.modal input[type=file]').first().setInputFiles(PDF_DATEI)
    await pc.page.waitForTimeout(1800)
    await pc.page.locator('.modal .list-row').filter({ hasText: erik.name.wert }).first().click()
    await pc.page.waitForTimeout(1000)
    await pc.page.locator('.modal').last()
      .locator('button', { hasText: 'Import bestätigen' }).first().click()
    await pc.page.waitForTimeout(2000)
  }

  const oeffneSachsen = async () => {
    await geh(pc, '/turnen/wettkaempfe', 1600)
    await pc.page.locator('.list-row')
      .filter({ hasText: 'Sächsische Einzelmeisterschaften' }).first().click()
    await pc.page.waitForTimeout(900)
  }

  const bestaetigeLoeschen = async () => {
    await pc.page.locator('.modal').last()
      .locator('button', { hasText: 'Löschen' }).first().click()
    await pc.page.waitForTimeout(700)
    await pc.page.locator('.modal').last()
      .locator('button', { hasText: 'Löschen' }).last().click()
    await pc.page.waitForTimeout(1800)
  }

  const offeneBenchmarks = () =>
    server.zeilen('gym_benchmarks').filter((z) => !z.deleted_at).length

  await oeffneSachsen()
  await bestaetigeLoeschen()
  await abgleich(pc)
  pruefe('Löschen aus der Ansicht nimmt die Vergleichswerte mit',
    offeneBenchmarks() === 0, `${offeneBenchmarks()} übrig`)
  pruefe('Und die Geräteergebnisse – nur der Handwettkampf bleibt',
    server.zeilen('gym_results').filter((z) => !z.deleted_at).length === 1,
    `${server.zeilen('gym_results').filter((z) => !z.deleted_at).length}`)

  await importiereNochmal()
  await abgleich(pc)
  pruefe('Nach erneutem Import stehen die sieben Vergleichszeilen wieder da',
    offeneBenchmarks() === 7, `${offeneBenchmarks()}`)

  await oeffneSachsen()
  await pc.page.locator('.modal').last()
    .locator('button', { hasText: 'Bearbeiten' }).first().click()
  await pc.page.waitForTimeout(1000)
  await bestaetigeLoeschen()
  await abgleich(pc)
  pruefe('Löschen aus dem Editor nimmt sie ebenfalls mit',
    offeneBenchmarks() === 0, `${offeneBenchmarks()} übrig`)

  /* ==================================================== Keine Fehler */
  // Derselbe Filter wie in den anderen Turnen-Prüfungen: Die 404 kommen von
  // Symbolen und dem Dienstarbeiter, die der schlichte Webserver nicht kennt.
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
