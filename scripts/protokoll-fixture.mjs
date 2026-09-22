/**
 * Aus einem Wettkampfprotokoll einen Testbestand machen.
 *
 * Der Parser (`supabase/functions/wettkampf-import/protokoll.ts`) arbeitet auf
 * Textstücken mit Koordinaten, nicht auf einer PDF. Dieses Skript holt genau
 * diese Textstücke heraus und legt sie als JSON ab – damit laufen die Tests
 * ohne PDF-Bibliothek und ohne die PDF selbst.
 *
 * ---------------------------------------------------------------------------
 * Warum die Personenangaben ersetzt werden
 *
 * Dieses Repository ist öffentlich. Ein Wettkampfprotokoll enthält Namen,
 * Jahrgänge und Vereine von Teilnehmern – im Beispiel überwiegend
 * Minderjährige. Die gehören nicht in einen öffentlichen Git-Verlauf, nur
 * damit ein Test läuft.
 *
 * Ersetzt werden deshalb **Name, Jahrgang und Verein**, und zwar an derselben
 * Stelle, in derselben Form und mit denselben Koordinaten. Nicht nur der Name:
 * Jahrgang und Verein zusammen mit einer Platzierung und sechs Noten grenzen
 * eine Person ebenso ein.
 *
 * **Unangetastet bleibt alles, woran der Parser geprüft wird:**
 *
 *   - sämtliche Zahlen (D, E, Abzüge, Endnoten, Gesamt)
 *   - die Kennzeichnungen `(+)`
 *   - echte Nullwerte
 *   - Ränge, auch die zweistelligen
 *   - die Klassen und ihre Reihenfolge
 *   - **ob** ein Jahrgang dasteht (drei Teilnehmer haben keinen)
 *   - **welche** Teilnehmer sich einen Verein teilen
 *   - die Form der Vereinsnamen (mehrteilig, mit Jahreszahl, mit Bindestrich)
 *   - die Form der Personennamen (auch die zwei- und dreiteiligen)
 *   - alle Koordinaten und damit die 16 Spaltenbündel je Zeile
 *
 * `--behalte "Ehnert"` lässt die eigenen Zeilen im Klartext stehen – Eriks
 * eigene Daten in seinem eigenen Repository.
 *
 * ---------------------------------------------------------------------------
 * Aufruf
 *
 *   node scripts/protokoll-fixture.mjs <pdf> <ziel.json> [--behalte Name] [--klar]
 *
 * `--klar` schreibt alles unverändert. Nur für den örtlichen Lauf gegen das
 * echte Protokoll gedacht, niemals für eine eingecheckte Datei.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { getDocumentProxy } from 'unpdf'

const [pdfPfad, zielPfad, ...rest] = process.argv.slice(2)
if (!pdfPfad || !zielPfad) {
  console.error('Aufruf: node scripts/protokoll-fixture.mjs <pdf> <ziel.json> [--behalte Name] [--klar]')
  process.exit(1)
}

const klar = rest.includes('--klar')
const behalte = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--behalte' && rest[i + 1]) behalte.push(rest[i + 1].toLowerCase())
}

/* ------------------------------------------------ Ersatzwerte
 *
 * Die Vereinsnamen bilden die Formen des echten Protokolls nach, ohne einen
 * echten zu nennen: Abkuerzung plus Ort, Ort plus Abkuerzung plus Jahreszahl,
 * Bindestrich, "zu". Danach reihum weitere - mehr Formen als Vereine schadet
 * nicht, weniger waere ein Verlust an Struktur.
 */
const ERSATZVEREINE = [
  'USV Musterstadt',
  'TV Musterstadt von 1871',
  'SSV Blau-Weiß Beispieldorf',
  'TV zu Beispielstadt-Nord',
  'SV Beispielstadt',
  'SG Musterdorf',
  'TuS Beispielheim',
  'ESV Musterstadt',
  'ATV Beispieldorf',
  'KTV Musterstadt',
  'SC Beispielstadt',
  'VSG Musterdorf',
  'TSV Beispielheim',
  'SV Musterbach',
  'TV Beispielau',
  'SG Musterberg',
  'TSV Musterau',
  'SV Blau-Gelb Musterdorf',
  'TV zu Beispielheim-Süd',
  'ESV Beispielau von 1898',
  'SG Musterstadt',
  'VSG Beispielstadt',
  'ATV Musterberg',
  'SC Musterdorf',
]

// Mehr Ersatznamen als echte Vereine: Fallen zwei echte auf denselben Ersatz,
// gaeben sich Teilnehmer einen Verein, die ihn nicht teilen - und die Pruefung
// "wer teilt sich einen Verein" ginge daran vorbei.

/**
 * Ein Ersatzname in derselben Form wie der echte.
 *
 * Zwei- und dreiteilige Namen kommen im Protokoll vor („Vorname Zweitname"
 * nach dem Komma, „Doppelname" davor). Die Form bleibt erhalten, damit der
 * Parser weiterhin an einem Namen mit Leerzeichen geprueft wird.
 */
