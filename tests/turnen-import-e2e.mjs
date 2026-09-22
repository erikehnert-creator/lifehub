/**
 * Turnen, Phase 2B2: ein Wettkampfprotokoll importieren.
 *
 * Der Leser ist in `turnen-protokoll.test.ts` gegen das echte Protokoll
 * nachgerechnet, der Weg vom PDF zu den Textstücken in
 * `protokoll-integration.mjs`. Hier geht es um das, was beides nicht zeigt:
 * ob der Weg durch die Oberfläche trägt.
 *
 *   PDF wählen → Teilnehmer wählen → Vorschau → korrigieren → Kür → bestätigen
 *
 * Der Nachbau spielt dabei die Edge Function und deutet denselben
 * Textbestand mit demselben Leser (siehe `_supabase-nachbau.mjs`).
 *
 * Aufruf:  node tests/turnen-import-e2e.mjs
 */
import { starteNachbau, ANON, MAIL, PASS } from './_supabase-nachbau.mjs'
import { starteWebserver, starteGeraet, anmelden, abgleich, geh, pruefer, DIST } from './_sync-app.mjs'
import { brauche, EINZELDATEI } from './_browser.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { pruefe, fehlend } = pruefer()

if (!brauche(path.join(WURZEL, 'LifeHub.html'), 'Erst `npm run build:single` ausführen.')) process.exit(0)
if (!brauche(path.join(DIST, 'index.html'), 'Erst `npx vite build` ausführen (dist/ fehlt).')) process.exit(0)

const FIXTURE = path.join(WURZEL, 'tests', 'fixtures', 'protokoll-score-2026.json')
if (!brauche(FIXTURE, 'Der Protokollbestand fehlt.')) process.exit(0)
const seitenBestand = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

/* Welche Zeile welchen Teilnehmer meint, rechnet der echte Leser aus. Sich
   auf die Reihenfolge der Suchtreffer zu verlassen waere truegerisch: Die
   Suche ist absichtlich grosszuegig (sie findet ueber Name, Verein, Jahrgang
   und Klasse) und liefert zu "LK 2 AK 18-29" auch Teilnehmer anderer
   Klassen, weil deren Jahrgang eine 2 enthaelt. */
const { parseProtokoll } = await import('../supabase/functions/wettkampf-import/protokoll.ts')
const bestand = parseProtokoll(seitenBestand)
const nameVon = (klasse, rang) => {
  const t = bestand.teilnehmer.find((x) => x.klasse === klasse && x.rang.wert === rang)
  if (!t) throw new Error(`kein Teilnehmer ${klasse} Rang ${rang}`)
  return t.name.wert
}

/* Zwei Dateien zum Auswaehlen: eine, die wie eine PDF aussieht, und eine,
   die es offensichtlich nicht ist. Der Inhalt spielt keine Rolle - der
   Nachbau deutet ohnehin den Bestand. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lifehub-import-'))
const PDF_DATEI = path.join(TMP, 'Sachsenmeisterschaft 2026 Einzel.pdf')
fs.writeFileSync(PDF_DATEI, '%PDF-1.4\n% Platzhalter fuer die Pruefung\n')
const KEIN_PDF = path.join(TMP, 'urlaub.txt')
fs.writeFileSync(KEIN_PDF, 'kein PDF')

const server = await starteNachbau({ port: 54400, protokoll: seitenBestand })
const web = await starteWebserver(8093)
const ZUGANG = { url: server.url, anon: ANON, mail: MAIL, pass: PASS }

const text = async (g) => g.page.innerText('#root')
const zerlege = (t) => String(t).trim().split(/\r?\n/).map((z) => z.trim()).filter(Boolean)

/* --------------------------------------------------------------- Hilfen */

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

/** Das Importfenster öffnen und eine Datei wählen. */
async function waehleDatei(g, datei) {
  await geh(g, '/turnen/wettkaempfe', 1500)
  await g.page.locator('button', { hasText: 'Protokoll importieren' }).first().click()
  await g.page.waitForTimeout(800)
  await g.page.locator('.modal input[type=file]').first().setInputFiles(datei)
  await g.page.waitForTimeout(1600)
}

