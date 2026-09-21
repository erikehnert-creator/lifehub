/**
 * Der ganze Weg vom echten PDF bis zu den Werten – örtlich.
 *
 * Die Unit-Tests rechnen den Leser gegen einen Textbestand nach; der E2E prüft
 * den Weg durch die Oberfläche. Dazwischen liegt ein Stück, das keiner von
 * beiden berührt: **PDF → Textstücke**. Genau das macht dieser Lauf, mit
 * derselben Bibliothek und denselben Aufrufen wie die Edge Function.
 *
 * Er läuft nicht in `npm test`, weil er zwei Dinge braucht, die nicht im
 * Repository liegen (und aus gutem Grund nicht):
 *
 *   - `unpdf`, die PDF-Bibliothek der Edge Function
 *   - das echte Protokoll, das Namen und Jahrgänge von 95 Teilnehmern enthält
 *
 * Aufruf:
 *
 *   npm install --no-save unpdf
 *   node tests/protokoll-integration.mjs "<pfad/zum/protokoll.pdf>"
 *
 * Ohne Pfad sucht er das Beispielprotokoll im Download-Ordner. Fehlt eines von
 * beidem, meldet er sich ab, statt rot zu werden.
 */
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseProtokoll } from '../supabase/functions/wettkampf-import/protokoll.ts'
import { pruefer } from './_sync-app.mjs'

const { pruefe, fehlend } = pruefer()

const VORGABE = path.join(os.homedir(), 'Downloads', 'Sachsenmeisterschaft 2026 Einzel.pdf')
const pdfPfad = process.argv[2] ?? VORGABE

if (!existsSync(pdfPfad)) {
  console.log(`\n  ÜBERSPRUNGEN: Kein Protokoll gefunden.\n  (gesucht: ${pdfPfad})\n`)
  process.exit(0)
}

let getDocumentProxy
try {
  ({ getDocumentProxy } = await import('unpdf'))
} catch {
  console.log('\n  ÜBERSPRUNGEN: unpdf fehlt. Erst `npm install --no-save unpdf`.\n')
  process.exit(0)
}

console.log(`\n=== Protokoll-Integration: ${path.basename(pdfPfad)} ===\n`)

/* ------------------------------------ PDF → Textstücke, wie in der Funktion */

const bytes = new Uint8Array(readFileSync(pdfPfad))
console.log(`  Datei: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`)

const t0 = Date.now()
const pdf = await getDocumentProxy(bytes)
const seiten = []
for (let s = 1; s <= pdf.numPages; s++) {
  const seite = await pdf.getPage(s)
  const inhalt = await seite.getTextContent()
  seiten.push(inhalt.items
    .filter((i) => typeof i.str === 'string' && i.str.trim())
    .map((i) => ({
      text: i.str.trim(),
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
    })))
}
const extrahiert = Date.now() - t0

const t1 = Date.now()
const ergebnis = parseProtokoll(seiten)
const geparst = Date.now() - t1

console.log(`  Textextraktion: ${extrahiert} ms`)
console.log(`  Deutung:        ${geparst} ms`)
console.log(`  Zusammen:       ${extrahiert + geparst} ms\n`)

/* ------------------------------------------------------------ Prüfungen */

pruefe('Die PDF hat eine Textebene', seiten.some((s) => s.length))
pruefe('Alle Seiten sind gelesen', ergebnis.seiten === pdf.numPages,
  `${ergebnis.seiten} von ${pdf.numPages}`)
pruefe('Keine Warnungen', ergebnis.warnungen.length === 0,
  ergebnis.warnungen.join(' '))
pruefe('Teilnehmer gefunden', ergebnis.teilnehmer.length > 0,
  `${ergebnis.teilnehmer.length}`)
pruefe('Wettkampfname erkannt', ergebnis.wettkampf.name.sicherheit === 'exact',
  ergebnis.wettkampf.name.wert ?? '—')
pruefe('Ort und Datum erkannt',
  ergebnis.wettkampf.ort.sicherheit === 'exact' && ergebnis.wettkampf.tag.sicherheit === 'exact',
  `${ergebnis.wettkampf.ort.wert} · ${ergebnis.wettkampf.tag.wert}`)

// Die Rechnung muss ueberall aufgehen - das ist die schaerfste Probe darauf,
// dass nichts verrutscht ist.
let schief = 0
for (const t of ergebnis.teilnehmer) {
  for (const g of t.geraete) {
    if (g.d.wert === null || g.e.wert === null || g.final.wert === null) continue
    const summe = g.d.wert + g.e.wert - (g.penalty.wert ?? 0)
    if (Math.abs(Math.round((summe - g.final.wert) * 1000) / 1000) >= 0.0005) schief++
  }
}
pruefe('D + E − Abzug geht bei jeder Gerätewertung auf', schief === 0,
  `${ergebnis.teilnehmer.length * 6} Wertungen, ${schief} schief`)

/* ---------------------------- Der benannte Prüfstein, falls er dabei ist */

const erik = ergebnis.teilnehmer.find((t) => (t.name.wert ?? '').includes('Ehnert'))
if (erik) {
  pruefe('Erik Ehnert steht in LK 2 AK 18-29 auf Rang 2',
    erik.klasse === 'LK 2 AK 18-29' && erik.rang.wert === 2,
    `${erik.klasse}, Rang ${erik.rang.wert}`)
  pruefe('Seine sechs D-Werte stimmen',
    JSON.stringify(erik.geraete.map((g) => g.d.wert)) === JSON.stringify([2.9, 3.1, 3.3, 1.9, 2.9, 2.1]),
    erik.geraete.map((g) => g.d.wert).join(' '))
  pruefe('Seine sechs E-Werte stimmen',
    JSON.stringify(erik.geraete.map((g) => g.e.wert)) === JSON.stringify([8.666, 8.266, 8.366, 9.1, 8.733, 7.85]),
    erik.geraete.map((g) => g.e.wert).join(' '))
  pruefe('Seine sechs Endnoten stimmen',
    JSON.stringify(erik.geraete.map((g) => g.final.wert)) === JSON.stringify([11.566, 11.366, 11.666, 11, 11.633, 9.95]),
    erik.geraete.map((g) => g.final.wert).join(' '))
  pruefe('Seine Gesamtpunktzahl ist 67,181', erik.gesamt.wert === 67.181, String(erik.gesamt.wert))
  pruefe('Jahrgang und Verein stimmen',
    erik.jahrgang.wert === 2006 && erik.verein.wert === 'SG Empor Possendorf',
    `${erik.jahrgang.wert} · ${erik.verein.wert}`)
} else {
  console.log('  (kein Eintrag „Ehnert" in diesem Protokoll – die benannten Prüfungen entfallen)')
}

console.log(fehlend.length === 0
  ? '\n=== alles bestanden ===\n'
  : `\n=== ${fehlend.length} FEHLER: ${fehlend.join(', ')} ===\n`)
process.exit(fehlend.length === 0 ? 0 : 1)