function ersatzName(echt, n) {
  const nr = String(n).padStart(2, '0')
  const [vorKomma = '', nachKomma = ''] = echt.split(',')
  const teileVor = vorKomma.trim().split(/\s+/).length
  const teileNach = nachKomma.trim().split(/\s+/).filter(Boolean).length
  const nachname = teileVor > 1 ? `Nachname${nr} Doppelname${nr}` : `Nachname${nr}`
  const vorname = teileNach > 1 ? `Vorname${nr} Zweitname${nr}` : `Vorname${nr}`
  return `${nachname}, ${vorname}`
}

/**
 * Ein Ersatzjahrgang – einer je Klasse, aus der Altersangabe der Klasse.
 *
 * Damit bleibt der Wert plausibel (er passt zur Altersklasse), und er grenzt
 * niemanden mehr ein: Alle Teilnehmer einer Klasse tragen denselben.
 */
function ersatzJahrgang(klasse) {
  const m = klasse.match(/AK\s*-?(\d+)/)
  const alter = m ? Number(m[1]) : 12
  return String(2026 - Math.min(alter, 20))
}

/* ------------------------------------------------------- PDF einlesen */

const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPfad)))

const seiten = []
for (let s = 1; s <= pdf.numPages; s++) {
  const page = await pdf.getPage(s)
  const inhalt = await page.getTextContent()
  seiten.push(inhalt.items
    .filter((i) => typeof i.str === 'string' && i.str.trim())
    .map((i) => ({
      text: i.str.trim(),
      // Auf ganze Einheiten runden: Der Parser fasst Spalten mit 5 und Zeilen
      // mit 12 Einheiten Abstand zusammen - Nachkommastellen aendern daran
      // nichts und blaehen die Datei nur auf.
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
    })))
}

/* ------------------------------------------------------- Ersetzen
 *
 * Zeilen und Spalten genau wie im Parser: senkrecht verketten, dann waagerecht
 * gruppieren. Die ersten drei Buendel einer Teilnehmerzeile sind Rang, Name
 * (mit Jahrgang darunter) und Verein.
 */
if (!klar) {
  const vereinErsatz = new Map()
  let personen = 0
  let ersetzteNamen = 0
  let ersetzteVereine = 0
  let ersetzteJahre = 0
  let behalten = 0

  for (const stuecke of seiten) {
    if (!stuecke.length) continue
    const kopfY = [...new Set(stuecke.map((i) => i.y))].sort((a, b) => b - a)
    const klasse = stuecke.filter((i) => i.y === kopfY[0]).map((i) => i.text).join(' ')
    const koerper = stuecke.filter(
      (i) => i.y < kopfY[2] - 5 && !/^Seite\s+\d+\s*\/\s*\d+$/.test(i.text))

    // Zeilen
    const sortiert = [...koerper].sort((a, b) => b.y - a.y)
    const zeilen = []
    let aktuell = null
    let letztes = null
    for (const it of sortiert) {
      if (aktuell === null || letztes - it.y > 12) { aktuell = []; zeilen.push(aktuell) }
      aktuell.push(it)
      letztes = it.y
    }

    for (const zeile of zeilen) {
      const nachX = [...zeile].sort((a, b) => a.x - b.x || b.y - a.y)
      const buendel = []
      for (const it of nachX) {
        const letzte = buendel[buendel.length - 1]
        if (letzte && Math.abs(letzte[0].x - it.x) < 5) letzte.push(it)
        else buendel.push([it])
      }
      if (buendel.length !== 16) continue

      const namensSpalte = buendel[1]
      const vereinsSpalte = buendel[2]
      const name = namensSpalte[0]
      if (!name) continue

      personen++
      if (behalte.some((b) => name.text.toLowerCase().includes(b))) { behalten++; continue }

      name.text = ersatzName(name.text, personen)
      ersetzteNamen++

      // Der Jahrgang steht UNTER dem Namen - oder gar nicht. Dass er fehlt,
      // ist ein Pruefgegenstand und bleibt deshalb erhalten.
      if (namensSpalte[1]) {
        namensSpalte[1].text = ersatzJahrgang(klasse)
        ersetzteJahre++
      }

      // Wer sich einen Verein teilt, teilt ihn auch danach.
      const echterVerein = vereinsSpalte.map((i) => i.text).join(' ')
      if (!vereinErsatz.has(echterVerein)) {
        vereinErsatz.set(echterVerein, ERSATZVEREINE[vereinErsatz.size % ERSATZVEREINE.length])
      }
      if (vereinsSpalte.length === 1) {
        vereinsSpalte[0].text = vereinErsatz.get(echterVerein)
        ersetzteVereine++
      }
    }
  }

  console.error(`${personen} Teilnehmerzeilen: ${ersetzteNamen} Namen, ${ersetzteJahre} Jahrgänge, `
    + `${ersetzteVereine} Vereine ersetzt (${vereinErsatz.size} verschiedene), ${behalten} behalten.`)
}

writeFileSync(zielPfad, JSON.stringify(seiten) + '\n')
console.error(`${seiten.length} Seiten, ${seiten.reduce((a, s) => a + s.length, 0)} Textstücke → ${zielPfad}`)