/** Die Werte eines Geräts im Editor lesen. */
async function feld(g, geraet, label) {
  const karte = g.page.locator('.modal .wk-karte').filter({ hasText: geraet }).first()
  return karte.locator('.field', { hasText: label }).locator('input').first().inputValue()
}

let pc, handy
try {
  /* ==================================================== Vorbereitung */
  pc = await starteGeraet({ name: 'import-pc', url: EINZELDATEI })
  pruefe('PC meldet sich an', await anmelden(pc, ZUGANG))
  await abgleich(pc)

  // Der eigene Name im Profil - daraus kommt der Vorschlag. Ohne ihn gibt es
  // keinen, und im Code steht kein Name.
  await geh(pc, '/einstellungen', 1500)
  const namensfeld = pc.page.locator('input[placeholder="dein Vorname"]').first()
  await namensfeld.fill('Ehnert')
  await namensfeld.blur()
  await pc.page.waitForTimeout(900)

  await legeElementAn(pc, { name: 'Kippe', geraet: 'Reck', buchstabe: 'A', wert: '0,1' })
  await legeElementAn(pc, { name: 'Riesenfelge', geraet: 'Reck', buchstabe: 'B', wert: '0,2' })
  await legeKuerAn(pc, { name: 'Reckkür 2026', geraet: 'Reck', elemente: ['Kippe', 'Riesenfelge'] })

  /* ================================================== Der Knopf ist da */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  pruefe('Der Reiter Wettkämpfe bietet den Import an',
    /Protokoll importieren/.test(await text(pc)))

  /* =============================================== Falsche Datei zuerst */
  await waehleDatei(pc, KEIN_PDF)
  pruefe('Eine Nicht-PDF wird sofort abgelehnt',
    /keine PDF-Datei/.test(await pc.page.locator('.modal').last().innerText()))
  pruefe('Und sie wird gar nicht erst hochgeladen', server.hochgeladen.length === 0,
    `${server.hochgeladen.length} Uploads`)
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(500)

  /* =========================================== PDF ohne Textebene */
  server.setzeProtokollFehler({
    code: 'keine_textebene',
    message: 'Diese PDF enthält keinen lesbaren Text. Gescannte Protokolle kann LifeHub nicht lesen.',
  })
  await waehleDatei(pc, PDF_DATEI)
  pruefe('Eine PDF ohne Textebene wird verständlich abgelehnt',
    /keinen lesbaren Text/.test(await pc.page.locator('.modal').last().innerText()))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(500)

  server.setzeProtokollFehler({
    code: 'format_unbekannt',
    message: 'Der Aufbau dieser PDF ist LifeHub nicht bekannt. Erkannt wird bisher nur das Protokoll der Wettkampfsoftware SCORE.',
  })
  await waehleDatei(pc, PDF_DATEI)
  const fremdText = await pc.page.locator('.modal').last().innerText()
  pruefe('Ein unbekanntes Format wird abgelehnt, statt geraten',
    /nicht bekannt/.test(fremdText))
  pruefe('Mit dem Hinweis, dass die Handeingabe bleibt',
    /von Hand eintragen/.test(fremdText))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(500)
  server.setzeProtokollFehler(null)

  /* ================================================ Das echte Protokoll */
  await waehleDatei(pc, PDF_DATEI)
  const nachLesen = await pc.page.locator('.modal').last().innerText()
  pruefe('Das Protokoll wird gelesen',
    /Sächsische Einzelmeisterschaften männlich/.test(nachLesen))
  pruefe('Mit Ort und Datum', /Bannewitz/.test(nachLesen) && /10\.05\.2026/.test(nachLesen))
  pruefe('Und mit Umfang', /12 Seiten/.test(nachLesen) && /95 Teilnehmer/.test(nachLesen))
  pruefe('Nichts ist dabei gespeichert worden',
    server.zeilen('gym_competitions').length === 0)

  /* ------------------------------------------ Teilnehmer vorgeschlagen */
  pruefe('Erik wird vorgeschlagen', /Vorschlag/.test(nachLesen))
  const vorschlagZeile = pc.page.locator('.modal .list-row', { hasText: 'Vorschlag' }).first()
  pruefe('Der Vorschlag ist Erik Ehnert',
    /Ehnert, Erik/.test(await vorschlagZeile.innerText()))
  pruefe('Mit Jahrgang, Verein und Klasse daneben',
    /2006/.test(await vorschlagZeile.innerText())
    && /SG Empor Possendorf/.test(await vorschlagZeile.innerText())
    && /LK 2 AK 18-29/.test(await vorschlagZeile.innerText()))

  // Die Liste laesst sich durchsuchen, und alle 95 stehen zur Wahl.
  const suchfeld = pc.page.locator('.modal input[placeholder="Suchen…"]').first()
  await suchfeld.fill('')
  await pc.page.waitForTimeout(600)
  const alle = await pc.page.locator('.modal .list-row').count()
  pruefe('Ohne Suche stehen viele Teilnehmer zur Wahl', alle >= 60, `${alle} Zeilen`)
  // Der Verein der drei Teilnehmer ohne Jahrgang - im Testbestand ersetzt,
  // aber weiterhin von genau diesen dreien geteilt.
  await suchfeld.fill('TV zu Beispielheim-Süd')
  await pc.page.waitForTimeout(600)
  pruefe('Die Suche findet auch über den Verein',
    (await pc.page.locator('.modal .list-row').count()) === 3)
  await suchfeld.fill('Ehnert')
  await pc.page.waitForTimeout(600)
  pruefe('Und über den Namen',
    (await pc.page.locator('.modal .list-row').count()) === 1)

  /* --------------------------------------------- Vorschau im Editor */
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  const vorschau = await pc.page.locator('.modal').first().innerText()
  pruefe('Danach geht der gewöhnliche Wettkampfeditor auf', /Protokoll prüfen/.test(vorschau))
  pruefe('Er nennt die Quelldatei', /Sachsenmeisterschaft 2026 Einzel\.pdf/.test(vorschau))
  pruefe('Und sagt, dass nichts gespeichert ist', /Nichts davon ist gespeichert/.test(vorschau))
  pruefe('Der Knopf heisst „Import bestätigen"',
    (await pc.page.locator('.modal button', { hasText: 'Import bestätigen' }).count()) === 1)

  const kopf = pc.page.locator('.modal').first()
  pruefe('Der Wettkampfname steht da',
    (await kopf.locator('.field', { hasText: 'Name' }).locator('input').first().inputValue())
      === 'Sächsische Einzelmeisterschaften männlich')
  pruefe('Das Datum steht da',
    (await kopf.locator('.field', { hasText: 'Datum' }).locator('input').first().inputValue())
      === '2026-05-10')
  pruefe('Der Ort steht da',
    (await kopf.locator('.field', { hasText: 'Ort' }).locator('input').first().inputValue())
      === 'Bannewitz')
  pruefe('Die Klasse steht in der Klasse',
    (await kopf.locator('.field', { hasText: 'Klasse' }).locator('input').first().inputValue())
      === 'LK 2 AK 18-29')
  pruefe('Die Mehrkampfnote steht da',
    (await kopf.locator('.field', { hasText: 'Mehrkampfnote' }).locator('input').first().inputValue())
      === '67,181')
  pruefe('Der Mehrkampfplatz steht da',
    (await kopf.locator('.field', { hasText: 'Mehrkampfplatz' }).locator('input').first().inputValue())
      === '2')

  const karten = await pc.page.locator('.modal .wk-karte').count()
  pruefe('Alle sechs Geräte stehen da', karten === 6, `${karten} Karten`)

  const erwartet = {
    Boden: ['2,9', '8,666', '11,566'],
    Pauschenpferd: ['3,1', '8,266', '11,366'],
    Ringe: ['3,3', '8,366', '11,666'],
    Sprung: ['1,9', '9,1', '11,0'],
    Barren: ['2,9', '8,733', '11,633'],
    Reck: ['2,1', '7,85', '9,95'],
  }
  for (const [geraet, [d, e, endnote]] of Object.entries(erwartet)) {
    const ist = [await feld(pc, geraet, 'D-Wert'), await feld(pc, geraet, 'E-Wert'),
      await feld(pc, geraet, 'Endnote')]
    pruefe(`${geraet}: D, E und Endnote stimmen`,
      JSON.stringify(ist) === JSON.stringify([d, e, endnote]),
      `${ist.join(' / ')} statt ${[d, e, endnote].join(' / ')}`)
  }
  pruefe('Kein Abzug, wo keiner stand', (await feld(pc, 'Boden', 'Abzug')) === '')
  pruefe('Kein Plausibilitätshinweis – die Rechnung geht auf',
    !/Beides kann richtig sein/.test(vorschau))

  /* ---------------------------------------------- Eine Angabe ändern */
  const reck = pc.page.locator('.modal .wk-karte').filter({ hasText: 'Reck' }).first()
  await reck.locator('.field', { hasText: 'Platz' }).locator('input').first().fill('4')
  await pc.page.waitForTimeout(400)
  pruefe('Jede Angabe lässt sich vor dem Speichern ändern',
    (await feld(pc, 'Reck', 'Platz')) === '4')

  /* ------------------------------------------------ Kür dazuwählen */
  await reck.locator('button', { hasText: 'Kür auswählen' }).first().click()
  await pc.page.waitForTimeout(800)
  const kuerText = await pc.page.locator('.modal').last().innerText()
  pruefe('Die Kür wird gefragt und nicht von selbst übernommen',
    /festgehalten/.test(kuerText) && /Reckkür 2026/.test(kuerText))
  await pc.page.locator('.modal').last().locator('.list-row', { hasText: 'Reckkür 2026' }).first().click()
  await pc.page.waitForTimeout(800)

  /* -------------------------------------------------- Bestätigen */
  pruefe('Vor dem Bestätigen steht nichts in der Datenbank',
    server.zeilen('gym_competitions').length === 0 && server.zeilen('gym_results').length === 0)

  await pc.page.locator('.modal').last().locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(1800)
  const nachImport = await text(pc)
  pruefe('Der Wettkampf steht danach in der Liste',
    /Sächsische Einzelmeisterschaften männlich/.test(nachImport))
  pruefe('Mit sechs Geräten', /6 Geräte/.test(nachImport))
  pruefe('Und der Mehrkampfnote', /67,181/.test(nachImport))

  await abgleich(pc)
  pruefe('Auf dem Server liegt ein Wettkampf',
    server.zeilen('gym_competitions').length === 1)
  pruefe('Mit sechs Ergebnissen', server.zeilen('gym_results').length === 6,
    `${server.zeilen('gym_results').length}`)
  const wkZeile = server.zeilen('gym_competitions')[0]
  pruefe('Die Klasse steht in class_name', wkZeile.class_name === 'LK 2 AK 18-29', wkZeile.class_name)
  pruefe('Datum und Ort stimmen',
    wkZeile.day === '2026-05-10' && wkZeile.location === 'Bannewitz')
  pruefe('Die Mehrkampfnote ist gespeichert', wkZeile.score_allround === 67.181,
    String(wkZeile.score_allround))

  const boden = server.zeilen('gym_results').find((r) => r.apparatus === 'boden')
  pruefe('Bodens Werte stehen als Zahlen in der Datenbank',
    boden.d_score === 2.9 && boden.e_score === 8.666 && boden.final_score === 11.566,
    `${boden.d_score} / ${boden.e_score} / ${boden.final_score}`)
  pruefe('Ein fehlender Abzug ist null und nicht 0', boden.penalty === null,
    String(boden.penalty))

  const reckZeile = server.zeilen('gym_results').find((r) => r.apparatus === 'reck')
  pruefe('Die geänderte Platzierung ist übernommen', reckZeile.rank_apparatus === 4,
    String(reckZeile.rank_apparatus))
  pruefe('Die gewählte Kür ist als Fassung festgehalten',
    !!reckZeile.routine_version_id)
  pruefe('Die Fassung liegt als eigene Zeile vor',
    server.zeilen('gym_routine_versions').length === 1)
  pruefe('Mit ihren beiden Elementen',
    server.zeilen('gym_routine_version_elements').length === 2)
  pruefe('Die anderen Geräte haben keine Kür',
    server.zeilen('gym_results').filter((r) => r.routine_version_id).length === 1)

  /* ============================== Zweiter Import: keine Dubletten */
  await waehleDatei(pc, PDF_DATEI)
  await pc.page.waitForTimeout(400)
  await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill('Ehnert')
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  const zweiter = await pc.page.locator('.modal').first().innerText()
  pruefe('Der zweite Import erkennt den vorhandenen Wettkampf',
    /gibt es schon/.test(zweiter))
  pruefe('Und sagt, dass er aktualisiert wird', /aktualisiert/.test(zweiter))

  await pc.page.locator('.modal').last().locator('button', { hasText: 'Import bestätigen' }).first().click()
  await pc.page.waitForTimeout(1800)
  await abgleich(pc)
  pruefe('Es bleibt bei EINEM Wettkampf',
    server.zeilen('gym_competitions').length === 1,
    `${server.zeilen('gym_competitions').length}`)
  pruefe('Und bei sechs Ergebnissen',
    server.zeilen('gym_results').length === 6,
    `${server.zeilen('gym_results').length}`)
  pruefe('Die Kürfassung wurde nicht verdoppelt',
    server.zeilen('gym_routine_versions').length === 1)

  /* ================================ Anderer Teilnehmer, anderer Wettkampf */
  await waehleDatei(pc, PDF_DATEI)
  const andererName = nameVon('LK 3 AK -13', 1)
  await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill(andererName)
  await pc.page.waitForTimeout(600)
  const andere = await pc.page.locator('.modal .list-row').count()
  pruefe('Ein Teilnehmer einer anderen Klasse lässt sich wählen', andere === 1, `${andere} Treffer`)
  pruefe('Seine Zeile nennt die richtige Klasse',
    /LK 3 AK -13/.test(await pc.page.locator('.modal .list-row').first().innerText()))
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  // Der Wert eines Eingabefelds steht NICHT im innerText - er muss als Wert
  // gelesen werden. Sonst prueft die Zeile nur, dass irgendwo der Text steht.
  const andereKlasse = await pc.page.locator('.modal').first()
    .locator('.field', { hasText: 'Klasse' }).locator('input').first().inputValue()
  pruefe('Seine Klasse steht im Entwurf', andereKlasse === 'LK 3 AK -13', andereKlasse)
  pruefe('Und LifeHub meldet, dass der Wettkampf schon da ist',
    /gibt es schon/.test(await pc.page.locator('.modal').first().innerText()))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ============================================ Abzug und (+) im Import */
  await waehleDatei(pc, PDF_DATEI)
  // Rang 6 dieser Klasse traegt einen Abzug an den Ringen.
  const mitAbzugName = nameVon('LK 2 AK 18-29', 6)
  await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill(mitAbzugName)
  await pc.page.waitForTimeout(600)
  pruefe('Der Teilnehmer mit Abzug ist eindeutig zu finden',
    (await pc.page.locator('.modal .list-row').count()) === 1)
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  pruefe('Der Abzug landet als Betrag im Abzugsfeld',
    (await feld(pc, 'Ringe', 'Abzug')) === '1,0',
    await feld(pc, 'Ringe', 'Abzug'))
  pruefe('D und E sind dadurch nicht verrutscht',
    (await feld(pc, 'Ringe', 'D-Wert')) === '2,4'
    && (await feld(pc, 'Ringe', 'E-Wert')) === '7,733')
  pruefe('Und die Endnote auch nicht',
    (await feld(pc, 'Ringe', 'Endnote')) === '9,133')
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  await waehleDatei(pc, PDF_DATEI)
  // Rang 3 dieser Klasse traegt (+) an Sprung und Reck.
  const mitPlusName = nameVon('LK 2 AK 18-29', 3)
  await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill(mitPlusName)
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  const mitPlus = await pc.page.locator('.modal').first().innerText()
  pruefe('Die Kennzeichnung (+) wird genannt', /Kennzeichnungen/.test(mitPlus) && /\(\+\)/.test(mitPlus))
  pruefe('Ohne sie zu deuten', /nicht hervor/.test(mitPlus))
  pruefe('Der D-Wert bleibt sauber', (await feld(pc, 'Sprung', 'D-Wert')) === '1,9')
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ================================ Nullwerte kommen als Nullen an */
  await waehleDatei(pc, PDF_DATEI)
  // Rang 6 dieser Klasse hat am Boden 0.0 / 0.000 / 0.000 und am Reck -4.0.
  const mitNullName = nameVon('LK 1 AK 16/17', 6)
  await pc.page.locator('.modal input[placeholder="Suchen…"]').first().fill(mitNullName)
  await pc.page.waitForTimeout(600)
  await pc.page.locator('.modal .list-row').first().click()
  await pc.page.waitForTimeout(1200)
  pruefe('Eine echte 0 steht als 0 da und nicht leer',
    (await feld(pc, 'Boden', 'D-Wert')) === '0,0'
    && (await feld(pc, 'Boden', 'Endnote')) === '0,0',
    `${await feld(pc, 'Boden', 'D-Wert')} / ${await feld(pc, 'Boden', 'Endnote')}`)
  pruefe('Ein hoher Abzug kommt ebenfalls an',
    (await feld(pc, 'Reck', 'Abzug')) === '4,0')
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(600)

  /* ================================================= Handy: 390 px, dunkel */
  await abgleich(pc)
  handy = await starteGeraet({ name: 'import-handy', url: web.url, viewport: { width: 390, height: 844 } })
  pruefe('Handy meldet sich an', await anmelden(handy, ZUGANG))
  await abgleich(handy)

  await geh(handy, '/turnen/wettkaempfe', 2000)
  pruefe('Handy sieht den importierten Wettkampf',
    /Sächsische Einzelmeisterschaften männlich/.test(await text(handy)))

  await waehleDatei(handy, PDF_DATEI)
  const breiteWahl = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Die Teilnehmerauswahl bleibt auf 390 px im Rahmen',
    breiteWahl.doc <= breiteWahl.fenster + 1,
    `${breiteWahl.doc} px Inhalt, ${breiteWahl.fenster} px Fenster`)

  await handy.page.locator('.modal input[placeholder="Suchen…"]').first().fill('Ehnert')
  await handy.page.waitForTimeout(600)
  await handy.page.locator('.modal .list-row').first().click()
  await handy.page.waitForTimeout(1400)
  const breiteVorschau = await handy.page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, fenster: window.innerWidth,
  }))
  pruefe('Auch die Vorschau läuft auf 390 px nicht heraus',
    breiteVorschau.doc <= breiteVorschau.fenster + 1,
    `${breiteVorschau.doc} px Inhalt, ${breiteVorschau.fenster} px Fenster`)

  await handy.page.emulateMedia({ colorScheme: 'dark' })
  await handy.page.waitForTimeout(800)
  const dunkel = await handy.page.evaluate(() => {
    const kasten = document.querySelector('.modal .hint-box')
    return kasten ? {
      thema: document.documentElement.getAttribute('data-theme'),
      hintergrund: getComputedStyle(kasten).backgroundColor,
    } : null
  })
  pruefe('Die dunkle Ansicht greift auch im Import', dunkel?.thema === 'dark',
    JSON.stringify(dunkel))
  await handy.page.emulateMedia({ colorScheme: 'light' })
  await handy.page.waitForTimeout(500)
  await handy.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await handy.page.waitForTimeout(600)

  /* ------------------------------------ Regression: Handeingabe lebt */
  await geh(pc, '/turnen/wettkaempfe', 1500)
  await pc.page.locator('button', { hasText: '+ Wettkampf' }).first().click()
  await pc.page.waitForTimeout(800)
  const handEingabe = await pc.page.locator('.modal').last().innerText()
  pruefe('Die Handeingabe ist unverändert erreichbar',
    /Neuer Wettkampf/.test(handEingabe) && !/Protokoll prüfen/.test(handEingabe))
  await pc.page.locator('.modal').last().locator('button', { hasText: 'Abbrechen' }).first().click()
  await pc.page.waitForTimeout(500)

  /* ------------------------------------------------- Konsolenfehler */
  const echte = [...pc.fehler, ...handy.fehler].filter(
    (f) => !/favicon|manifest|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|415|422/i.test(f))
  pruefe('Keine Fehler in der Konsole', echte.length === 0, echte.slice(0, 2).join(' | '))
} finally {
  await pc?.stop()
  await handy?.stop()
  await web.stop()
  await server.stop()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
