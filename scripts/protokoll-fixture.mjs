/**
 * Aus einem Wettkampfprotokoll einen Testbestand machen.
 *
 * Der Parser (`supabase/functions/wettkampf-import/protokoll.ts`) arbeitet auf
 * Textstücken mit Koordinaten, nicht auf einer PDF. Dieses Skript holt genau
 * diese Textstücke heraus und legt sie als JSON ab – damit laufen die Tests
 * ohne PDF-Bibliothek und ohne die PDF selbst.
 *
 * ---------------------------------------------------------------------------
 * Warum die Namen ersetzt werden
 *
 * Dieses Repository ist öffentlich. Ein Wettkampfprotokoll enthält Namen,
 * Jahrgänge und Vereine von Teilnehmern – im Beispiel überwiegend
 * Minderjährige. Die gehören nicht in einen öffentlichen Git-Verlauf, nur
 * damit ein Test läuft.
 *
 * Ersetzt wird deshalb **nur der Name**, und zwar an derselben Stelle und in
 * derselben Form („Nachname, Vorname"). Alles, worauf der Parser prüft, bleibt
 * unangetastet: Ränge, Jahrgänge, Vereine, sämtliche Zahlen, Abzüge,
 * Kennzeichnungen, Nullwerte und die fehlenden Jahrgänge.
 *
 * `--behalte "Ehnert"` lässt die eigenen Zeilen im Klartext stehen – Eriks
 * eigene Daten in seinem eigenen Repository.
 *
 * ---------------------------------------------------------------------------
 * Aufruf
 *
 *   node scripts/protokoll-fixture.mjs <pdf> <ziel.json> [--behalte Name] [--klar]
 *
 * `--klar` schreibt die Namen unverändert. Nur für den örtlichen Lauf gegen
 * das echte Protokoll gedacht, niemals für eine eingecheckte Datei.
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

const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPfad)))

/** Die Spalte, in der die Namen stehen – aus dem Spaltenkopf der ersten Seite. */
let namensSpalteX = null

const seiten = []
for (let s = 1; s <= pdf.numPages; s++) {
  const page = await pdf.getPage(s)
  const inhalt = await page.getTextContent()
  const stuecke = inhalt.items
    .filter((i) => typeof i.str === 'string' && i.str.trim())
    .map((i) => ({
      text: i.str.trim(),
      // Auf ganze Einheiten runden: Der Parser fasst Spalten mit 5 und Zeilen
      // mit 12 Einheiten Abstand zusammen - Nachkommastellen aendern daran
      // nichts und blaehen die Datei nur auf.
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
    }))
  seiten.push(stuecke)
}

if (!klar) {
  // Die Namensspalte ist die, in der "Name" im Spaltenkopf steht. Die Eintraege
  // stehen linksbuendig weiter links als die Kopfzeile, deshalb wird die
  // Spalte ueber die zweithaeufigste x-Position im Koerper bestimmt: Rang,
  // Name, Verein. Einfacher und zuverlaessiger: die x-Position des ersten
  // Nicht-Zahl-Stuecks je Teilnehmerzeile.
  const haeufig = new Map()
  for (const stuecke of seiten) {
    for (const s of stuecke) {
      if (/^-?\d+([.,]\d+)?( \(.*\))?$/.test(s.text)) continue
      haeufig.set(s.x, (haeufig.get(s.x) ?? 0) + 1)
    }
  }
  // Die Namen sind die haeufigsten nichtnumerischen Stuecke ueberhaupt.
  namensSpalteX = [...haeufig.entries()].sort((a, b) => b[1] - a[1])[0][0]

  let n = 0
  for (const stuecke of seiten) {
    for (const s of stuecke) {
      if (s.x !== namensSpalteX) continue
      if (!s.text.includes(',')) continue          // Jahrgaenge und Kopfzeilen nicht
      if (behalte.some((b) => s.text.toLowerCase().includes(b))) continue
      n++
      s.text = `Nachname${String(n).padStart(2, '0')}, Vorname${String(n).padStart(2, '0')}`
    }
  }
  console.error(`${n} Namen ersetzt (Spalte x=${namensSpalteX}), ${behalte.length} Muster behalten.`)
}

writeFileSync(zielPfad, JSON.stringify(seiten) + '\n')
console.error(`${seiten.length} Seiten, ${seiten.reduce((a, s) => a + s.length, 0)} Textstücke → ${zielPfad}`)
