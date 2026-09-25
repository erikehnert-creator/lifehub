/**
 * Der Konkurrenzvergleich gegen das ECHTE Protokoll – nur örtlich.
 *
 * ---------------------------------------------------------------------------
 * Warum dieser Lauf zusätzlich zu `turnen-vergleich.test.ts` besteht
 *
 * Die Prüfungen dort rechnen gegen `fixtures/protokoll-score-2026.json`. Darin
 * sind alle Zahlen und Klassen unverändert, ersetzt sind Namen, Jahrgänge und
 * Vereine. Für den Vergleich genügt das – er sieht nur Zahlen.
 *
 * Was der Bestand nicht abdeckt, ist das Stück **PDF → Textstücke**. Genau das
 * deckt dieser Lauf ab: dieselbe Grundwahrheit, aber vom echten PDF aus, mit
 * derselben Bibliothek und denselben Aufrufen wie die Edge Function.
 *
 * ---------------------------------------------------------------------------
 * Er übergeht sich selbst, wenn etwas fehlt
 *
 * Gebraucht werden zwei Dinge, die nicht im Repository liegen und aus gutem
 * Grund nicht dort liegen:
 *
 *   - `unpdf`, die PDF-Bibliothek der Edge Function (`npm install --no-save unpdf`)
 *   - das echte Protokoll, das Namen und Jahrgänge von 95 Teilnehmern nennt
 *
 * Fehlt eines, melden sich die Prüfungen ab statt rot zu werden. Auf Eriks
 * Rechner laufen sie damit bei jedem `npm test` mit; überall sonst sind sie
 * still. Deshalb schwankt die Testzahl zwischen seinem Rechner und einem
 * frischen Klon – das ist Absicht.
 *
 * Gelesen wird nur; geschrieben wird nichts, und die PDF bleibt, wo sie ist.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseProtokoll, type ProtokollErgebnis, type TextStueck, type Teilnehmer,
} from '../supabase/functions/wettkampf-import/protokoll'
import { ausProtokoll, vergleichFuer } from '../src/core/turnen/protokollImport'
import { MEHRKAMPF, benchmarkWerte } from '../src/core/turnen/vergleich'
import { wettkampfAnalyse, type VergleichsWerte } from '../src/core/turnen/analyse'
import type { GymCompetition, GymResult } from '../src/core/types'

const PDF = process.env.LIFEHUB_PROTOKOLL
  ?? path.join(os.homedir(), 'Downloads', 'Sachsenmeisterschaft 2026 Einzel.pdf')

let unpdfDa = false
try {
  await import('unpdf')
  unpdfDa = true
} catch {
  unpdfDa = false
}

const laeuft = existsSync(PDF) && unpdfDa

if (!laeuft) {
  describe('Konkurrenzvergleich gegen das echte Protokoll', () => {
    it.skip(`übersprungen – ${existsSync(PDF) ? 'unpdf fehlt' : 'kein Protokoll gefunden'}`, () => {})
  })
}

describe.runIf(laeuft)('Konkurrenzvergleich gegen das echte Protokoll', () => {
  let protokoll: ProtokollErgebnis
  let erik: Teilnehmer
  let vergleich: ReturnType<typeof vergleichFuer>

  beforeAll(async () => {
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(PDF)))
    const seiten: TextStueck[][] = []
    for (let s = 1; s <= pdf.numPages; s++) {
      const inhalt = await (await pdf.getPage(s)).getTextContent()
      seiten.push((inhalt.items as any[])
        .filter((i) => typeof i.str === 'string' && i.str.trim())
        .map((i) => ({
          text: i.str.trim(),
          x: Math.round(i.transform[4]),
          y: Math.round(i.transform[5]),
        })))
    }
    protokoll = parseProtokoll(seiten)
    const treffer = protokoll.teilnehmer.filter((t) => (t.name.wert ?? '').includes('Ehnert'))
    expect(treffer, 'genau ein Eintrag Ehnert').toHaveLength(1)
    erik = treffer[0]
    vergleich = vergleichFuer(protokoll, erik)
  })

  const kurz = (r: { rang: number; gleich: number; anzahl: number } | null | undefined) =>
    (r ? `${r.rang}${r.gleich > 1 ? 'g' : ''}/${r.anzahl}` : '—')

  it('bildet die Gruppe aus sechs Turnern und nicht aus allen 95', () => {
    expect(vergleich.grund).toBeNull()
    expect(vergleich.klasse).toBe('LK 2 AK 18-29')
    expect(protokoll.teilnehmer.length).toBe(95)
    for (const z of vergleich.zeilen) expect(z.feldgroesse).toBe(6)
  })

  /** Die Grundwahrheit. `g` heisst geteilt. */
  const SOLL: Record<string, [string, string, string]> = {
    boden: ['4g/6', '1/6', '4/6'],
    pauschenpferd: ['2g/6', '1/6', '1/6'],
    ringe: ['3/6', '2/6', '2/6'],
    sprung: ['2g/6', '1/6', '1/6'],
    barren: ['4g/6', '1/6', '4/6'],
    reck: ['4/6', '4/6', '4/6'],
  }

  for (const [apparatus, [sd, se, sf]] of Object.entries(SOLL)) {
    it(`${apparatus}: D ${sd}, E ${se}, Endnote ${sf}`, () => {
      const z = vergleich.zeilen.find((x) => x.scope === apparatus)
      expect(kurz(z?.d)).toBe(sd)
      expect(kurz(z?.e)).toBe(se)
      expect(kurz(z?.final)).toBe(sf)
    })
  }

  it('Mehrkampf: 2 von 6', () => {
    expect(kurz(vergleich.zeilen.find((x) => x.scope === MEHRKAMPF)?.final)).toBe('2/6')
  })

  /* ------------------------------------------ Die Deutung, nicht die Zahl */

  const analyseBauen = () => {
    const wettkampf = {
      id: 'wk', day: protokoll.wettkampf.tag.wert, name: protokoll.wettkampf.name.wert,
      class_name: erik.klasse, rank_allround: erik.rang.wert,
      score_allround: erik.gesamt.wert, deleted_at: null,
    } as unknown as GymCompetition
    const eigene = erik.geraete.map((g) => ({
      id: `r-${g.apparatus}`, competition_id: 'wk', apparatus: g.apparatus,
      d_score: g.d.wert, e_score: g.e.wert, penalty: g.penalty.wert,
      final_score: g.final.wert, rank_apparatus: null, deleted_at: null,
    }) as unknown as GymResult)
    const benchmarks = benchmarkWerte('wk', vergleich.zeilen, 'jetzt')
      .map((w) => w.values as unknown as VergleichsWerte)
    return { wettkampf, eigene, benchmarks, analyse: wettkampfAnalyse(wettkampf, eigene, benchmarks) }
  }

  const FOKUS: Record<string, string> = {
    boden: 'schwierigkeit',
    pauschenpferd: 'halten',
    ringe: 'halten',
    sprung: 'halten',
    barren: 'schwierigkeit',
    reck: 'beides',
  }

  for (const [apparatus, soll] of Object.entries(FOKUS)) {
    it(`${apparatus}: Fokus ${soll}`, () => {
      const g = analyseBauen().analyse.geraete.find((x) => x.apparatus === apparatus)
      expect(g?.fokus).toBe(soll)
    })
  }

  it('bewertet den Sprung nicht wegen seiner niedrigeren Rohnote als schwach', () => {
    const { analyse } = analyseBauen()
    const sp = analyse.geraete.find((g) => g.apparatus === 'sprung')!
    for (const a of ['boden', 'barren', 'ringe']) {
      const g = analyse.geraete.find((x) => x.apparatus === a)!
      expect(sp.final.wert as number, `Sprung roh unter ${a}`)
        .toBeLessThan(g.final.wert as number)
      expect(sp.final.position as number, `Sprung relativ über ${a}`)
        .toBeGreaterThan(g.final.position as number)
    }
    expect(sp.final.rang).toBe(1)
  })

  it('merkt, dass die höchste Rohnote nicht das relativ stärkste Gerät ist', () => {
    const { analyse } = analyseBauen()
    expect(analyse.rohnoteTaeuscht).toBe(true)
    expect(analyse.hoechsteRohnote).toEqual(['ringe'])
    expect(analyse.staerkste.sort()).toEqual(['pauschenpferd', 'sprung'])
  })

  /* --------------------------------------------------------- Datenschutz */

  it('lässt aus dem echten Protokoll nur Klasse, Rang, Gesamt und Geräte in den Vergleich', () => {
    expect(Object.keys(ausProtokoll(erik)).sort())
      .toEqual(['geraete', 'gesamt', 'klasse', 'rang'])
  })

  it('speichert keinen fremden Namen, Verein oder Jahrgang', () => {
    const text = JSON.stringify(benchmarkWerte('wk', vergleich.zeilen, 'jetzt'))
    for (const t of protokoll.teilnehmer) {
      const nachname = (t.name.wert ?? '').split(',')[0].trim()
      if (nachname && nachname !== 'Ehnert') {
        expect(text.includes(nachname), 'ein fremder Nachname').toBe(false)
      }
      if (t.verein.wert && t.verein.wert !== erik.verein.wert) {
        expect(text.includes(t.verein.wert), 'ein fremder Verein').toBe(false)
      }
      if (t.jahrgang.wert && t.jahrgang.wert !== erik.jahrgang.wert) {
        expect(text.includes(String(t.jahrgang.wert)), 'ein fremder Jahrgang').toBe(false)
      }
    }
  })

  it('erfindet ohne Vergleichswerte keine Plätze', () => {
    const { wettkampf, eigene } = analyseBauen()
    const ohne = wettkampfAnalyse(wettkampf, eigene, [])
    for (const g of ohne.geraete) {
      expect(g.final.rang).toBeNull()
      expect(g.fokus).toBe('zu_wenig_daten')
    }
  })
})
